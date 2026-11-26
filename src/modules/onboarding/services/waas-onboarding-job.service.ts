import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { DatabaseService } from '../../../core/database/database.service';
import { AstppMysqlService } from '../../../core/astpp-mysql/astpp-mysql.service';
import { SasaPayWalletConfirmation, SasaPayWaasService } from './sasapay-waas.service';
import { JobService } from '../../../core/jobs/job.service';
import { mapAstppToPostgres, mapPostgresToSasaPay } from '../../../core/constants';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { parseDateOrNull, parseTimestampOrNull } from '../../../core/utils/date.util';
import { normalizePhoneNumber } from '../../../core/utils/phone-number.util';

export interface OnboardingJobPayload {
  customerId: number;
  astppId: number;
  applicationId: number | null;
  submissionId?: string;
  requestId?: string;
  otp?: string;
  providerConfirmation?: SasaPayWalletConfirmation;
}

interface OnboardingJobState {
  step: 'sasapay_init' | 'awaiting_otp' | 'fetch_images' | 'upload_kyc' | 'completed';
  sasapay_request_id?: string;
  sasapay_account_number?: string;
  sasapay_account_status?: string;
  images?: {
    front?: string;
    back?: string;
    selfie?: string;
    requiredDocuments?: string[];
    submissionId?: string;
    cleanupDirectory?: string;
  };
  error?: string;
}

@Injectable()
export class WaasOnboardingJobService {
  private readonly logger = new Logger(WaasOnboardingJobService.name);

  private async writeAuditLog(customerId: number, eventType: string, details: Record<string, unknown>): Promise<void> {
    await this.db.query(
      `INSERT INTO customer_activity_logs (customer_id, event_type, actor_type, actor_id, details, created_at)
       VALUES ($1, $2, 'SYSTEM', 'SASAPAY_WAAS_JOB', $3::jsonb, NOW())`,
      [customerId, eventType, details],
    );
  }

  private readonly astppImagesBaseUrl: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly astppMysql: AstppMysqlService,
    private readonly sasapayWaas: SasaPayWaasService,
    private readonly jobService: JobService,
    private readonly config: ConfigService,
  ) {
    this.astppImagesBaseUrl = this.config.get<string>('astpp.imagesBaseUrl') || '';
  }

  /**
   * Confirm OTP and Create SasaPay Wallet.
   * 
   * Job-based handler that processes OTP confirmation.
   * Called by job worker after claiming job with SELECT FOR UPDATE SKIP LOCKED.
   * 
   * Flow:
   * 1. Double-check wallet doesn't already exist (idempotency)
   * 2. Call SasaPay OTP confirmation API
   * 3. Create wallet record based on accountStatus:
   *    - AWAITING_KYC_UPLOAD → locked wallet, enqueue KYC upload job
   *    - ACTIVE → active wallet
   *    - AWAITING_APPROVAL → locked wallet, no KYC job
   */
  async confirmOtpAndCreateWallet(
    payload: OnboardingJobPayload & {
      requestId: string;
      otp?: string;
      providerConfirmation?: SasaPayWalletConfirmation;
    },
  ): Promise<void> {
    const { customerId, astppId, applicationId, requestId, otp, providerConfirmation } = payload;

    this.logger.log(`[OTP CONFIRM JOB] Processing OTP for customer ${customerId}, requestId: ${requestId}`);

    // --- 1. IDEMPOTENCY CHECK: Verify wallet doesn't already exist ---
    const existingApp = await this.db.queryOne(
      `SELECT sasapay_account_number FROM customer_applications WHERE id = $1`,
      [applicationId],
    );

    if (existingApp?.sasapay_account_number) {
      this.logger.warn(
        `[OTP CONFIRM JOB] Wallet already exists for customer ${customerId}: ${existingApp.sasapay_account_number}. Skipping.`,
      );
      await this.writeAuditLog(customerId, 'SASAPAY_OTP_JOB_SKIPPED_DUPLICATE', {
        requestId,
        existingAccountNumber: existingApp.sasapay_account_number,
        reason: 'Wallet already created, job was idempotent retry',
      });
      return; // Job completes successfully (idempotent)
    }

    // Consume the API's provider result, or confirm here for legacy jobs.
    let result: SasaPayWalletConfirmation;
    if (providerConfirmation) {
      result = providerConfirmation;
    } else {
      if (!otp) throw new Error('OTP confirmation job has no provider result or legacy OTP payload');
      result = await this.sasapayWaas.confirmPersonalOnboardingByRequestId(requestId, otp);
    }

    if (!result.status) {
      await this.writeAuditLog(customerId, 'SASAPAY_OTP_JOB_FAILED', {
        requestId,
        responseCode: result.responseCode,
        message: result.message,
        reason: 'SasaPay API returned error',
      });

      const error = new Error(`SasaPay OTP confirmation failed: ${result.message}`) as Error & {
        response?: { data: SasaPayWalletConfirmation };
      };
      error.response = { data: result };
      throw error;
    }

    const accountStatus = result.data?.accountStatus;
    const accountNumber = result.data?.accountNumber;

    if (!accountNumber) {
      throw new Error('SasaPay API did not return account number');
    }

    // --- 3. Update application with account details ---
    await this.db.query(
      `UPDATE customer_applications
       SET sasapay_account_number = $1,
           sasapay_account_status = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [accountNumber, accountStatus, applicationId],
    );

    await this.writeAuditLog(customerId, 'SASAPAY_OTP_CONFIRMED', {
      requestId,
      accountNumber,
      accountStatus,
      message: result.message,
    });

    this.logger.log(
      `[OTP CONFIRM JOB] Customer ${customerId} — SasaPay accountStatus: ${accountStatus}, accountNumber: ${accountNumber}`,
    );

    // --- 4. Create wallet based on accountStatus ---
    if (accountStatus === 'AWAITING_KYC_UPLOAD') {
      // Insert wallet as locked pending KYC upload
      await this.db.query(
        `INSERT INTO customer_wallets (
           customer_id, astpp_id, account_number, status,
           is_locked, lock_reason, locked_by, created_at, updated_at
         )
         VALUES ($1, $2, $3, 'locked', TRUE, 'Awaiting KYC upload', 'SYSTEM_KYC', NOW(), NOW())
         ON CONFLICT (account_number) DO NOTHING`,
        [customerId, astppId, accountNumber],
      );

      await this.db.query(
        `UPDATE customer_applications
         SET kyc_status = 'processing', updated_at = NOW()
         WHERE customer_id = $1`,
        [customerId],
      );

      await this.writeAuditLog(customerId, 'SASAPAY_KYC_UPLOAD_REQUIRED', {
        requestId,
        accountNumber,
        accountStatus,
        reason: 'Awaiting KYC upload',
      });

      // Enqueue KYC image upload job
      const kycJobUuid = await this.jobService.enqueue('sasapay_waas_kyc_upload', {
        customerId,
        astppId,
        applicationId: null,
      });

      await this.writeAuditLog(customerId, 'SASAPAY_KYC_UPLOAD_JOB_QUEUED', {
        requestId,
        accountNumber,
        jobUuid: kycJobUuid,
        jobType: 'sasapay_waas_kyc_upload',
      });

      this.logger.log(`[OTP CONFIRM JOB] Enqueued sasapay_waas_kyc_upload for customer ${customerId}`);

    } else if (accountStatus === 'ACTIVE') {
      await this.db.query(
        `INSERT INTO customer_wallets (
           customer_id, astpp_id, account_number, status, created_at, updated_at
         )
         VALUES ($1, $2, $3, 'active', NOW(), NOW())
         ON CONFLICT (account_number) DO NOTHING`,
        [customerId, astppId, accountNumber],
      );

      await this.db.query(
        `UPDATE customer_applications
         SET kyc_status = 'approved', updated_at = NOW()
         WHERE customer_id = $1`,
        [customerId],
      );

      await this.writeAuditLog(customerId, 'SASAPAY_WALLET_READY', {
        requestId,
        accountNumber,
        accountStatus,
        status: 'active',
      });

      this.logger.log(`[OTP CONFIRM JOB] Wallet activated for customer ${customerId}`);

    } else {
      // AWAITING_APPROVAL or unknown — lock wallet, no KYC job
      await this.db.query(
        `UPDATE customer_applications
         SET kyc_status = 'pending', updated_at = NOW()
         WHERE id = $1`,
        [applicationId],
      );

      await this.db.query(
        `INSERT INTO customer_wallets (
           customer_id, astpp_id, account_number, status,
           is_locked, lock_reason, locked_by, created_at, updated_at
         )
         VALUES ($1, $2, $3, 'locked', TRUE, 'Awaiting SasaPay approval', 'SYSTEM_KYC', NOW(), NOW())
         ON CONFLICT (account_number) DO NOTHING`,
        [customerId, astppId, accountNumber],
      );

      await this.writeAuditLog(customerId, 'SASAPAY_AWAITING_APPROVAL', {
        requestId,
        accountNumber,
        accountStatus,
        status: 'locked_awaiting_manual_review',
      });

      this.logger.log(`[OTP CONFIRM JOB] Wallet locked for customer ${customerId}, awaiting SasaPay approval`);
    }
  }

  // ---------------------------------------------------------------------------
  // AREA 0 — Customer existence check + MySQL fallback + PG upsert
  // ---------------------------------------------------------------------------

  /**
   * Step 1: Initiate SasaPay WaaS Personal Onboarding.
   *
   * - Ensures the customer exists in PostgreSQL (upserts from ASTPP MySQL if not).
   * - Calls SasaPay WaaS /personal-onboarding/ to send OTP.
   * - Persists the returned requestId in customer_applications (wallet_kyc row).
   */
  async step1_InitiateSasaPayWaaS(payload: OnboardingJobPayload): Promise<OnboardingJobState> {
    this.logger.log(`[STEP 1] Initiating SasaPay WaaS for customer ${payload.customerId}`);

    // --- 1a. Ensure customer exists in PostgreSQL ---
    let customer = await this.db.queryOne(
      `SELECT id, astpp_id, phone_number, first_name, last_name, email, country_code
       FROM customers WHERE id = $1`,
      [payload.customerId],
    );

    if (!customer) {
      this.logger.warn(`[STEP 1] Customer ${payload.customerId} not in PG — fetching from ASTPP MySQL`);
      customer = await this.fetchFromMysqlAndUpsert(payload.astppId);
    }

    // --- 1b. Fetch eligible SasaPay KYC, then wallet KYC, then primary KYC ---
    const kycDetails = await this.db.queryOne(
      `SELECT cad.identity_document_type, cad.identity_document_number, cad.application_type
       FROM customer_applications ca
       JOIN customer_applicant_details cad ON cad.customer_application_id = ca.id
       WHERE ca.customer_id = $1
         AND (
           cad.application_type IN ('wallet_kyc', 'primary_kyc')
           OR (
             $2::boolean
             AND
             cad.application_type = 'sasapay_kyc'
             AND cad.sasapay_submission_status = 'approved_for_psp'
             AND CARDINALITY(cad.required_documents) > 0
             AND NOT EXISTS (
               SELECT 1
               FROM unnest(cad.required_documents) AS required(document_type)
               WHERE NOT EXISTS (
                 SELECT 1
                 FROM jsonb_array_elements(COALESCE(cad.images, '[]'::jsonb)) AS image(value)
                 WHERE image.value->>'type' = required.document_type
               )
             )
           )
         )
       ORDER BY 
         CASE cad.application_type
           WHEN 'sasapay_kyc' THEN 1
           WHEN 'wallet_kyc' THEN 2
           ELSE 3
         END ASC
       LIMIT 1`,
      [payload.customerId, this.config.get<boolean>('sasapay.kycEnabled') === true],
    );

    // --- Debug logging ---
    this.logger.log(`[STEP 1] Customer details: ${JSON.stringify({
      id: customer.id,
      astpp_id: customer.astpp_id,
      phone_number: customer.phone_number,
      country_code: customer.country_code,
      first_name: customer.first_name,
      last_name: customer.last_name,
      email: customer.email,
    })}`);
    
    this.logger.log(`[STEP 1] KYC details: ${JSON.stringify({
      identity_document_type: kycDetails?.identity_document_type,
      identity_document_number: kycDetails?.identity_document_number,
      application_type: kycDetails?.application_type,
    })}`);

    // --- 1c. Call SasaPay WaaS /personal-onboarding/ ---
    if (!customer.country_code) {
      throw new Error(`Customer ${customer.id} has no country code for phone number validation.`);
    }
    
    if (!kycDetails?.identity_document_type) {
      throw new Error(`Customer ${customer.id} has no identity_document_type in KYC details.`);
    }
    
    if (!kycDetails?.identity_document_number) {
      throw new Error(`Customer ${customer.id} has no identity_document_number in KYC details.`);
    }
    
    // Check if document type is supported by SasaPay automatic onboarding
    if (kycDetails.identity_document_type === 'SERVICE_CARD') {
      this.logger.warn(`[STEP 1] Customer ${customer.id} has SERVICE_CARD which is not supported by SasaPay API. Manual KYC required.`);
      
      // Mark as requiring manual KYC
      await this.db.query(
        `UPDATE customer_applications
         SET kyc_status = 'manual_kyc_required',
             updated_at = NOW()
         WHERE customer_id = $1`,
        [customer.id],
      );
      
      await this.writeAuditLog(customer.id, 'SASAPAY_MANUAL_KYC_REQUIRED', {
        reason: 'Service/Military Card not supported by SasaPay automatic onboarding',
        documentType: kycDetails.identity_document_type,
        documentNumber: kycDetails.identity_document_number,
        instruction: 'Customer must upload documents via GET /onboarding-status and POST /sessions/device',
      });
      
      throw new Error(`Customer ${customer.id} has SERVICE_CARD document type which requires secondary KYC upload. SasaPay API does not support Service/Military Cards.`);
    }
    
    const customerPhone = normalizePhoneNumber(customer.phone_number, customer.country_code);

    const result = await this.sasapayWaas.initiatePersonalOnboardingAuto({
      customerId: customer.id,
      firstName: customer.first_name,
      middleName: '',
      lastName: customer.last_name,
      countryCode: customerPhone.countryCallingCode,
      mobileNumber: customerPhone.nationalNumber,
      documentType: mapPostgresToSasaPay(kycDetails.identity_document_type),
      documentNumber: kycDetails.identity_document_number,
      email: customer.email,
    });

    // --- 1d. Persist requestId into customer_applications ---
    await this.db.query(
      `UPDATE customer_applications
       SET sasapay_request_id = $1,
           kyc_status = 'pending',
           submitted_at = NOW(),
           updated_at = NOW()
       WHERE customer_id = $2`,
      [result.requestId, customer.id],
    );

    await this.writeAuditLog(customer.id, 'SASAPAY_PERSONAL_ONBOARDING_INITIATED', {
      requestId: result.requestId,
      firstName: customer.first_name,
      lastName: customer.last_name,
      mobileNumber: customer.phone_number,
      documentType: mapPostgresToSasaPay(kycDetails.identity_document_type),
      documentNumber: kycDetails.identity_document_number,
      kycSource: kycDetails?.application_type || 'unknown',
      status: 'otp_sent',
    });

    this.logger.log(`[STEP 1] OTP sent — requestId: ${result.requestId}`);

    return {
      step: 'awaiting_otp',
      sasapay_request_id: result.requestId,
    };
  }

  /**
   * Fetch a single customer's data from ASTPP MySQL and upsert into PostgreSQL.
   * Mirrors fetchCustomerData + insertCustomerData from snapshot.worker.ts for one account.
   */
  private async fetchFromMysqlAndUpsert(astppId: number): Promise<any> {
    // --- MySQL fetch (5 parallel queries, mirrors snapshot worker) ---
    const [account, application, applicant_details, wallet_kyc, voipRow] = await Promise.all([
      this.astppMysql.queryOne(
        `SELECT id, number, first_name, last_name, email,
                telephone_2, country_id, currency_id, type AS account_type, deleted, creation
         FROM accounts WHERE id = ? AND deleted = 0 AND type = 9`,
        [astppId],
      ),
      this.astppMysql.queryOne(
        `SELECT id AS application_id, applicationid, accountid, did_id, country_id,
                status, creation_date, approved_date, rejected_date
         FROM applications WHERE accountid = ? AND deleted = 0 LIMIT 1`,
        [astppId],
      ),
      this.astppMysql.queryOne(
        `SELECT name, identity_document_type, identity_document_number, date_of_birth,
                gender, physical_address, nationality,
                identity_document, identity_document_back, id_verification, registration_type
         FROM applicant_details WHERE accountid = ? LIMIT 1`,
        [astppId],
      ),
      this.astppMysql.queryOne(
        `SELECT id, application_id, name, identity_document_number, physical_address,
                date_of_birth, gender, nationality, account_id, status, rejection_reason,
                system_notes, created_at, updated_at, reviewed_at, reviewed_by
         FROM wallet_kyc_applications WHERE account_id = ? ORDER BY created_at DESC LIMIT 1`,
        [astppId],
      ),
      this.astppMysql.queryOne(
        `SELECT number FROM dids WHERE accountid = ? LIMIT 1`,
        [astppId],
      ),
    ]);

    if (!account) {
      throw new Error(`Account ${astppId} not found in ASTPP MySQL`);
    }

    // Fetch wallet KYC images if wallet_kyc row exists
    let wallet_kyc_images: any[] = [];
    if (wallet_kyc) {
      wallet_kyc_images = await this.astppMysql.query(
        `SELECT id, account_id, application_id, filename, original_name, image_type,
                file_size, mime_type, description, upload_date
         FROM wallet_application_images
         WHERE account_id = ? AND application_id = ? AND deleted_date IS NULL AND status = 1
         ORDER BY upload_date DESC`,
        [astppId, wallet_kyc.application_id],
      );
    }

    const voip_number = voipRow?.number || null;

    // --- PostgreSQL upsert (transaction, mirrors insertCustomerData) ---
    const client = await this.db.getClient();
    let customerId: number;

    try {
      await client.query('BEGIN');

      const kycStatus = this.mapKycStatus(application?.status);
      const deletedAt = account.deleted === 1 ? new Date() : null;

      // Resolve country_code from ASTPP countrycode table (load map for this call)
      let countryCode: string | null = null;
      if (account.country_id) {
        try {
          const ccRow = await this.astppMysql.queryOne<{ phonecode: string }>(
            `SELECT phonecode FROM countrycode WHERE id = ? AND phonecode IS NOT NULL AND phonecode != '' LIMIT 1`,
            [account.country_id],
          );
          countryCode = ccRow?.phonecode?.trim() || null;
        } catch {
          // Non-fatal: country_code will be null
        }
      }

      // 1. Upsert customers
      await client.query(
        `INSERT INTO customers (
           astpp_id, phone_number, voip_number, first_name, last_name, email,
           country_id, country_code, currency_id, account_type,
           status, deleted_at, astpp_created_at, synced_at, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, NOW(), NOW(), NOW())
         ON CONFLICT (astpp_id) DO UPDATE SET
           phone_number = EXCLUDED.phone_number,
           voip_number = EXCLUDED.voip_number,
           first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name,
           email = EXCLUDED.email,
           country_id = EXCLUDED.country_id,
           country_code = EXCLUDED.country_code,
           status = CASE
             WHEN EXCLUDED.deleted_at IS NOT NULL THEN 'suspended'
             WHEN customers.deleted_at IS NOT NULL THEN 'active'
             ELSE customers.status
           END,
           deleted_at = EXCLUDED.deleted_at,
           synced_at = NOW(),
           updated_at = NOW()`,
        [
          account.id,
          account.number,
          voip_number,
          account.first_name || '',
          account.last_name || '',
          account.email || null,
          account.country_id || null,
          countryCode,
          account.currency_id || null,
          account.account_type || null,
          deletedAt ? 'suspended' : 'active',
          deletedAt,
          parseTimestampOrNull(account.creation),
        ],
      );

      if (Number(account.deleted) === 1) {
        await client.query(`
          UPDATE customer_wallets SET
            status = 'inactive',
            is_locked = false,
            lock_reason = 'Customer deleted in ASTPP',
            locked_by = 'SYSTEM_ASTPP_SYNC',
            locked_at = NULL,
            freeze_type = NULL,
            updated_at = NOW()
          WHERE astpp_id = $1 AND status != 'closed'
        `, [account.id]);
      }

      const customerRow = await client.query(
        'SELECT id FROM customers WHERE astpp_id = $1',
        [account.id],
      );
      customerId = customerRow.rows[0].id;

      // 2. Upsert primary_kyc customer_applications + applicant_details
      if (application && applicant_details) {
        const appResult = await client.query(
          `INSERT INTO customer_applications (
             customer_id, astpp_id, application_id, application_number,
             kyc_status, approved_at, rejected_at,
             synced_at, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7, NOW(),$8, NOW())
           ON CONFLICT (application_id) DO UPDATE SET
             kyc_status = EXCLUDED.kyc_status,
             approved_at = EXCLUDED.approved_at,
             rejected_at = EXCLUDED.rejected_at,
             synced_at = NOW(),
             updated_at = NOW()
           RETURNING id`,
          [
            customerId,
            account.id,
            application.application_id,
            application.applicationid || null,
            kycStatus,
            parseTimestampOrNull(application.approved_date),
            parseTimestampOrNull(application.rejected_date),
            parseTimestampOrNull(application.creation_date) || new Date(),
          ],
        );

        const customerApplicationId = appResult.rows[0].id;

        await client.query(
          `INSERT INTO customer_applicant_details (
             customer_application_id, customer_id, astpp_id, name,
             identity_document_type, identity_document_number,
             date_of_birth, gender, nationality, physical_address,
             passport_photo_url, doc_front_url, doc_back_url,
             registration_type, application_type, synced_at, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'primary_kyc', NOW(), NOW(), NOW())
           ON CONFLICT (customer_application_id, application_type) DO UPDATE SET
             name = EXCLUDED.name,
             identity_document_number = EXCLUDED.identity_document_number,
             date_of_birth = EXCLUDED.date_of_birth,
             synced_at = NOW(),
             updated_at = NOW()`,
          [
            customerApplicationId,
            customerId,
            account.id,
            applicant_details.name || '',
            this.mapDocumentType(applicant_details.identity_document_type),
            applicant_details.identity_document_number || '',
            parseDateOrNull(applicant_details.date_of_birth),
            this.mapGender(applicant_details.gender),
            applicant_details.nationality || null,
            applicant_details.physical_address || null,
            applicant_details.id_verification || null,       // passport_photo_url
            applicant_details.identity_document || null,     // doc_front_url
            applicant_details.identity_document_back || null, // doc_back_url
            applicant_details.registration_type || null,
          ],
        );
      }

      // 3. Upsert wallet_kyc customer_applications + applicant_details (if exists)
      if (wallet_kyc) {
        await client.query(
          `INSERT INTO customer_applications (
             customer_id, astpp_id, application_id, application_type,
             kyc_status, rejection_reason, system_notes, reviewed_at, reviewed_by,
             synced_at, created_at, updated_at
           ) VALUES ($1,$2,$3,'wallet_kyc',$4,$5,$6,$7,$8, NOW(),$9,$10)
           ON CONFLICT (application_id) DO UPDATE SET
             kyc_status = EXCLUDED.kyc_status,
             rejection_reason = EXCLUDED.rejection_reason,
             system_notes = EXCLUDED.system_notes,
             reviewed_at = EXCLUDED.reviewed_at,
             synced_at = NOW(),
             updated_at = EXCLUDED.updated_at`,
          [
            customerId,
            account.id,
            wallet_kyc.id,
            wallet_kyc.status || 'pending',
            wallet_kyc.rejection_reason || null,
            wallet_kyc.system_notes || null,
            parseTimestampOrNull(wallet_kyc.reviewed_at),
            wallet_kyc.reviewed_by || null,
            parseTimestampOrNull(wallet_kyc.created_at) || new Date(),
            parseTimestampOrNull(wallet_kyc.updated_at) || new Date(),
          ],
        );

        const imagesJson = JSON.stringify(
          wallet_kyc_images.map((img) => ({
            image_id: img.id,
            filename: img.filename,
            original_name: img.original_name,
            image_type: img.image_type,
            file_size: img.file_size,
            mime_type: img.mime_type,
            description: img.description || '',
            uploaded_at: parseTimestampOrNull(img.upload_date)?.toISOString() || null,
          })),
        );

        await client.query(
          `INSERT INTO customer_applicant_details (
             application_id, customer_id, astpp_id, name,
             identity_document_type, identity_document_number,
             date_of_birth, gender, nationality, physical_address,
             images, synced_at, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb, NOW(), NOW(), NOW())
           ON CONFLICT (application_id) DO UPDATE SET
             name = EXCLUDED.name,
             images = EXCLUDED.images,
             synced_at = NOW(),
             updated_at = NOW()`,
          [
            wallet_kyc.id,
            customerId,
            account.id,
            wallet_kyc.name || '',
            'NATIONAL_ID',
            wallet_kyc.identity_document_number || '',
            parseDateOrNull(wallet_kyc.date_of_birth),
            this.mapGender(wallet_kyc.gender),
            wallet_kyc.nationality || null,
            wallet_kyc.physical_address || null,
            imagesJson,
          ],
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    // Return the freshly-upserted customer row (include country_code for callers)
    return this.db.queryOne(
      `SELECT id, astpp_id, phone_number, first_name, last_name, email, country_code
       FROM customers WHERE id = $1`,
      [customerId],
    );
  }

  // ---------------------------------------------------------------------------
  // AREA 3 — Fix KYC image lookup + implement HTTP download
  // ---------------------------------------------------------------------------

  /**
   * Step 2: Fetch KYC Images over HTTPS from ASTPP's image portal.
   *
   * Image resolution priority:
   *   - wallet_kyc row preferred over primary_kyc
   *   - For each image type: use doc_front_url / doc_back_url / passport_photo_url columns first,
   *     then fall back to images[] JSONB (wallet_kyc only — primary_kyc images[] is always empty)
   *   - If selfie missing in wallet_kyc → fall back to primary_kyc passport_photo_url
   */
  async step2_FetchKycImagesViaHttp(
    payload: OnboardingJobPayload,
    state: OnboardingJobState,
  ): Promise<OnboardingJobState> {
    this.logger.log(`[STEP 2] Fetching KYC images over HTTPS for customer ${payload.customerId}`);

    if (payload.submissionId && this.config.get<boolean>('sasapay.kycEnabled') !== true) {
      throw new Error('SasaPay KYC feature is disabled for this submission job.');
    }

    const sasaPayImageResult = await this.db.query(
      `SELECT cad.id::text AS submission_id, ca.id AS customer_application_id,
              cad.required_documents, cad.images
       FROM customer_applicant_details cad
       JOIN customer_applications ca ON ca.id = cad.customer_application_id
       WHERE ca.customer_id = $1
         AND $2::boolean
         AND cad.application_type = 'sasapay_kyc'
         AND cad.sasapay_submission_status IN ('approved_for_psp', 'processing_psp_upload')
         AND CARDINALITY(cad.required_documents) > 0
         AND ($3::text IS NULL OR cad.id::text = $3)
         AND NOT EXISTS (
           SELECT 1
           FROM unnest(cad.required_documents) AS required(document_type)
           WHERE NOT EXISTS (
             SELECT 1
             FROM jsonb_array_elements(COALESCE(cad.images, '[]'::jsonb)) AS image(value)
             WHERE image.value->>'type' = required.document_type
           )
         )
       ORDER BY cad.updated_at DESC`,
      [
        payload.customerId,
        this.config.get<boolean>('sasapay.kycEnabled') === true,
        payload.submissionId || null,
      ],
    );
    const sasaPayImageRows = sasaPayImageResult.rows;
    if (sasaPayImageRows.length) {
      const submission = sasaPayImageRows[0];
      const requiredDocuments = submission.required_documents as string[];
      const applicationDirectory = path.resolve(
        process.cwd(),
        'uploads',
        'images',
        String(submission.customer_application_id),
      );
      const images: Record<string, string> = {};
      let filesAvailable = true;

      for (const image of (Array.isArray(submission.images) ? submission.images : [])) {
        if (
          typeof image.filename !== 'string' ||
          !image.filename ||
          path.basename(image.filename) !== image.filename ||
          image.filename.includes('\\')
        ) {
          throw new Error('Stored SasaPay KYC image has an invalid filename.');
        }
        const imagePath = path.resolve(applicationDirectory, image.filename);
        if (!imagePath.startsWith(`${applicationDirectory}${path.sep}`)) {
          throw new Error('Stored SasaPay KYC image path is outside its application directory.');
        }
        const imageKey = image.type === 'document_front'
          ? 'front'
          : image.type === 'document_back'
            ? 'back'
            : image.type === 'selfie'
              ? 'selfie'
              : null;
        if (!imageKey) continue;
        images[imageKey] = imagePath;
      }

      for (const documentType of requiredDocuments) {
        const imageKey = documentType === 'document_front'
          ? 'front'
          : documentType === 'document_back'
            ? 'back'
            : 'selfie';
        if (!images[imageKey]) {
          filesAvailable = false;
          break;
        }
        try {
          await fsPromises.access(images[imageKey]);
        } catch {
          filesAvailable = false;
          break;
        }
      }

      if (filesAvailable) {
        return {
          ...state,
          step: 'upload_kyc',
          images: {
            front: images.front,
            back: images.back,
            selfie: images.selfie,
            requiredDocuments,
            submissionId: submission.submission_id,
          },
        };
      }
    }

    if (payload.submissionId) {
      throw new Error(`Required images for SasaPay submission ${payload.submissionId} are unavailable.`);
    }

    // Query for both primary and wallet KYC details
    const rows = await this.db.query(
      `SELECT ca.id AS pg_application_id,
              ca.application_id AS astpp_application_id,
              cad.application_type,
              cad.doc_front_url,
              cad.doc_back_url,
              cad.passport_photo_url,
              cad.images
       FROM customer_applications ca
       JOIN customer_applicant_details cad ON cad.customer_application_id = ca.id
       WHERE ca.customer_id = $1
         AND cad.application_type IN ('wallet_kyc', 'primary_kyc')
       ORDER BY
         CASE cad.application_type WHEN 'wallet_kyc' THEN 1 ELSE 2 END ASC,
         ca.created_at DESC`,
      [payload.customerId],
    );

    const rowList = (rows as any).rows ?? rows;

    if (!rowList || rowList.length === 0) {
      throw new Error(`No KYC application found for customer ${payload.customerId}`);
    }

    const walletRow = rowList.find((r: any) => r.application_type === 'wallet_kyc') || null;
    const primaryRow = rowList.find((r: any) => r.application_type === 'primary_kyc') || null;
    const bestRow = walletRow || primaryRow;

    // -- Resolve filenames per image type --
    const walletImages: any[] = walletRow?.images ?? [];

    // doc_front (identity_document)
    let frontFilename: string | null =
      walletRow?.doc_front_url ||
      walletImages.find((i: any) => i.image_type === 'identity_document')?.filename ||
      primaryRow?.doc_front_url ||
      null;

    // doc_back (identity_document_back)
    let backFilename: string | null =
      walletRow?.doc_back_url ||
      walletImages.find((i: any) => i.image_type === 'identity_document_back')?.filename ||
      primaryRow?.doc_back_url ||
      null;

    // selfie (passport_photo) — fall back to primary_kyc passport_photo_url if missing in wallet_kyc
    let selfieFilename: string | null =
      walletRow?.passport_photo_url ||
      walletImages.find((i: any) => i.image_type === 'passport_photo')?.filename ||
      primaryRow?.passport_photo_url ||
      null;

    if (!frontFilename || !backFilename || !selfieFilename) {
      throw new Error(
        `Missing required KYC images for customer ${payload.customerId}: ` +
          `front=${frontFilename}, back=${backFilename}, selfie=${selfieFilename}`,
      );
    }

    const astppApplicationId = String(bestRow.astpp_application_id ?? '');
    if (!/^\d+$/.test(astppApplicationId)) {
      throw new Error('ASTPP application ID is missing or invalid for KYC image download.');
    }
    if (!this.astppImagesBaseUrl) {
      throw new Error('ASTPP_IMAGES_BASE_URL must be configured before KYC image transfer.');
    }

    const localTempDir = path.join(os.tmpdir(), `kyc_${payload.customerId}_${astppApplicationId}`);
    await fsPromises.mkdir(localTempDir, { recursive: true });

    const frontName = this.getSafeImageFilename(frontFilename);
    const backName = this.getSafeImageFilename(backFilename);
    const selfieName = this.getSafeImageFilename(selfieFilename);
    const localFrontPath = path.join(localTempDir, frontName);
    const localBackPath = path.join(localTempDir, backName);
    const localSelfiePath = path.join(localTempDir, selfieName);

    this.logger.log(`[STEP 2] Staging KYC files in ${localTempDir}`);

    await this.downloadIfMissing(
      this.buildAstppImageUrl(astppApplicationId, frontName),
      localFrontPath,
    );
    await this.downloadIfMissing(
      this.buildAstppImageUrl(astppApplicationId, backName),
      localBackPath,
    );
    await this.downloadIfMissing(
      this.buildAstppImageUrl(astppApplicationId, selfieName),
      localSelfiePath,
    );

    return {
      ...state,
      step: 'upload_kyc',
      images: {
        front: localFrontPath,
        back: localBackPath,
        selfie: localSelfiePath,
        requiredDocuments: ['document_front', 'document_back', 'selfie'],
        cleanupDirectory: localTempDir,
      },
    };
  }

  /**
   * Step 3: Upload KYC Images to SasaPay WaaS.
   * After success: updates wallet to active, application to approved.
   */
  async step3_UploadKycToSasaPay(
    payload: OnboardingJobPayload,
    state: OnboardingJobState,
  ): Promise<OnboardingJobState> {
    this.logger.log(`[STEP 3] Uploading KYC documents to SasaPay for customer ${payload.customerId}`);

    if (!state.images) {
      throw new Error('KYC images not found in job state');
    }
    const requiredDocuments = state.images.requiredDocuments || ['document_front', 'document_back', 'selfie'];
    const imagePaths: Record<string, string | undefined> = {
      document_front: state.images.front,
      document_back: state.images.back,
      selfie: state.images.selfie,
    };
    if (requiredDocuments.some((documentType) => !imagePaths[documentType])) {
      throw new Error('One or more required KYC images are missing from job state');
    }

    // Get customer phone number
    const customer = await this.db.queryOne<{ phone_number: string; country_code: string | null }>(
      `SELECT phone_number, country_code FROM customers WHERE id = $1`,
      [payload.customerId],
    );
    if (!customer) {
      throw new Error(`Customer ${payload.customerId} was not found for SasaPay KYC upload.`);
    }
    if (!customer.country_code) {
      throw new Error(`Customer ${payload.customerId} has no country code for phone number validation.`);
    }
    const customerMobileNumber = normalizePhoneNumber(
      customer.phone_number,
      customer.country_code,
    ).internationalDigits;

    let uploadRequestId: string | null = null;
    try {
      await this.writeAuditLog(payload.customerId, 'SASAPAY_KYC_UPLOAD_STARTED', {
        requestId: state.sasapay_request_id || null,
        accountNumber: state.sasapay_account_number || null,
        documentTypes: requiredDocuments,
      });

      const uploadResult = await this.sasapayWaas.uploadKycDocuments(
        customerMobileNumber,
        state.images.front,
        state.images.back,
        state.images.selfie,
      );
      if (!uploadResult.status) {
        throw new Error(`SasaPay KYC upload failed: ${uploadResult.message}`);
      }
      uploadRequestId = uploadResult.requestId || uploadResult.request_id || null;

      if (state.images.cleanupDirectory) {
        await fsPromises.rm(state.images.cleanupDirectory, { recursive: true, force: true });
      }

      await this.writeAuditLog(payload.customerId, 'SASAPAY_KYC_UPLOAD_SUCCEEDED', {
        requestId: state.sasapay_request_id || null,
        accountNumber: state.sasapay_account_number || null,
      });
    } catch (error) {
      this.logger.warn(
        '[STEP 3] SasaPay upload failed; staged files retained for retry.',
      );

      await this.writeAuditLog(payload.customerId, 'SASAPAY_KYC_UPLOAD_FAILED', {
        requestId: state.sasapay_request_id || null,
        accountNumber: state.sasapay_account_number || null,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }

    if (state.images.submissionId) {
      await this.db.query(
        `UPDATE customer_applicant_details
         SET sasapay_submission_status = 'awaiting_psp_result',
             sasapay_request_id = COALESCE($2, sasapay_request_id),
             sasapay_submitted_at = NOW(),
             updated_at = NOW()
         WHERE id = $1
           AND application_type = 'sasapay_kyc'
           AND sasapay_submission_status = 'processing_psp_upload'`,
        [state.images.submissionId, uploadRequestId],
      );
      await this.db.query(
        `UPDATE customer_applications
         SET sasapay_account_status = 'AWAITING_APPROVAL',
             updated_at = NOW()
         WHERE customer_id = $1
           AND sasapay_account_status = 'AWAITING_KYC_UPLOAD'`,
        [payload.customerId],
      );
      await this.writeAuditLog(payload.customerId, 'SASAPAY_KYC_RESUBMISSION_SENT', {
        submissionId: state.images.submissionId,
        documentTypes: requiredDocuments,
      });
      return { ...state, step: 'completed' };
    }

    // Update wallet to active + application to approved for the legacy onboarding flow.
    await this.db.query(
      `UPDATE customer_wallets
       SET status = 'active', is_locked = FALSE, lock_reason = NULL, locked_by = NULL, updated_at = NOW()
       WHERE customer_id = $1`,
      [payload.customerId],
    );

    await this.db.query(
      `UPDATE customer_applications
       SET kyc_status = CASE
             WHEN sasapay_account_status = 'REJECTED' THEN kyc_status
             ELSE 'approved'
           END,
           sasapay_account_status = CASE
             WHEN sasapay_account_status = 'AWAITING_KYC_UPLOAD' THEN 'AWAITING_APPROVAL'
             ELSE sasapay_account_status
           END,
           updated_at = NOW()
       WHERE customer_id = $1`,
      [payload.customerId],
    );

    await this.writeAuditLog(payload.customerId, 'SASAPAY_WALLET_APPROVED', {
      requestId: state.sasapay_request_id || null,
      accountNumber: state.sasapay_account_number || null,
      status: 'wallet_active',
    });

    this.logger.log(`[STEP 3] KYC upload complete — wallet activated for customer ${payload.customerId}`);

    return {
      ...state,
      step: 'completed',
    };
  }

  private getSafeImageFilename(value: string): string {
    let imagePath = value;
    if (/^https?:\/\//i.test(value)) {
      imagePath = new URL(value).pathname;
    }

    const filename = path.posix.basename(imagePath.replace(/\\/g, '/'));
    if (!filename || filename === '.' || filename === '..') {
      throw new Error('ASTPP returned an invalid KYC image filename.');
    }
    return filename;
  }

  private buildAstppImageUrl(applicationId: string, filename: string): string {
    let baseUrl: URL;
    try {
      baseUrl = new URL(this.astppImagesBaseUrl);
    } catch {
      throw new Error('ASTPP_IMAGES_BASE_URL must be a valid HTTPS URL.');
    }

    if (
      baseUrl.protocol !== 'https:'
      || baseUrl.username
      || baseUrl.password
      || baseUrl.search
      || baseUrl.hash
    ) {
      throw new Error('ASTPP_IMAGES_BASE_URL must be an HTTPS URL without credentials, query, or fragment.');
    }

    baseUrl.pathname = `${baseUrl.pathname.replace(/\/+$/, '')}/application_images/${applicationId}/${encodeURIComponent(filename)}`;
    return baseUrl.toString();
  }

  private async downloadIfMissing(imageUrl: string, localPath: string): Promise<void> {
    try {
      const existingFile = await fsPromises.stat(localPath);
      if (existingFile.isFile() && existingFile.size > 0) {
        this.logger.log(`[STEP 2] Reusing staged KYC file ${path.basename(localPath)}`);
        return;
      }
      await fsPromises.rm(localPath, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      maxContentLength: 20 * 1024 * 1024,
      maxBodyLength: 20 * 1024 * 1024,
      maxRedirects: 0,
      validateStatus: (status) => status === 200,
    });
    const contentType = String(response.headers['content-type'] || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (!contentType.startsWith('image/')) {
      throw new Error(`ASTPP image endpoint returned an unsupported content type for ${path.basename(localPath)}.`);
    }

    const image = Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data);
    if (image.length === 0) {
      throw new Error(`ASTPP image endpoint returned an empty image for ${path.basename(localPath)}.`);
    }

    await fsPromises.writeFile(localPath, image, { mode: 0o600 });
    this.logger.log(`[STEP 2] Downloaded KYC image ${path.basename(localPath)} over HTTPS.`);
  }

  // ---------------------------------------------------------------------------
  // Mapping helpers (mirrors snapshot.worker.ts)
  // ---------------------------------------------------------------------------

  private mapKycStatus(status: number | undefined): string {
    switch (status) {
      case 2: return 'approved';
      case 3: return 'rejected';
      default: return 'pending';
    }
  }

  /**
   * Map ASTPP document type to PostgreSQL string
   * @deprecated Use mapAstppToPostgres from core/constants instead
   */
  private mapDocumentType(type: number | undefined): string {
    return mapAstppToPostgres(type);
  }

  private mapGender(gender: number | undefined): string | null {
    switch (gender) {
      case 1: return 'male';
      case 2: return 'female';
      default: return null;
    }
  }

  /**
   * Map PostgreSQL doc-type string to SasaPay API code
   * @deprecated Use mapPostgresToSasaPay from core/constants instead
   */
  private mapDocTypeToSasaPay(docType: string): string {
    return mapPostgresToSasaPay(docType);
  }
}

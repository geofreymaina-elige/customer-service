import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../../core/database/database.service';
import { AstppMysqlService } from '../../../core/astpp-mysql/astpp-mysql.service';
import { SasaPayWaasService } from './sasapay-waas.service';
import { JobService } from '../../../core/jobs/job.service';
import { Client as SSHClient } from 'ssh2';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { parseDateOrNull, parseTimestampOrNull } from '../../../core/utils/date.util';

export interface OnboardingJobPayload {
  customerId: number;
  astppId: number;
  applicationId: number | null;
  submissionId?: string;
  requestId?: string;
  otp?: string;
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

  // SSH Configuration for ASTPP server
  private readonly sshHost: string;
  private readonly sshPort: number;
  private readonly sshUsername: string;
  private readonly sshPrivateKey: string;
  private readonly sshPrivateKeyPath: string;
  private readonly astppImagesPath: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly astppMysql: AstppMysqlService,
    private readonly sasapayWaas: SasaPayWaasService,
    private readonly jobService: JobService,
    private readonly config: ConfigService,
  ) {
    this.sshHost = this.config.get<string>('astpp.ssh.host') || 'localhost';
    this.sshPort = this.config.get<number>('astpp.ssh.port') || 22;
    this.sshUsername = this.config.get<string>('astpp.ssh.username') || 'jeff';
    this.sshPrivateKey = this.config.get<string>('astpp.ssh.privateKey') || '';
    this.sshPrivateKeyPath = this.config.get<string>('astpp.ssh.privateKeyPath') || '';
    this.astppImagesPath = this.config.get<string>('astpp.imagesPath') || '/var/www/html/astpp/application_images';

    if (!this.astppImagesPath.startsWith('/')) {
      throw new Error(`astpp.imagesPath must be an absolute path, got: "${this.astppImagesPath}"`);
    }
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
  async confirmOtpAndCreateWallet(payload: OnboardingJobPayload & { requestId: string; otp: string }): Promise<void> {
    const { customerId, astppId, applicationId, requestId, otp } = payload;

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

    // --- 2. Call SasaPay OTP Confirmation API ---
    const result = await this.sasapayWaas.confirmPersonalOnboardingByRequestId(requestId, otp);

    if (!result.status) {
      await this.writeAuditLog(customerId, 'SASAPAY_OTP_JOB_FAILED', {
        requestId,
        otp,
        message: result.message,
        reason: 'SasaPay API returned error',
      });

      throw new Error(`SasaPay OTP confirmation failed: ${result.message}`);
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
         SET kyc_status = 'requires_kyc_upload', updated_at = NOW()
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

    // --- 1c. Call SasaPay WaaS /personal-onboarding/ ---
    // Use country_code stored on the customer (ISO 2-letter, e.g. 'KE'). SasaPay
    // expects the numeric phone dialing code, but country_code here is the ISO code
    // that we can map or pass as-is depending on the SasaPay API spec.
    // We pass it directly; fall back to an empty string if not set.
    const sasapayCountryCode = customer.country_code ?? '';

    const result = await this.sasapayWaas.initiatePersonalOnboardingAuto({
      customerId: customer.id,
      firstName: customer.first_name,
      middleName: '',
      lastName: customer.last_name,
      countryCode: sasapayCountryCode,
      mobileNumber: customer.phone_number.replace(/^\+?254/, '0'),
      documentType: this.mapDocTypeToSasaPay(kycDetails?.identity_document_type || 'NATIONAL_ID'),
      documentNumber: kycDetails?.identity_document_number || `ID${customer.astpp_id}`,
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
      documentType: this.mapDocTypeToSasaPay(kycDetails?.identity_document_type || 'NATIONAL_ID'),
      documentNumber: kycDetails?.identity_document_number || `ID${customer.astpp_id}`,
      kycSource: kycDetails?.application_type || 'fallback',
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
           deleted_at, astpp_created_at, synced_at, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, NOW(), NOW(), NOW())
         ON CONFLICT (astpp_id) DO UPDATE SET
           phone_number = EXCLUDED.phone_number,
           voip_number = EXCLUDED.voip_number,
           first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name,
           email = EXCLUDED.email,
           country_id = EXCLUDED.country_id,
           country_code = EXCLUDED.country_code,
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
          deletedAt,
          parseTimestampOrNull(account.creation),
        ],
      );

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
  // AREA 3 — Fix KYC image lookup + implement SSH download
  // ---------------------------------------------------------------------------

  /**
   * Step 2: Fetch KYC Images via SSH from ASTPP Server.
   *
   * Image resolution priority:
   *   - wallet_kyc row preferred over primary_kyc
   *   - For each image type: use doc_front_url / doc_back_url / passport_photo_url columns first,
   *     then fall back to images[] JSONB (wallet_kyc only — primary_kyc images[] is always empty)
   *   - If selfie missing in wallet_kyc → fall back to primary_kyc passport_photo_url
   */
  async step2_FetchKycImagesViaSSH(
    payload: OnboardingJobPayload,
    state: OnboardingJobState,
  ): Promise<OnboardingJobState> {
    this.logger.log(`[STEP 2] Fetching KYC images via SSH for customer ${payload.customerId}`);

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

    const astppApplicationId = bestRow.astpp_application_id;
    const remoteDir = `${this.astppImagesPath}/${astppApplicationId}`;

    const localTempDir = path.join(os.tmpdir(), `kyc_${payload.customerId}_${astppApplicationId}`);
    await fsPromises.mkdir(localTempDir, { recursive: true });

    const localFrontPath = path.join(localTempDir, path.basename(frontFilename));
    const localBackPath = path.join(localTempDir, path.basename(backFilename));
    const localSelfiePath = path.join(localTempDir, path.basename(selfieFilename));

    this.logger.log(`[STEP 2] Staging KYC files in ${localTempDir}`);

    await this.downloadIfMissing(
      `${remoteDir}/${path.basename(frontFilename)}`,
      localFrontPath,
    );
    await this.downloadIfMissing(
      `${remoteDir}/${path.basename(backFilename)}`,
      localBackPath,
    );
    await this.downloadIfMissing(
      `${remoteDir}/${path.basename(selfieFilename)}`,
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
    const customer = await this.db.queryOne(
      `SELECT phone_number FROM customers WHERE id = $1`,
      [payload.customerId],
    );

    let uploadRequestId: string | null = null;
    try {
      await this.writeAuditLog(payload.customerId, 'SASAPAY_KYC_UPLOAD_STARTED', {
        requestId: state.sasapay_request_id || null,
        accountNumber: state.sasapay_account_number || null,
        documentTypes: requiredDocuments,
      });

      const uploadResult = await this.sasapayWaas.uploadKycDocuments(
        customer.phone_number.replace(/^\+?254/, ''),
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
       SET kyc_status = 'approved', updated_at = NOW()
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

  // ---------------------------------------------------------------------------
  // SSH Helper
  // ---------------------------------------------------------------------------

  private downloadIfMissing(remotePath: string, localPath: string): Promise<void> {
    if (fs.existsSync(localPath)) {
      this.logger.log(`[STEP 2] Reusing staged KYC file ${path.basename(localPath)}`);
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const conn = new SSHClient();

      conn.on('ready', () => {
        conn.exec(`/bin/cat ${this.shellQuote(remotePath)}`, (execError, stream) => {
            if (execError) {
              conn.end();
              reject(execError);
              return;
            }

            const writeStream = fs.createWriteStream(localPath);
            let stderr = '';

            stream.stderr.on('data', (chunk: Buffer) => {
              stderr += chunk.toString();
            });

            stream.on('error', (error) => {
              writeStream.destroy();
              conn.end();
              reject(error);
            });

            writeStream.on('error', (error) => {
              stream.destroy();
              conn.end();
              reject(error);
            });

            stream.on('close', (code: number) => {
              writeStream.end(() => {
                conn.end();
                if (code !== 0) {
                  reject(new Error(`SSH image download failed for ${remotePath}: ${stderr.trim() || `exit code ${code}`}`));
                  return;
                }

                resolve();
              });
            });

            stream.pipe(writeStream);
        });
      });

      conn.on('error', (err) => {
        reject(err);
      });

      conn.connect({
        host: this.sshHost,
        port: this.sshPort,
        username: this.sshUsername,
        privateKey: this.getPrivateKey(),
      });
    });
  }

  private shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }

  /**
   * Helper to retrieve and format the SSH private key from env.
   * Supports base64 encoded strings, escaped newlines (\n), or raw PEM strings.
   */
  private getPrivateKey(): string | Buffer {
    let key = this.sshPrivateKeyPath
      ? fs.readFileSync(this.sshPrivateKeyPath, 'utf8').trim()
      : (this.sshPrivateKey || '').trim();
    if (!key) {
      throw new Error('ASTPP_SSH_PRIVATE_KEY or ASTPP_SSH_PRIVATE_KEY_PATH is not configured');
    }
    if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
      key = key.slice(1, -1);
    }
    if (key.includes('\\n')) {
      key = key.replace(/\\n/g, '\n');
    }
    if (key.startsWith('-----BEGIN')) {
      return key;
    }
    if (/^(ssh-|ecdsa-)/.test(key)) {
      throw new Error('ASTPP SSH key is a public key; configure the matching private key instead');
    }
    try {
      const decoded = Buffer.from(key, 'base64').toString('utf8');
      if (decoded.includes('-----BEGIN')) {
        return decoded;
      }
    } catch {
      // ignore
    }
    return key;
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

  private mapDocumentType(type: number | undefined): string {
    switch (type) {
      case 1: return 'PASSPORT';
      case 2: return 'ALIEN_CARD';
      case 3: return 'SERVICE_CARD';
      default: return 'NATIONAL_ID';
    }
  }

  private mapGender(gender: number | undefined): string | null {
    switch (gender) {
      case 1: return 'male';
      case 2: return 'female';
      default: return null;
    }
  }

  /** Map string doc-type enum to SasaPay document type code */
  private mapDocTypeToSasaPay(docType: string): string {
    const mapping: Record<string, string> = {
      NATIONAL_ID: '1',
      SERVICE_CARD: '1',
      ALIEN_CARD: '2',
      PASSPORT: '3',
    };
    return mapping[docType] ?? '1';
  }
}

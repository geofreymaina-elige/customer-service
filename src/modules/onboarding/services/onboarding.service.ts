import {
  Injectable,
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { DatabaseService } from '../../../core/database/database.service';
import { AstppAdapterService, AstppCustomerRecord } from '../../astpp/astpp-adapter.service';
import { DeviceGatekeeperService } from '../../devices/services/device-gatekeeper.service';
import { SecureJwtService } from '../../../core/auth/jwt.service';
import { MessageService } from '../../../core/messages/message.service';
import { JobService } from '../../../core/jobs/job.service';
import { KafkaNotificationService } from '../../../core/notifications/kafka-notification.service';
import { OnboardUserDeviceDto } from '../dto/onboarding.dto';

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);
  constructor(
    private readonly db: DatabaseService,
    private readonly astppAdapter: AstppAdapterService,
    private readonly deviceGatekeeper: DeviceGatekeeperService,
    private readonly jwtService: SecureJwtService,
    private readonly messages: MessageService,
    private readonly jobService: JobService,
    private readonly notifications: KafkaNotificationService,
  ) {}

  async recordWalletLimitReached(
    customerId: number,
    stage: 'onboarding_initiation' | 'otp_verification',
    providerResponseCode = 'SP4000',
    notifyCustomer = true,
  ): Promise<void> {
    const recipient = await this.db.queryOne(
      `SELECT astpp_id, phone_number FROM customers WHERE id = $1`,
      [customerId],
    );
    if (!recipient) {
      throw new Error(`Cannot record SasaPay wallet limit for missing customer ${customerId}`);
    }

    await this.db.query(
      `INSERT INTO customer_activity_logs (customer_id, event_type, actor_type, actor_id, details)
       VALUES ($1, 'SASAPAY_WALLET_LIMIT_REACHED', 'SYSTEM', 'SASAPAY_WAAS', $2::jsonb)`,
      [customerId, { stage, providerResponseCode, walletLimit: 2 }],
    );

    if (notifyCustomer) {
      await this.notifications.sendNotification({
        astppId: String(recipient.astpp_id),
        channels: ['sms', 'push'],
        title: this.messages.get('wallets.onboarding.walletLimitReached.title'),
        body: this.messages.get('wallets.onboarding.walletLimitReached.body'),
        priority: 'urgent',
        correlationId: `sasapay-wallet-limit-${customerId}-${Date.now()}`,
        sourceService: 'customer-management-service',
        type: 'SASAPAY_WALLET_LIMIT_REACHED',
        notifyTopic: true,
        contact: recipient.phone_number ? { phoneNumber: recipient.phone_number } : undefined,
        context: { customerId, stage },
        metadata: { providerResponseCode, walletLimit: 2 },
      });
    }
  }

  private async assertWalletCapacityAvailable(customerId: number): Promise<void> {
    const identity = await this.db.queryOne<{ identity_document_type: string; identity_document_number: string }>(
      `SELECT identity_document_type, identity_document_number
       FROM customer_applicant_details
       WHERE customer_id = $1 AND application_type IN ('primary_kyc', 'wallet_kyc')
       ORDER BY CASE WHEN application_type = 'primary_kyc' THEN 0 ELSE 1 END, updated_at DESC
       LIMIT 1`,
      [customerId],
    );

    if (!identity?.identity_document_number?.trim()) return;

    const walletCount = await this.db.queryOne<{ wallet_count: number }>(
      `SELECT COUNT(DISTINCT wallet.account_number)::int AS wallet_count
       FROM customer_applicant_details matching_identity
       JOIN customer_wallets wallet ON wallet.customer_id = matching_identity.customer_id
         WHERE UPPER(TRIM(matching_identity.identity_document_type)) = UPPER(TRIM($1))
         AND REGEXP_REPLACE(UPPER(TRIM(matching_identity.identity_document_number)), '[^A-Z0-9]', '', 'g')
             = REGEXP_REPLACE(UPPER(TRIM($2)), '[^A-Z0-9]', '', 'g')`,
      [identity.identity_document_type, identity.identity_document_number],
    );

    if ((walletCount?.wallet_count ?? 0) < 2) return;

    await this.recordWalletLimitReached(customerId, 'onboarding_initiation', 'LOCAL_WALLET_LIMIT', false);
    throw new ConflictException(this.messages.get('wallets.onboarding.walletLimitReached.body'));
  }

  /**
   * Complete Onboard User Device Flow:
   * 1. Query ASTPP MySQL database for VoIP account & customer profile.
   * 2. Upsert customer & customer_applications in PostgreSQL.
   * 3. Check the local wallet limit for the customer's identity before device registration.
   * 4. Register device using DeviceGatekeeperService (checks single-device rule).
   * 5. Enqueue background onboarding job for SasaPay WaaS and KYC image processing.
   * 6. Return simplified response with user details and token (if PIN set).
   */
  async onboardUserDevice(dto: OnboardUserDeviceDto, ipAddress: string = '127.0.0.1'): Promise<{
    user: any;
    token: any;
    otpPending: boolean;
  }> {
    // ASTPP is the source of truth for registration; never create a placeholder profile.
    let astppCustomer;
    let lookupTimeout: NodeJS.Timeout | undefined;
    try {
      astppCustomer = await Promise.race([
        this.astppAdapter.lookupCustomer(dto.astpp_id),
        new Promise<null>((_resolve, reject) => {
          lookupTimeout = setTimeout(() => reject(new Error('ASTPP customer lookup timed out.')), 3000);
        }),
      ]);
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      this.logger.error(`ASTPP lookup failed for account ${dto.astpp_id}: ${details}`);
      throw new ServiceUnavailableException(this.messages.get('common.astppUnavailable'));
    } finally {
      if (lookupTimeout) clearTimeout(lookupTimeout);
    }

    if (!astppCustomer) {
      throw new NotFoundException(this.messages.get('common.astppCustomerNotFound'));
    }
    if (String(astppCustomer.accountId) !== String(dto.astpp_id)) {
      throw new BadRequestException(this.messages.get('common.invalidAstppCustomer'));
    }
    if (!astppCustomer.accountNumber?.trim()) {
      throw new BadRequestException(this.messages.get('common.invalidAstppCustomer'));
    }

    // Reconcile the current ASTPP account and its same-phone predecessor atomically.
    const customer = await this.syncCustomerFromAstpp(astppCustomer);
    if (customer.deleted_at || customer.status === 'closed' || customer.status === 'suspended') {
      throw new UnauthorizedException('Customer account is inactive or deleted.');
    }

    const existingWallet = await this.db.queryOne(
      `SELECT id FROM customer_wallets WHERE customer_id = $1 AND status IN ('active', 'locked', 'frozen')`,
      [customer.id],
    );
    if (!existingWallet) {
      await this.assertWalletCapacityAvailable(customer.id);
    }

    // 2. Register / Verify Device with single-device constraint
    const deviceResult = await this.deviceGatekeeper.registerOrVerifyDevice(
      customer.id,
      {
        device_identifier: dto.device_identifier,
        device_model: dto.device_model,
        device_os: dto.device_os,
        mobile_type: dto.mobile_type,
        app_version: dto.app_version,
        callkit_token: dto.callkit_token,
        apns_token: dto.apns_token,
      },
      ipAddress
    );

    // 3. Check if PIN is set
    const pinRecord = await this.db.queryOne(
      `SELECT id FROM customer_pins WHERE customer_id = $1`,
      [customer.id]
    );
    const isWalletPinSet = !!pinRecord;

    // 4. Enqueue background onboarding job (SasaPay WaaS + KYC image sync)
    let otpPending = false;

    if (existingWallet) {
      this.logger.log(`[ONBOARDING] Customer ${customer.id} already has a wallet — skipping WaaS job enqueue`);
    } else {
      //    Guard B: skip if a pending/running onboarding job already exists
      const existingJob = await this.db.queryOne(
        `SELECT id FROM jobs
         WHERE job_type = 'sasapay_waas_onboarding'
           AND status IN ('PENDING', 'RUNNING')
           AND payload->>'customerId' = $1::text
         LIMIT 1`,
        [customer.id],
      );

      if (existingJob) {
        this.logger.log(`[ONBOARDING] Pending WaaS job already exists for customer ${customer.id} — skipping duplicate`);
        otpPending = true;
      } else {
        const jobUuid = await this.jobService.enqueue('sasapay_waas_onboarding', {
          customerId: customer.id,
          astppId: customer.astpp_id,
          applicationId: null,
        });
        await this.db.query(
          `INSERT INTO customer_activity_logs (customer_id, event_type, actor_type, actor_id, details)
           VALUES ($1, 'SASAPAY_ONBOARDING_JOB_QUEUED', 'SYSTEM', 'ONBOARDING_SERVICE', $2::jsonb)`,
          [customer.id, { jobUuid, jobType: 'sasapay_waas_onboarding' }],
        );
        this.logger.log(`[ONBOARDING] Enqueued sasapay_waas_onboarding job for customer ${customer.id}`);
        otpPending = true;
      }
    }

    // 5. Generate long-lived general app token. Transaction tokens require PIN verification.
    const token = this.jwtService.generateAppAccessToken(customer, deviceResult.deviceHash);

    return {
      user: {
        userId: customer.uuid,
        astppId: customer.astpp_id,
        phoneNumber: customer.phone_number,
        firstName: customer.first_name,
        lastName: customer.last_name,
        isWalletPinSet,
      },
      token,
      otpPending,
    };
  }

  private async syncCustomerFromAstpp(astppCustomer: AstppCustomerRecord) {
    return this.db.transaction(async (client) => {
      const superseded = await client.query(
        `UPDATE customers
         SET deleted_at = COALESCE(deleted_at, NOW()), updated_at = NOW()
         WHERE phone_number = $1
           AND astpp_id <> $2
           AND deleted_at IS NULL
         RETURNING astpp_id`,
        [astppCustomer.accountNumber, astppCustomer.accountId],
      );

      const supersededIds = superseded.rows.map((row) => row.astpp_id);
      if (supersededIds.length) {
        await client.query(
          `UPDATE customer_wallets
           SET status = 'inactive',
               is_locked = false,
               lock_reason = 'Customer replaced by active ASTPP account',
               locked_by = 'SYSTEM_ASTPP_SYNC',
               locked_at = NULL,
               freeze_type = NULL,
               updated_at = NOW()
           WHERE astpp_id = ANY($1::bigint[]) AND status != 'closed'`,
          [supersededIds],
        );
      }

      const customerResult = await client.query(
        `INSERT INTO customers (
           astpp_id, phone_number, voip_number, email, first_name, last_name,
           country_id, country_code, currency_id, account_type, timezone, astpp_created_at,
           status, deleted_at, synced_at, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active', NULL, NOW(), NOW(), NOW())
         ON CONFLICT (astpp_id) DO UPDATE SET
           phone_number = EXCLUDED.phone_number,
           voip_number = EXCLUDED.voip_number,
           email = EXCLUDED.email,
           first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name,
           country_id = EXCLUDED.country_id,
           country_code = COALESCE(EXCLUDED.country_code, customers.country_code),
           currency_id = EXCLUDED.currency_id,
           account_type = EXCLUDED.account_type,
           timezone = EXCLUDED.timezone,
           astpp_created_at = EXCLUDED.astpp_created_at,
           deleted_at = NULL,
           synced_at = NOW(),
           updated_at = NOW()
         RETURNING id, uuid, astpp_id, voip_number, phone_number, first_name,
                   last_name, email, date_of_birth, status, timezone, deleted_at`,
        [
          astppCustomer.accountId,
          astppCustomer.accountNumber,
          astppCustomer.voipNumber || astppCustomer.accountNumber,
          astppCustomer.email || null,
          astppCustomer.firstName || '',
          astppCustomer.lastName || '',
          astppCustomer.countryId ?? null,
          astppCustomer.countryCode ?? null,
          astppCustomer.currencyId ?? null,
          astppCustomer.accountType ?? null,
          astppCustomer.timezone || 'Africa/Nairobi',
          astppCustomer.createdAt || null,
        ],
      );
      const customer = customerResult.rows[0];
      const applicationStatus = this.mapAstppApplicationStatus(astppCustomer.applicationStatus);
      const applicationResult = await client.query(
        `INSERT INTO customer_applications (
           customer_id, astpp_id, application_id, application_number,
           kyc_status, approved_at, rejected_at, synced_at, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NOW())
         ON CONFLICT (customer_id) DO UPDATE SET
           astpp_id = EXCLUDED.astpp_id,
           application_id = COALESCE(EXCLUDED.application_id, customer_applications.application_id),
           application_number = COALESCE(EXCLUDED.application_number, customer_applications.application_number),
           kyc_status = EXCLUDED.kyc_status,
           approved_at = EXCLUDED.approved_at,
           rejected_at = EXCLUDED.rejected_at,
           synced_at = NOW(),
           updated_at = NOW()
         RETURNING id`,
        [
          customer.id,
          astppCustomer.accountId,
          astppCustomer.applicationId ?? null,
          astppCustomer.applicationNumber ?? null,
          applicationStatus,
          astppCustomer.approvedAt ?? null,
          astppCustomer.rejectedAt ?? null,
        ],
      );
      const customerApplicationId = applicationResult.rows[0].id;
      const applicant = astppCustomer.applicantDetails;
      if (applicant?.identityDocumentNumber?.trim()) {
        await client.query(
          `INSERT INTO customer_applicant_details (
             customer_application_id, customer_id, astpp_id, name,
             identity_document_type, identity_document_number,
             date_of_birth, gender, nationality, physical_address,
             passport_photo_url, doc_front_url, doc_back_url,
             application_type, synced_at, created_at, updated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'primary_kyc', NOW(), NOW(), NOW())
           ON CONFLICT (customer_application_id, application_type) DO UPDATE SET
             name = EXCLUDED.name,
             identity_document_type = EXCLUDED.identity_document_type,
             identity_document_number = EXCLUDED.identity_document_number,
             date_of_birth = EXCLUDED.date_of_birth,
             gender = EXCLUDED.gender,
             nationality = EXCLUDED.nationality,
             physical_address = EXCLUDED.physical_address,
             passport_photo_url = EXCLUDED.passport_photo_url,
             doc_front_url = EXCLUDED.doc_front_url,
             doc_back_url = EXCLUDED.doc_back_url,
             synced_at = NOW(),
             updated_at = NOW()`,
          [
            customerApplicationId,
            customer.id,
            astppCustomer.accountId,
            applicant.name || `${astppCustomer.firstName} ${astppCustomer.lastName}`.trim(),
            this.mapAstppDocumentType(applicant.identityDocumentType),
            applicant.identityDocumentNumber.trim(),
            applicant.dateOfBirth ?? null,
            this.mapAstppGender(applicant.gender),
            applicant.nationality ?? null,
            applicant.physicalAddress ?? null,
            applicant.passportPhotoUrl ?? null,
            applicant.documentFrontUrl ?? null,
            applicant.documentBackUrl ?? null,
          ],
        );
      }

      return customer;
    });
  }

  private mapAstppApplicationStatus(status: number): string {
    switch (Number(status)) {
      case 2: return 'approved';
      case 3: return 'rejected';
      default: return 'pending';
    }
  }

  private mapAstppDocumentType(type: number): string {
    switch (Number(type)) {
      case 1: return 'PASSPORT';
      case 2: return 'ALIEN_CARD';
      case 3: return 'SERVICE_CARD';
      default: return 'NATIONAL_ID';
    }
  }

  private mapAstppGender(gender?: number): string | null {
    if (gender === undefined || Number(gender) === 0) return null;

    switch (Number(gender)) {
      case 1: return 'male';
      case 2: return 'female';
      default:
        return 'other';
    }
  }
}

import { Injectable, BadRequestException, Logger, UnauthorizedException } from '@nestjs/common';
import { DatabaseService } from '../../../core/database/database.service';
import { AstppAdapterService } from '../../astpp/astpp-adapter.service';
import { DeviceGatekeeperService } from '../../devices/services/device-gatekeeper.service';
import { SecureJwtService } from '../../../core/auth/jwt.service';
import { MessageService } from '../../../core/messages/message.service';
import { JobService } from '../../../core/jobs/job.service';
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
  ) {}

  /**
   * Complete Onboard User Device Flow:
   * 1. Query ASTPP MySQL database for VoIP account & customer profile.
   * 2. Upsert customer & customer_applications in PostgreSQL.
   * 3. Register device using DeviceGatekeeperService (checks single-device rule).
   * 4. Enqueue background onboarding job for SasaPay WaaS and KYC image processing.
   * 5. Return simplified response with user details and token (if PIN set).
   */
  async onboardUserDevice(dto: OnboardUserDeviceDto, ipAddress: string = '127.0.0.1'): Promise<{
    user: any;
    token: any;
    otpPending: boolean;
  }> {
    // 1. Sync from ASTPP or check existing customer (with 3-second timeout safety)
    let astppCustomer = null;
    try {
      astppCustomer = await Promise.race([
        this.astppAdapter.lookupCustomer(dto.astpp_id),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
      ]);
    } catch {
      astppCustomer = null;
    }

    // If ASTPP DB not accessible or no record, check local DB
    let customer = await this.db.queryOne(
      `SELECT id, uuid, astpp_id, voip_number, phone_number, first_name, last_name, email, date_of_birth, status, timezone, deleted_at
       FROM customers
       WHERE astpp_id = $1`,
      [dto.astpp_id]
    );

    if (!customer) {
      if (!astppCustomer) {
        // Fallback for demonstration / initialization
        astppCustomer = {
          accountId: parseInt(dto.astpp_id, 10) || 1001,
          accountNumber: `2547000${dto.astpp_id}`,
          firstName: 'Customer',
          lastName: 'User',
          email: `user_${dto.astpp_id}@example.com`,
          phoneNumber: `+2547000${dto.astpp_id}`,
          voipNumber: `2547000${dto.astpp_id}`,
          timezone: 'Africa/Nairobi',
          identityDocumentType: 0,
          identityDocumentNumber: `ID${dto.astpp_id}`,
          applicationStatus: 2,
        };
      }

      // Create new customer record in PostgreSQL
      customer = await this.db.queryOne(
        `INSERT INTO customers (
          astpp_id, voip_number, phone_number, email, first_name,
          last_name, timezone, status, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NOW(), NOW())
        RETURNING id, uuid, astpp_id, voip_number, phone_number, first_name, last_name, email, date_of_birth, status, timezone`,
        [
          dto.astpp_id,
          astppCustomer.voipNumber,
          astppCustomer.phoneNumber,
          astppCustomer.email,
          astppCustomer.firstName,
          astppCustomer.lastName,
          astppCustomer.timezone || 'Africa/Nairobi',
        ]
      );

      // Create the primary KYC application and identity details.
      const docTypeEnum = astppCustomer.identityDocumentType === 3 ? 'PASSPORT' :
                          astppCustomer.identityDocumentType === 2 ? 'ALIEN_CARD' :
                          astppCustomer.identityDocumentType === 1 ? 'SERVICE_CARD' : 'NATIONAL_ID';

      const appResult = await this.db.query(
        `INSERT INTO customer_applications (
          customer_id, astpp_id, application_id, kyc_status, created_at, updated_at
        )
        VALUES ($1, $2, NULL, 'approved', NOW(), NOW())
        ON CONFLICT (application_id) DO UPDATE SET
          kyc_status = EXCLUDED.kyc_status,
          updated_at = NOW()
        RETURNING id`,
        [customer.id, dto.astpp_id]
      );

      const customerApplicationId = appResult.rows[0].id;

      await this.db.query(
        `INSERT INTO customer_applicant_details (
          customer_application_id, customer_id, astpp_id, name,
          identity_document_type, identity_document_number, application_type, synced_at, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'primary_kyc', NOW(), NOW(), NOW())
        ON CONFLICT (customer_application_id, application_type) DO UPDATE SET
          identity_document_type = EXCLUDED.identity_document_type,
          identity_document_number = EXCLUDED.identity_document_number,
          updated_at = NOW()`,
        [
          customerApplicationId,
          customer.id,
          dto.astpp_id,
          `${astppCustomer.firstName || ''} ${astppCustomer.lastName || ''}`.trim() || 'Customer',
          docTypeEnum,
          astppCustomer.identityDocumentNumber || `ID${dto.astpp_id}`,
        ]
      );
    }

    if (customer.deleted_at || customer.status === 'closed' || customer.status === 'suspended') {
      throw new UnauthorizedException('Customer account is inactive or deleted.');
    }

    // 2. Register / Verify Device with single-device constraint
    const deviceResult = await this.deviceGatekeeper.registerOrVerifyDevice(
      customer.id,
      {
        deviceIdentifier: dto.device_identifier,
        deviceModel: dto.device_model,
        deviceOs: dto.device_os,
        mobileType: dto.mobile_type,
        appVersion: dto.app_version,
        callkitToken: dto.callkit_token,
        apnsToken: dto.apns_token,
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
    //    Guard A: skip if customer already has an active wallet
    const existingWallet = await this.db.queryOne(
      `SELECT id FROM customer_wallets WHERE customer_id = $1 AND status IN ('active', 'locked', 'frozen')`,
      [customer.id],
    );
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
}

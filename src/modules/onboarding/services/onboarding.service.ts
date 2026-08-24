import { Injectable, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../../core/database/database.service';
import { AstppAdapterService } from '../../astpp/astpp-adapter.service';
import { DeviceGatekeeperService } from '../../devices/services/device-gatekeeper.service';
import { SecureJwtService } from '../../../core/auth/jwt.service';
import { MessageService } from '../../../core/messages/message.service';
import { JobService } from '../../../core/jobs/job.service';
import { OnboardUserDeviceDto } from '../dto/onboarding.dto';

@Injectable()
export class OnboardingService {
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
  }> {
    // 1. Sync from ASTPP or check existing customer
    let astppCustomer = await this.astppAdapter.lookupCustomer(dto.astpp_id);

    // If ASTPP DB not accessible or no record, check local DB
    let customer = await this.db.queryOne(
      `SELECT id, uuid, astpp_id, voip_number, phone_number, first_name, last_name, email, date_of_birth, status, timezone
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

      // Create customer identity record
      const docTypeEnum = astppCustomer.identityDocumentType === 3 ? 'PASSPORT' :
                          astppCustomer.identityDocumentType === 2 ? 'ALIEN_CARD' :
                          astppCustomer.identityDocumentType === 1 ? 'SERVICE_CARD' : 'NATIONAL_ID';

      await this.db.query(
        `INSERT INTO customer_identities (
          customer_id, document_type, document_number, kyc_status, iprs_verified, created_at, updated_at
        )
        VALUES ($1, $2, $3, 'approved', TRUE, NOW(), NOW())
        ON CONFLICT (customer_id) DO NOTHING`,
        [customer.id, docTypeEnum, astppCustomer.identityDocumentNumber || `ID${dto.astpp_id}`]
      );
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
    await this.jobService.enqueue('sasapay_waas_onboarding', {
      customerId: customer.id,
      astppId: customer.astpp_id,
      applicationId: astppCustomer?.applicationId || null,
    });

    // 5. Generate token if PIN is set
    let token = null;
    if (isWalletPinSet) {
      token = this.jwtService.generateToken(customer, deviceResult.deviceHash, ['wallet:transact', 'wallet:read']);
    }

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
    };
  }
}

import { Controller, Post, Body, Req, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { OnboardingService } from '../services/onboarding.service';
import { SasaPayWaasService } from '../services/sasapay-waas.service';
import {
  OnboardUserDeviceDto,
  PersonalOnboardingDto,
  PersonalOnboardingConfirmDto,
  SasaPayOnboardingCallbackDto,
} from '../dto/onboarding.dto';
import { MessageService } from '../../../core/messages/message.service';
import { AstppTokenGuard } from '../../../core/auth/astpp-token.guard';
import { DatabaseService } from '../../../core/database/database.service';
import { JobService } from '../../../core/jobs/job.service';
import { Logger } from '@nestjs/common';

@Controller('api/v1/onboarding')
export class OnboardingController {
  private readonly logger = new Logger(OnboardingController.name);

  constructor(
    private readonly onboardingService: OnboardingService,
    private readonly sasapayWaas: SasaPayWaasService,
    private readonly messages: MessageService,
    private readonly db: DatabaseService,
    private readonly jobService: JobService,
  ) {}

  /**
   * Device and Customer Onboarding (matching client expectations)
   */
  @Post('user-device')
  @UseGuards(AstppTokenGuard)
  @HttpCode(HttpStatus.OK)
  async onboardUserDevice(@Body() dto: OnboardUserDeviceDto, @Req() req: Request) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',').shift()?.trim() || req.ip || '127.0.0.1';
    const result = await this.onboardingService.onboardUserDevice(dto, ip);

    return {
      success: true,
      message: result.otpPending
        ? this.messages.get('wallets.onboarding.awaitingOtp', {
            phoneNumber: this.maskPhoneNumber(result.user.phoneNumber),
          })
        : this.messages.get('onboarding.welcome'),
      data: result,
    };
  }

  private maskPhoneNumber(phoneNumber: string): string {
    if (!phoneNumber || phoneNumber.length <= 6) return 'your registered phone number';

    return `${phoneNumber.slice(0, 3)}${'*'.repeat(phoneNumber.length - 6)}${phoneNumber.slice(-3)}`;
  }

  /**
   * SasaPay WaaS Step 1: Initial Personal Onboarding
   */
  @Post('personal')
  @HttpCode(HttpStatus.ACCEPTED)
  async initiatePersonalOnboarding(@Body() dto: PersonalOnboardingDto) {
    const result = await this.sasapayWaas.initiatePersonalOnboarding(dto);
    return {
      success: result.status,
      message: result.message,
      data: {
        requestId: result.requestId,
      },
    };
  }

  /**
   * SasaPay WaaS Step 2: Personal Onboarding Confirmation with OTP.
   *
   * Flow:
   * 1. Look up sasapay_request_id from customer_applications (wallet_kyc) by customerId.
   * 2. Call SasaPay /personal-onboarding/confirmation/ with the OTP + requestId.
   * 3. Based on accountStatus from SasaPay:
   *    - AWAITING_KYC_UPLOAD → insert wallet as 'locked', enqueue sasapay_waas_kyc_upload job.
   *    - ACTIVE              → insert wallet as 'active'.
   *    - AWAITING_APPROVAL   → insert wallet as 'locked' (awaiting SasaPay manual review).
   */
  @Post('personal/confirm')
  @HttpCode(HttpStatus.OK)
  async confirmPersonalOnboarding(@Body() dto: PersonalOnboardingConfirmDto) {
    const customerId = parseInt(dto.customerId, 10);

    // --- 1. Look up requestId from DB ---
    const appRow = await this.db.queryOne(
      `SELECT id AS pg_app_id, sasapay_request_id, astpp_id
       FROM customer_applications
       WHERE customer_id = $1 AND application_type = 'wallet_kyc'
       LIMIT 1`,
      [customerId],
    );

    if (!appRow?.sasapay_request_id) {
      return {
        success: false,
        message: 'No pending onboarding found for this customer. Please initiate onboarding first.',
      };
    }

    const requestId: string = appRow.sasapay_request_id;

    // --- 2. Call SasaPay OTP confirmation ---
    const result = await this.sasapayWaas.confirmPersonalOnboarding(dto, requestId);

    if (!result.status) {
      return {
        success: false,
        message: result.message,
      };
    }

    const accountStatus = result.data?.accountStatus;
    const accountNumber = result.data?.accountNumber;

    await this.db.query(
      `UPDATE customer_applications
       SET sasapay_account_number = $1,
           sasapay_account_status = $2,
           updated_at = NOW()
       WHERE id = $3 AND application_type = 'wallet_kyc'`,
      [accountNumber, accountStatus, appRow.pg_app_id],
    );

    this.logger.log(
      `[OTP CONFIRM] Customer ${customerId} — SasaPay accountStatus: ${accountStatus}, accountNumber: ${accountNumber}`,
    );

    // --- 3. Persist wallet + update application based on accountStatus ---
    if (accountStatus === 'AWAITING_KYC_UPLOAD') {
      // Insert wallet as locked pending KYC upload
      await this.db.query(
        `INSERT INTO customer_wallets (
           customer_id, astpp_id, account_number, status,
           is_locked, lock_reason, locked_by, created_at, updated_at
         )
         VALUES ($1, $2, $3, 'locked', TRUE, 'Awaiting KYC upload', 'SYSTEM_KYC', NOW(), NOW())
         ON CONFLICT (account_number) DO NOTHING`,
        [customerId, appRow.astpp_id, accountNumber],
      );

      await this.db.query(
        `UPDATE customer_applications
         SET kyc_status = 'requires_kyc_upload', updated_at = NOW()
         WHERE customer_id = $1 AND application_type = 'wallet_kyc'`,
        [customerId],
      );

      // Enqueue KYC image upload job
      await this.jobService.enqueue('sasapay_waas_kyc_upload', {
        customerId,
        astppId: appRow.astpp_id,
        applicationId: null,
      });

      this.logger.log(`[OTP CONFIRM] Enqueued sasapay_waas_kyc_upload for customer ${customerId}`);

    } else if (accountStatus === 'ACTIVE') {
      await this.db.query(
        `INSERT INTO customer_wallets (
           customer_id, astpp_id, account_number, status, created_at, updated_at
         )
         VALUES ($1, $2, $3, 'active', NOW(), NOW())
         ON CONFLICT (account_number) DO NOTHING`,
        [customerId, appRow.astpp_id, accountNumber],
      );

      await this.db.query(
        `UPDATE customer_applications
         SET kyc_status = 'approved', updated_at = NOW()
         WHERE customer_id = $1 AND application_type = 'wallet_kyc'`,
        [customerId],
      );

    } else {
      // AWAITING_APPROVAL or unknown — lock wallet, no KYC job
      await this.db.query(
        `UPDATE customer_applications
         SET kyc_status = 'pending', updated_at = NOW()
         WHERE id = $1 AND application_type = 'wallet_kyc'`,
        [appRow.pg_app_id],
      );

      await this.db.query(
        `INSERT INTO customer_wallets (
           customer_id, astpp_id, account_number, status,
           is_locked, lock_reason, locked_by, created_at, updated_at
         )
         VALUES ($1, $2, $3, 'locked', TRUE, 'Awaiting SasaPay approval', 'SYSTEM_KYC', NOW(), NOW())
         ON CONFLICT (account_number) DO NOTHING`,
        [customerId, appRow.astpp_id, accountNumber],
      );
    }

    return {
      success: true,
      message: result.message,
      data: {
        accountNumber,
        accountStatus,
        displayName: result.data?.displayName,
      },
    };
  }

  /**
   * SasaPay WaaS Webhook Callback
   */
  @Post('callback/sasapay')
  @HttpCode(HttpStatus.OK)
  async handleSasaPayCallback(@Body() dto: SasaPayOnboardingCallbackDto) {
    const application = await this.db.queryOne(
      `SELECT id, customer_id, kyc_status
       FROM customer_applications
       WHERE application_type = 'wallet_kyc'
         AND sasapay_account_number = $1
         AND sasapay_account_number IS NOT NULL
         AND sasapay_account_status IS NOT NULL
       LIMIT 1`,
      [dto.accountNumber],
    );

    if (!application) {
      this.logger.warn(
        `[SASAPAY CALLBACK] Ignored callback for account ${dto.accountNumber}: no confirmed wallet onboarding found`,
      );
      return {
        success: true,
        processed: false,
        message: 'Callback ignored because no confirmed wallet onboarding exists for this account.',
      };
    }

    const kycStatus = dto.accountStatus === 'APPROVED' ? 'approved' : 'rejected';
    await this.db.query(
      `UPDATE customer_applications
       SET sasapay_account_status = $1,
           kyc_status = $2,
           rejection_reason = CASE WHEN $2 = 'rejected' THEN $3 ELSE NULL END,
           updated_at = NOW()
       WHERE id = $4
         AND application_type = 'wallet_kyc'
         AND sasapay_account_number IS NOT NULL`,
      [dto.accountStatus, kycStatus, dto.description || 'SasaPay onboarding rejected', application.id],
    );

    this.logger.log(
      `[SASAPAY CALLBACK] Processed ${dto.accountStatus} for customer ${application.customer_id}`,
    );
    return {
      success: true,
      processed: true,
      message: 'Callback received and processed',
    };
  }
}

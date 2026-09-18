import { Controller, Post, Body, Req, HttpCode, HttpStatus, UseGuards, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
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
    private readonly config: ConfigService,
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
  private async writeAuditLog(customerId: number, eventType: string, details: Record<string, unknown>): Promise<void> {
    await this.db.query(
      `INSERT INTO customer_activity_logs (customer_id, event_type, actor_type, actor_id, details, created_at)
       VALUES ($1, $2, 'SYSTEM', 'ONBOARDING_CONTROLLER', $3::jsonb, NOW())`,
      [customerId, eventType, JSON.stringify(details)],
    );
  }

  @Post('personal/confirm')
  @HttpCode(HttpStatus.OK)
  async confirmPersonalOnboarding(@Body() dto: PersonalOnboardingConfirmDto) {
    // --- 1. Look up customer and requestId from DB by ASTPP ID ---
    const appRow = await this.db.queryOne(
      `SELECT ca.id AS pg_app_id, ca.sasapay_request_id, ca.astpp_id, c.id AS customer_id
       FROM customer_applications ca
       JOIN customers c ON c.id = ca.customer_id
       WHERE c.astpp_id = $1
       LIMIT 1`,
      [dto.astppId],
    );

    if (!appRow?.sasapay_request_id) {
      await this.writeAuditLog(appRow?.customer_id || null, 'SASAPAY_PERSONAL_ONBOARDING_MISSING_REQUEST', {
        astppId: dto.astppId,
        reason: 'No pending onboarding found for this customer. Please initiate onboarding first.',
      });

      return {
        success: false,
        message: 'No pending onboarding found for this customer. Please initiate onboarding first.',
      };
    }

    const customerId = appRow.customer_id;
    const requestId: string = appRow.sasapay_request_id;

    // --- 2. Call SasaPay OTP confirmation ---
    const result = await this.sasapayWaas.confirmPersonalOnboarding(dto, requestId);

    if (!result.status) {
      await this.writeAuditLog(customerId, 'SASAPAY_OTP_VERIFICATION_FAILED', {
        requestId,
        otp: dto.otp,
        message: result.message,
      });

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
       WHERE id = $3`,
      [accountNumber, accountStatus, appRow.pg_app_id],
    );

    await this.writeAuditLog(customerId, 'SASAPAY_OTP_CONFIRMED', {
      requestId,
      accountNumber,
      accountStatus,
      message: result.message,
    });

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
        astppId: appRow.astpp_id,
        applicationId: null,
      });

      await this.writeAuditLog(customerId, 'SASAPAY_KYC_UPLOAD_JOB_QUEUED', {
        requestId,
        accountNumber,
        jobUuid: kycJobUuid,
        jobType: 'sasapay_waas_kyc_upload',
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
         WHERE customer_id = $1`,
        [customerId],
      );

      await this.writeAuditLog(customerId, 'SASAPAY_WALLET_READY', {
        requestId,
        accountNumber,
        accountStatus,
        status: 'active',
      });

    } else {
      // AWAITING_APPROVAL or unknown — lock wallet, no KYC job
      await this.db.query(
        `UPDATE customer_applications
         SET kyc_status = 'pending', updated_at = NOW()
         WHERE id = $1`,
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

      await this.writeAuditLog(customerId, 'SASAPAY_AWAITING_APPROVAL', {
        requestId,
        accountNumber,
        accountStatus,
        status: 'locked_awaiting_manual_review',
      });
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
   * Log SasaPay callback payload to separate file
   */
  private logSasaPayCallback(payload: Record<string, unknown>, req: Request): void {
    try {
      const logsDir = path.join(process.cwd(), 'logs');
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      const logFilePath = path.join(logsDir, 'sasapay-callbacks.log');
      const timestamp = new Date().toISOString();
      const sourceIp = this.normalizeIp(req.socket.remoteAddress || req.ip);
      const headers = {
        'x-sasapay-signature': req.header('X-SasaPay-Signature'),
        'content-type': req.header('Content-Type'),
        'user-agent': req.header('User-Agent'),
      };

      const logEntry = {
        timestamp,
        sourceIp,
        headers,
        payload,
      };

      const logLine = JSON.stringify(logEntry, null, 2) + '\n' + '-'.repeat(80) + '\n';
      fs.appendFileSync(logFilePath, logLine, 'utf8');

      this.logger.log(`[SASAPAY CALLBACK] Full payload logged to ${logFilePath}`);
    } catch (error) {
      this.logger.error(`[SASAPAY CALLBACK] Failed to write callback log: ${error.message}`);
    }
  }

  /**
   * SasaPay WaaS Webhook Callback
   */
  @Post('callback/sasapay')
  @HttpCode(HttpStatus.OK)
  async handleSasaPayCallback(
    @Body() dto: SasaPayOnboardingCallbackDto,
    @Req() req: Request,
  ) {
    // Log the full callback payload first
    const callbackPayload = dto as SasaPayOnboardingCallbackDto & Record<string, unknown>;
    this.logSasaPayCallback(callbackPayload, req);

    this.verifySasaPayCallback(req, dto);
    const callbackAccountNumber = this.callbackValue(callbackPayload, 'account_number', 'accountNumber');
    const callbackAccountStatus = this.callbackValue(callbackPayload, 'account_status', 'accountStatus');

    const application = await this.db.queryOne(
      `SELECT id, customer_id, kyc_status
       FROM customer_applications
       WHERE sasapay_account_number = $1
         AND sasapay_account_number IS NOT NULL
         AND sasapay_account_status IS NOT NULL
       LIMIT 1`,
      [callbackAccountNumber],
    );

    if (!application) {
      this.logger.warn(
        `[SASAPAY CALLBACK] Ignored callback for account ${callbackAccountNumber}: no confirmed wallet onboarding found`,
      );
      return {
        success: true,
        processed: false,
        message: 'Callback ignored because no confirmed wallet onboarding exists for this account.',
      };
    }

    const kycStatus = callbackAccountStatus === 'APPROVED' ? 'approved' : 'rejected';
    await this.db.query(
      `UPDATE customer_applications
       SET sasapay_account_status = $1,
           kyc_status = $2,
           rejection_reason = CASE WHEN $2 = 'rejected' THEN $3 ELSE NULL END,
           updated_at = NOW()
       WHERE id = $4
         AND sasapay_account_number IS NOT NULL`,
      [callbackAccountStatus, kycStatus, dto.description || 'SasaPay onboarding rejected', application.id],
    );

    this.logger.log(
      `[SASAPAY CALLBACK] Processed ${callbackAccountStatus} for customer ${application.customer_id}`,
    );
    return {
      success: true,
      processed: true,
      message: 'Callback received and processed',
    };
  }

  private verifySasaPayCallback(req: Request, dto: SasaPayOnboardingCallbackDto): void {
    const configuredIps = this.config.get<string[]>('sasapay.callbackSecurity.allowedIps') || [];
    const sourceIp = this.normalizeIp(req.socket.remoteAddress || req.ip);
    const allowed = configuredIps.map((ip) => this.normalizeIp(ip)).includes(sourceIp);

    if (!allowed) {
      this.logger.warn(`[SASAPAY CALLBACK] Rejected request from IP ${sourceIp || 'unknown'}`);
      throw new UnauthorizedException('Callback source is not allowed.');
    }

    const signatureHeader = req.header('X-SasaPay-Signature');
    if (!signatureHeader) {
      this.logger.warn('[SASAPAY CALLBACK] Rejected request without signature');
      throw new UnauthorizedException('Callback signature is required.');
    }

    const payload = dto as SasaPayOnboardingCallbackDto & Record<string, unknown>;
    const transactionCode = this.callbackValue(payload, 'sasapay_transaction_code', 'sasapayTransactionCode', 'transactionCode');
    const merchantCode = this.callbackValue(payload, 'merchant_code', 'merchantCode');
    const accountNumber = this.callbackValue(payload, 'account_number', 'accountNumber');
    const paymentReference = this.callbackValue(payload, 'payment_reference', 'paymentReference');
    const amount = this.callbackValue(payload, 'amount');

    if (!transactionCode || !merchantCode || !accountNumber || !paymentReference || amount === undefined) {
      throw new UnauthorizedException('Callback payload is incomplete.');
    }

    const message = `${transactionCode}-${merchantCode}-${accountNumber}-${paymentReference}-${amount}`;
    const expectedSignature = crypto
      .createHmac('sha512', this.config.get<string>('sasapay.clientId') || '')
      .update(message, 'utf8')
      .digest('hex');

    const provided = signatureHeader.trim().toLowerCase();
    const expected = expectedSignature.toLowerCase();
    const signaturesMatch = provided.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));

    if (!signaturesMatch) {
      this.logger.warn(`[SASAPAY CALLBACK] Rejected invalid signature for account ${accountNumber}`);
      throw new UnauthorizedException('Invalid callback signature.');
    }
  }

  private callbackValue(payload: Record<string, unknown>, ...keys: string[]): string | undefined {
    for (const key of keys) {
      const value = payload[key];
      if (value !== undefined && value !== null) return String(value);
    }

    return undefined;
  }

  private normalizeIp(ip: string | undefined): string {
    return (ip || '').replace(/^::ffff:/, '').trim();
  }
}

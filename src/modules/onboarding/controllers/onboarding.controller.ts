import { Controller, Post, Body, Req, HttpCode, HttpStatus, UseGuards, UnauthorizedException, Delete } from '@nestjs/common';
import { Request } from 'express';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { OnboardingService } from '../services/onboarding.service';
import { SasaPayWaasService } from '../services/sasapay-waas.service';
import { PinAuthService } from '../../auth/services/pin-auth.service';
import { DeviceLogoutService } from '../../devices/services/device-logout.service';
import { DeviceGatekeeperService } from '../../devices/services/device-gatekeeper.service';
import {
  OnboardUserDeviceDto,
  PersonalOnboardingDto,
  PersonalOnboardingConfirmDto,
  ConfirmWalletOtpDto,
  SasaPayOnboardingCallbackDto,
} from '../dto/onboarding.dto';
import { VerifyPinDto, ExchangePinForTransactionTokenDto } from '../../auth/dto/pin-auth.dto';
import { InitiateDeviceLogoutDto, VerifyDeviceLogoutDto } from '../../devices/dto/device.dto';
import { MessageService } from '../../../core/messages/message.service';
import { AstppTokenGuard } from '../../../core/auth/astpp-token.guard';
import { PinAstppTokenGuard } from '../../../core/auth/pin-astpp-token.guard';
import { AuthGuard } from '../../../core/auth/auth.guard';
import { DatabaseService } from '../../../core/database/database.service';
import { JobService } from '../../../core/jobs/job.service';
import { CurrentUser, AuthenticatedUser } from '../../../core/auth/current-user.decorator';
import { Logger } from '@nestjs/common';

@Controller('')
export class OnboardingController {
  private readonly logger = new Logger(OnboardingController.name);

  constructor(
    private readonly onboardingService: OnboardingService,
    private readonly sasapayWaas: SasaPayWaasService,
    private readonly pinAuthService: PinAuthService,
    private readonly deviceLogoutService: DeviceLogoutService,
    private readonly deviceGatekeeper: DeviceGatekeeperService,
    private readonly messages: MessageService,
    private readonly db: DatabaseService,
    private readonly jobService: JobService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Register new device + start wallet (was POST api/v1/onboarding/user-device)
   */
  @Post('api/v2/auth/sessions/device')
  @UseGuards(AstppTokenGuard)
  @HttpCode(HttpStatus.OK)
  async onboardUserDevice(@Body() dto: OnboardUserDeviceDto, @Req() req: Request) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',').shift()?.trim() || req.ip || '127.0.0.1';
    const result = await this.onboardingService.onboardUserDevice(dto, ip);

    return {
      success: true,
      message: result.otpPending
        ? this.messages.get('wallets.onboarding.awaitingOtp', {
            phoneNumber: result.user.phoneNumber ? this.maskPhoneNumber(result.user.phoneNumber) : 'your registered phone number',
          })
        : this.messages.get('onboarding.welcome'),
      data: result,
    };
  }

  /**
   * Exchange PIN for a transaction token (with registered phone)
   * Uses Bearer token authentication from an existing session
   */
  @Post('api/v2/auth/transaction-tokens')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async exchangePinForTransactionToken(
    @CurrentUser() user: AuthenticatedUser, 
    @Body() dto: ExchangePinForTransactionTokenDto, 
    @Req() req: Request
  ) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',').shift()?.trim() || req.ip || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || '';

    // Fetch the customer's ASTPP ID
    const customer = await this.db.queryOne<{ astpp_id: string }>(
      `SELECT astpp_id FROM customers WHERE id = $1`,
      [user.id]
    );

    if (!customer?.astpp_id) {
      throw new UnauthorizedException('Customer ASTPP ID not found.');
    }

    // Create a VerifyPinDto with the user's ASTPP ID
    const verifyDto: VerifyPinDto = {
      astpp_id: String(customer.astpp_id),
      pin: dto.pin,
      device_identifier: dto.device.device_identifier,
      device_model: dto.device.device_model,
      mobile_type: dto.device.mobile_type,
    };

    const result = await this.pinAuthService.verifyPin(verifyDto, ip, userAgent);

    return {
      success: true,
      message: this.messages.get('auth.pin.verifySuccess'),
      data: result,
    };
  }

  /**
   * Sign in new phone (recovery, start OTP) - moved from DeviceController
   */
  @Post('api/v2/auth/sessions/recovery')
  @HttpCode(HttpStatus.OK)
  async initiateLogout(@Body() dto: InitiateDeviceLogoutDto) {
    const data = await this.deviceLogoutService.initiateLogout(dto);
    return {
      success: true,
      message: this.messages.get('devices.logoutInitiated'),
      data,
    };
  }

  /**
   * Recovery OTP verify + new device register - moved from DeviceController
   */
  @Post('api/v2/auth/sessions/recovery-otp')
  @HttpCode(HttpStatus.OK)
  async verifyLogout(@Body() dto: VerifyDeviceLogoutDto, @Req() req: Request) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',').shift()?.trim() || req.ip || '127.0.0.1';
    const result = await this.deviceLogoutService.verifyOtpAndLogout(dto, ip);

    return {
      success: true,
      message: this.messages.get('devices.logoutVerified'),
      data: result,
    };
  }

  /**
   * Sign out all devices (revokes all active sessions for this customer)
   */
  @Delete('api/v2/auth/sessions/current')
  @UseGuards(AuthGuard)
  async revokeAllSessions(@CurrentUser() user: AuthenticatedUser) {
    // Revoke ALL active devices for this customer
    const result = await this.db.query(
      `UPDATE customer_devices 
       SET status = 'revoked', revoked_at = NOW(), updated_at = NOW() 
       WHERE customer_id = $1 AND status = 'active'
       RETURNING id`,
      [user.id]
    );

    const revokedCount = result.rowCount || 0;

    // Log the revocation
    await this.db.query(
      `INSERT INTO customer_activity_logs (customer_id, event_type, actor_type, actor_id, details)
       VALUES ($1, 'ALL_DEVICES_REVOKED', 'CUSTOMER', $2, $3::jsonb)`,
      [user.id, String(user.id), JSON.stringify({ revokedCount, reason: 'Manual sign out' })]
    );

    return {
      success: true,
      message: `All sessions revoked successfully (${revokedCount} device${revokedCount !== 1 ? 's' : ''})`,
    };
  }

  /**
   * Confirm wallet OTP (was POST api/v1/onboarding/personal/confirm)
   * Now uses Bearer token authentication
   */
  @Post('api/v2/auth/wallet-verifications')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  async confirmPersonalOnboarding(@CurrentUser() user: AuthenticatedUser, @Body() dto: ConfirmWalletOtpDto) {
    // --- 1. Look up customer and validate ---
    const appRow = await this.db.queryOne(
      `SELECT ca.id AS pg_app_id, ca.sasapay_request_id, ca.sasapay_account_number, ca.astpp_id, c.id AS customer_id
       FROM customer_applications ca
       JOIN customers c ON c.id = ca.customer_id
       WHERE c.id = $1
       LIMIT 1`,
      [user.id],
    );

    if (!appRow?.sasapay_request_id) {
      if (appRow?.customer_id) {
        await this.writeAuditLog(appRow.customer_id, 'SASAPAY_PERSONAL_ONBOARDING_MISSING_REQUEST', {
          customerId: user.id,
          reason: 'No pending onboarding found for this customer. Please initiate onboarding first.',
        });
      }

      return {
        success: false,
        message: 'No pending onboarding found for this customer. Please initiate onboarding first.',
      };
    }

    const customerId = appRow.customer_id;
    const requestId: string = appRow.sasapay_request_id;

    // --- 2. IDEMPOTENCY CHECK: Return existing wallet if already created ---
    if (appRow.sasapay_account_number) {
      this.logger.log(
        `[OTP CONFIRM] Customer ${customerId} already has SasaPay account ${appRow.sasapay_account_number}. Returning existing wallet.`,
      );

      await this.writeAuditLog(customerId, 'SASAPAY_OTP_DUPLICATE_ATTEMPT', {
        customerId: user.id,
        existingAccountNumber: appRow.sasapay_account_number,
        reason: 'OTP confirmation already processed for this customer.',
      });

      return {
        success: true,
        message: 'Your wallet has already been created.',
        data: {
          accountNumber: appRow.sasapay_account_number,
          alreadyExists: true,
        },
      };
    }

    // --- 3. ENQUEUE JOB: Let worker handle SasaPay API call ---
    const jobUuid = await this.jobService.enqueue('sasapay_otp_confirmation', {
      customerId,
      astppId: appRow.astpp_id,
      applicationId: appRow.pg_app_id,
      requestId,
      otp: dto.otp,
    });

    await this.writeAuditLog(customerId, 'SASAPAY_OTP_JOB_QUEUED', {
      customerId: user.id,
      requestId,
      jobUuid,
      jobType: 'sasapay_otp_confirmation',
      reason: 'OTP confirmation enqueued for processing',
    });

    this.logger.log(`[OTP CONFIRM] Enqueued sasapay_otp_confirmation job ${jobUuid} for customer ${customerId}`);

    return {
      success: true,
      message: 'OTP confirmation is being processed. Your wallet will be ready shortly.',
      data: {
        jobId: jobUuid,
        status: 'processing',
      },
    };
  }

  /**
   * SasaPay webhook callback (was POST api/v1/onboarding/callback/sasapay)
   */
  @Post('webhooks/v1/sasapay')
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

  private maskPhoneNumber(phoneNumber: string): string {
    if (!phoneNumber || phoneNumber.length <= 6) return 'your registered phone number';

    return `${phoneNumber.slice(0, 3)}${'*'.repeat(phoneNumber.length - 6)}${phoneNumber.slice(-3)}`;
  }

  private async writeAuditLog(customerId: number, eventType: string, details: Record<string, unknown>): Promise<void> {
    await this.db.query(
      `INSERT INTO customer_activity_logs (customer_id, event_type, actor_type, actor_id, details, created_at)
       VALUES ($1, $2, 'SYSTEM', 'ONBOARDING_CONTROLLER', $3::jsonb, NOW())`,
      [customerId, eventType, details],
    );
  }

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

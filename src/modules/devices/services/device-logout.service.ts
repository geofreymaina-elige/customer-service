import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
  HttpStatus,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../../../core/database/database.service';
import { SecureJwtService } from '../../../core/auth/jwt.service';
import { MessageService } from '../../../core/messages/message.service';
import { KafkaNotificationService } from '../../../core/notifications/kafka-notification.service';
import { DeviceGatekeeperService } from './device-gatekeeper.service';
import { InitiateDeviceLogoutDto, VerifyDeviceLogoutDto } from '../dto/device.dto';
import { AppException, PinLockedException } from '../../../core/errors/app.exception';

@Injectable()
export class DeviceLogoutService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwtService: SecureJwtService,
    private readonly messages: MessageService,
    private readonly deviceGatekeeper: DeviceGatekeeperService,
    private readonly notifications: KafkaNotificationService,
  ) { }

  /**
   * Step 1: Initiate Device Logout / Recovery (Verify ASTPP ID, Document Number & PIN)
   */
  async initiateLogout(dto: InitiateDeviceLogoutDto): Promise<{
    sessionToken: string;
    maskedPhone: string;
    expiresInMinutes: number;
  }> {
    // 1. Find customer and identity details (prioritize wallet_kyc over primary_kyc)
    const customer = await this.db.queryOne(
      `SELECT c.id, c.uuid, c.phone_number, c.deleted_at, c.status, cad.identity_document_number AS document_number
       FROM customers c
       LEFT JOIN customer_applications ca ON ca.customer_id = c.id
       LEFT JOIN customer_applicant_details cad ON cad.customer_application_id = ca.id
         AND cad.application_type IN ('wallet_kyc', 'primary_kyc')
       WHERE (c.astpp_id::text = $1 OR c.uuid::text = $1)
       ORDER BY 
         ca.created_at DESC NULLS LAST,
         CASE cad.application_type WHEN 'wallet_kyc' THEN 1 WHEN 'primary_kyc' THEN 2 ELSE 3 END ASC
       LIMIT 1`,
      [dto.astpp_id]
    );

    if (!customer) {
      throw new NotFoundException(this.messages.get('common.notFound'));
    }

    if (customer.deleted_at || customer.status === 'closed' || customer.status === 'suspended') {
      throw new UnauthorizedException('Customer account is inactive or deleted.');
    }

    // 2. Validate Document Number
    if (!customer.document_number || customer.document_number.trim().toUpperCase() !== dto.id_number.trim().toUpperCase()) {
      throw new UnauthorizedException('Identity document number does not match registered profile.');
    }

    // 3. Verify PIN
    const pinRecord = await this.db.queryOne(
      `SELECT pin_hash, is_permanently_locked, locked_until FROM customer_pins WHERE customer_id = $1`,
      [customer.id]
    );

    if (!pinRecord) {
      throw new BadRequestException(this.messages.get('auth.pin.required'));
    }

    if (pinRecord.is_permanently_locked) {
      throw new PinLockedException(this.messages.get('auth.pin.permanentlyLocked'));
    }

    const isPinValid = await bcrypt.compare(dto.pin, pinRecord.pin_hash);
    if (!isPinValid) {
      throw new UnauthorizedException('Invalid PIN provided.');
    }

    // 4. Invalidate previous logout sessions
    await this.db.query(
      `UPDATE customer_device_logout_sessions SET invalidated_at = NOW() WHERE customer_id = $1 AND invalidated_at IS NULL`,
      [customer.id]
    );

    // 5. Create new session token
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const sessionTokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');

    await this.db.query(
      `INSERT INTO customer_device_logout_sessions (customer_id, session_token_hash, state, resend_count, expires_at, created_at, updated_at)
       VALUES ($1, $2, 'id_verified', 0, NOW() + INTERVAL '30 minutes', NOW(), NOW())`,
      [customer.id, sessionTokenHash]
    );

    // 6. Generate 6-digit OTP
    const otpCode = crypto.randomInt(100000, 999999).toString();
    const otpHash = this.jwtService.hashOtp(otpCode);

    await this.db.query(
      `INSERT INTO customer_otp_codes (customer_id, otp_hash, purpose, attempts, max_attempts, is_used, expires_at, created_at)
       VALUES ($1, $2, 'device_logout', 0, 3, FALSE, NOW() + INTERVAL '5 minutes', NOW())`,
      [customer.id, otpHash]
    );

    await this.db.query(
      `UPDATE customer_device_logout_sessions SET state = 'otp_sent', updated_at = NOW() WHERE session_token_hash = $1`,
      [sessionTokenHash]
    );

    const phone = customer.phone_number || '';
    const maskedPhone = phone.length > 4 ? `****${phone.slice(-4)}` : '****';

    // Send OTP via SMS through Kafka
    await this.notifications.sendOtpSms(
      customer.phone_number,
      otpCode,
      'device_recovery',
      `device_recovery_${customer.uuid}_${Date.now()}`,
      String(customer.id)
    );

    return {
      sessionToken,
      maskedPhone,
      expiresInMinutes: 5,
    };
  }

  /**
   * Step 2: Verify OTP, Revoke Old Active Devices, and Activate New Device
   */
  async verifyOtpAndLogout(
    dto: VerifyDeviceLogoutDto,
    ipAddress: string = '127.0.0.1'
  ): Promise<{
    loggedOut: boolean;
    token: any;
  }> {
    const sessionHash = crypto.createHash('sha256').update(dto.sessionToken).digest('hex');

    const session = await this.db.queryOne(
      `SELECT id, customer_id, state, expires_at, invalidated_at
       FROM customer_device_logout_sessions
       WHERE session_token_hash = $1 AND invalidated_at IS NULL`,
      [sessionHash]
    );

    if (!session || new Date(session.expires_at) < new Date()) {
      throw new BadRequestException(this.messages.get('auth.reset.invalidOrExpiredSession'));
    }

    // Verify OTP
    const otpRecord = await this.db.queryOne(
      `SELECT id, otp_hash, attempts, max_attempts
       FROM customer_otp_codes
       WHERE customer_id = $1 AND purpose = 'device_logout' AND is_used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [session.customer_id]
    );

    if (!otpRecord) {
      throw new BadRequestException(this.messages.get('auth.reset.invalidOrExpiredSession'));
    }

    const providedOtpHash = this.jwtService.hashOtp(dto.otp);

    if (otpRecord.otp_hash !== providedOtpHash) {
      const newAttempts = otpRecord.attempts + 1;
      await this.db.query(`UPDATE customer_otp_codes SET attempts = $1 WHERE id = $2`, [newAttempts, otpRecord.id]);
      const attemptsRemaining = Math.max(0, otpRecord.max_attempts - newAttempts);
      throw new AppException(
        'INVALID_OTP',
        this.messages.get('auth.reset.invalidOtp', { attemptsRemaining }),
        HttpStatus.UNAUTHORIZED
      );
    }

    // Mark OTP as used and invalidate session
    await this.db.query(`UPDATE customer_otp_codes SET is_used = TRUE WHERE id = $1`, [otpRecord.id]);
    await this.db.query(
      `UPDATE customer_device_logout_sessions SET state = 'completed', invalidated_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [session.id]
    );

    // Revoke all previous active devices
    await this.db.query(
      `UPDATE customer_devices SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
       WHERE customer_id = $1 AND status = 'active'`,
      [session.customer_id]
    );

    // Register new device as the single active device
    const deviceResult = await this.deviceGatekeeper.registerOrVerifyDevice(
      session.customer_id,
      dto.device,
      ipAddress
    );

    // Fetch customer for token generation
    const customer = await this.db.queryOne(
      `SELECT id, uuid, voip_number, status, deleted_at FROM customers WHERE id = $1`,
      [session.customer_id]
    );

    if (!customer || customer.deleted_at || customer.status === 'closed' || customer.status === 'suspended') {
      throw new UnauthorizedException('Customer account is inactive or deleted.');
    }

    const token = this.jwtService.generateAppAccessToken(customer, deviceResult.deviceHash);

    return {
      loggedOut: true,
      token,
    };
  }
}

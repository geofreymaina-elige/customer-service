import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  HttpStatus,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../../../core/database/database.service';
import { SecureJwtService } from '../../../core/auth/jwt.service';
import { MessageService } from '../../../core/messages/message.service';
import {
  InitiatePinResetDto,
  VerifyResetOtpDto,
  ResendResetOtpDto,
  CompletePinResetDto,
} from '../dto/pin-reset.dto';
import { AppException } from '../../../core/errors/app.exception';

@Injectable()
export class PinResetService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwtService: SecureJwtService,
    private readonly messages: MessageService,
  ) {}

  /**
   * Step 1: Initiate PIN reset with ASTPP Account ID & ID Number check
   */
  async initiateReset(dto: InitiatePinResetDto): Promise<{
    sessionToken: string;
    maskedPhone: string;
    expiresInMinutes: number;
  }> {
    // Find customer & identity
    const customer = await this.db.queryOne(
      `SELECT c.id, c.uuid, c.phone_number, ci.document_number
       FROM customers c
       LEFT JOIN customer_identities ci ON ci.customer_id = c.id
       WHERE c.astpp_account_id = $1 OR c.uuid::text = $1`,
      [dto.astppId]
    );

    if (!customer) {
      throw new NotFoundException(this.messages.get('common.notFound'));
    }

    if (!customer.document_number || customer.document_number.trim().toUpperCase() !== dto.idNumber.trim().toUpperCase()) {
      throw new UnauthorizedException('Identity document number does not match registered profile.');
    }

    // Invalidate previous active sessions
    await this.db.query(
      `UPDATE pin_reset_sessions SET invalidated_at = NOW() WHERE customer_id = $1 AND invalidated_at IS NULL`,
      [customer.id]
    );

    // Generate opaque session token
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const sessionTokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');

    // Create session (state: id_verified, expires in 30 minutes)
    await this.db.query(
      `INSERT INTO pin_reset_sessions (customer_id, session_token_hash, state, resend_count, expires_at, created_at, updated_at)
       VALUES ($1, $2, 'id_verified', 0, NOW() + INTERVAL '30 minutes', NOW(), NOW())`,
      [customer.id, sessionTokenHash]
    );

    // Generate 6-digit OTP
    const otpCode = crypto.randomInt(100000, 999999).toString();
    const otpHash = this.jwtService.hashOtp(otpCode);

    // Store OTP in database
    await this.db.query(
      `INSERT INTO otp_codes (customer_id, otp_hash, purpose, attempts, max_attempts, is_used, expires_at, created_at)
       VALUES ($1, $2, 'pin_reset', 0, 3, FALSE, NOW() + INTERVAL '5 minutes', NOW())`,
      [customer.id, otpHash]
    );

    // Update session state to otp_sent
    await this.db.query(
      `UPDATE pin_reset_sessions SET state = 'otp_sent', updated_at = NOW() WHERE session_token_hash = $1`,
      [sessionTokenHash]
    );

    // Mask phone number (show last 4 digits)
    const phone = customer.phone_number || '';
    const maskedPhone = phone.length > 4 ? `****${phone.slice(-4)}` : '****';

    return {
      sessionToken,
      maskedPhone,
      expiresInMinutes: 5,
    };
  }

  /**
   * Step 2: Verify SMS OTP
   */
  async verifyOtp(dto: VerifyResetOtpDto): Promise<{ canResetPin: boolean; sessionToken: string }> {
    const sessionHash = crypto.createHash('sha256').update(dto.sessionToken).digest('hex');

    const session = await this.db.queryOne(
      `SELECT id, customer_id, state, expires_at, invalidated_at
       FROM pin_reset_sessions
       WHERE session_token_hash = $1 AND invalidated_at IS NULL`,
      [sessionHash]
    );

    if (!session || new Date(session.expires_at) < new Date()) {
      throw new BadRequestException(this.messages.get('auth.reset.invalidOrExpiredSession'));
    }

    // Lookup latest unused OTP
    const otpRecord = await this.db.queryOne(
      `SELECT id, otp_hash, attempts, max_attempts, expires_at
       FROM otp_codes
       WHERE customer_id = $1 AND purpose = 'pin_reset' AND is_used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [session.customer_id]
    );

    if (!otpRecord) {
      throw new BadRequestException(this.messages.get('auth.reset.invalidOrExpiredSession'));
    }

    const providedOtpHash = this.jwtService.hashOtp(dto.otp);

    if (otpRecord.otp_hash !== providedOtpHash) {
      const newAttempts = otpRecord.attempts + 1;
      await this.db.query(
        `UPDATE otp_codes SET attempts = $1 WHERE id = $2`,
        [newAttempts, otpRecord.id]
      );

      const attemptsRemaining = Math.max(0, otpRecord.max_attempts - newAttempts);
      throw new AppException(
        'INVALID_OTP',
        this.messages.get('auth.reset.invalidOtp', { attemptsRemaining }),
        HttpStatus.UNAUTHORIZED
      );
    }

    // Mark OTP as used
    await this.db.query(`UPDATE otp_codes SET is_used = TRUE WHERE id = $1`, [otpRecord.id]);

    // Advance session state to otp_verified
    await this.db.query(
      `UPDATE pin_reset_sessions SET state = 'otp_verified', updated_at = NOW() WHERE id = $1`,
      [session.id]
    );

    return {
      canResetPin: true,
      sessionToken: dto.sessionToken,
    };
  }

  /**
   * Step 3: Complete PIN Reset with verified session
   */
  async completeReset(dto: CompletePinResetDto): Promise<{ success: boolean; message: string }> {
    if (dto.pin !== dto.confirmPin) {
      throw new BadRequestException(this.messages.get('auth.pin.pinsMustMatch'));
    }

    const sessionHash = crypto.createHash('sha256').update(dto.sessionToken).digest('hex');

    const session = await this.db.queryOne(
      `SELECT id, customer_id, state, expires_at, invalidated_at
       FROM pin_reset_sessions
       WHERE session_token_hash = $1 AND invalidated_at IS NULL`,
      [sessionHash]
    );

    if (!session || new Date(session.expires_at) < new Date() || session.state !== 'otp_verified') {
      throw new BadRequestException(this.messages.get('auth.reset.invalidOrExpiredSession'));
    }

    // Hash new PIN with bcrypt
    const hashedPin = await bcrypt.hash(dto.pin, 10);

    // Update customer PIN and reset all lockouts
    await this.db.transaction(async (client) => {
      await client.query(
        `INSERT INTO customer_pins (customer_id, pin_hash, failed_attempts, locked_until, is_permanently_locked, updated_at)
         VALUES ($1, $2, 0, NULL, FALSE, NOW())
         ON CONFLICT (customer_id) DO UPDATE
         SET pin_hash = $2, failed_attempts = 0, locked_until = NULL, is_permanently_locked = FALSE, updated_at = NOW()`,
        [session.customer_id, hashedPin]
      );

      // Invalidate the session
      await client.query(
        `UPDATE pin_reset_sessions SET state = 'completed', invalidated_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [session.id]
      );
    });

    return {
      success: true,
      message: this.messages.get('auth.reset.completed'),
    };
  }
}

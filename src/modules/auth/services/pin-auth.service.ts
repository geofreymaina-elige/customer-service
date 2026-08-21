import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
  ForbiddenException,
  HttpStatus,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../../../core/database/database.service';
import { SecureJwtService, TokenResponse } from '../../../core/auth/jwt.service';
import { MessageService } from '../../../core/messages/message.service';
import { EventService } from '../../../core/events/event.service';
import { SetPinDto, VerifyPinDto, ChangePinDto } from '../dto/pin-auth.dto';
import { AppException, PinLockedException } from '../../../core/errors/app.exception';

@Injectable()
export class PinAuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwtService: SecureJwtService,
    private readonly messages: MessageService,
    private readonly events: EventService,
  ) {}

  /**
   * Set initial 4-digit PIN for a customer
   */
  async setPin(dto: SetPinDto): Promise<{ success: boolean; message: string }> {
    if (dto.pin !== dto.confirmPin) {
      throw new BadRequestException(this.messages.get('auth.pin.pinsMustMatch'));
    }

    // Find customer by UUID or ASTPP ID
    const customer = await this.db.queryOne(
      `SELECT id, uuid FROM customers WHERE uuid::text = $1 OR astpp_account_id = $1`,
      [dto.customerId]
    );

    if (!customer) {
      throw new NotFoundException(this.messages.get('common.notFound'));
    }

    // Check if PIN already set
    const existingPin = await this.db.queryOne(
      `SELECT id FROM customer_pins WHERE customer_id = $1`,
      [customer.id]
    );

    if (existingPin) {
      throw new BadRequestException(this.messages.get('auth.pin.alreadySet'));
    }

    // Hash PIN with bcrypt
    const hashedPin = await bcrypt.hash(dto.pin, 10);

    await this.db.query(
      `INSERT INTO customer_pins (customer_id, pin_hash, failed_attempts, created_at, updated_at)
       VALUES ($1, $2, 0, NOW(), NOW())`,
      [customer.id, hashedPin]
    );

    // Record activity log
    await this.db.query(
      `INSERT INTO customer_activity_logs (customer_id, event_type, actor_type, actor_id, details)
       VALUES ($1, 'PIN_SET', 'CUSTOMER', $1::text, '{}'::jsonb)`,
      [customer.id]
    );

    await this.events.publish('customer.pin_set', 'CustomerPin', String(customer.id), { customerId: customer.id });

    return {
      success: true,
      message: this.messages.get('auth.pin.setSuccess'),
    };
  }

  /**
   * Authenticated PIN change (requires old PIN)
   */
  async changePin(customerId: number, dto: ChangePinDto): Promise<{ success: boolean; message: string }> {
    if (dto.newPin !== dto.confirmNewPin) {
      throw new BadRequestException(this.messages.get('auth.pin.pinsMustMatch'));
    }

    if (dto.newPin === dto.oldPin) {
      throw new BadRequestException(this.messages.get('auth.pin.newPinCannotBeSame'));
    }

    const pinRecord = await this.db.queryOne(
      `SELECT id, pin_hash, failed_attempts, locked_until, is_permanently_locked
       FROM customer_pins
       WHERE customer_id = $1`,
      [customerId]
    );

    if (!pinRecord) {
      throw new BadRequestException(this.messages.get('auth.pin.required'));
    }

    if (pinRecord.is_permanently_locked) {
      throw new ForbiddenException(this.messages.get('auth.pin.permanentlyLocked'));
    }

    if (pinRecord.locked_until && new Date(pinRecord.locked_until) > new Date()) {
      const minutesRemaining = Math.ceil((new Date(pinRecord.locked_until).getTime() - Date.now()) / (1000 * 60));
      throw new ForbiddenException(
        this.messages.get('auth.pin.temporarilyLocked', { minutes: minutesRemaining })
      );
    }

    // Verify old PIN
    const isOldPinValid = await bcrypt.compare(dto.oldPin, pinRecord.pin_hash);
    if (!isOldPinValid) {
      const newAttempts = pinRecord.failed_attempts + 1;
      await this.db.query(
        `UPDATE customer_pins SET failed_attempts = $1, updated_at = NOW() WHERE id = $2`,
        [newAttempts, pinRecord.id]
      );
      throw new BadRequestException(this.messages.get('auth.pin.oldPinInvalid'));
    }

    // Hash new PIN
    const hashedNewPin = await bcrypt.hash(dto.newPin, 10);

    await this.db.query(
      `UPDATE customer_pins
       SET pin_hash = $1, failed_attempts = 0, locked_until = NULL, last_changed_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [hashedNewPin, pinRecord.id]
    );

    // Record activity log
    await this.db.query(
      `INSERT INTO customer_activity_logs (customer_id, event_type, actor_type, actor_id, details)
       VALUES ($1, 'PIN_CHANGED', 'CUSTOMER', $1::text, '{}'::jsonb)`,
      [customerId]
    );

    await this.events.publish('customer.pin_changed', 'CustomerPin', String(customerId), { customerId });

    return {
      success: true,
      message: this.messages.get('auth.pin.changeSuccess'),
    };
  }

  /**
   * Verify 4-digit PIN with lockout enforcement (3 attempts -> 15 min lock, 5 attempts -> permanent lock)
   */
  async verifyPin(dto: VerifyPinDto, ip: string = '127.0.0.1', userAgent: string = ''): Promise<{
    customer: any;
    token: TokenResponse;
  }> {
    // Find customer
    const customer = await this.db.queryOne(
      `SELECT id, uuid, voip_number, first_name, last_name, email, phone_number, status, timezone
       FROM customers
       WHERE uuid::text = $1 OR astpp_account_id = $1`,
      [dto.customerId]
    );

    if (!customer) {
      throw new NotFoundException(this.messages.get('common.notFound'));
    }

    // Check PIN record
    const pinRecord = await this.db.queryOne(
      `SELECT id, pin_hash, failed_attempts, locked_until, is_permanently_locked
       FROM customer_pins
       WHERE customer_id = $1`,
      [customer.id]
    );

    if (!pinRecord) {
      throw new BadRequestException(this.messages.get('auth.pin.required'));
    }

    // 1. Check Permanent Lockout
    if (pinRecord.is_permanently_locked) {
      await this.recordAttempt(customer.id, false, 'PERMANENTLY_LOCKED', ip, userAgent);
      throw new PinLockedException(this.messages.get('auth.pin.permanentlyLocked'));
    }

    // 2. Check Temporary Lockout
    if (pinRecord.locked_until && new Date(pinRecord.locked_until) > new Date()) {
      const minutesRemaining = Math.ceil((new Date(pinRecord.locked_until).getTime() - Date.now()) / (1000 * 60));
      await this.recordAttempt(customer.id, false, 'TEMPORARILY_LOCKED', ip, userAgent);
      throw new PinLockedException(
        this.messages.get('auth.pin.temporarilyLocked', { minutes: minutesRemaining }),
        pinRecord.locked_until
      );
    }

    // 3. Verify bcrypt hash
    const isValid = await bcrypt.compare(dto.pin, pinRecord.pin_hash);

    if (!isValid) {
      const newAttempts = pinRecord.failed_attempts + 1;
      let lockedUntil: Date | null = null;
      let isPermanent = false;

      if (newAttempts >= 5) {
        isPermanent = true;
      } else if (newAttempts >= 3) {
        lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 mins lock
      }

      await this.db.query(
        `UPDATE customer_pins
         SET failed_attempts = $1, locked_until = $2, is_permanently_locked = $3, updated_at = NOW()
         WHERE customer_id = $4`,
        [newAttempts, lockedUntil, isPermanent, customer.id]
      );

      await this.recordAttempt(customer.id, false, 'INVALID_PIN', ip, userAgent);

      const attemptsRemaining = Math.max(0, 5 - newAttempts);
      if (isPermanent) {
        throw new PinLockedException(this.messages.get('auth.pin.permanentlyLocked'));
      }
      if (lockedUntil) {
        throw new PinLockedException(this.messages.get('auth.pin.temporarilyLocked', { minutes: 15 }), lockedUntil);
      }

      throw new AppException(
        'INVALID_PIN',
        this.messages.get('auth.pin.invalid', { attemptsRemaining }),
        HttpStatus.UNAUTHORIZED
      );
    }

    // 4. Success: Reset attempt counters
    await this.db.query(
      `UPDATE customer_pins
       SET failed_attempts = 0, locked_until = NULL, last_verified_at = NOW(), updated_at = NOW()
       WHERE customer_id = $1`,
      [customer.id]
    );

    await this.recordAttempt(customer.id, true, null, ip, userAgent);

    // Compute device hash if device info provided
    let deviceHash = '';
    if (dto.deviceIdentifier && dto.deviceModel && dto.mobileType) {
      deviceHash = this.jwtService.hashDevice(dto.deviceIdentifier, dto.deviceModel, dto.mobileType);
    }

    // Generate secure token
    const token = this.jwtService.generateToken(customer, deviceHash, [
      'customer:read',
      'customer:write',
      'device:manage',
      'wallet:control',
    ]);

    return {
      customer: {
        uuid: customer.uuid,
        voipNumber: customer.voip_number,
        firstName: customer.first_name,
        lastName: customer.last_name,
        email: customer.email,
        phoneNumber: customer.phone_number,
      },
      token,
    };
  }

  private async recordAttempt(customerId: number, isSuccess: boolean, reason: string | null, ip: string, userAgent: string) {
    await this.db.query(
      `INSERT INTO customer_auth_attempts (customer_id, attempt_type, is_successful, failure_reason, ip_address, user_agent, created_at)
       VALUES ($1, 'pin', $2, $3, $4, $5, NOW())`,
      [customerId, isSuccess, reason, ip, userAgent]
    );
  }
}

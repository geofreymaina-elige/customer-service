import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../../../core/database/database.service';
import { MessageService } from '../../../core/messages/message.service';
import { EventService } from '../../../core/events/event.service';
import { LockWalletDto, UnlockWalletDto } from '../dto/wallet.dto';

@Injectable()
export class WalletService {
  constructor(
    private readonly db: DatabaseService,
    private readonly messages: MessageService,
    private readonly events: EventService,
  ) {}

  /**
   * Get wallet / account summary by customer ID
   */
  async getWalletByCustomerId(customerId: number) {
    const wallet = await this.db.queryOne(
      `SELECT id, uuid, account_number, currency, status, is_locked, lock_reason, locked_by, locked_at, freeze_type, tier_level, created_at, updated_at
       FROM customer_wallets WHERE customer_id = $1`,
      [customerId]
    );

    if (!wallet) {
      throw new NotFoundException(this.messages.get('wallets.notFound'));
    }

    return {
      walletId: wallet.uuid,
      accountNumber: wallet.account_number,
      currency: wallet.currency,
      status: wallet.status,
      isLocked: wallet.is_locked,
      lockReason: wallet.lock_reason,
      lockedBy: wallet.locked_by,
      lockedAt: wallet.locked_at,
      freezeType: wallet.freeze_type,
      tierLevel: wallet.tier_level,
      createdAt: wallet.created_at,
      updatedAt: wallet.updated_at,
    };
  }

  /**
   * Get wallet onboarding readiness status (fast - no joins)
   * Returns wallet status, application progress, and KYC requirements
   */
  async getWalletOnboardingStatus(customerId: number) {
    // Single query to fetch wallet data
    const wallet = await this.db.queryOne(
      `SELECT id, uuid, account_number, currency, status, tier_level, created_at
       FROM customer_wallets WHERE customer_id = $1`,
      [customerId]
    );

    // Single query to fetch customer application status
    const application = await this.db.queryOne(
      `SELECT kyc_status, sasapay_request_id, sasapay_account_number, sasapay_account_status, submitted_at, approved_at, rejected_at
       FROM customer_applications
       WHERE customer_id = $1 AND application_type = 'wallet_kyc'
       ORDER BY created_at DESC
       LIMIT 1`,
      [customerId]
    );

    // Determine readiness
    const hasWallet = !!wallet;
    const hasApplication = !!application;
    const applicationStatus = application?.kyc_status || 'not_started';
    const requiresAdditionalKyc = !hasWallet || applicationStatus === 'unverified' || applicationStatus === 'requires_kyc_upload';
    const isReadyToOnboard = !hasApplication || applicationStatus === 'unverified';
    const isPending = applicationStatus === 'pending' || applicationStatus === 'requires_kyc_upload';
    const isApproved = applicationStatus === 'approved' && hasWallet;
    const isRejected = applicationStatus === 'rejected';

    // Build response based on status
    const response: any = {
      hasWallet,
      hasApplication,
      isReadyToOnboard,
      requiresAdditionalKyc,
      applicationStatus,
    };

    // Add wallet details if exists
    if (hasWallet) {
      response.wallet = {
        walletId: wallet.uuid,
        accountNumber: wallet.account_number,
        currency: wallet.currency,
        status: wallet.status,
        tierLevel: wallet.tier_level,
        createdAt: wallet.created_at,
      };
    }

    // Add application details if exists
    if (hasApplication) {
      response.application = {
        status: applicationStatus,
        sasapayRequestId: application.sasapay_request_id,
        sasapayAccountNumber: application.sasapay_account_number,
        sasapayAccountStatus: application.sasapay_account_status,
        submittedAt: application.submitted_at,
        approvedAt: application.approved_at,
        rejectedAt: application.rejected_at,
      };
    }

    // Determine user-facing message
    let message: string;
    let nextAction: string | null = null;

    if (!hasApplication) {
      message = this.messages.get('wallets.onboarding.notStarted');
      nextAction = 'start_onboarding';
    } else if (applicationStatus === 'unverified') {
      message = this.messages.get('wallets.onboarding.readyToStart');
      nextAction = 'start_onboarding';
    } else if (applicationStatus === 'pending') {
      message = this.messages.get('wallets.onboarding.awaitingOtp');
      nextAction = 'verify_otp';
    } else if (applicationStatus === 'requires_kyc_upload') {
      message = this.messages.get('wallets.onboarding.processingKyc');
      nextAction = 'wait_for_approval';
    } else if (applicationStatus === 'approved' && hasWallet) {
      message = this.messages.get('wallets.onboarding.approved');
      nextAction = null;
    } else if (applicationStatus === 'rejected') {
      message = this.messages.get('wallets.onboarding.rejected');
      nextAction = 'contact_support';
    } else {
      message = this.messages.get('wallets.onboarding.inProgress');
      nextAction = 'wait_for_approval';
    }

    response.message = message;
    response.nextAction = nextAction;
    response.isPending = isPending;
    response.isApproved = isApproved;
    response.isRejected = isRejected;

    return response;
  }

  /**
   * Get wallet by public UUID
   */
  async getWalletByUuid(uuid: string) {
    const wallet = await this.db.queryOne(
      `SELECT id, uuid, account_number, currency, status, is_locked, lock_reason, locked_by, locked_at, freeze_type, tier_level, created_at, updated_at
       FROM customer_wallets WHERE uuid = $1`,
      [uuid]
    );

    if (!wallet) {
      throw new NotFoundException(this.messages.get('wallets.notFound'));
    }

    return {
      walletId: wallet.uuid,
      accountNumber: wallet.account_number,
      currency: wallet.currency,
      status: wallet.status,
      isLocked: wallet.is_locked,
      lockReason: wallet.lock_reason,
      lockedBy: wallet.locked_by,
      lockedAt: wallet.locked_at,
      freezeType: wallet.freeze_type,
      tierLevel: wallet.tier_level,
      createdAt: wallet.created_at,
      updatedAt: wallet.updated_at,
    };
  }

  /**
   * Lock account / wallet (Customer self-lock or security lock)
   */
  async lockWallet(customerId: number, dto: LockWalletDto, actor: string = 'CUSTOMER_SELF_LOCK') {
    const wallet = await this.db.queryOne(
      `SELECT id, status, is_locked FROM customer_wallets WHERE customer_id = $1`,
      [customerId]
    );

    if (!wallet) {
      throw new NotFoundException(this.messages.get('wallets.notFound'));
    }

    if (wallet.is_locked || wallet.status === 'locked') {
      throw new BadRequestException(this.messages.get('wallets.alreadyLocked'));
    }

    // If PIN is provided, verify it
    if (dto.pin) {
      await this.verifyCustomerPin(customerId, dto.pin);
    }

    await this.db.query(
      `UPDATE customer_wallets
       SET status = 'locked',
           is_locked = TRUE,
           lock_reason = $1,
           locked_by = $2,
           locked_at = NOW(),
           freeze_type = 'customer_initiated',
           updated_at = NOW()
       WHERE customer_id = $3`,
      [dto.reason, actor, customerId]
    );

    // Record activity log
    await this.db.query(
      `INSERT INTO customer_activity_logs (customer_id, event_type, actor_type, actor_id, details)
       VALUES ($1, 'WALLET_LOCKED', 'CUSTOMER', $2, $3::jsonb)`,
      [customerId, actor, JSON.stringify({ reason: dto.reason })]
    );

    // Outbox event
    await this.events.publish(
      'customer.wallet_locked',
      'Wallet',
      String(customerId),
      { customerId, reason: dto.reason, lockedBy: actor }
    );

    return this.getWalletByCustomerId(customerId);
  }

  /**
   * Unlock account / wallet with PIN verification
   */
  async unlockWallet(customerId: number, dto: UnlockWalletDto, actor: string = 'CUSTOMER_UNLOCK') {
    const wallet = await this.db.queryOne(
      `SELECT id, status, is_locked, freeze_type FROM customer_wallets WHERE customer_id = $1`,
      [customerId]
    );

    if (!wallet) {
      throw new NotFoundException(this.messages.get('wallets.notFound'));
    }

    if (!wallet.is_locked && wallet.status === 'active') {
      throw new BadRequestException(this.messages.get('wallets.alreadyUnlocked'));
    }

    // If locked by admin for compliance reasons, user cannot unlock themselves
    if (wallet.freeze_type === 'admin_compliance') {
      throw new ForbiddenException(
        'Account was administratively restricted for compliance review. Please contact customer support.'
      );
    }

    // Verify PIN
    await this.verifyCustomerPin(customerId, dto.pin);

    await this.db.query(
      `UPDATE customer_wallets
       SET status = 'active',
           is_locked = FALSE,
           lock_reason = NULL,
           locked_by = NULL,
           locked_at = NULL,
           freeze_type = NULL,
           updated_at = NOW()
       WHERE customer_id = $1`,
      [customerId]
    );

    // Record activity log
    await this.db.query(
      `INSERT INTO customer_activity_logs (customer_id, event_type, actor_type, actor_id, details)
       VALUES ($1, 'WALLET_UNLOCKED', 'CUSTOMER', $2, '{}'::jsonb)`,
      [customerId, actor]
    );

    // Outbox event
    await this.events.publish(
      'customer.wallet_unlocked',
      'Wallet',
      String(customerId),
      { customerId, unlockedBy: actor }
    );

    return this.getWalletByCustomerId(customerId);
  }

  /**
   * Private helper to verify PIN against anti-brute-force lockout
   */
  private async verifyCustomerPin(customerId: number, rawPin: string): Promise<void> {
    const pinRecord = await this.db.queryOne(
      `SELECT id, pin_hash, failed_attempts, locked_until, is_permanently_locked
       FROM customer_pins WHERE customer_id = $1`,
      [customerId]
    );

    if (!pinRecord) {
      throw new BadRequestException('Security PIN has not been set for this account.');
    }

    if (pinRecord.is_permanently_locked) {
      throw new ForbiddenException(this.messages.get('auth.pin.permanentlyLocked'));
    }

    if (pinRecord.locked_until && new Date(pinRecord.locked_until) > new Date()) {
      const remainingMinutes = Math.ceil(
        (new Date(pinRecord.locked_until).getTime() - Date.now()) / 60000
      );
      throw new ForbiddenException(
        this.messages.get('auth.pin.temporarilyLocked', { minutes: remainingMinutes })
      );
    }

    const isMatch = await bcrypt.compare(rawPin, pinRecord.pin_hash);
    if (!isMatch) {
      const newFailed = (pinRecord.failed_attempts || 0) + 1;
      const maxAttempts = 5;

      if (newFailed >= 10) {
        await this.db.query(
          `UPDATE customer_pins SET failed_attempts = $1, is_permanently_locked = TRUE WHERE id = $2`,
          [newFailed, pinRecord.id]
        );
        throw new ForbiddenException(this.messages.get('auth.pin.permanentlyLocked'));
      }

      if (newFailed >= maxAttempts) {
        const lockoutUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 mins
        await this.db.query(
          `UPDATE customer_pins SET failed_attempts = $1, locked_until = $2 WHERE id = $3`,
          [newFailed, lockoutUntil, pinRecord.id]
        );
        throw new ForbiddenException(
          this.messages.get('auth.pin.temporarilyLocked', { minutes: 15 })
        );
      }

      await this.db.query(
        `UPDATE customer_pins SET failed_attempts = $1 WHERE id = $2`,
        [newFailed, pinRecord.id]
      );

      throw new BadRequestException(
        this.messages.get('auth.pin.invalid', { attemptsRemaining: maxAttempts - newFailed })
      );
    }

    // Reset failed attempts on success
    await this.db.query(
      `UPDATE customer_pins SET failed_attempts = 0, locked_until = NULL, last_verified_at = NOW() WHERE id = $1`,
      [pinRecord.id]
    );
  }
}

import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../../../core/database/database.service';
import { MessageService } from '../../../core/messages/message.service';
import { EventService } from '../../../core/events/event.service';
import { LockWalletDto, UnlockWalletDto } from '../dto/wallet.dto';
import { SasaPayWaasService } from '../../onboarding/services/sasapay-waas.service';
import { SasaPayKycService } from '../../onboarding/services/sasapay-kyc.service';

@Injectable()
export class WalletService {
  constructor(
    private readonly db: DatabaseService,
    private readonly messages: MessageService,
    private readonly events: EventService,
    private readonly sasaPayWaas: SasaPayWaasService,
    private readonly sasaPayKyc: SasaPayKycService,
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

  async getBalance(customerId: number) {
    const wallet = await this.db.queryOne(
      `SELECT cw.account_number, cw.currency, cw.status, c.country_code
       FROM customer_wallets cw
       JOIN customers c ON c.id = cw.customer_id
       WHERE cw.customer_id = $1`,
      [customerId],
    );

    if (!wallet) {
      throw new NotFoundException(this.messages.get('wallets.notFound'));
    }

    const sasaPayDetails = await this.sasaPayWaas.getCustomerDetails(
      String(wallet.account_number),
      wallet.country_code ?? '',
    );
    const sasaPayWallet = sasaPayDetails?.data?.CustomerWallets?.find(
      (item) => String(item.account_number) === String(wallet.account_number),
    ) || sasaPayDetails?.data?.CustomerWallets?.[0];

    return {
      accountNumber: wallet.account_number,
      currency: sasaPayWallet?.currency_code || wallet.currency,
      balance: Number(sasaPayWallet?.account_balance_derived || 0),
      status: wallet.status,
    };
  }

  /**
   * Get wallet onboarding readiness status by ASTPP ID (no auth required)
   * Resolves astppId → internal customer id, then delegates to getWalletOnboardingStatus
   * and adds nextStep field for v2 API
   */
  async getWalletOnboardingStatusByAstppId(astppId: string) {
    const customer = await this.db.queryOne(
      `SELECT id, phone_number FROM customers WHERE astpp_id = $1::bigint`,
      [astppId]
    );
    if (!customer) {
      throw new NotFoundException(this.messages.get('common.notFound'));
    }
    return this.getWalletOnboardingStatus(customer.id);
  }

  /**
   * Get wallet onboarding readiness status (fast - no joins)
   * Returns wallet status, application progress, and KYC requirements
   */
  async getWalletOnboardingStatus(customerId: number) {
    // Single query to fetch wallet data
    const wallet = await this.db.queryOne(
      `SELECT id, uuid, account_number, currency, status, created_at
       FROM customer_wallets WHERE customer_id = $1`,
      [customerId]
    );

    // Single query to fetch customer application status
    const application = await this.db.queryOne(
      `SELECT id, kyc_status, sasapay_request_id, sasapay_account_number, sasapay_account_status, submitted_at, approved_at, rejected_at
       FROM customer_applications
       WHERE customer_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [customerId]
    );

    const applicationStatus = application?.kyc_status || 'not_started';
    await this.sasaPayKyc.ensureSystemCase(
      customerId,
      'The system detected missing or insufficient images for SasaPay requirements.',
      ['REJECTED', 'REQUIRES_KYC_UPLOAD'].includes(application?.sasapay_account_status)
        ? 'SasaPay rejected the existing KYC documents.'
        : undefined,
    );
    const kycSubmission = await this.sasaPayKyc.getCurrentStatus(customerId);
    const requiredDocuments: string[] = kycSubmission?.requiredDocuments || [];

    const pin = await this.db.queryOne(
      `SELECT id FROM customer_pins WHERE customer_id = $1 AND pin_hash IS NOT NULL`,
      [customerId],
    );
    const device = await this.db.queryOne(
      `SELECT id FROM customer_devices WHERE customer_id = $1 AND status = 'active'`,
      [customerId],
    );

    let nextAction: Record<string, string>;
    if (kycSubmission?.status === 'awaiting_documents' && requiredDocuments.length) {
      nextAction = {
        type: 'upload_required_documents',
        method: 'POST',
        endpoint: `/api/v2/customers/kyc/submissions/images`,
      };
    } else if (kycSubmission?.status === 'psp_upload_failed') {
      nextAction = { type: 'contact_support' };
    } else if ([
      'submitted_for_review',
      'approved_for_psp',
      'processing_psp_upload',
      'awaiting_psp_result',
    ].includes(kycSubmission?.status)) {
      nextAction = { type: 'wait_for_kyc_review' };
    } else if (!wallet) {
      // No wallet means we need to start onboarding (which includes OTP verification)
      nextAction = {
        type: 'start_onboarding',
        method: 'POST',
        endpoint: '/api/v2/auth/sessions/device',
      };
    } else if (wallet.status !== 'active') {
      // Wallet exists but not active - waiting for activation
      nextAction = { type: 'wait_for_wallet_activation' };
    } else if (applicationStatus === 'pending') {
      // Wallet is active but application pending - need KYC upload
      nextAction = {
        type: 'upload_kyc_documents',
        message: 'Wallet created. Please upload KYC documents for approval.',
      };
    } else if (applicationStatus === 'requires_kyc_upload') {
      nextAction = { type: 'wait_for_kyc_requirements' };
    } else if (applicationStatus === 'rejected') {
      nextAction = { type: 'contact_support' };
    } else if (!pin) {
      nextAction = { type: 'set_pin' };
    } else if (!device) {
      nextAction = {
        type: 'register_device',
        method: 'POST',
        endpoint: '/api/v2/auth/sessions/device',
      };
    } else {
      nextAction = { type: 'make_transaction' };
    }

    return {
      applicationStatus,
      wallet: wallet ? {
        walletId: wallet.uuid,
        accountNumber: wallet.account_number,
        currency: wallet.currency,
        status: wallet.status,
        createdAt: wallet.created_at,
      } : null,
      application: application ? {
        sasapayRequestId: application.sasapay_request_id,
        sasapayAccountNumber: application.sasapay_account_number,
        sasapayAccountStatus: application.sasapay_account_status,
        submittedAt: application.submitted_at,
        approvedAt: application.approved_at,
        rejectedAt: application.rejected_at,
      } : null,
      requiredDocuments,
      nextAction,
    };
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

  private maskPhoneNumber(phoneNumber: string): string {
    if (!phoneNumber || phoneNumber.length <= 6) return 'your registered phone number';

    return `${phoneNumber.slice(0, 3)}${'*'.repeat(phoneNumber.length - 6)}${phoneNumber.slice(-3)}`;
  }
}

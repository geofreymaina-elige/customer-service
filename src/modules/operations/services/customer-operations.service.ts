import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../../core/database/database.service';
import { MessageService } from '../../../core/messages/message.service';
import { EventService } from '../../../core/events/event.service';
import {
  CustomerQueryDto,
  UpdateCustomerStatusDto,
  ReviewKycDto,
  AdminUnlockPinDto,
  AdminFreezeWalletDto,
} from '../dto/customer-operations.dto';

@Injectable()
export class CustomerOperationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly messages: MessageService,
    private readonly events: EventService,
  ) {}

  /**
   * Search and filter customer directory with pagination
   */
  async searchCustomers(dto: CustomerQueryDto) {
    const limit = dto.limit || 20;
    const offset = dto.offset || 0;
    const params: any[] = [];
    let whereClauses: string[] = [];

    if (dto.query) {
      params.push(`%${dto.query}%`);
      const idx = params.length;
      whereClauses.push(`(
        c.phone_number ILIKE $${idx} OR
        c.voip_number ILIKE $${idx} OR
        c.first_name ILIKE $${idx} OR
        c.last_name ILIKE $${idx} OR
        c.email ILIKE $${idx} OR
        ci.document_number ILIKE $${idx} OR
        c.astpp_account_id ILIKE $${idx}
      )`);
    }

    if (dto.status) {
      params.push(dto.status);
      whereClauses.push(`c.status = $${params.length}`);
    }

    if (dto.kycStatus) {
      params.push(dto.kycStatus);
      whereClauses.push(`ci.kyc_status = $${params.length}`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countSql = `
      SELECT COUNT(DISTINCT c.id) as total
      FROM customers c
      LEFT JOIN customer_identities ci ON ci.customer_id = c.id
      ${whereSql}
    `;
    const countResult = await this.db.queryOne(countSql, params);
    const total = parseInt(countResult?.total || '0', 10);

    params.push(limit);
    const limitParam = `$${params.length}`;
    params.push(offset);
    const offsetParam = `$${params.length}`;

    const dataSql = `
      SELECT c.id, c.uuid, c.astpp_id, c.phone_number, c.email,
             c.first_name, c.last_name, c.status, c.created_at,
             w.status AS wallet_status, w.is_locked AS wallet_is_locked
      FROM customers c
      LEFT JOIN customer_wallets w ON w.customer_id = c.id
      ${whereSql}
      ORDER BY c.created_at DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `;

    const dataResult = await this.db.query(dataSql, params);

    return {
      total,
      limit,
      offset,
      customers: dataResult.rows,
    };
  }

  /**
   * Get complete administrative details of a customer
   */
  async getCustomerAdminDetails(customerUuid: string) {
    const customer = await this.db.queryOne(
      `SELECT c.id, c.uuid, c.astpp_id, c.phone_number, c.email,
              c.first_name, c.last_name, c.gender, c.date_of_birth, c.timezone, c.status, c.has_wallet,
              c.balance, c.credit_limit, c.wallet_kyc_status, c.wallet_kyc_required,
              c.created_at, c.updated_at,
              p.pin_hash IS NOT NULL AS has_pin, p.failed_attempts AS pin_failed_attempts, p.locked_until AS pin_locked_until,
              p.is_permanently_locked AS pin_is_permanently_locked, p.last_verified_at AS pin_last_verified_at,
              w.uuid AS wallet_uuid, w.account_number AS wallet_account_number, w.status AS wallet_status,
              w.is_locked AS wallet_is_locked, w.lock_reason AS wallet_lock_reason, w.locked_by AS wallet_locked_by, w.locked_at AS wallet_locked_at, w.freeze_type AS wallet_freeze_type
       FROM customers c
       LEFT JOIN customer_pins p ON p.customer_id = c.id
       LEFT JOIN customer_wallets w ON w.customer_id = c.id
       WHERE c.uuid::text = $1`,
      [customerUuid]
    );

    if (!customer) {
      throw new NotFoundException(this.messages.get('operations.customerNotFound'));
    }

    // Fetch registered devices
    const devices = await this.db.query(
      `SELECT uuid, device_identifier, device_model, device_os, mobile_type, app_version, status, last_active_at, created_at, revoked_at
       FROM customer_devices
       WHERE customer_id = $1
       ORDER BY created_at DESC`,
      [customer.id]
    );

    // Fetch recent activity logs
    const activityLogs = await this.db.query(
      `SELECT uuid, event_type, actor_type, actor_id, details, ip_address, created_at
       FROM customer_activity_logs
       WHERE customer_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [customer.id]
    );

    return {
      customer,
      devices: devices.rows,
      activityLogs: activityLogs.rows,
    };
  }

  /**
   * Administratively update customer account status (e.g. active, suspended, closed)
   */
  async updateCustomerStatus(customerUuid: string, dto: UpdateCustomerStatusDto) {
    const customer = await this.db.queryOne(
      `SELECT id, status FROM customers WHERE uuid::text = $1`,
      [customerUuid]
    );

    if (!customer) {
      throw new NotFoundException(this.messages.get('operations.customerNotFound'));
    }

    await this.db.query(
      `UPDATE customers SET status = $1, updated_at = NOW() WHERE id = $2`,
      [dto.status, customer.id]
    );

    // Record activity log
    await this.db.query(
      `INSERT INTO customer_activity_logs (customer_id, event_type, actor_type, actor_id, details)
       VALUES ($1, 'STATUS_CHANGED', 'ADMIN', $2, $3::jsonb)`,
      [
        customer.id,
        dto.operatorId || 'ADMIN_OPERATOR',
        JSON.stringify({ previousStatus: customer.status, newStatus: dto.status, reason: dto.reason }),
      ]
    );

    await this.events.publish('customer.status_changed', 'Customer', String(customer.id), {
      customerId: customer.id,
      previousStatus: customer.status,
      newStatus: dto.status,
      operatorId: dto.operatorId,
      reason: dto.reason,
    });

    return {
      success: true,
      message: this.messages.get('operations.statusUpdated'),
      status: dto.status,
    };
  }

  /**
   * Administratively review customer KYC (approve or reject)
   */
  async reviewKyc(customerUuid: string, dto: ReviewKycDto) {
    const customer = await this.db.queryOne(
      `SELECT id FROM customers WHERE uuid::text = $1`,
      [customerUuid]
    );

    if (!customer) {
      throw new NotFoundException(this.messages.get('operations.customerNotFound'));
    }

    const newKycStatus = dto.decision === 'approved' ? 'approved' : 'rejected';
    const tierLevel = dto.tierLevel || 'TIER_1';

    await this.db.query(
      `UPDATE customer_identities
       SET kyc_status = $1,
           kyc_tier = $2,
           kyc_verified_at = CASE WHEN $1 = 'approved' THEN NOW() ELSE NULL END,
           rejection_reason = $3,
           reviewer_notes = $4,
           reviewed_by = $5,
           reviewed_at = NOW(),
           updated_at = NOW()
       WHERE customer_id = $6`,
      [
        newKycStatus,
        tierLevel,
        dto.decision === 'rejected' ? dto.rejectionReason || 'Documents rejected by reviewer' : null,
        dto.reviewerNotes || null,
        dto.operatorId || 'OPERATOR',
        customer.id,
      ]
    );

    // Record activity log
    await this.db.query(
      `INSERT INTO customer_activity_logs (customer_id, event_type, actor_type, actor_id, details)
       VALUES ($1, $2, 'ADMIN', $3, $4::jsonb)`,
      [
        customer.id,
        dto.decision === 'approved' ? 'KYC_APPROVED' : 'KYC_REJECTED',
        dto.operatorId || 'OPERATOR',
        JSON.stringify(dto),
      ]
    );

    await this.events.publish(
      dto.decision === 'approved' ? 'customer.kyc_approved' : 'customer.kyc_rejected',
      'CustomerIdentity',
      String(customer.id),
      { customerId: customer.id, decision: dto.decision, operatorId: dto.operatorId }
    );

    return {
      success: true,
      message: dto.decision === 'approved' ? this.messages.get('kyc.approved') : this.messages.get('kyc.rejected'),
      kycStatus: newKycStatus,
    };
  }

  /**
   * Administratively unlock a permanently locked or rate-limited customer PIN
   */
  async unlockPin(customerUuid: string, dto: AdminUnlockPinDto) {
    const customer = await this.db.queryOne(
      `SELECT id FROM customers WHERE uuid::text = $1`,
      [customerUuid]
    );

    if (!customer) {
      throw new NotFoundException(this.messages.get('operations.customerNotFound'));
    }

    await this.db.query(
      `UPDATE customer_pins
       SET failed_attempts = 0, locked_until = NULL, is_permanently_locked = FALSE, updated_at = NOW()
       WHERE customer_id = $1`,
      [customer.id]
    );

    // Record activity log
    await this.db.query(
      `INSERT INTO customer_activity_logs (customer_id, event_type, actor_type, actor_id, details)
       VALUES ($1, 'PIN_UNLOCKED_BY_ADMIN', 'ADMIN', $2, $3::jsonb)`,
      [customer.id, dto.operatorId || 'OPERATOR', JSON.stringify({ reason: dto.reason })]
    );

    await this.events.publish('customer.pin_unlocked_by_admin', 'CustomerPin', String(customer.id), {
      customerId: customer.id,
      operatorId: dto.operatorId,
      reason: dto.reason,
    });

    return {
      success: true,
      message: this.messages.get('operations.pinUnlocked'),
    };
  }

  /**
   * Administratively freeze or unfreeze customer account
   */
  async freezeWallet(customerUuid: string, dto: AdminFreezeWalletDto) {
    const customer = await this.db.queryOne(
      `SELECT id FROM customers WHERE uuid::text = $1`,
      [customerUuid]
    );

    if (!customer) {
      throw new NotFoundException(this.messages.get('operations.customerNotFound'));
    }

    if (dto.action === 'freeze') {
      await this.db.query(
        `UPDATE customer_wallets
         SET status = 'frozen',
             is_locked = TRUE,
             lock_reason = $1,
             locked_by = $2,
             locked_at = NOW(),
             freeze_type = 'admin_compliance',
             updated_at = NOW()
         WHERE customer_id = $3`,
        [dto.reason, `ADMIN:${dto.operatorId || 'OPERATOR'}`, customer.id]
      );

      // Record activity log
      await this.db.query(
        `INSERT INTO customer_activity_logs (customer_id, event_type, actor_type, actor_id, details)
         VALUES ($1, 'WALLET_FROZEN_BY_ADMIN', 'ADMIN', $2, $3::jsonb)`,
        [customer.id, dto.operatorId || 'OPERATOR', JSON.stringify({ reason: dto.reason })]
      );

      return {
        success: true,
        message: this.messages.get('operations.walletFrozen'),
        status: 'frozen',
      };
    } else {
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
        [customer.id]
      );

      // Record activity log
      await this.db.query(
        `INSERT INTO customer_activity_logs (customer_id, event_type, actor_type, actor_id, details)
         VALUES ($1, 'WALLET_UNFROZEN_BY_ADMIN', 'ADMIN', $2, $3::jsonb)`,
        [customer.id, dto.operatorId || 'OPERATOR', JSON.stringify({ reason: dto.reason })]
      );

      return {
        success: true,
        message: this.messages.get('operations.walletUnfrozen'),
        status: 'active',
      };
    }
  }
}

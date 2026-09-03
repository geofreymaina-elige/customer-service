import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../../core/database/database.service';
import { MessageService } from '../../../core/messages/message.service';
import { EventService } from '../../../core/events/event.service';
import { UpdateCustomerProfileDto, SubmitKycDocumentsDto } from '../dto/customer.dto';

@Injectable()
export class CustomerService {
  constructor(
    private readonly db: DatabaseService,
    private readonly messages: MessageService,
    private readonly events: EventService,
  ) {}

  /**
   * Get full customer profile with KYC, active device, and wallet status
   */
  async getProfile(customerId: number) {
    const customer = await this.db.queryOne(
      `SELECT c.id, c.uuid, c.astpp_id, c.phone_number, c.email,
              c.first_name, c.last_name, c.date_of_birth, c.timezone, 
              c.status, c.balance, c.credit_limit,
              c.created_at, c.updated_at,
              (p.pin_hash IS NOT NULL) AS is_pin_set,
              p.is_permanently_locked AS is_pin_permanently_locked,
              w.uuid AS wallet_uuid, w.account_number AS wallet_account_number, 
              w.status AS wallet_status, w.is_locked AS wallet_is_locked,
              d.device_model AS active_device_model, d.device_os AS active_device_os, 
              d.last_active_at AS active_device_last_active
       FROM customers c
       LEFT JOIN customer_pins p ON p.customer_id = c.id
       LEFT JOIN customer_wallets w ON w.customer_id = c.id
       LEFT JOIN customer_devices d ON d.customer_id = c.id AND d.status = 'active'
       WHERE c.id = $1`,
      [customerId]
    );

    if (!customer) {
      throw new NotFoundException(this.messages.get('common.notFound'));
    }

    // Get primary KYC application details
    const primaryKyc = await this.db.queryOne(
      `SELECT ca.kyc_status, ca.kyc_tier, ca.approved_at, ca.rejected_at, ca.rejection_reason,
              cad.identity_document_type, cad.identity_document_number, cad.issuing_country,
              cad.doc_front_url, cad.doc_back_url, cad.passport_photo_url
       FROM customer_applications ca
       LEFT JOIN customer_applicant_details cad ON cad.application_id = ca.application_id
       WHERE ca.customer_id = $1 AND ca.application_type = 'primary_kyc'
       LIMIT 1`,
      [customerId]
    );

    // Get wallet KYC details (if exists)
    const walletKyc = await this.db.queryOne(
      `SELECT ca.kyc_status, ca.rejection_reason, ca.reviewed_at, ca.created_at,
              cad.identity_document_number, cad.images
       FROM customer_applications ca
       LEFT JOIN customer_applicant_details cad ON cad.application_id = ca.application_id
       WHERE ca.customer_id = $1 AND ca.application_type = 'wallet_kyc'
       LIMIT 1`,
      [customerId]
    );

    // Infer has_wallet from customer_wallets table (wallet exists and is active)
    const hasWallet = customer.wallet_uuid !== null && customer.wallet_status === 'active';

    return {
      customerId: customer.uuid,
      astppId: customer.astpp_id,
      phoneNumber: customer.phone_number,
      email: customer.email,
      firstName: customer.first_name,
      lastName: customer.last_name,
      dateOfBirth: customer.date_of_birth,
      timezone: customer.timezone,
      status: customer.status,
      balance: customer.balance || 0,
      creditLimit: customer.credit_limit || 0,
      createdAt: customer.created_at,
      hasWallet,
      security: {
        isPinSet: customer.is_pin_set,
        isPinPermanentlyLocked: customer.is_pin_permanently_locked || false,
      },
      kyc: primaryKyc ? {
        documentType: primaryKyc.identity_document_type || 'NATIONAL_ID',
        documentNumber: primaryKyc.identity_document_number,
        issuingCountry: primaryKyc.issuing_country || 'KEN',
        kycStatus: primaryKyc.kyc_status || 'pending',
        kycTier: primaryKyc.kyc_tier || 'TIER_1',
        rejectionReason: primaryKyc.rejection_reason,
        approvedAt: primaryKyc.approved_at,
        rejectedAt: primaryKyc.rejected_at,
      } : {
        kycStatus: 'pending',
        kycTier: 'TIER_1',
      },
      walletKyc: walletKyc ? {
        required: true,
        status: walletKyc.kyc_status,
        flaggedAt: walletKyc.created_at,
        rejectionReason: walletKyc.rejection_reason,
        documentCount: walletKyc.images ? JSON.parse(walletKyc.images).length : 0,
      } : {
        required: false,
      },
      wallet: {
        walletId: customer.wallet_uuid,
        accountNumber: customer.wallet_account_number,
        status: customer.wallet_status,
        isLocked: customer.wallet_is_locked || false,
      },
      activeDevice: customer.active_device_model
        ? {
            model: customer.active_device_model,
            os: customer.active_device_os,
            lastActive: customer.active_device_last_active,
          }
        : null,
    };
  }

  /**
   * Update editable customer profile fields
   */
  async updateProfile(customerId: number, dto: UpdateCustomerProfileDto) {
    await this.db.query(
      `UPDATE customers
       SET first_name = COALESCE($1, first_name),
           last_name = COALESCE($2, last_name),
           email = COALESCE($3, email),
           timezone = COALESCE($4, timezone),
           updated_at = NOW()
       WHERE id = $5`,
      [dto.firstName || null, dto.lastName || null, dto.email || null, dto.timezone || null, customerId]
    );

    // Record activity log
    await this.db.query(
      `INSERT INTO customer_activity_logs (customer_id, event_type, actor_type, actor_id, details)
       VALUES ($1, 'PROFILE_UPDATED', 'CUSTOMER', $2, $3::jsonb)`,
      [customerId, String(customerId), JSON.stringify(dto)]
    );

    return this.getProfile(customerId);
  }

  /**
   * Submit KYC identity documents for verification
   * Note: This method is now deprecated as KYC is managed in ASTPP
   * and synced via CDC. Kept for backward compatibility.
   */
  async submitKycDocuments(customerId: number, dto: SubmitKycDocumentsDto) {
    const customer = await this.db.queryOne(`SELECT id, astpp_id FROM customers WHERE id = $1`, [customerId]);
    if (!customer) {
      throw new NotFoundException(this.messages.get('common.notFound'));
    }

    // Check if primary KYC already approved
    const existingKyc = await this.db.queryOne(
      `SELECT kyc_status FROM customer_applications 
       WHERE customer_id = $1 AND application_type = 'primary_kyc'`,
      [customerId]
    );

    if (existingKyc && existingKyc.kyc_status === 'approved') {
      throw new BadRequestException(this.messages.get('kyc.alreadyApproved'));
    }

    // Record activity log
    await this.db.query(
      `INSERT INTO customer_activity_logs (customer_id, event_type, actor_type, actor_id, details)
       VALUES ($1, 'KYC_DOCUMENTS_SUBMITTED', 'CUSTOMER', $2, $3::jsonb)`,
      [customerId, String(customerId), JSON.stringify({ documentType: dto.documentType, documentNumber: dto.documentNumber })]
    );

    // Dispatch outbox event
    await this.events.publish(
      'customer.kyc_submitted',
      'CustomerApplication',
      String(customerId),
      { customerId, astppId: customer.astpp_id, documentType: dto.documentType, documentNumber: dto.documentNumber }
    );

    return {
      kycStatus: 'pending',
      message: 'KYC documents submitted. Please complete KYC in ASTPP system.',
      note: 'KYC is now managed in ASTPP and will be synced automatically.',
    };
  }

  /**
   * Get activity and security audit history for customer
   */
  async getActivityHistory(customerId: number, limit: number = 30) {
    const logs = await this.db.query(
      `SELECT uuid, event_type, actor_type, actor_id, details, ip_address, created_at
       FROM customer_activity_logs
       WHERE customer_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [customerId, limit]
    );

    const attempts = await this.db.query(
      `SELECT attempt_type, is_successful, failure_reason, ip_address, user_agent, created_at
       FROM customer_auth_attempts
       WHERE customer_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [customerId]
    );

    return {
      activities: logs.rows,
      recentAuthAttempts: attempts.rows,
    };
  }
}

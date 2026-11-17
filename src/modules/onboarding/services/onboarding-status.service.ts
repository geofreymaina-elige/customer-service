import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../core/database/database.service';
import { MessageService } from '../../../core/messages/message.service';
import { SasaPayKycService } from './sasapay-kyc.service';

export type OnboardingNextAction =
  | { type: 'wait_for_update' }
  | { type: 'make_transaction' }
  | {
    type: 'start_onboarding' | 'verify_otp' | 'upload_kyc_documents' | 'set_pin';
    method: 'POST';
    endpoint: string;
  };

@Injectable()
export class OnboardingStatusService {
  constructor(
    private readonly db: DatabaseService,
    private readonly messages: MessageService,
    private readonly sasaPayKyc: SasaPayKycService,
  ) {}

  async getStatus(customerId: number) {
    const wallet = await this.db.queryOne(
      `SELECT id, uuid, account_number, currency, status, created_at
       FROM customer_wallets WHERE customer_id = $1`,
      [customerId]
    );

    const application = await this.db.queryOne(
      `SELECT id, kyc_status, sasapay_request_id, sasapay_account_number, sasapay_account_status, submitted_at, approved_at, rejected_at
       FROM customer_applications
       WHERE customer_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [customerId]
    );

    let applicationStatus = application?.kyc_status || 'not_started';
    if (application?.sasapay_account_status === 'REJECTED' && applicationStatus === 'approved') {
      applicationStatus = 'pending';
    }

    const kycSubmission = await this.sasaPayKyc.getCurrentStatus(customerId);
    const requiredDocuments: string[] = kycSubmission?.requiredDocuments || [];
    if (kycSubmission?.status === 'awaiting_documents' && requiredDocuments.length) {
      applicationStatus = 'requires_kyc_upload';
    }

    const pin = await this.db.queryOne(
      `SELECT id FROM customer_pins WHERE customer_id = $1 AND pin_hash IS NOT NULL`,
      [customerId],
    );
    const device = await this.db.queryOne(
      `SELECT id FROM customer_devices WHERE customer_id = $1 AND status = 'active'`,
      [customerId],
    );

    let nextAction: OnboardingNextAction = { type: 'wait_for_update' };
    if (
      application?.sasapay_account_number
      && kycSubmission?.status === 'awaiting_documents'
      && requiredDocuments.length
    ) {
      nextAction = {
        type: 'upload_kyc_documents',
        method: 'POST',
        endpoint: '/api/v2/customers/kyc/submissions/images',
      };
    } else if (!wallet && applicationStatus !== 'rejected') {
      if (application?.sasapay_request_id && !application.sasapay_account_number) {
        const otpJob = await this.db.queryOne(
          `SELECT id
           FROM jobs
           WHERE job_type = 'sasapay_otp_confirmation'
             AND payload->>'customerId' = $1
             AND payload->>'requestId' = $2
           ORDER BY created_at DESC
           LIMIT 1`,
          [String(customerId), application.sasapay_request_id],
        );

        if (!otpJob) {
          nextAction = {
            type: 'verify_otp',
            method: 'POST',
            endpoint: '/api/v2/auth/wallet-verifications',
          };
        }
      } else if (!application?.sasapay_account_number) {
        nextAction = {
          type: 'start_onboarding',
          method: 'POST',
          endpoint: '/api/v2/auth/sessions/device',
        };
      }
    } else if (applicationStatus === 'approved' && wallet.status === 'active') {
      if (!device) {
        nextAction = {
          type: 'start_onboarding',
          method: 'POST',
          endpoint: '/api/v2/auth/sessions/device',
        };
      } else if (!pin) {
        nextAction = {
          type: 'set_pin',
          method: 'POST',
          endpoint: '/api/v2/customers/me/pin',
        };
      } else {
        nextAction = { type: 'make_transaction' };
      }
    }

    const message = this.getStatusMessage(
      applicationStatus,
      wallet?.status,
      requiredDocuments.length > 0,
    );

    return {
      message,
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

  private getStatusMessage(
    applicationStatus: string,
    walletStatus: string | undefined,
    hasRequiredDocuments: boolean,
  ): string {
    if (applicationStatus === 'approved') {
      const status = walletStatus?.replace(/_/g, ' ') || 'pending';
      return this.messages.get('wallets.onboarding.statusMessages.walletStatus', { status });
    }

    if (applicationStatus === 'requires_kyc_upload' || hasRequiredDocuments) {
      return this.messages.get('wallets.onboarding.statusMessages.kycDetailsRequired');
    }

    if (applicationStatus === 'processing') {
      return this.messages.get('wallets.onboarding.statusMessages.kycSubmissionProcessing');
    }

    if (applicationStatus === 'rejected') {
      return this.messages.get('wallets.onboarding.statusMessages.applicationRejected');
    }

    if (applicationStatus === 'not_started') {
      return this.messages.get('wallets.onboarding.statusMessages.notStarted');
    }

    return this.messages.get('wallets.onboarding.statusMessages.pendingApproval');
  }
}

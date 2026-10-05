import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../../core/database/database.service';

@Injectable()
export class AdminSasaPayKycService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  private getPublicUrl(): string {
    const rawUrl =
      this.config.get<string>('publicUrl') ||
      process.env.PUBLIC_URL ||
      'https://api.ambiapay.com';
    return rawUrl.replace(/\/+$/, '');
  }

  private getAstppBaseUrl(): string {
    const rawUrl =
      this.config.get<string>('astpp.baseUrl') ||
      process.env.ASTPP_BASE_URL ||
      'https://msa-portal.elige-africa.com';
    return rawUrl.replace(/\/+$/, '');
  }

  /**
   * Fetch customer KYC profile by ASTPP ID
   * Returns prioritized KYC data (sasapay > wallet > primary) with full image URLs
   */
  async getSubmissionDetailsByAstppId(astppId: string) {
    const customer = await this.db.queryOne(
      `SELECT c.id, c.uuid, c.astpp_id, c.phone_number, c.email,
              c.first_name, c.last_name, c.status AS customer_status,
              c.country_code, c.account_type, c.created_at,
              ca.id AS app_id, ca.uuid AS app_uuid, ca.kyc_status, ca.kyc_tier,
              ca.sasapay_request_id, ca.sasapay_account_number, ca.sasapay_account_status,
              ca.submitted_at, ca.approved_at, ca.rejected_at, ca.rejection_reason,
              -- Determine which KYC source is being used (priority: sasapay > wallet > primary)
              CASE 
                WHEN sasapay.id IS NOT NULL THEN 'sasapay_kyc'
                WHEN wallet.id IS NOT NULL THEN 'wallet_kyc'
                WHEN primary_kyc.id IS NOT NULL THEN 'primary_kyc'
                ELSE NULL
              END AS kyc_source,
              -- Get data from highest priority source available
              COALESCE(sasapay.identity_document_type, wallet.identity_document_type, primary_kyc.identity_document_type) AS identity_document_type,
              COALESCE(sasapay.name, wallet.name, primary_kyc.name) AS name,
              COALESCE(sasapay.identity_document_number, wallet.identity_document_number, primary_kyc.identity_document_number) AS identity_document_number,
              COALESCE(sasapay.date_of_birth, wallet.date_of_birth, primary_kyc.date_of_birth) AS date_of_birth,
              COALESCE(sasapay.gender, wallet.gender, primary_kyc.gender) AS gender,
              COALESCE(sasapay.nationality, wallet.nationality, primary_kyc.nationality) AS nationality,
              COALESCE(sasapay.physical_address, wallet.physical_address, primary_kyc.physical_address) AS physical_address,
              -- SasaPay-specific columns
              sasapay.id AS sasapay_detail_id,
              sasapay.sasapay_submission_status,
              sasapay.sasapay_request_id,
              sasapay.sasapay_submitted_at,
              sasapay.sasapay_result_at,
              sasapay.sasapay_psp_status,
              sasapay.sasapay_psp_reason,
              sasapay.review_status,
              sasapay.review_decision,
              sasapay.reviewed_by,
              sasapay.reviewed_at,
              sasapay.review_reason,
              sasapay.required_documents AS sasapay_required_documents,
              sasapay.images AS sasapay_images,
              sasapay.created_at AS sasapay_created_at,
              sasapay.updated_at AS sasapay_updated_at,
              -- Other KYC sources
              wallet.doc_front_url AS wallet_doc_front,
              wallet.doc_back_url AS wallet_doc_back,
              wallet.passport_photo_url AS wallet_selfie,
              primary_kyc.doc_front_url AS primary_doc_front,
              primary_kyc.doc_back_url AS primary_doc_back,
              primary_kyc.passport_photo_url AS primary_selfie
       FROM customers c
       JOIN customer_applications ca ON ca.customer_id = c.id
       LEFT JOIN customer_applicant_details sasapay
         ON sasapay.customer_application_id = ca.id AND sasapay.application_type = 'sasapay_kyc'
       LEFT JOIN customer_applicant_details wallet
         ON wallet.customer_application_id = ca.id AND wallet.application_type = 'wallet_kyc'
       LEFT JOIN customer_applicant_details primary_kyc
         ON primary_kyc.customer_application_id = ca.id AND primary_kyc.application_type = 'primary_kyc'
       WHERE c.astpp_id = $1
       LIMIT 1`,
      [parseInt(astppId, 10)],
    );

    if (!customer) {
      throw new NotFoundException('Customer not found.');
    }

    const publicUrl = this.getPublicUrl();
    const astppBaseUrl = this.getAstppBaseUrl();

    // Build document URLs based on KYC source
    let documents = [];
    
    if (customer.kyc_source === 'sasapay_kyc' && customer.sasapay_images) {
      // SasaPay KYC: images stored in JSONB field
      const images = Array.isArray(customer.sasapay_images) ? customer.sasapay_images : [];
      images.forEach(img => {
        if (img.type && img.filename) {
          documents.push({
            type: img.type,
            url: `${publicUrl}/uploads/images/${customer.app_id}/${img.filename}`,
          });
        }
      });
    } else if (customer.kyc_source === 'wallet_kyc') {
      // Wallet KYC: images from ASTPP
      if (customer.wallet_doc_front) {
        documents.push({
          type: 'document_front',
          url: `${astppBaseUrl}/application_images/${customer.astpp_id}/${customer.wallet_doc_front}`,
        });
      }
      if (customer.wallet_doc_back) {
        documents.push({
          type: 'document_back',
          url: `${astppBaseUrl}/application_images/${customer.astpp_id}/${customer.wallet_doc_back}`,
        });
      }
      if (customer.wallet_selfie) {
        documents.push({
          type: 'selfie',
          url: `${astppBaseUrl}/application_images/${customer.astpp_id}/${customer.wallet_selfie}`,
        });
      }
    } else if (customer.kyc_source === 'primary_kyc') {
      // Primary KYC: images from ASTPP
      if (customer.primary_doc_front) {
        documents.push({
          type: 'document_front',
          url: `${astppBaseUrl}/application_images/${customer.astpp_id}/${customer.primary_doc_front}`,
        });
      }
      if (customer.primary_doc_back) {
        documents.push({
          type: 'document_back',
          url: `${astppBaseUrl}/application_images/${customer.astpp_id}/${customer.primary_doc_back}`,
        });
      }
      if (customer.primary_selfie) {
        documents.push({
          type: 'selfie',
          url: `${astppBaseUrl}/application_images/${customer.astpp_id}/${customer.primary_selfie}`,
        });
      }
    }

    return {
      success: true,
      message: 'Customer KYC profile retrieved successfully.',
      data: {
        kycSource: customer.kyc_source,
        customer: {
          id: customer.id,
          uuid: customer.uuid,
          astppId: customer.astpp_id,
          phoneNumber: customer.phone_number,
          email: customer.email,
          firstName: customer.first_name,
          lastName: customer.last_name,
          fullName: customer.name || [customer.first_name, customer.last_name].filter(Boolean).join(' '),
          dateOfBirth: customer.date_of_birth,
          gender: customer.gender,
          nationality: customer.nationality,
          physicalAddress: customer.physical_address,
          identityDocumentType: customer.identity_document_type,
          identityDocumentNumber: customer.identity_document_number,
          customerStatus: customer.customer_status,
          countryCode: customer.country_code,
          accountType: customer.account_type,
          createdAt: customer.created_at,
        },
        application: {
          id: customer.app_id,
          uuid: customer.app_uuid,
          kycStatus: customer.kyc_status,
          kycTier: customer.kyc_tier,
          sasapayRequestId: customer.sasapay_request_id,
          sasapayAccountNumber: customer.sasapay_account_number,
          sasapayAccountStatus: customer.sasapay_account_status,
          submittedAt: customer.submitted_at,
          approvedAt: customer.approved_at,
          rejectedAt: customer.rejected_at,
          rejectionReason: customer.rejection_reason,
        },
        status: customer.sasapay_submission_status || null,
        documentType: customer.identity_document_type,
        documents,
        submittedAt: customer.sasapay_submitted_at,
        reviewedAt: customer.reviewed_at,
        reviewStatus: customer.review_status,
        reviewDecision: customer.review_decision,
        reviewedBy: customer.reviewed_by,
        reviewReason: customer.review_reason,
        pspStatus: customer.sasapay_psp_status,
        pspReason: customer.sasapay_psp_reason,
        pspResultAt: customer.sasapay_result_at,
      },
    };
  }
}

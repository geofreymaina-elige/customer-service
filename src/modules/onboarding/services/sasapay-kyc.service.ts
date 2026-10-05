import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { DatabaseService } from '../../../core/database/database.service';
import { SasaPayLogger } from '../../../core/logging/sasapay-logger.service';

const DOCUMENT_TYPES = ['document_front', 'document_back', 'selfie'] as const;
type KycDocumentType = typeof DOCUMENT_TYPES[number];
export type UploadedKycFile = {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

@Injectable()
export class SasaPayKycService {
  private readonly imageRoot = path.resolve(process.cwd(), 'uploads', 'images');
  private readonly maxUploadBytes = 20 * 1024 * 1024;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly sasaPayLogger: SasaPayLogger,
  ) {
    this.imageRoot = path.resolve(process.cwd(), 'uploads', 'images');
    this.maxUploadBytes = 20 * 1024 * 1024;
  }

  /**
   * Get all available document policies (for mobile app to show all types)
   */
  async getAllDocumentRequirements() {
    const policies = await this.db.query(
      `SELECT document_type, version, required_documents, accepted_mime_types, max_file_size_bytes
       FROM document_policies
       WHERE is_active = TRUE
       ORDER BY document_type`,
    );

    return policies.rows.map(policy => ({
      documentType: policy.document_type,
      policyVersion: policy.version,
      requiredDocuments: this.withRequiredSelfie(policy.required_documents),
      acceptedMimeTypes: policy.accepted_mime_types,
      maxFileSizeBytes: policy.max_file_size_bytes,
    }));
  }

  /**
   * Get policy requirements for specific customer's document type
   */
  async getActiveRequirements(customerId: number) {
    const source = await this.getCustomerApplicationAndDocument(customerId);
    if (!source) {
      throw new NotFoundException('Customer application was not found.');
    }

    const policy = await this.db.queryOne(
      `SELECT document_type, version, required_documents, accepted_mime_types, max_file_size_bytes
       FROM document_policies
       WHERE LOWER(document_type) = LOWER($1) AND is_active = TRUE`,
      [source.identity_document_type],
    );
    
    if (!policy) {
      throw new ConflictException('Document requirements have not been configured for this document type.');
    }

    return {
      documentType: policy.document_type,
      policyVersion: policy.version,
      requiredDocuments: this.withRequiredSelfie(policy.required_documents),
      acceptedMimeTypes: policy.accepted_mime_types,
      maxFileSizeBytes: policy.max_file_size_bytes,
    };
  }

  /**
   * Get prioritized KYC status (sasapay > wallet > primary) with full image URLs
   */
  async getAllKycStatus(customerId: number) {
    // Get the customer application with prioritized KYC data (sasapay > wallet > primary)
    const application = await this.db.queryOne(
      `SELECT ca.id, ca.customer_id, ca.astpp_id, ca.kyc_status,
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
              COALESCE(sasapay.created_at, wallet.created_at, primary_kyc.created_at) AS submitted_at,
              -- SasaPay-specific columns
              sasapay.id AS sasapay_detail_id,
              sasapay.sasapay_submission_status,
              sasapay.sasapay_request_id,
              sasapay.sasapay_submitted_at,
              sasapay.sasapay_result_at,
              sasapay.sasapay_psp_status,
              sasapay.sasapay_psp_reason,
              sasapay.review_status,
              sasapay.required_documents AS sasapay_required_documents,
              sasapay.images AS sasapay_images,
              -- Other KYC sources
              wallet.doc_front_url AS wallet_doc_front,
              wallet.doc_back_url AS wallet_doc_back,
              wallet.passport_photo_url AS wallet_selfie,
              primary_kyc.doc_front_url AS primary_doc_front,
              primary_kyc.doc_back_url AS primary_doc_back,
              primary_kyc.passport_photo_url AS primary_selfie
       FROM customer_applications ca
       LEFT JOIN customer_applicant_details sasapay
         ON sasapay.customer_application_id = ca.id AND sasapay.application_type = 'sasapay_kyc'
       LEFT JOIN customer_applicant_details wallet
         ON wallet.customer_application_id = ca.id AND wallet.application_type = 'wallet_kyc'
       LEFT JOIN customer_applicant_details primary_kyc
         ON primary_kyc.customer_application_id = ca.id AND primary_kyc.application_type = 'primary_kyc'
       WHERE ca.customer_id = $1
       LIMIT 1`,
      [customerId],
    );
    
    if (!application) {
      return null;
    }

    // Build image URLs based on KYC source
    const astppBaseUrl = this.config.get<string>('astpp.baseUrl') || 'https://msa-portal.elige-africa.com';
    const publicUrl = this.config.get<string>('publicUrl') || 'https://api.ambiapay.com';
    
    let documents = [];
    
    if (application.kyc_source === 'sasapay_kyc' && application.sasapay_images) {
      // SasaPay KYC: images stored in JSONB field
      const images = Array.isArray(application.sasapay_images) ? application.sasapay_images : [];
      const docFront = images.find(img => img.type === 'document_front');
      const docBack = images.find(img => img.type === 'document_back');
      const selfie = images.find(img => img.type === 'selfie');
      
      if (docFront) {
        documents.push({
          type: 'document_front',
          url: `${publicUrl}/uploads/images/${application.id}/${docFront.filename}`,
        });
      }
      if (docBack) {
        documents.push({
          type: 'document_back',
          url: `${publicUrl}/uploads/images/${application.id}/${docBack.filename}`,
        });
      }
      if (selfie) {
        documents.push({
          type: 'selfie',
          url: `${publicUrl}/uploads/images/${application.id}/${selfie.filename}`,
        });
      }
    } else if (application.kyc_source === 'wallet_kyc') {
      // Wallet KYC: images from ASTPP
      if (application.wallet_doc_front) {
        documents.push({
          type: 'document_front',
          url: `${astppBaseUrl}/application_images/${application.astpp_id}/${application.wallet_doc_front}`,
        });
      }
      if (application.wallet_doc_back) {
        documents.push({
          type: 'document_back',
          url: `${astppBaseUrl}/application_images/${application.astpp_id}/${application.wallet_doc_back}`,
        });
      }
      if (application.wallet_selfie) {
        documents.push({
          type: 'selfie',
          url: `${astppBaseUrl}/application_images/${application.astpp_id}/${application.wallet_selfie}`,
        });
      }
    } else if (application.kyc_source === 'primary_kyc') {
      // Primary KYC: images from ASTPP
      if (application.primary_doc_front) {
        documents.push({
          type: 'document_front',
          url: `${astppBaseUrl}/application_images/${application.astpp_id}/${application.primary_doc_front}`,
        });
      }
      if (application.primary_doc_back) {
        documents.push({
          type: 'document_back',
          url: `${astppBaseUrl}/application_images/${application.astpp_id}/${application.primary_doc_back}`,
        });
      }
      if (application.primary_selfie) {
        documents.push({
          type: 'selfie',
          url: `${astppBaseUrl}/application_images/${application.astpp_id}/${application.primary_selfie}`,
        });
      }
    }

    return {
      kycSource: application.kyc_source,
      customer: {
        id: application.customer_id,
        astppId: application.astpp_id,
      },
      application: {
        id: application.id,
        kycStatus: application.kyc_status,
      },
      status: application.sasapay_submission_status || null,
      documentType: application.identity_document_type,
      documents,
      submittedAt: application.sasapay_submitted_at || application.submitted_at || null,
      reviewedAt: application.sasapay_result_at || null,
    };
  }

  /**
   * Get current submission status for customer
   */
  async getCurrentStatus(customerId: number) {
    const application = await this.db.queryOne(
      `SELECT ca.id, ca.customer_id,
              sasapay.id AS detail_id,
              sasapay.sasapay_submission_status AS status,
              sasapay.required_documents,
              sasapay.sasapay_psp_reason AS psp_reason,
              sasapay.sasapay_submitted_at AS customer_submitted_at,
              sasapay.reviewed_at AS internal_reviewed_at,
              sasapay.sasapay_submitted_at AS psp_submitted_at,
              sasapay.sasapay_result_at AS psp_result_at,
              sasapay.policy_version,
              sasapay.images,
              sasapay.created_at,
              sasapay.updated_at
       FROM customer_applications ca
       LEFT JOIN customer_applicant_details sasapay
         ON sasapay.customer_application_id = ca.id AND sasapay.application_type = 'sasapay_kyc'
       WHERE ca.customer_id = $1
       LIMIT 1`,
      [customerId],
    );
    
    if (!application || !application.detail_id) {
      return null;
    }

    // Count uploaded documents from images JSONB array
    const images = Array.isArray(application.images) ? application.images : [];
    const uploadedTypes = new Set(images.map(img => img.type));
    const requiredDocuments = this.withRequiredSelfie(application.required_documents)
      .filter((documentType) => !uploadedTypes.has(documentType));

    return {
      submissionId: application.detail_id,
      status: application.status,
      policyVersion: application.policy_version,
      requiredDocuments,
      reason: application.psp_reason || null,
      customerSubmittedAt: application.customer_submitted_at,
      internalReviewedAt: application.internal_reviewed_at,
      pspSubmittedAt: application.psp_submitted_at,
      pspResultAt: application.psp_result_at,
      createdAt: application.created_at,
      updatedAt: application.updated_at,
    };
  }

  /**
   * Create or update sasapay_kyc applicant details when system needs to request re-upload
   */
  async ensureSystemCase(customerId: number, reason: string, pspReason?: string) {
    if (!this.config.get<boolean>('sasapay.kycEnabled')) return null;

    const application = await this.getCustomerApplicationAndDocument(customerId);
    if (!application) return null;

    const policy = await this.db.queryOne(
      `SELECT id, version, required_documents
       FROM document_policies
       WHERE LOWER(document_type) = LOWER($1) AND is_active = TRUE`,
      [application.identity_document_type],
    );
    if (!policy) return null;

    // Check if there's already a completed submission
    const completedSubmission = await this.db.queryOne(
      `SELECT id
       FROM customer_applicant_details
       WHERE customer_application_id = $1
         AND application_type = 'sasapay_kyc'
         AND sasapay_submission_status = 'psp_approved'
         AND policy_id = $2
       LIMIT 1`,
      [application.id, policy.id],
    );
    if (completedSubmission) return null;

    const policyDocuments = this.withRequiredSelfie(policy.required_documents);
    const existingDocuments = new Set<KycDocumentType>();
    const images = Array.isArray(application.images) ? application.images : [];
    if (application.doc_front_url || images.some((image) => ['identity_document', 'document_front'].includes(image.image_type))) {
      existingDocuments.add('document_front');
    }
    if (application.doc_back_url || images.some((image) => ['identity_document_back', 'document_back'].includes(image.image_type))) {
      existingDocuments.add('document_back');
    }
    if (application.passport_photo_url || images.some((image) => ['passport_photo', 'selfie'].includes(image.image_type))) {
      existingDocuments.add('selfie');
    }
    const requiredDocuments = pspReason
      ? policyDocuments
      : policyDocuments.filter((documentType) => !existingDocuments.has(documentType));
    if (!requiredDocuments.length) return null;

    // Check for open submission
    const openSubmission = await this.db.queryOne(
      `SELECT id
       FROM customer_applicant_details
       WHERE customer_application_id = $1
         AND application_type = 'sasapay_kyc'
         AND sasapay_submission_status IN ('awaiting_documents', 'submitted_for_review', 'approved_for_psp', 'awaiting_psp_result')
       ORDER BY created_at DESC
       LIMIT 1`,
      [application.id],
    );
    if (openSubmission) return openSubmission.id;

    // Create or update sasapay_kyc applicant details
    const detail = await this.db.queryOne(
      `INSERT INTO customer_applicant_details (
         customer_application_id, customer_id, astpp_id, application_type,
         name, identity_document_type, identity_document_number, issuing_country,
         date_of_birth, gender, nationality, physical_address,
         policy_id, policy_version, sasapay_submission_status, required_documents,
         created_at, updated_at
       )
       VALUES ($1, $2, $3, 'sasapay_kyc', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'awaiting_documents', $14, NOW(), NOW())
       ON CONFLICT (customer_application_id, application_type) DO UPDATE SET
         identity_document_type = EXCLUDED.identity_document_type,
         identity_document_number = EXCLUDED.identity_document_number,
         policy_id = EXCLUDED.policy_id,
         policy_version = EXCLUDED.policy_version,
         sasapay_submission_status = 'awaiting_documents',
         required_documents = EXCLUDED.required_documents,
         updated_at = NOW()
       RETURNING id`,
      [
        application.id,
        application.customer_id,
        application.astpp_id,
        application.name,
        application.identity_document_type,
        application.identity_document_number,
        application.issuing_country,
        application.date_of_birth,
        application.gender,
        application.nationality,
        application.physical_address,
        policy.id,
        policy.version,
        requiredDocuments,
      ],
    );

    // Log submission creation
    await this.logSubmissionEvent(
      'submission_created',
      application.id,
      detail.id,
      'system',
      {
        submissionStatus: 'awaiting_documents',
        metadata: { reason, pspReason: pspReason || null },
      },
    );

    return detail.id;
  }

  /**
   * Record SasaPay callback event
   */
  async recordCallbackEvent(
    customerId: number,
    callbackStatus: string,
    reason: string | undefined,
    callbackPayload: Record<string, unknown>,
    signedPaymentReference?: string,
  ) {
    const application = await this.db.queryOne(
      `SELECT id FROM customer_applications WHERE customer_id = $1`,
      [customerId],
    );
    if (!application) return { processed: false, submissionId: null };

    // Log the callback using dedicated SasaPay logger
    this.sasaPayLogger.logCallback(callbackPayload, customerId, application.id, {
      callbackStatus,
      reason,
      signedPaymentReference,
    });

    const relevantFields = [
      'sasapay_transaction_code', 'transactionCode', 'merchantCode', 'merchant_code',
      'accountNumber', 'account_number', 'accountStatus', 'account_status',
      'payment_reference', 'paymentReference', 'amount', 'description',
    ];
    const payload = Object.fromEntries(
      relevantFields
        .filter((key) => callbackPayload[key] !== undefined && callbackPayload[key] !== null)
        .map((key) => [key, callbackPayload[key]]),
    );

    // Correlate with existing submission if request ID provided
    const correlatedSubmission = signedPaymentReference
      ? await this.db.queryOne(
        `SELECT cad.id
         FROM customer_applicant_details cad
         JOIN customer_applications ca ON ca.id = cad.customer_application_id
         WHERE ca.id = $1 
           AND cad.application_type = 'sasapay_kyc'
           AND cad.sasapay_request_id = $2
         LIMIT 1`,
        [application.id, signedPaymentReference],
      )
      : null;

    const newSubmissionId = callbackStatus === 'REJECTED'
      ? await this.ensureSystemCase(
        customerId,
        'SasaPay rejected existing KYC images; replacement documents are required.',
        reason,
      )
      : null;
    
    const submissionId = correlatedSubmission?.id || newSubmissionId;

    // Update submission status if correlated
    if (correlatedSubmission) {
      await this.db.query(
        `UPDATE customer_applicant_details
         SET sasapay_submission_status = $1,
             sasapay_psp_status = $2,
             sasapay_psp_reason = $3,
             sasapay_result_at = NOW(),
             sasapay_callback_payload = $4::jsonb,
             updated_at = NOW()
         WHERE id = $5 AND application_type = 'sasapay_kyc'`,
        [
          callbackStatus === 'APPROVED' ? 'psp_approved' : 'psp_rejected',
          callbackStatus,
          reason || null,
          JSON.stringify(payload),
          correlatedSubmission.id,
        ],
      );

      // Log the callback event
      await this.logSubmissionEvent(
        callbackStatus === 'APPROVED' ? 'psp_approved' : 'psp_rejected',
        application.id,
        correlatedSubmission.id,
        'sasapay_callback',
        {
          submissionStatus: callbackStatus === 'APPROVED' ? 'psp_approved' : 'psp_rejected',
          sasapayRequestId: signedPaymentReference,
          sasapayCallbackPayload: payload,
          sasapayPspStatus: callbackStatus,
          sasapayPspReason: reason || null,
        },
      );
    }

    return { processed: true, submissionId };
  }

  /**
   * Queue approved submissions for PSP upload
   */
  async enqueueApprovedSubmission(): Promise<void> {
    if (!this.config.get<boolean>('sasapay.kycEnabled')) return;

    await this.db.transaction(async (client) => {
      const result = await client.query(
        `SELECT cad.id, cad.customer_application_id, ca.customer_id, ca.astpp_id, cad.images
         FROM customer_applicant_details cad
         JOIN customer_applications ca ON ca.id = cad.customer_application_id
         WHERE cad.application_type = 'sasapay_kyc'
           AND cad.sasapay_submission_status = 'approved_for_psp'
           AND cad.required_documents IS NOT NULL
           AND CARDINALITY(cad.required_documents) > 0
         ORDER BY cad.updated_at ASC
         FOR UPDATE OF cad SKIP LOCKED
         LIMIT 1`,
      );
      const submission = result.rows[0];
      if (!submission) return;

      // Verify all required documents are uploaded
      const images = Array.isArray(submission.images) ? submission.images : [];
      const uploadedTypes = new Set(images.map(img => img.type));
      const requiredDocs = submission.required_documents || [];
      const allUploaded = requiredDocs.every(docType => uploadedTypes.has(docType));
      
      if (!allUploaded) return;

      await client.query(
        `UPDATE customer_applicant_details
         SET sasapay_submission_status = 'processing_psp_upload', updated_at = NOW()
         WHERE id = $1 AND sasapay_submission_status = 'approved_for_psp'`,
        [submission.id],
      );
      
      await client.query(
        `INSERT INTO jobs (job_type, payload, status, attempts, available_at, created_at, updated_at)
         VALUES ('sasapay_kyc_submission_upload', $1::jsonb, 'PENDING', 0, NOW(), NOW(), NOW())`,
        [JSON.stringify({
          customerId: submission.customer_id,
          astppId: submission.astpp_id,
          applicationId: submission.customer_application_id,
          submissionId: submission.id,
        })],
      );
    });
  }

  /**
   * Mark PSP upload as failed
   */
  async markPspUploadFailed(submissionId: string, reason: string): Promise<void> {
    await this.db.transaction(async (client) => {
      await client.query(
        `UPDATE customer_applicant_details
         SET sasapay_submission_status = 'psp_upload_failed', 
             sasapay_psp_reason = $2, 
             updated_at = NOW()
         WHERE id = $1 
           AND application_type = 'sasapay_kyc'
           AND sasapay_submission_status = 'processing_psp_upload'`,
        [submissionId, reason.slice(0, 2000)],
      );
      
      await client.query(
        `INSERT INTO events (event_type, aggregate_type, aggregate_id, payload, created_at)
         VALUES ('sasapay_kyc.psp_upload_failed', 'SasaPayKycSubmission', $1, $2::jsonb, NOW())`,
        [submissionId, JSON.stringify({ submissionId })],
      );
    });
  }

  /**
   * Upload KYC images and store in images JSONB field
   */
  async uploadImages(customerId: number, files: UploadedKycFile[]) {
    this.ensureEnabled();
    if (!files.length) throw new BadRequestException('At least one required image must be provided.');

    const submission = await this.db.queryOne(
      `SELECT cad.id, cad.customer_application_id, cad.required_documents, cad.sasapay_submission_status,
              cad.images, p.accepted_mime_types, p.max_file_size_bytes
       FROM customer_applicant_details cad
       JOIN customer_applications ca ON ca.id = cad.customer_application_id
       JOIN document_policies p ON p.id = cad.policy_id
       WHERE ca.customer_id = $1
         AND cad.application_type = 'sasapay_kyc'
         AND cad.sasapay_submission_status = 'awaiting_documents'
       ORDER BY cad.created_at DESC
       LIMIT 1`,
      [customerId],
    );
    if (!submission) throw new NotFoundException('No active KYC submission awaiting documents was found.');

    const requiredDocuments = this.withRequiredSelfie(submission.required_documents);
    const acceptedMimeTypes = new Set<string>(submission.accepted_mime_types);
    const existingImages = Array.isArray(submission.images) ? submission.images : [];
    const existingTypes = new Set(existingImages.map(img => img.type));
    const seen = new Set<KycDocumentType>();
    
    for (const file of files) {
      if (!DOCUMENT_TYPES.includes(file.fieldname as KycDocumentType)) {
        throw new BadRequestException(`Unsupported KYC image field: ${file.fieldname}`);
      }
      const documentType = file.fieldname as KycDocumentType;
      if (!requiredDocuments.includes(documentType)) {
        throw new BadRequestException(`${documentType} is not required for this submission.`);
      }
      if (seen.has(documentType)) throw new BadRequestException(`Only one ${documentType} image is allowed.`);
      if (existingTypes.has(documentType)) throw new ConflictException(`An image of type ${documentType} is already uploaded.`);
      seen.add(documentType);
      if (file.size <= 0 || file.size > Math.min(submission.max_file_size_bytes, this.maxUploadBytes)) {
        throw new BadRequestException(`Image size exceeds the allowed limit for ${documentType}.`);
      }
      if (!acceptedMimeTypes.has(file.mimetype) || this.detectMimeType(file.buffer) !== file.mimetype) {
        throw new BadRequestException(`Unsupported or invalid image type for ${documentType}.`);
      }
    }

    const applicationId = String(submission.customer_application_id);
    const applicationDirectory = path.resolve(this.imageRoot, applicationId);
    if (!applicationDirectory.startsWith(`${this.imageRoot}${path.sep}`)) {
      throw new BadRequestException('Invalid application image directory.');
    }
    await fs.mkdir(applicationDirectory, { recursive: true, mode: 0o700 });

    const savedFiles: Array<{ file: UploadedKycFile; filePath: string; filename: string }> = [];
    try {
      for (const file of files) {
        const extension = this.extensionForMimeType(file.mimetype);
        const fileName = `${randomUUID()}${extension}`;
        const filePath = path.join(applicationDirectory, fileName);
        await fs.writeFile(filePath, file.buffer, { flag: 'wx', mode: 0o600 });
        savedFiles.push({
          file,
          filePath,
          filename: fileName,
        });
      }

      // Build new images array
      const newImages = savedFiles.map(saved => ({
        type: saved.file.fieldname,
        filename: saved.filename,
        url: `uploads/images/${applicationId}/${saved.filename}`,
        mime_type: saved.file.mimetype,
        file_size: saved.file.size,
        uploaded_at: new Date().toISOString(),
      }));

      // Update images JSONB field
      await this.db.query(
        `UPDATE customer_applicant_details
         SET images = COALESCE(images, '[]'::jsonb) || $1::jsonb,
             updated_at = NOW()
         WHERE id = $2 AND application_type = 'sasapay_kyc'`,
        [JSON.stringify(newImages), submission.id],
      );

      // Log successful image upload
      this.sasaPayLogger.logImageUpload(
        customerId,
        submission.customer_application_id,
        submission.id,
        files.map((f) => f.fieldname),
        200,
        { uploadedDocuments: files.map((f) => f.fieldname), submissionId: submission.id },
      );

      // Log to submission log table
      await this.logSubmissionEvent(
        'documents_uploaded',
        submission.customer_application_id,
        submission.id,
        `customer_${customerId}`,
        {
          submissionStatus: submission.sasapay_submission_status || 'awaiting_documents',
          uploadedDocuments: newImages,
          metadata: {
            document_types: files.map(f => f.fieldname),
            file_count: files.length,
          },
        },
      );
    } catch (error) {
      // Log failed image upload
      this.sasaPayLogger.logImageUpload(
        customerId,
        submission.customer_application_id,
        submission.id,
        files.map((f) => f.fieldname),
        undefined,
        undefined,
        error,
      );
      
      await Promise.all(savedFiles.map(({ filePath }) => fs.rm(filePath, { force: true })));
      throw error;
    }

    // Auto-submit when all required documents have been uploaded
    const status = await this.getCurrentStatus(customerId);
    if (status && status.requiredDocuments.length === 0) {
      await this.submitForReview(customerId, status.submissionId);
      return { uploadedDocuments: files.map((file) => file.fieldname), submission: await this.getCurrentStatus(customerId) };
    }

    return { uploadedDocuments: files.map((file) => file.fieldname), submission: status };
  }

  /**
   * Submit KYC for internal review (auto-called when all docs uploaded)
   */
  private async submitForReview(customerId: number, submissionId: string) {
    this.ensureEnabled();
    const submission = await this.db.queryOne(
      `SELECT cad.id, cad.required_documents, cad.sasapay_submission_status, cad.policy_version, cad.images
       FROM customer_applicant_details cad
       JOIN customer_applications ca ON ca.id = cad.customer_application_id
       WHERE cad.id = $1 
         AND ca.customer_id = $2
         AND cad.application_type = 'sasapay_kyc'`,
      [submissionId, customerId],
    );
    if (!submission) throw new NotFoundException('KYC submission was not found.');
    if (submission.sasapay_submission_status !== 'awaiting_documents') {
      throw new ConflictException('This KYC submission is not awaiting documents.');
    }

    const requiredDocuments = this.withRequiredSelfie(submission.required_documents);
    const images = Array.isArray(submission.images) ? submission.images : [];
    const uploadedTypes = new Set(images.map(img => img.type));
    const missing = requiredDocuments.filter((documentType) => !uploadedTypes.has(documentType));
    if (missing.length) {
      throw new BadRequestException(`Missing required images: ${missing.join(', ')}`);
    }

    await this.db.transaction(async (client) => {
      await client.query(
        `UPDATE customer_applicant_details
         SET sasapay_submission_status = 'submitted_for_review', 
             sasapay_submitted_at = NOW(), 
             updated_at = NOW()
         WHERE id = $1 
           AND application_type = 'sasapay_kyc'
           AND sasapay_submission_status = 'awaiting_documents'`,
        [submissionId],
      );
      
      await client.query(
        `INSERT INTO events (event_type, aggregate_type, aggregate_id, payload, created_at)
         VALUES ('sasapay_kyc.submitted_for_review', 'SasaPayKycSubmission', $1, $2::jsonb, NOW())`,
        [submissionId, JSON.stringify({ submissionId, policyVersion: submission.policy_version })],
      );
    });

    // Log submission for review
    await this.logSubmissionEvent(
      'submitted_for_review',
      await this.getApplicationId(customerId),
      parseInt(submissionId, 10),
      `customer_${customerId}`,
      {
        submissionStatus: 'submitted_for_review',
        uploadedDocuments: images,
        metadata: { policyVersion: submission.policy_version },
      },
    );

    return this.getCurrentStatus(customerId);
  }

  /**
   * Get customer application with prioritized KYC document data
   */
  private async getCustomerApplicationAndDocument(customerId: number) {
    return this.db.queryOne(
      `SELECT ca.id, ca.customer_id, ca.astpp_id,
              COALESCE(sasapay.identity_document_type, wallet.identity_document_type, primary_kyc.identity_document_type) AS identity_document_type,
              COALESCE(sasapay.name, wallet.name, primary_kyc.name) AS name,
              COALESCE(sasapay.identity_document_number, wallet.identity_document_number, primary_kyc.identity_document_number) AS identity_document_number,
              COALESCE(sasapay.issuing_country, wallet.issuing_country, primary_kyc.issuing_country) AS issuing_country,
              COALESCE(sasapay.date_of_birth, wallet.date_of_birth, primary_kyc.date_of_birth) AS date_of_birth,
              COALESCE(sasapay.gender, wallet.gender, primary_kyc.gender) AS gender,
              COALESCE(sasapay.nationality, wallet.nationality, primary_kyc.nationality) AS nationality,
              COALESCE(sasapay.physical_address, wallet.physical_address, primary_kyc.physical_address) AS physical_address,
              COALESCE(sasapay.doc_front_url, wallet.doc_front_url, primary_kyc.doc_front_url) AS doc_front_url,
              COALESCE(sasapay.doc_back_url, wallet.doc_back_url, primary_kyc.doc_back_url) AS doc_back_url,
              COALESCE(sasapay.passport_photo_url, wallet.passport_photo_url, primary_kyc.passport_photo_url) AS passport_photo_url,
              COALESCE(sasapay.images, '[]'::jsonb) || COALESCE(wallet.images, '[]'::jsonb) ||
                COALESCE(primary_kyc.images, '[]'::jsonb) AS images
       FROM customer_applications ca
       LEFT JOIN customer_applicant_details sasapay
         ON sasapay.customer_application_id = ca.id AND sasapay.application_type = 'sasapay_kyc'
       LEFT JOIN customer_applicant_details wallet
         ON wallet.customer_application_id = ca.id AND wallet.application_type = 'wallet_kyc'
       LEFT JOIN customer_applicant_details primary_kyc
         ON primary_kyc.customer_application_id = ca.id AND primary_kyc.application_type = 'primary_kyc'
       WHERE ca.customer_id = $1
       LIMIT 1`,
      [customerId],
    );
  }

  /**
   * Get application ID for a customer (helper for logging)
   */
  private async getApplicationId(customerId: number): Promise<number> {
    const app = await this.db.queryOne(
      `SELECT id FROM customer_applications WHERE customer_id = $1`,
      [customerId],
    );
    return app?.id || 0;
  }

  private withRequiredSelfie(value: string[] | null | undefined): KycDocumentType[] {
    const documents = (value || []).filter((document): document is KycDocumentType =>
      DOCUMENT_TYPES.includes(document as KycDocumentType),
    );
    if (documents.length && !documents.includes('selfie')) documents.push('selfie');
    return [...new Set(documents)];
  }

  private detectMimeType(buffer: Buffer): string | null {
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return 'image/jpeg';
    }
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return 'image/png';
    }
    if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
      return 'image/webp';
    }
    return null;
  }

  private extensionForMimeType(mimeType: string): string {
    const extensions: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
    };
    return extensions[mimeType] || '.img';
  }

  private safeOriginalName(fileName: string): string {
    return path.basename(fileName.replace(/\\/g, '/')).replace(/[\r\n\0]/g, '').slice(0, 255);
  }

  private ensureEnabled(): void {
    if (!this.config.get<boolean>('sasapay.kycEnabled')) {
      throw new ForbiddenException('SasaPay KYC submissions are not enabled.');
    }
  }

  /**
   * Log SasaPay KYC submission event to audit log table
   */
  private async logSubmissionEvent(
    eventType: string,
    applicationId: number,
    applicantDetailId: number | null,
    triggeredBy: string,
    data: {
      submissionStatus?: string;
      sasapayRequestId?: string;
      sasapayCallbackPayload?: any;
      sasapayPspStatus?: string;
      sasapayPspReason?: string;
      reviewDecision?: string;
      reviewedBy?: string;
      reviewReason?: string;
      uploadedDocuments?: any[];
      metadata?: any;
    } = {},
  ) {
    try {
      await this.db.query(
        `INSERT INTO sasapay_kyc_submission_log (
          customer_application_id,
          customer_applicant_detail_id,
          event_type,
          triggered_by,
          submission_status,
          sasapay_request_id,
          sasapay_callback_payload,
          sasapay_psp_status,
          sasapay_psp_reason,
          review_decision,
          reviewed_by,
          review_reason,
          uploaded_documents,
          metadata,
          event_timestamp,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, NOW(), NOW())`,
        [
          applicationId,
          applicantDetailId,
          eventType,
          triggeredBy,
          data.submissionStatus || null,
          data.sasapayRequestId || null,
          data.sasapayCallbackPayload ? JSON.stringify(data.sasapayCallbackPayload) : null,
          data.sasapayPspStatus || null,
          data.sasapayPspReason || null,
          data.reviewDecision || null,
          data.reviewedBy || null,
          data.reviewReason || null,
          data.uploadedDocuments ? JSON.stringify(data.uploadedDocuments) : null,
          data.metadata ? JSON.stringify(data.metadata) : '{}',
        ],
      );
    } catch (error) {
      // Don't fail the operation if logging fails, but log the error
      console.error('[SASAPAY-KYC] Failed to log submission event:', error);
    }
  }
}

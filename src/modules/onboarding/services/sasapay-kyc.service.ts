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
  ) {}

  async getAllDocumentRequirements() {
    const policies = await this.db.query(
      `SELECT document_type, version, required_documents, accepted_mime_types, max_file_size_bytes
       FROM sasapay_kyc_document_policies
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

  async getActiveRequirements(customerId: number) {
    const source = await this.getCustomerApplicationAndDocument(customerId);
    if (!source) {
      console.error('[SASAPAY-KYC] Customer application not found for customer ID:', customerId);
      throw new NotFoundException('Customer application was not found.');
    }

    console.log('[SASAPAY-KYC] Looking up policy for customer:', {
      customerId,
      applicationId: source.id,
      documentType: source.identity_document_type,
    });

    // Debug: Check all available policies
    const allPolicies = await this.db.query(
      `SELECT document_type, version, is_active FROM sasapay_kyc_document_policies ORDER BY document_type`,
    );
    console.log('[SASAPAY-KYC] Available policies in database:', 
      allPolicies.rows.map(p => ({ type: p.document_type, version: p.version, active: p.is_active }))
    );

    const policy = await this.db.queryOne(
      `SELECT document_type, version, required_documents, accepted_mime_types, max_file_size_bytes
       FROM sasapay_kyc_document_policies
       WHERE LOWER(document_type) = LOWER($1) AND is_active = TRUE`,
      [source.identity_document_type],
    );
    
    if (!policy) {
      console.error('[SASAPAY-KYC] No policy found for document type:', {
        requestedType: source.identity_document_type,
        customerId,
        applicationId: source.id,
        availablePolicies: allPolicies.rows.map(p => p.document_type),
      });
      throw new ConflictException('SasaPay document requirements have not been configured for this document type.');
    }

    console.log('[SASAPAY-KYC] Policy found:', {
      documentType: policy.document_type,
      version: policy.version,
      requiredDocs: policy.required_documents,
    });

    return {
      documentType: policy.document_type,
      policyVersion: policy.version,
      requiredDocuments: this.withRequiredSelfie(policy.required_documents),
      acceptedMimeTypes: policy.accepted_mime_types,
      maxFileSizeBytes: policy.max_file_size_bytes,
    };
  }

  async getAllKycStatus(customerId: number) {
    console.log('[SASAPAY-KYC] getAllKycStatus called for customer:', customerId);

    // Get the customer application
    const application = await this.db.queryOne(
      `SELECT id, kyc_status FROM customer_applications WHERE customer_id = $1`,
      [customerId],
    );
    
    if (!application) {
      console.log('[SASAPAY-KYC] No customer application found for customer:', customerId);
      return {
        hasApplication: false,
        overallKycStatus: null,
        primaryKyc: null,
        walletKyc: null,
        sasapayKyc: null,
      };
    }

    console.log('[SASAPAY-KYC] Application found:', { 
      applicationId: application.id, 
      kycStatus: application.kyc_status,
      customerId 
    });

    // Get all applicant details (primary_kyc, wallet_kyc, sasapay_kyc)
    const applicantDetails = await this.db.query(
      `SELECT application_type, identity_document_type, name, created_at
       FROM customer_applicant_details
       WHERE customer_application_id = $1
       ORDER BY created_at DESC`,
      [application.id],
    );

    console.log('[SASAPAY-KYC] Applicant details found:', 
      applicantDetails.rows.map(d => ({ type: d.application_type, docType: d.identity_document_type }))
    );

    // Get SasaPay KYC submission status
    const sasapaySubmission = await this.db.queryOne(
      `SELECT id, status, required_documents, system_reason, psp_reason,
              customer_submitted_at, psp_result_at, created_at
       FROM sasapay_kyc_submissions
       WHERE customer_application_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [application.id],
    );

    // Get uploaded documents for SasaPay submission if it exists
    let sasapayUploadedDocs = [];
    if (sasapaySubmission) {
      const uploaded = await this.db.query(
        `SELECT document_type FROM sasapay_kyc_submission_images WHERE submission_id = $1`,
        [sasapaySubmission.id],
      );
      sasapayUploadedDocs = uploaded.rows.map(row => row.document_type);
    }

    // Build response
    const primaryKycDetail = applicantDetails.rows.find(d => d.application_type === 'primary_kyc');
    const walletKycDetail = applicantDetails.rows.find(d => d.application_type === 'wallet_kyc');
    const sasapayKycDetail = applicantDetails.rows.find(d => d.application_type === 'sasapay_kyc');

    const result = {
      hasApplication: true,
      overallKycStatus: application.kyc_status,
      
      primaryKyc: primaryKycDetail ? {
        exists: true,
        documentType: primaryKycDetail.identity_document_type,
        name: primaryKycDetail.name,
        submittedAt: primaryKycDetail.created_at,
      } : {
        exists: false,
      },
      
      walletKyc: walletKycDetail ? {
        exists: true,
        documentType: walletKycDetail.identity_document_type,
        name: walletKycDetail.name,
        submittedAt: walletKycDetail.created_at,
      } : {
        exists: false,
      },
      
      sasapayKyc: sasapaySubmission ? {
        exists: true,
        submissionId: sasapaySubmission.id,
        status: sasapaySubmission.status,
        requiredDocuments: this.withRequiredSelfie(sasapaySubmission.required_documents),
        uploadedDocuments: sasapayUploadedDocs,
        remainingDocuments: this.withRequiredSelfie(sasapaySubmission.required_documents)
          .filter(doc => !sasapayUploadedDocs.includes(doc)),
        reason: sasapaySubmission.psp_reason || sasapaySubmission.system_reason || null,
        submittedAt: sasapaySubmission.customer_submitted_at,
        resultAt: sasapaySubmission.psp_result_at,
        createdAt: sasapaySubmission.created_at,
      } : (sasapayKycDetail ? {
        exists: true,
        documentType: sasapayKycDetail.identity_document_type,
        name: sasapayKycDetail.name,
        submittedAt: sasapayKycDetail.created_at,
        hasSubmission: false,
        message: 'SasaPay KYC details exist but no submission workflow started',
      } : {
        exists: false,
        message: 'SasaPay KYC not initiated',
      }),
    };

    console.log('[SASAPAY-KYC] Final status:', {
      overallStatus: result.overallKycStatus,
      primaryExists: result.primaryKyc.exists,
      walletExists: result.walletKyc.exists,
      sasapayExists: result.sasapayKyc.exists,
    });

    return result;
  }

  async getCurrentStatus(customerId: number) {
    console.log('[SASAPAY-KYC] getCurrentStatus called for customer:', customerId);

    const applicationQuery = `SELECT id FROM customer_applications WHERE customer_id = $1`;
    console.log('[SASAPAY-KYC] Executing query:', applicationQuery, 'with params:', [customerId]);
    
    const application = await this.db.queryOne(applicationQuery, [customerId]);
    
    if (!application) {
      console.log('[SASAPAY-KYC] No customer application found for customer:', customerId);
      return null;
    }

    console.log('[SASAPAY-KYC] Application found:', { applicationId: application.id, customerId });

    const submissionQuery = `SELECT id, status, required_documents, system_reason, psp_reason,
              customer_submitted_at, internal_reviewed_at, psp_submitted_at, psp_result_at,
              policy_version, created_at, updated_at
       FROM sasapay_kyc_submissions
       WHERE customer_application_id = $1
       ORDER BY created_at DESC
       LIMIT 1`;
    console.log('[SASAPAY-KYC] Executing query:', submissionQuery, 'with params:', [application.id]);
    
    const submission = await this.db.queryOne(submissionQuery, [application.id]);
    
    if (!submission) {
      console.log('[SASAPAY-KYC] No KYC submission found for application:', application.id);
      console.log('[SASAPAY-KYC] This means the customer has not started a KYC submission yet.');
      console.log('[SASAPAY-KYC] To check if any submissions exist, run:');
      console.log(`  SELECT * FROM sasapay_kyc_submissions WHERE customer_application_id = ${application.id};`);
      return null;
    }

    console.log('[SASAPAY-KYC] Submission found:', {
      submissionId: submission.id,
      status: submission.status,
      requiredDocuments: submission.required_documents,
    });

    const uploadedQuery = `SELECT document_type FROM sasapay_kyc_submission_images WHERE submission_id = $1`;
    console.log('[SASAPAY-KYC] Executing query:', uploadedQuery, 'with params:', [submission.id]);
    
    const uploaded = await this.db.query(uploadedQuery, [submission.id]);
    const uploadedTypes = new Set(uploaded.rows.map((row) => row.document_type));
    const requiredDocuments = this.withRequiredSelfie(submission.required_documents)
      .filter((documentType) => !uploadedTypes.has(documentType));

    console.log('[SASAPAY-KYC] Upload status:', {
      uploadedDocuments: Array.from(uploadedTypes),
      remainingDocuments: requiredDocuments,
    });

    return {
      submissionId: submission.id,
      status: submission.status,
      policyVersion: submission.policy_version,
      requiredDocuments,
      reason: submission.psp_reason || submission.system_reason || null,
      customerSubmittedAt: submission.customer_submitted_at,
      internalReviewedAt: submission.internal_reviewed_at,
      pspSubmittedAt: submission.psp_submitted_at,
      pspResultAt: submission.psp_result_at,
      createdAt: submission.created_at,
      updatedAt: submission.updated_at,
    };
  }

  async ensureSystemCase(customerId: number, reason: string, pspReason?: string) {
    if (!this.config.get<boolean>('sasapay.kycEnabled')) return null;

    const application = await this.getCustomerApplicationAndDocument(customerId);
    if (!application) return null;

    const policy = await this.db.queryOne(
      `SELECT id, version, required_documents
       FROM sasapay_kyc_document_policies
       WHERE LOWER(document_type) = LOWER($1) AND is_active = TRUE`,
      [application.identity_document_type],
    );
    if (!policy) return null;

    const completedSubmission = await this.db.queryOne(
      `SELECT id
       FROM sasapay_kyc_submissions s
       WHERE s.customer_application_id = $1
         AND s.policy_id = $2
         AND s.status = 'psp_approved'
         AND NOT EXISTS (
           SELECT 1
           FROM unnest(s.required_documents) AS required(document_type)
           WHERE NOT EXISTS (
             SELECT 1 FROM sasapay_kyc_submission_images image
             WHERE image.submission_id = s.id
               AND image.document_type = required.document_type
           )
         )
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

    const openSubmission = await this.db.queryOne(
      `SELECT id
       FROM sasapay_kyc_submissions
       WHERE customer_application_id = $1
         AND status IN ('awaiting_documents', 'submitted_for_review', 'approved_for_psp', 'awaiting_psp_result')
       ORDER BY created_at DESC
       LIMIT 1`,
      [application.id],
    );
    if (openSubmission) return openSubmission.id;

    const detail = await this.db.queryOne(
      `INSERT INTO customer_applicant_details (
         customer_application_id, customer_id, astpp_id, application_type,
         name, identity_document_type, identity_document_number, issuing_country,
         date_of_birth, gender, nationality, physical_address,
         created_at, updated_at
       )
       VALUES ($1, $2, $3, 'sasapay_kyc', $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
       ON CONFLICT (customer_application_id, application_type) DO UPDATE SET
         identity_document_type = EXCLUDED.identity_document_type,
         identity_document_number = EXCLUDED.identity_document_number,
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
      ],
    );

    const submission = await this.db.queryOne(
      `INSERT INTO sasapay_kyc_submissions (
         customer_application_id, customer_applicant_detail_id, policy_id,
         document_type, policy_version, status, required_documents,
         system_reason, psp_reason, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, 'awaiting_documents', $6, $7, $8, NOW(), NOW())
       RETURNING id`,
      [application.id, detail.id, policy.id, application.identity_document_type, policy.version,
        requiredDocuments, reason, pspReason || null],
    );

    return submission.id;
  }

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
    const serializedPayload = JSON.stringify(payload);

    const correlatedSubmission = signedPaymentReference
      ? await this.db.queryOne(
        `SELECT s.id
         FROM sasapay_kyc_submissions s
         JOIN customer_applications ca ON ca.id = s.customer_application_id
        WHERE ca.id = $1 AND s.sasapay_request_id = $2
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
    const payloadHash = createHash('sha256').update(serializedPayload).digest('hex');
    const receiptInserted = await this.db.transaction(async (client) => {
      const receipt = await client.query(
        `INSERT INTO sasapay_kyc_callback_receipts (
           customer_application_id, submission_id, payload_sha256,
           callback_status, psp_reason, payload
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (payload_sha256) DO NOTHING
         RETURNING id`,
        [application.id, submissionId, payloadHash, callbackStatus, reason || null, serializedPayload],
      );
      if (!receipt.rowCount) return false;

      if (correlatedSubmission) {
        await client.query(
          `UPDATE sasapay_kyc_submissions
           SET status = $1,
               psp_status = $2,
               psp_reason = $3,
               psp_result_at = NOW(),
               latest_callback_payload = $4::jsonb,
               updated_at = NOW()
           WHERE id = $5`,
          [
            callbackStatus === 'APPROVED' ? 'psp_approved' : 'psp_rejected',
            callbackStatus,
            reason || null,
            serializedPayload,
            correlatedSubmission.id,
          ],
        );
      }
      return true;
    });

    return { processed: receiptInserted, submissionId };
  }

  async enqueueApprovedSubmission(): Promise<void> {
    if (!this.config.get<boolean>('sasapay.kycEnabled')) return;

    await this.db.transaction(async (client) => {
      const result = await client.query(
        `SELECT s.id, s.customer_application_id, ca.customer_id, ca.astpp_id
         FROM sasapay_kyc_submissions s
         JOIN customer_applications ca ON ca.id = s.customer_application_id
         WHERE s.status = 'approved_for_psp'
           AND NOT EXISTS (
             SELECT 1
             FROM unnest(s.required_documents) AS required(document_type)
             WHERE NOT EXISTS (
               SELECT 1 FROM sasapay_kyc_submission_images image
               WHERE image.submission_id = s.id
                 AND image.document_type = required.document_type
             )
           )
         ORDER BY s.updated_at ASC
         FOR UPDATE OF s SKIP LOCKED
         LIMIT 1`,
      );
      const submission = result.rows[0];
      if (!submission) return;

      await client.query(
        `UPDATE sasapay_kyc_submissions
         SET status = 'processing_psp_upload', updated_at = NOW()
         WHERE id = $1 AND status = 'approved_for_psp'`,
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

  async markPspUploadFailed(submissionId: string, reason: string): Promise<void> {
    await this.db.transaction(async (client) => {
      await client.query(
        `UPDATE sasapay_kyc_submissions
         SET status = 'psp_upload_failed', psp_reason = $2, updated_at = NOW()
         WHERE id = $1 AND status = 'processing_psp_upload'`,
        [submissionId, reason.slice(0, 2000)],
      );
      await client.query(
        `INSERT INTO events (event_type, aggregate_type, aggregate_id, payload, created_at)
         VALUES ('sasapay_kyc.psp_upload_failed', 'SasaPayKycSubmission', $1, $2::jsonb, NOW())`,
        [submissionId, JSON.stringify({ submissionId })],
      );
    });
  }

  async uploadImages(customerId: number, files: UploadedKycFile[]) {
    this.ensureEnabled();
    if (!files.length) throw new BadRequestException('At least one required image must be provided.');

    const submission = await this.db.queryOne(
      `SELECT s.id, s.customer_application_id, s.required_documents, s.status,
              p.accepted_mime_types, p.max_file_size_bytes
       FROM sasapay_kyc_submissions s
       JOIN customer_applications ca ON ca.id = s.customer_application_id
       JOIN sasapay_kyc_document_policies p ON p.id = s.policy_id
       WHERE ca.customer_id = $1
         AND s.status = 'awaiting_documents'
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [customerId],
    );
    if (!submission) throw new NotFoundException('No active KYC submission awaiting documents was found.');

    const requiredDocuments = this.withRequiredSelfie(submission.required_documents);
    const acceptedMimeTypes = new Set<string>(submission.accepted_mime_types);
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
      seen.add(documentType);
      if (file.size <= 0 || file.size > Math.min(submission.max_file_size_bytes, this.maxUploadBytes)) {
        throw new BadRequestException(`Image size exceeds the allowed limit for ${documentType}.`);
      }
      if (!acceptedMimeTypes.has(file.mimetype) || this.detectMimeType(file.buffer) !== file.mimetype) {
        throw new BadRequestException(`Unsupported or invalid image type for ${documentType}.`);
      }
    }

    const existing = await this.db.query(
      `SELECT document_type FROM sasapay_kyc_submission_images
       WHERE submission_id = $1 AND document_type = ANY($2::text[])`,
      [submission.id, files.map((file) => file.fieldname)],
    );
    if (existing.rowCount) {
      throw new ConflictException('An image of this type is already stored for this submission.');
    }

    const applicationId = String(submission.customer_application_id);
    const applicationDirectory = path.resolve(this.imageRoot, applicationId);
    if (!applicationDirectory.startsWith(`${this.imageRoot}${path.sep}`)) {
      throw new BadRequestException('Invalid application image directory.');
    }
    await fs.mkdir(applicationDirectory, { recursive: true, mode: 0o700 });

    const savedFiles: Array<{ file: UploadedKycFile; filePath: string; relativePath: string }> = [];
    try {
      for (const file of files) {
        const extension = this.extensionForMimeType(file.mimetype);
        const fileName = `${randomUUID()}${extension}`;
        const filePath = path.join(applicationDirectory, fileName);
        await fs.writeFile(filePath, file.buffer, { flag: 'wx', mode: 0o600 });
        savedFiles.push({
          file,
          filePath,
          relativePath: path.posix.join('uploads', 'images', applicationId, fileName),
        });
      }

      await this.db.transaction(async (client) => {
        for (const saved of savedFiles) {
          await client.query(
            `INSERT INTO sasapay_kyc_submission_images (
               submission_id, customer_application_id, document_type, relative_path,
               mime_type, file_size_bytes, original_filename
             ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              submission.id,
              submission.customer_application_id,
              saved.file.fieldname,
              saved.relativePath,
              saved.file.mimetype,
              saved.file.size,
              this.safeOriginalName(saved.file.originalname),
            ],
          );
        }
      });

      // Log successful image upload
      this.sasaPayLogger.logImageUpload(
        customerId,
        submission.customer_application_id,
        submission.id,
        files.map((f) => f.fieldname),
        200,
        { uploadedDocuments: files.map((f) => f.fieldname), submissionId: submission.id },
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

  private async submitForReview(customerId: number, submissionId: string) {
    this.ensureEnabled();
    const submission = await this.db.queryOne(
      `SELECT s.id, s.required_documents, s.status, s.policy_version
       FROM sasapay_kyc_submissions s
       JOIN customer_applications ca ON ca.id = s.customer_application_id
       WHERE s.id = $1 AND ca.customer_id = $2`,
      [submissionId, customerId],
    );
    if (!submission) throw new NotFoundException('KYC submission was not found.');
    if (submission.status !== 'awaiting_documents') {
      throw new ConflictException('This KYC submission is not awaiting documents.');
    }

    const requiredDocuments = this.withRequiredSelfie(submission.required_documents);
    const uploaded = await this.db.query(
      `SELECT document_type FROM sasapay_kyc_submission_images WHERE submission_id = $1`,
      [submissionId],
    );
    const uploadedTypes = new Set(uploaded.rows.map((row) => row.document_type));
    const missing = requiredDocuments.filter((documentType) => !uploadedTypes.has(documentType));
    if (missing.length) {
      throw new BadRequestException(`Missing required images: ${missing.join(', ')}`);
    }

    await this.db.transaction(async (client) => {
      await client.query(
        `UPDATE sasapay_kyc_submissions
         SET status = 'submitted_for_review', customer_submitted_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND status = 'awaiting_documents'`,
        [submissionId],
      );
      await client.query(
        `INSERT INTO events (event_type, aggregate_type, aggregate_id, payload, created_at)
         VALUES ('sasapay_kyc.submitted_for_review', 'SasaPayKycSubmission', $1, $2::jsonb, NOW())`,
        [submissionId, JSON.stringify({ submissionId, policyVersion: submission.policy_version })],
      );
    });
    return this.getCurrentStatus(customerId);
  }

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
}
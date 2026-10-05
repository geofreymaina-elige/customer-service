import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { DatabaseService } from '../../../core/database/database.service';
import { EventService } from '../../../core/events/event.service';
import {
  AdminReviewDecisionDto,
  AdminReviewDecisionEnum,
  AdminKycSubmissionsQueryDto,
} from '../dto/admin-sasapay-kyc.dto';

@Injectable()
export class AdminSasaPayKycService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly events: EventService,
  ) {}

  private getPublicUrl(): string {
    const rawUrl =
      this.config.get<string>('publicUrl') ||
      process.env.PUBLIC_URL ||
      'https://api.ambiapay.com';
    return rawUrl.replace(/\/+$/, '');
  }

  private getAdminApiKey(): string {
    return (
      this.config.get<string>('adminApiKey') ||
      process.env.ADMIN_API_KEY ||
      'ambia_admin_secret_key_2026_x89a1c90f23b'
    );
  }

  /**
   * Fetch complete case details for an admin review:
   * Returns Customer details, Application details with KYC status,
   * SasaPay KYC submission, Document images with full URLs on https://api.ambiapay.com,
   * and previous submission history.
   */
  async getSubmissionDetails(submissionId: string) {
    const submission = await this.db.queryOne(
      `SELECT s.*, ca.id AS app_id, ca.uuid AS app_uuid, ca.customer_id, ca.astpp_id,
              ca.application_id, ca.application_number, ca.kyc_status, ca.kyc_tier,
              ca.sasapay_request_id AS app_sasapay_request_id,
              ca.sasapay_account_number AS app_sasapay_account_number,
              ca.sasapay_account_status AS app_sasapay_account_status,
              ca.submitted_at AS app_submitted_at,
              ca.approved_at AS app_approved_at,
              ca.rejected_at AS app_rejected_at,
              ca.rejection_reason AS app_rejection_reason,
              c.uuid AS customer_uuid, c.phone_number, c.email,
              c.first_name, c.last_name, c.status AS customer_status,
              c.country_code, c.account_type, c.created_at AS customer_created_at
       FROM sasapay_kyc_submissions s
       JOIN customer_applications ca ON ca.id = s.customer_application_id
       JOIN customers c ON c.id = ca.customer_id
       WHERE s.id = $1`,
      [submissionId],
    );

    if (!submission) {
      throw new NotFoundException(`KYC submission ${submissionId} was not found.`);
    }

    // Fetch applicant details (name, identity doc, etc.)
    const applicantDetail = await this.db.queryOne(
      `SELECT cad.*
       FROM customer_applicant_details cad
       WHERE cad.customer_application_id = $1
       ORDER BY CASE cad.application_type
         WHEN 'sasapay_kyc' THEN 1
         WHEN 'wallet_kyc' THEN 2
         WHEN 'primary_kyc' THEN 3
         ELSE 4
       END ASC
       LIMIT 1`,
      [submission.app_id],
    );

    // Fetch images uploaded for this specific submission
    const submissionImages = await this.db.query(
      `SELECT id, document_type, relative_path, mime_type, file_size_bytes, original_filename, uploaded_at
       FROM sasapay_kyc_submission_images
       WHERE submission_id = $1
       ORDER BY uploaded_at ASC`,
      [submissionId],
    );

    const publicUrl = this.getPublicUrl();
    const apiKey = this.getAdminApiKey();

    const formattedDocuments = submissionImages.rows.map((img) => {
      // Secure authenticated download endpoint
      const secureFileUrl = `${publicUrl}/api/v2/admin/sasapay-kyc/files/${img.id}?apiKey=${encodeURIComponent(apiKey)}`;
      // Normalized relative path URL
      const normalizedPath = img.relative_path.startsWith('/')
        ? img.relative_path
        : `/${img.relative_path}`;
      const staticFileUrl = `${publicUrl}${normalizedPath}`;

      return {
        id: img.id,
        documentType: img.document_type,
        originalFilename: img.original_filename,
        mimeType: img.mime_type,
        fileSizeBytes: img.file_size_bytes,
        uploadedAt: img.uploaded_at,
        url: secureFileUrl,
        staticUrl: staticFileUrl,
      };
    });

    // Fetch submission history for this customer application
    const historyRows = await this.db.query(
      `SELECT s.id, s.status, s.document_type, s.policy_version, s.customer_submitted_at,
              s.internal_reviewed_at, s.reviewed_by, s.review_decision, s.review_reason,
              s.psp_submitted_at, s.psp_result_at, s.psp_status, s.psp_reason, s.created_at
       FROM sasapay_kyc_submissions s
       WHERE s.customer_application_id = $1 AND s.id != $2
       ORDER BY s.created_at DESC`,
      [submission.app_id, submissionId],
    );

    const fullName =
      applicantDetail?.name ||
      [submission.first_name, submission.last_name].filter(Boolean).join(' ') ||
      '';

    return {
      customer: {
        id: submission.customer_id,
        uuid: submission.customer_uuid,
        astppId: submission.astpp_id,
        phoneNumber: submission.phone_number,
        email: submission.email,
        firstName: submission.first_name,
        lastName: submission.last_name,
        fullName,
        dateOfBirth: applicantDetail?.date_of_birth || null,
        gender: applicantDetail?.gender || null,
        nationality: applicantDetail?.nationality || null,
        countryCode: submission.country_code,
        accountType: submission.account_type,
        customerStatus: submission.customer_status,
        createdAt: submission.customer_created_at,
        identityDocumentType: applicantDetail?.identity_document_type || submission.document_type,
        identityDocumentNumber: applicantDetail?.identity_document_number || null,
        physicalAddress: applicantDetail?.physical_address || null,
      },
      application: {
        id: submission.app_id,
        uuid: submission.app_uuid,
        applicationId: submission.application_id,
        applicationNumber: submission.application_number,
        kycStatus: submission.kyc_status,
        kycTier: submission.kyc_tier,
        sasapayRequestId: submission.app_sasapay_request_id,
        sasapayAccountNumber: submission.app_sasapay_account_number,
        sasapayAccountStatus: submission.app_sasapay_account_status,
        submittedAt: submission.app_submitted_at,
        approvedAt: submission.app_approved_at,
        rejectedAt: submission.app_rejected_at,
        rejectionReason: submission.app_rejection_reason,
      },
      submission: {
        submissionId: submission.id,
        status: submission.status,
        documentType: submission.document_type,
        policyVersion: submission.policy_version,
        requiredDocuments: submission.required_documents || [],
        systemReason: submission.system_reason,
        customerSubmittedAt: submission.customer_submitted_at,
        internalReviewedAt: submission.internal_reviewed_at,
        reviewedBy: submission.reviewed_by,
        reviewDecision: submission.review_decision,
        reviewReason: submission.review_reason,
        sasapayRequestId: submission.sasapay_request_id,
        pspSubmittedAt: submission.psp_submitted_at,
        pspResultAt: submission.psp_result_at,
        pspStatus: submission.psp_status,
        pspReason: submission.psp_reason,
        createdAt: submission.created_at,
        updatedAt: submission.updated_at,
      },
      documents: formattedDocuments,
      applicantDetails: applicantDetail
        ? {
            id: applicantDetail.id,
            applicationType: applicantDetail.application_type,
            passportPhotoUrl: applicantDetail.passport_photo_url
              ? this.normalizeUrl(applicantDetail.passport_photo_url, publicUrl)
              : null,
            docFrontUrl: applicantDetail.doc_front_url
              ? this.normalizeUrl(applicantDetail.doc_front_url, publicUrl)
              : null,
            docBackUrl: applicantDetail.doc_back_url
              ? this.normalizeUrl(applicantDetail.doc_back_url, publicUrl)
              : null,
            additionalImages: Array.isArray(applicantDetail.images)
              ? applicantDetail.images.map((img: any) => ({
                  ...img,
                  url: img.url ? this.normalizeUrl(img.url, publicUrl) : null,
                }))
              : [],
          }
        : null,
      submissionHistory: historyRows.rows.map((row) => ({
        submissionId: row.id,
        status: row.status,
        documentType: row.document_type,
        policyVersion: row.policy_version,
        customerSubmittedAt: row.customer_submitted_at,
        internalReviewedAt: row.internal_reviewed_at,
        reviewedBy: row.reviewed_by,
        reviewDecision: row.review_decision,
        reviewReason: row.review_reason,
        pspSubmittedAt: row.psp_submitted_at,
        pspResultAt: row.psp_result_at,
        pspStatus: row.psp_status,
        pspReason: row.psp_reason,
        createdAt: row.created_at,
      })),
    };
  }

  /**
   * Search / List SasaPay KYC submissions with pagination and status filtering
   */
  async listSubmissions(dto: AdminKycSubmissionsQueryDto) {
    const limit = dto.limit || 20;
    const offset = dto.offset || 0;
    const params: any[] = [];
    const whereClauses: string[] = [];

    if (dto.status) {
      params.push(dto.status);
      whereClauses.push(`s.status = $${params.length}`);
    }

    if (dto.astppId) {
      params.push(dto.astppId);
      whereClauses.push(`ca.astpp_id = $${params.length}`);
    }

    if (dto.query) {
      params.push(`%${dto.query}%`);
      const idx = params.length;
      whereClauses.push(`(
        c.phone_number ILIKE $${idx} OR
        c.first_name ILIKE $${idx} OR
        c.last_name ILIKE $${idx} OR
        ca.astpp_id::text ILIKE $${idx} OR
        cad.identity_document_number ILIKE $${idx}
      )`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countSql = `
      SELECT COUNT(s.id) AS total
      FROM sasapay_kyc_submissions s
      JOIN customer_applications ca ON ca.id = s.customer_application_id
      JOIN customers c ON c.id = ca.customer_id
      LEFT JOIN customer_applicant_details cad ON cad.id = s.customer_applicant_detail_id
      ${whereSql}
    `;

    const countResult = await this.db.queryOne(countSql, params);
    const total = parseInt(countResult?.total || '0', 10);

    params.push(limit);
    const limitParam = `$${params.length}`;
    params.push(offset);
    const offsetParam = `$${params.length}`;

    const dataSql = `
      SELECT s.id AS submission_id, s.status AS submission_status, s.document_type,
             s.policy_version, s.customer_submitted_at, s.created_at AS submission_created_at,
             s.internal_reviewed_at, s.reviewed_by, s.review_decision,
             ca.id AS app_id, ca.astpp_id, ca.kyc_status, ca.kyc_tier,
             c.uuid AS customer_uuid, c.phone_number, c.first_name, c.last_name,
             c.status AS customer_status,
             cad.name AS applicant_name, cad.identity_document_number
      FROM sasapay_kyc_submissions s
      JOIN customer_applications ca ON ca.id = s.customer_application_id
      JOIN customers c ON c.id = ca.customer_id
      LEFT JOIN customer_applicant_details cad ON cad.id = s.customer_applicant_detail_id
      ${whereSql}
      ORDER BY s.created_at DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `;

    const dataResult = await this.db.query(dataSql, params);
    const publicUrl = this.getPublicUrl();

    const items = dataResult.rows.map((row) => ({
      submissionId: row.submission_id,
      submissionStatus: row.submission_status,
      documentType: row.document_type,
      policyVersion: row.policy_version,
      customerSubmittedAt: row.customer_submitted_at,
      createdAt: row.submission_created_at,
      internalReviewedAt: row.internal_reviewed_at,
      reviewedBy: row.reviewed_by,
      reviewDecision: row.review_decision,
      customer: {
        uuid: row.customer_uuid,
        astppId: row.astpp_id,
        phoneNumber: row.phone_number,
        fullName: row.applicant_name || [row.first_name, row.last_name].filter(Boolean).join(' '),
        customerStatus: row.customer_status,
        identityDocumentNumber: row.identity_document_number,
      },
      application: {
        id: row.app_id,
        kycStatus: row.kyc_status,
        kycTier: row.kyc_tier,
      },
      detailUrl: `${publicUrl}/api/v2/admin/sasapay-kyc/submissions/${row.submission_id}`,
    }));

    return {
      total,
      limit,
      offset,
      submissions: items,
    };
  }

  /**
   * Fetch customer KYC profile by ASTPP ID
   */
  async getCustomerKycByAstppId(astppId: number) {
    const customer = await this.db.queryOne(
      `SELECT c.id, c.uuid, c.astpp_id, c.phone_number, c.email,
              c.first_name, c.last_name, c.status AS customer_status,
              c.country_code, c.account_type, c.created_at,
              ca.id AS app_id, ca.uuid AS app_uuid, ca.kyc_status, ca.kyc_tier,
              ca.sasapay_request_id, ca.sasapay_account_number, ca.sasapay_account_status,
              ca.submitted_at, ca.approved_at, ca.rejected_at, ca.rejection_reason
       FROM customers c
       JOIN customer_applications ca ON ca.customer_id = c.id
       WHERE c.astpp_id = $1`,
      [astppId],
    );

    if (!customer) {
      throw new NotFoundException(`Customer with ASTPP ID ${astppId} was not found.`);
    }

    // Fetch latest SasaPay KYC submission
    const latestSubmission = await this.db.queryOne(
      `SELECT id FROM sasapay_kyc_submissions
       WHERE customer_application_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [customer.app_id],
    );

    if (latestSubmission) {
      return this.getSubmissionDetails(latestSubmission.id);
    }

    // If no SasaPay submission yet, return basic application data
    const publicUrl = this.getPublicUrl();
    const applicantDetail = await this.db.queryOne(
      `SELECT * FROM customer_applicant_details WHERE customer_application_id = $1 ORDER BY id DESC LIMIT 1`,
      [customer.app_id],
    );

    return {
      customer: {
        id: customer.id,
        uuid: customer.uuid,
        astppId: customer.astpp_id,
        phoneNumber: customer.phone_number,
        email: customer.email,
        firstName: customer.first_name,
        lastName: customer.last_name,
        fullName: applicantDetail?.name || [customer.first_name, customer.last_name].filter(Boolean).join(' '),
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
      submission: null,
      documents: [],
      applicantDetails: applicantDetail
        ? {
            id: applicantDetail.id,
            passportPhotoUrl: applicantDetail.passport_photo_url
              ? this.normalizeUrl(applicantDetail.passport_photo_url, publicUrl)
              : null,
            docFrontUrl: applicantDetail.doc_front_url
              ? this.normalizeUrl(applicantDetail.doc_front_url, publicUrl)
              : null,
            docBackUrl: applicantDetail.doc_back_url
              ? this.normalizeUrl(applicantDetail.doc_back_url, publicUrl)
              : null,
          }
        : null,
      submissionHistory: [],
    };
  }

  /**
   * Retrieve image file metadata and read stream for file downloads
   */
  async getImageFile(imageId: number) {
    const image = await this.db.queryOne(
      `SELECT id, relative_path, mime_type, file_size_bytes, original_filename
       FROM sasapay_kyc_submission_images
       WHERE id = $1`,
      [imageId],
    );

    if (!image) {
      throw new NotFoundException(`KYC image file with ID ${imageId} was not found.`);
    }

    const filePath = path.resolve(process.cwd(), image.relative_path);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('The requested KYC image file was not found on storage.');
    }

    const stream = fs.createReadStream(filePath);

    return {
      stream,
      mimeType: image.mime_type || 'image/jpeg',
      fileSizeBytes: image.file_size_bytes,
      filename: image.original_filename || `kyc_image_${imageId}.jpg`,
    };
  }

  /**
   * Process Admin review decision (Approve or Reject)
   */
  async submitReviewDecision(
    submissionId: string,
    dto: AdminReviewDecisionDto,
    adminActor: string,
  ) {
    const submission = await this.db.queryOne(
      `SELECT id, status, customer_application_id, policy_version
       FROM sasapay_kyc_submissions
       WHERE id = $1`,
      [submissionId],
    );

    if (!submission) {
      throw new NotFoundException(`KYC submission ${submissionId} was not found.`);
    }

    if (submission.status !== 'submitted_for_review') {
      throw new ConflictException(
        `Cannot review submission in status "${submission.status}". Only submissions in "submitted_for_review" can be reviewed.`,
      );
    }

    const reviewer = dto.reviewerName || adminActor || 'admin_reviewer';
    const isApproved = dto.decision === AdminReviewDecisionEnum.APPROVED;
    const newStatus = isApproved ? 'approved_for_psp' : 'rejected';

    await this.db.transaction(async (client) => {
      await client.query(
        `UPDATE sasapay_kyc_submissions
         SET status = $1,
             review_decision = $2,
             reviewed_by = $3,
             review_reason = $4,
             internal_reviewed_at = NOW(),
             updated_at = NOW()
         WHERE id = $5`,
        [newStatus, dto.decision, reviewer, dto.reason || dto.notes || null, submissionId],
      );

      // Audit log entry
      await client.query(
        `INSERT INTO events (event_type, aggregate_type, aggregate_id, payload, created_at)
         VALUES ($1, 'SasaPayKycSubmission', $2, $3::jsonb, NOW())`,
        [
          isApproved ? 'sasapay_kyc.admin_approved' : 'sasapay_kyc.admin_rejected',
          submissionId,
          JSON.stringify({
            submissionId,
            decision: dto.decision,
            reviewer,
            reason: dto.reason || null,
            notes: dto.notes || null,
          }),
        ],
      );
    });

    return this.getSubmissionDetails(submissionId);
  }

  private normalizeUrl(url: string, baseUrl: string): string {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    const cleanPath = url.startsWith('/') ? url : `/${url}`;
    return `${baseUrl}${cleanPath}`;
  }
}

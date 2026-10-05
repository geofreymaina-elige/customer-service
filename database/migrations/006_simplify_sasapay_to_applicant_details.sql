-- ============================================================================
-- Migration 006: Simplify SasaPay KYC to use customer_applicant_details
-- ============================================================================
-- Drop SasaPay-specific tables (sasapay_kyc_submissions, sasapay_kyc_submission_images, 
-- sasapay_kyc_admin_declarations) and rename sasapay_kyc_document_policies to document_policies.
-- Add SasaPay tracking columns to customer_applicant_details to support SasaPay workflow
-- using the existing application_type pattern ('sasapay_kyc').

-- ============================================================================
-- 1. Drop SasaPay-specific tables
-- ============================================================================

DROP TABLE IF EXISTS sasapay_kyc_submission_images CASCADE;
DROP TABLE IF EXISTS sasapay_kyc_submissions CASCADE;
DROP TABLE IF EXISTS sasapay_kyc_admin_declarations CASCADE;

-- ============================================================================
-- 2. Rename sasapay_kyc_document_policies to document_policies
-- ============================================================================

ALTER TABLE IF EXISTS sasapay_kyc_document_policies 
    RENAME TO document_policies;

-- Rename indexes and constraints to match new table name
ALTER INDEX IF EXISTS uq_sasapay_kyc_active_policy 
    RENAME TO uq_document_active_policy;

-- The unique constraint uq_sasapay_kyc_policy_version creates an index automatically
-- We only need to rename that index, not the constraint separately
ALTER INDEX IF EXISTS uq_sasapay_kyc_policy_version 
    RENAME TO uq_document_policy_version;

ALTER TABLE document_policies 
    RENAME CONSTRAINT ck_sasapay_kyc_policy_documents TO ck_document_policy_documents;

ALTER TABLE document_policies 
    RENAME CONSTRAINT ck_sasapay_kyc_policy_mime_types TO ck_document_policy_mime_types;

-- Update table comment
COMMENT ON TABLE document_policies IS
    'Versioned document requirements for KYC submissions (used for SasaPay and other providers).';

-- ============================================================================
-- 3. Add SasaPay workflow columns to customer_applicant_details
-- ============================================================================

-- Add policy reference
ALTER TABLE customer_applicant_details 
    ADD COLUMN IF NOT EXISTS policy_id BIGINT REFERENCES document_policies(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS policy_version INTEGER;

-- Add SasaPay submission tracking
ALTER TABLE customer_applicant_details
    ADD COLUMN IF NOT EXISTS sasapay_submission_status VARCHAR(32) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS sasapay_request_id VARCHAR(128) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS sasapay_submitted_at TIMESTAMPTZ DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS sasapay_result_at TIMESTAMPTZ DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS sasapay_callback_payload JSONB DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS sasapay_psp_status VARCHAR(32) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS sasapay_psp_reason TEXT DEFAULT NULL;

-- Add internal review tracking
ALTER TABLE customer_applicant_details
    ADD COLUMN IF NOT EXISTS review_status VARCHAR(16) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS review_decision VARCHAR(16) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(128) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS review_reason TEXT DEFAULT NULL;

-- Add required documents tracking
ALTER TABLE customer_applicant_details
    ADD COLUMN IF NOT EXISTS required_documents TEXT[] DEFAULT '{}';

-- Add constraints (use DO block for IF NOT EXISTS logic)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'ck_applicant_sasapay_status'
    ) THEN
        ALTER TABLE customer_applicant_details
        ADD CONSTRAINT ck_applicant_sasapay_status CHECK (
            sasapay_submission_status IS NULL OR sasapay_submission_status IN (
                'awaiting_requirements', 'awaiting_documents', 'submitted_for_review',
                'approved_for_psp', 'rejected', 'awaiting_psp_result',
                'processing_psp_upload', 'psp_upload_failed', 'psp_approved', 'psp_rejected'
            )
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'ck_applicant_review_decision'
    ) THEN
        ALTER TABLE customer_applicant_details
        ADD CONSTRAINT ck_applicant_review_decision CHECK (
            review_decision IS NULL OR review_decision IN ('approved', 'rejected')
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'ck_applicant_required_documents'
    ) THEN
        ALTER TABLE customer_applicant_details
        ADD CONSTRAINT ck_applicant_required_documents CHECK (
            required_documents <@ ARRAY['document_front', 'document_back', 'selfie']::TEXT[]
            AND (CARDINALITY(required_documents) = 0 OR 'selfie' = ANY(required_documents))
        );
    END IF;
END $$;

-- Create indexes for SasaPay queries
CREATE INDEX IF NOT EXISTS idx_applicant_sasapay_request 
    ON customer_applicant_details(sasapay_request_id)
    WHERE sasapay_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_applicant_sasapay_status 
    ON customer_applicant_details(sasapay_submission_status, created_at DESC)
    WHERE sasapay_submission_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_applicant_review_status
    ON customer_applicant_details(review_status, created_at DESC)
    WHERE review_status IS NOT NULL;

-- ============================================================================
-- 4. Comments
-- ============================================================================

COMMENT ON COLUMN customer_applicant_details.policy_id IS 
    'Reference to document_policies - tracks which policy version was used for this submission';

COMMENT ON COLUMN customer_applicant_details.sasapay_submission_status IS 
    'SasaPay submission workflow status - only populated for application_type = ''sasapay_kyc''';

COMMENT ON COLUMN customer_applicant_details.sasapay_request_id IS 
    'SasaPay WaaS API request ID for tracking with provider';

COMMENT ON COLUMN customer_applicant_details.sasapay_callback_payload IS 
    'Latest callback payload from SasaPay (JSONB for easy querying)';

COMMENT ON COLUMN customer_applicant_details.review_status IS 
    'Internal compliance review status: pending, approved, rejected';

COMMENT ON COLUMN customer_applicant_details.images IS 
    'JSONB array of document images: [{type, url, filename, mime_type, file_size, uploaded_at}]. For SasaPay, stores document_front, document_back, selfie';

-- ============================================================================
-- Migration complete
-- ============================================================================

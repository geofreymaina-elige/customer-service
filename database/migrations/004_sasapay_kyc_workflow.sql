CREATE TABLE IF NOT EXISTS sasapay_kyc_document_policies (
    id BIGSERIAL PRIMARY KEY,
    document_type VARCHAR(50) NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    required_documents TEXT[] NOT NULL,
    accepted_mime_types TEXT[] NOT NULL,
    max_file_size_bytes INTEGER NOT NULL CHECK (max_file_size_bytes > 0),
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by VARCHAR(128),
    CONSTRAINT uq_sasapay_kyc_policy_version UNIQUE (document_type, version),
    CONSTRAINT ck_sasapay_kyc_policy_documents CHECK (
        required_documents <@ ARRAY['document_front', 'document_back', 'selfie']::TEXT[]
        AND (CARDINALITY(required_documents) = 0 OR 'selfie' = ANY(required_documents))
    ),
    CONSTRAINT ck_sasapay_kyc_policy_mime_types CHECK (
        CARDINALITY(accepted_mime_types) > 0
        AND accepted_mime_types <@ ARRAY['image/jpeg', 'image/png', 'image/webp']::TEXT[]
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sasapay_kyc_active_policy
    ON sasapay_kyc_document_policies(document_type)
    WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS sasapay_kyc_submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_application_id BIGINT NOT NULL REFERENCES customer_applications(id) ON DELETE CASCADE,
    customer_applicant_detail_id BIGINT REFERENCES customer_applicant_details(id) ON DELETE SET NULL,
    policy_id BIGINT REFERENCES sasapay_kyc_document_policies(id) ON DELETE RESTRICT,
    document_type VARCHAR(50) NOT NULL,
    policy_version INTEGER,
    status VARCHAR(32) NOT NULL DEFAULT 'awaiting_requirements',
    required_documents TEXT[] NOT NULL DEFAULT '{}',
    system_reason TEXT,
    customer_submitted_at TIMESTAMPTZ,
    internal_reviewed_at TIMESTAMPTZ,
    reviewed_by VARCHAR(128),
    review_decision VARCHAR(16),
    review_reason TEXT,
    sasapay_request_id VARCHAR(128),
    psp_submitted_at TIMESTAMPTZ,
    psp_result_at TIMESTAMPTZ,
    psp_status VARCHAR(32),
    psp_reason TEXT,
    latest_callback_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_sasapay_kyc_submission_status CHECK (
        status IN (
            'awaiting_requirements', 'awaiting_documents', 'submitted_for_review',
            'approved_for_psp', 'rejected', 'awaiting_psp_result',
            'processing_psp_upload', 'psp_upload_failed', 'psp_approved', 'psp_rejected'
        )
    ),
    CONSTRAINT ck_sasapay_kyc_review_decision CHECK (
        review_decision IS NULL OR review_decision IN ('approved', 'rejected')
    ),
    CONSTRAINT ck_sasapay_kyc_submission_documents CHECK (
        required_documents <@ ARRAY['document_front', 'document_back', 'selfie']::TEXT[]
        AND (CARDINALITY(required_documents) = 0 OR 'selfie' = ANY(required_documents))
    )
);

CREATE INDEX IF NOT EXISTS idx_sasapay_kyc_submissions_application
    ON sasapay_kyc_submissions(customer_application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sasapay_kyc_submissions_status
    ON sasapay_kyc_submissions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sasapay_kyc_submissions_request
    ON sasapay_kyc_submissions(sasapay_request_id)
    WHERE sasapay_request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sasapay_kyc_submission_images (
    id BIGSERIAL PRIMARY KEY,
    submission_id UUID NOT NULL REFERENCES sasapay_kyc_submissions(id) ON DELETE CASCADE,
    customer_application_id BIGINT NOT NULL REFERENCES customer_applications(id) ON DELETE CASCADE,
    document_type VARCHAR(24) NOT NULL,
    relative_path TEXT NOT NULL,
    mime_type VARCHAR(128) NOT NULL,
    file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes > 0),
    original_filename TEXT NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_sasapay_kyc_submission_image UNIQUE (submission_id, document_type),
    CONSTRAINT ck_sasapay_kyc_image_type CHECK (
        document_type IN ('document_front', 'document_back', 'selfie')
    )
);

CREATE INDEX IF NOT EXISTS idx_sasapay_kyc_images_application
    ON sasapay_kyc_submission_images(customer_application_id, submission_id);

CREATE TABLE IF NOT EXISTS sasapay_kyc_callback_receipts (
    id BIGSERIAL PRIMARY KEY,
    customer_application_id BIGINT NOT NULL REFERENCES customer_applications(id) ON DELETE CASCADE,
    submission_id UUID REFERENCES sasapay_kyc_submissions(id) ON DELETE SET NULL,
    payload_sha256 CHAR(64) NOT NULL UNIQUE,
    callback_status VARCHAR(32) NOT NULL,
    psp_reason TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sasapay_kyc_callback_application
    ON sasapay_kyc_callback_receipts(customer_application_id, received_at DESC);

COMMENT ON TABLE sasapay_kyc_document_policies IS
    'Versioned SasaPay document requirements; seed only after confirming requirements with SasaPay.';
COMMENT ON TABLE sasapay_kyc_submissions IS
    'Independent SasaPay KYC submission and review history; does not replace customer_applications.kyc_status.';
COMMENT ON TABLE sasapay_kyc_submission_images IS
    'Metadata and private local-file references for KYC images stored under uploads/images/<customer_applications.id>.';
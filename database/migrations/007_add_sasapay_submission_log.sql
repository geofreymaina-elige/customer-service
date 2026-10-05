-- ============================================================================
-- Migration 007: Add SasaPay KYC Submission Log Table
-- ============================================================================
-- Creates a dedicated audit/log table to track all SasaPay KYC submission
-- events and state changes over time. customer_applicant_details holds
-- CURRENT state, this table holds HISTORY.

CREATE TABLE IF NOT EXISTS sasapay_kyc_submission_log (
    id BIGSERIAL PRIMARY KEY,
    
    -- References
    customer_application_id BIGINT NOT NULL REFERENCES customer_applications(id) ON DELETE CASCADE,
    customer_applicant_detail_id BIGINT REFERENCES customer_applicant_details(id) ON DELETE SET NULL,
    policy_id BIGINT REFERENCES document_policies(id) ON DELETE SET NULL,
    
    -- Event metadata
    event_type VARCHAR(64) NOT NULL, -- 'created', 'documents_uploaded', 'submitted_for_review', 'admin_reviewed', 'psp_callback', etc.
    event_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    triggered_by VARCHAR(128), -- customer_id, admin_email, 'system', 'sasapay_callback'
    
    -- Document policy snapshot
    document_type VARCHAR(50),
    policy_version INTEGER,
    required_documents TEXT[],
    
    -- Workflow state at this event
    submission_status VARCHAR(32),
    
    -- SasaPay PSP tracking
    sasapay_request_id VARCHAR(128),
    sasapay_submitted_at TIMESTAMPTZ,
    sasapay_result_at TIMESTAMPTZ,
    sasapay_callback_payload JSONB,
    sasapay_psp_status VARCHAR(32),
    sasapay_psp_reason TEXT,
    
    -- Internal review tracking
    review_status VARCHAR(16),
    review_decision VARCHAR(16),
    reviewed_by VARCHAR(128),
    reviewed_at TIMESTAMPTZ,
    review_reason TEXT,
    
    -- Uploaded documents snapshot (JSONB array from customer_applicant_details.images)
    uploaded_documents JSONB,
    
    -- Additional metadata
    metadata JSONB DEFAULT '{}'::jsonb,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT ck_sasapay_log_event_type CHECK (
        event_type IN (
            'submission_created',
            'documents_uploaded', 
            'documents_updated',
            'submitted_for_review',
            'admin_approved',
            'admin_rejected',
            'queued_for_psp',
            'psp_upload_started',
            'psp_upload_failed',
            'psp_callback_received',
            'psp_approved',
            'psp_rejected'
        )
    ),
    
    CONSTRAINT ck_sasapay_log_submission_status CHECK (
        submission_status IS NULL OR submission_status IN (
            'awaiting_requirements', 'awaiting_documents', 'submitted_for_review',
            'approved_for_psp', 'rejected', 'awaiting_psp_result',
            'processing_psp_upload', 'psp_upload_failed', 'psp_approved', 'psp_rejected'
        )
    ),
    
    CONSTRAINT ck_sasapay_log_review_decision CHECK (
        review_decision IS NULL OR review_decision IN ('approved', 'rejected')
    )
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_sasapay_log_application 
    ON sasapay_kyc_submission_log(customer_application_id, event_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_sasapay_log_event_type 
    ON sasapay_kyc_submission_log(event_type, event_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_sasapay_log_request_id 
    ON sasapay_kyc_submission_log(sasapay_request_id)
    WHERE sasapay_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sasapay_log_status 
    ON sasapay_kyc_submission_log(submission_status, event_timestamp DESC)
    WHERE submission_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sasapay_log_timestamp 
    ON sasapay_kyc_submission_log(event_timestamp DESC);

-- Comments
COMMENT ON TABLE sasapay_kyc_submission_log IS
    'Audit log of all SasaPay KYC submission events and state changes. customer_applicant_details holds current state, this table holds full history.';

COMMENT ON COLUMN sasapay_kyc_submission_log.event_type IS
    'Type of event that triggered this log entry: submission_created, documents_uploaded, admin_approved, psp_callback_received, etc.';

COMMENT ON COLUMN sasapay_kyc_submission_log.triggered_by IS
    'Who/what triggered this event: customer_id, admin email, system, or sasapay_callback';

COMMENT ON COLUMN sasapay_kyc_submission_log.uploaded_documents IS
    'Snapshot of uploaded documents at the time of this event (from customer_applicant_details.images)';

COMMENT ON COLUMN sasapay_kyc_submission_log.sasapay_callback_payload IS
    'Full callback payload from SasaPay for audit purposes';

COMMENT ON COLUMN sasapay_kyc_submission_log.metadata IS
    'Additional event-specific metadata (error details, notes, etc.)';

-- ============================================================================
-- Migration complete
-- ============================================================================

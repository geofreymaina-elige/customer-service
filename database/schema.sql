-- ============================================================================
-- Customer Management Service - Database Schema
-- ============================================================================
-- Legacy schema snapshot retained for reference.
-- The canonical fresh-database schema is migrations/001_initial_schema.sql.
-- Do not use this snapshot to initialize a database.
--
-- Last updated: 2026-10-05
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- ENUMS
-- ============================================================================

CREATE TYPE gender_enum AS ENUM ('male', 'female', 'other');

-- ============================================================================
-- 1. CUSTOMERS & IDENTITY
-- ============================================================================

CREATE TABLE IF NOT EXISTS customers (
    id BIGSERIAL PRIMARY KEY,
    uuid UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    astpp_id INTEGER NOT NULL UNIQUE,
    phone_number VARCHAR(20) NOT NULL UNIQUE,
    email VARCHAR(255) UNIQUE,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    country_code CHAR(2) DEFAULT 'KE',
    account_type VARCHAR(32) DEFAULT 'prepaid',
    sync_version BIGINT,
    synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_customer_status CHECK (status IN ('active', 'suspended', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone_number);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_astpp_id ON customers(astpp_id);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
CREATE INDEX IF NOT EXISTS idx_customers_country_code ON customers(country_code);

COMMENT ON TABLE customers IS 'Customer master records synced from ASTPP accounts table';
COMMENT ON COLUMN customers.country_code IS 'ISO 3166-1 alpha-2 country code (e.g., KE for Kenya)';

-- ============================================================================
-- 2. CUSTOMER APPLICATIONS & KYC
-- ============================================================================

CREATE TABLE IF NOT EXISTS customer_applications (
    id BIGSERIAL PRIMARY KEY,
    uuid UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    astpp_id INTEGER NOT NULL,
    application_id INTEGER,
    application_number VARCHAR(50),
    kyc_status VARCHAR(32) NOT NULL DEFAULT 'not_submitted',
    kyc_tier VARCHAR(20),
    sasapay_request_id VARCHAR(128),
    sasapay_account_number VARCHAR(64),
    sasapay_account_status VARCHAR(32),
    submitted_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    rejected_at TIMESTAMPTZ,
    rejection_reason TEXT,
    sync_version BIGINT,
    synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_application_kyc_status CHECK (
        kyc_status IN (
            'not_submitted', 'kyc_submitted', 'kyc_approved', 'kyc_rejected',
            'kyc_pending_review', 'kyc_needs_resubmission'
        )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_applications_customer ON customer_applications(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_applications_astpp_id ON customer_applications(astpp_id);
CREATE INDEX IF NOT EXISTS idx_customer_applications_kyc_status ON customer_applications(kyc_status);
CREATE INDEX IF NOT EXISTS idx_customer_applications_sasapay_request ON customer_applications(sasapay_request_id) WHERE sasapay_request_id IS NOT NULL;

COMMENT ON TABLE customer_applications IS 'Customer wallet applications - one per customer, synced from ASTPP';

-- ============================================================================
-- 3. CUSTOMER APPLICANT DETAILS (KYC Documents)
-- ============================================================================

CREATE TABLE IF NOT EXISTS customer_applicant_details (
    id BIGSERIAL PRIMARY KEY,
    uuid UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    
    -- Link to application
    customer_application_id BIGINT NOT NULL REFERENCES customer_applications(id) ON DELETE CASCADE,
    customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    astpp_id INTEGER NOT NULL,
    
    -- Application type (identifies which KYC document set this is)
    application_type VARCHAR(20) NOT NULL DEFAULT 'primary_kyc',
    
    -- Personal Information
    name VARCHAR(100) NOT NULL,
    identity_document_type VARCHAR(50) NOT NULL DEFAULT 'NATIONAL_ID',
    identity_document_number VARCHAR(64) NOT NULL,
    issuing_country VARCHAR(3) DEFAULT 'KEN',
    date_of_birth DATE,
    gender gender_enum,
    nationality INTEGER,
    physical_address TEXT,
    
    -- Document URLs (file paths from ASTPP or local filesystem)
    passport_photo_url TEXT,
    doc_front_url TEXT,
    doc_back_url TEXT,
    
    -- Additional document images (JSONB array)
    images JSONB DEFAULT '[]'::jsonb,
    
    -- Policy reference (for SasaPay KYC)
    policy_id BIGINT REFERENCES document_policies(id) ON DELETE SET NULL,
    policy_version INTEGER,
    
    -- SasaPay submission tracking
    sasapay_submission_status VARCHAR(32) DEFAULT NULL,
    sasapay_request_id VARCHAR(128) DEFAULT NULL,
    sasapay_submitted_at TIMESTAMPTZ DEFAULT NULL,
    sasapay_result_at TIMESTAMPTZ DEFAULT NULL,
    sasapay_callback_payload JSONB DEFAULT NULL,
    sasapay_psp_status VARCHAR(32) DEFAULT NULL,
    sasapay_psp_reason TEXT DEFAULT NULL,
    
    -- Internal review tracking
    review_status VARCHAR(16) DEFAULT NULL,
    review_decision VARCHAR(16) DEFAULT NULL,
    reviewed_by VARCHAR(128) DEFAULT NULL,
    reviewed_at TIMESTAMPTZ DEFAULT NULL,
    review_reason TEXT DEFAULT NULL,
    
    -- Required documents tracking
    required_documents TEXT[] DEFAULT '{}',
    
    -- ASTPP metadata
    registration_type INTEGER,
    local_id_allowed BOOLEAN,
    employee_accountid INTEGER,
    
    -- CDC Sync tracking
    sync_version BIGINT,
    synced_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT ck_applicant_sasapay_status CHECK (
        sasapay_submission_status IS NULL OR sasapay_submission_status IN (
            'awaiting_requirements', 'awaiting_documents', 'submitted_for_review',
            'approved_for_psp', 'rejected', 'awaiting_psp_result',
            'processing_psp_upload', 'psp_upload_failed', 'psp_approved', 'psp_rejected'
        )
    ),
    
    CONSTRAINT ck_applicant_review_decision CHECK (
        review_decision IS NULL OR review_decision IN ('approved', 'rejected')
    ),
    
    CONSTRAINT ck_applicant_required_documents CHECK (
        required_documents <@ ARRAY['document_front', 'document_back', 'selfie']::TEXT[]
        AND (CARDINALITY(required_documents) = 0 OR 'selfie' = ANY(required_documents))
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_applicant_details_application_type ON customer_applicant_details(customer_application_id, application_type);
CREATE INDEX IF NOT EXISTS idx_applicant_details_customer_application ON customer_applicant_details(customer_application_id);
CREATE INDEX IF NOT EXISTS idx_applicant_details_customer ON customer_applicant_details(customer_id);
CREATE INDEX IF NOT EXISTS idx_applicant_details_astpp_id ON customer_applicant_details(astpp_id);
CREATE INDEX IF NOT EXISTS idx_applicant_details_doc_number ON customer_applicant_details(identity_document_number);
CREATE INDEX IF NOT EXISTS idx_applicant_sasapay_request ON customer_applicant_details(sasapay_request_id) WHERE sasapay_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_applicant_sasapay_status ON customer_applicant_details(sasapay_submission_status, created_at DESC) WHERE sasapay_submission_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_applicant_review_status ON customer_applicant_details(review_status, created_at DESC) WHERE review_status IS NOT NULL;

COMMENT ON TABLE customer_applicant_details IS 'KYC documents and identity details - multiple records per customer application (primary_kyc, wallet_kyc, sasapay_kyc)';
COMMENT ON COLUMN customer_applicant_details.application_type IS 'Type of KYC: primary_kyc = initial onboarding, wallet_kyc = secondary KYC, sasapay_kyc = SasaPay submission';
COMMENT ON COLUMN customer_applicant_details.images IS 'JSONB array of document images: [{type, url, filename, mime_type, file_size, uploaded_at}]. For SasaPay, stores document_front, document_back, selfie';
COMMENT ON COLUMN customer_applicant_details.sasapay_submission_status IS 'SasaPay submission workflow status - only populated for application_type = ''sasapay_kyc''';
COMMENT ON COLUMN customer_applicant_details.policy_id IS 'Reference to document_policies - tracks which policy version was used for this submission';

-- ============================================================================
-- 4. DOCUMENT POLICIES (formerly sasapay_kyc_document_policies)
-- ============================================================================

CREATE TABLE IF NOT EXISTS document_policies (
    id BIGSERIAL PRIMARY KEY,
    document_type VARCHAR(50) NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    required_documents TEXT[] NOT NULL,
    accepted_mime_types TEXT[] NOT NULL,
    max_file_size_bytes INTEGER NOT NULL CHECK (max_file_size_bytes > 0),
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by VARCHAR(128),
    CONSTRAINT uq_document_policy_version UNIQUE (document_type, version),
    CONSTRAINT ck_document_policy_documents CHECK (
        required_documents <@ ARRAY['document_front', 'document_back', 'selfie']::TEXT[]
        AND (CARDINALITY(required_documents) = 0 OR 'selfie' = ANY(required_documents))
    ),
    CONSTRAINT ck_document_policy_mime_types CHECK (
        CARDINALITY(accepted_mime_types) > 0
        AND accepted_mime_types <@ ARRAY['image/jpeg', 'image/png', 'image/webp']::TEXT[]
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_document_active_policy ON document_policies(document_type) WHERE is_active = TRUE;

COMMENT ON TABLE document_policies IS 'Versioned document requirements for KYC submissions (used for SasaPay and other providers)';

-- Seed default policies
INSERT INTO document_policies (
    document_type, version, required_documents, accepted_mime_types,
    max_file_size_bytes, is_active, created_by
) VALUES
    ('national_id', 1, ARRAY['document_front', 'document_back', 'selfie']::TEXT[],
     ARRAY['image/jpeg', 'image/png', 'image/webp']::TEXT[], 20971520, TRUE, 'system_seed'),
    ('passport', 1, ARRAY['document_front', 'document_back', 'selfie']::TEXT[],
     ARRAY['image/jpeg', 'image/png', 'image/webp']::TEXT[], 20971520, TRUE, 'system_seed'),
    ('alien_id', 1, ARRAY['document_front', 'document_back', 'selfie']::TEXT[],
     ARRAY['image/jpeg', 'image/png', 'image/webp']::TEXT[], 20971520, TRUE, 'system_seed')
ON CONFLICT (document_type, version) DO NOTHING;

-- ============================================================================
-- 5. SASAPAY KYC SUBMISSION LOG (Audit Trail)
-- ============================================================================

CREATE TABLE IF NOT EXISTS sasapay_kyc_submission_log (
    id BIGSERIAL PRIMARY KEY,
    
    -- References
    customer_application_id BIGINT NOT NULL REFERENCES customer_applications(id) ON DELETE CASCADE,
    customer_applicant_detail_id BIGINT REFERENCES customer_applicant_details(id) ON DELETE SET NULL,
    policy_id BIGINT REFERENCES document_policies(id) ON DELETE SET NULL,
    
    -- Event metadata
    event_type VARCHAR(64) NOT NULL,
    event_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    triggered_by VARCHAR(128),
    
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
    
    -- Uploaded documents snapshot
    uploaded_documents JSONB,
    
    -- Additional metadata
    metadata JSONB DEFAULT '{}'::jsonb,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT ck_sasapay_log_event_type CHECK (
        event_type IN (
            'submission_created', 'documents_uploaded', 'documents_updated',
            'submitted_for_review', 'admin_approved', 'admin_rejected',
            'queued_for_psp', 'psp_upload_started', 'psp_upload_failed',
            'psp_callback_received', 'psp_approved', 'psp_rejected'
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

CREATE INDEX IF NOT EXISTS idx_sasapay_log_application ON sasapay_kyc_submission_log(customer_application_id, event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_sasapay_log_event_type ON sasapay_kyc_submission_log(event_type, event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_sasapay_log_request_id ON sasapay_kyc_submission_log(sasapay_request_id) WHERE sasapay_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sasapay_log_status ON sasapay_kyc_submission_log(submission_status, event_timestamp DESC) WHERE submission_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sasapay_log_timestamp ON sasapay_kyc_submission_log(event_timestamp DESC);

COMMENT ON TABLE sasapay_kyc_submission_log IS 'Audit log of all SasaPay KYC submission events and state changes. customer_applicant_details holds current state, this table holds full history.';
COMMENT ON COLUMN sasapay_kyc_submission_log.event_type IS 'Type of event: submission_created, documents_uploaded, admin_approved, psp_callback_received, etc.';
COMMENT ON COLUMN sasapay_kyc_submission_log.triggered_by IS 'Who/what triggered this event: customer_id, admin email, system, or sasapay_callback';

-- ============================================================================
-- 6. SASAPAY KYC CALLBACK RECEIPTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS sasapay_kyc_callback_receipts (
    id BIGSERIAL PRIMARY KEY,
    customer_application_id BIGINT NOT NULL REFERENCES customer_applications(id) ON DELETE CASCADE,
    submission_id BIGINT REFERENCES customer_applicant_details(id) ON DELETE SET NULL,
    payload_sha256 CHAR(64) NOT NULL UNIQUE,
    callback_status VARCHAR(32) NOT NULL,
    psp_reason TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sasapay_kyc_callback_application ON sasapay_kyc_callback_receipts(customer_application_id, received_at DESC);

COMMENT ON TABLE sasapay_kyc_callback_receipts IS 'Deduplication and storage of SasaPay KYC callbacks';

-- ============================================================================
-- 7. SECURITY, PIN MANAGEMENT & ANTI-BRUTE-FORCE
-- ============================================================================

CREATE TABLE IF NOT EXISTS customer_pins (
    id BIGSERIAL PRIMARY KEY,
    customer_id BIGINT NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
    pin_hash VARCHAR(255) NOT NULL,
    failed_attempts INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    is_permanently_locked BOOLEAN NOT NULL DEFAULT FALSE,
    last_verified_at TIMESTAMPTZ,
    last_changed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_auth_attempts (
    id BIGSERIAL PRIMARY KEY,
    customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    attempt_type VARCHAR(32) NOT NULL,
    is_successful BOOLEAN NOT NULL,
    failure_reason VARCHAR(255),
    ip_address VARCHAR(45),
    user_agent TEXT,
    device_uuid UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_attempts_customer_time ON customer_auth_attempts(customer_id, created_at DESC);

-- ============================================================================
-- 8. DEVICE REGISTRATION
-- ============================================================================

CREATE TABLE IF NOT EXISTS customer_devices (
    id BIGSERIAL PRIMARY KEY,
    uuid UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    device_uuid_hash CHAR(64) NOT NULL,
    device_identifier VARCHAR(255) NOT NULL,
    device_model VARCHAR(100) NOT NULL,
    device_os VARCHAR(50) NOT NULL,
    mobile_type VARCHAR(20) NOT NULL CHECK (mobile_type IN ('android', 'ios')),
    app_version VARCHAR(20),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_seen_at TIMESTAMPTZ,
    registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deactivated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_active_device ON customer_devices(customer_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_customer_devices_customer ON customer_devices(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_devices_uuid_hash ON customer_devices(device_uuid_hash);

-- ============================================================================
-- 9. SESSIONS & AUTHENTICATION
-- ============================================================================

CREATE TABLE IF NOT EXISTS customer_sessions (
    id BIGSERIAL PRIMARY KEY,
    uuid UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    device_id BIGINT NOT NULL REFERENCES customer_devices(id) ON DELETE CASCADE,
    session_type VARCHAR(32) NOT NULL DEFAULT 'app',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at TIMESTAMPTZ NOT NULL,
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    revoke_reason VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_sessions_customer ON customer_sessions(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_device ON customer_sessions(device_id);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_active ON customer_sessions(customer_id, is_active) WHERE is_active = TRUE;

-- ============================================================================
-- 10. WALLETS
-- ============================================================================

CREATE TABLE IF NOT EXISTS customer_wallets (
    id BIGSERIAL PRIMARY KEY,
    uuid UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    customer_id BIGINT NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
    account_number VARCHAR(50) NOT NULL UNIQUE,
    currency VARCHAR(3) NOT NULL DEFAULT 'KES',
    status VARCHAR(20) NOT NULL DEFAULT 'pending_otp',
    is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    lock_reason TEXT,
    locked_at TIMESTAMPTZ,
    tier VARCHAR(20) DEFAULT 'TIER_1',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_wallet_status CHECK (status IN ('pending_otp', 'active', 'suspended', 'closed', 'inactive'))
);

CREATE INDEX IF NOT EXISTS idx_customer_wallets_customer ON customer_wallets(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_wallets_account_number ON customer_wallets(account_number);
CREATE INDEX IF NOT EXISTS idx_customer_wallets_status ON customer_wallets(status);

-- ============================================================================
-- 11. EVENTS & JOBS
-- ============================================================================

CREATE TABLE IF NOT EXISTS events (
    id BIGSERIAL PRIMARY KEY,
    uuid UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    event_type VARCHAR(64) NOT NULL,
    aggregate_type VARCHAR(64) NOT NULL,
    aggregate_id VARCHAR(128) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_type_time ON events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_aggregate ON events(aggregate_type, aggregate_id, created_at DESC);

CREATE TABLE IF NOT EXISTS jobs (
    id BIGSERIAL PRIMARY KEY,
    uuid UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    job_type VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 3,
    last_error TEXT,
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_job_status CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_available ON jobs(status, available_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_jobs_type_status ON jobs(job_type, status, created_at DESC);

-- ============================================================================
-- Schema Complete
-- ============================================================================

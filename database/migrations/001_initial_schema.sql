-- ============================================================================
-- Ambia Customer Management Service — PostgreSQL Schema Migration 001
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. CUSTOMERS & IDENTITIES
-- ============================================================================

DO $$ BEGIN
    CREATE TYPE customer_status_enum AS ENUM ('active', 'suspended', 'pending_verification', 'closed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE kyc_status_enum AS ENUM ('unverified', 'pending', 'requires_kyc_upload', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE doc_type_enum AS ENUM ('NATIONAL_ID', 'SERVICE_CARD', 'ALIEN_CARD', 'PASSPORT');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE gender_enum AS ENUM ('male', 'female', 'other');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS customers (
    id BIGSERIAL PRIMARY KEY,
    uuid UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    
    -- ASTPP Integration (CDC Sync)
    astpp_id INTEGER UNIQUE, -- From ASTPP accounts.id
    phone_number VARCHAR(32) NOT NULL UNIQUE, -- From ASTPP accounts.number (account_number and phone_number are same)
    country_id INTEGER, -- From ASTPP accounts.country_id
    country_code VARCHAR(10),
    currency_id INTEGER, -- From ASTPP accounts.currency_id
    account_type INTEGER, -- From ASTPP accounts.type
    
    -- Customer Details
    voip_number VARCHAR(32), -- Optional: for VoIP-specific routing if needed
    email VARCHAR(255),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    date_of_birth DATE,
    timezone VARCHAR(50) DEFAULT 'Africa/Nairobi',
    
    -- Status
    status customer_status_enum NOT NULL DEFAULT 'pending_verification',
    
    -- Soft Delete
    deleted_at TIMESTAMPTZ,
    
    -- CDC Sync Tracking
    sync_version BIGINT, -- For idempotency (from Kafka __source_ts_ms)
    synced_at TIMESTAMPTZ, -- Last sync timestamp
    astpp_created_at TIMESTAMPTZ, -- From ASTPP accounts.creation
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_astpp_id ON customers(astpp_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone_number);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
CREATE INDEX IF NOT EXISTS idx_customers_sync_version ON customers(sync_version);
CREATE INDEX IF NOT EXISTS idx_customers_deleted ON customers(deleted_at) WHERE deleted_at IS NULL;

COMMENT ON TABLE customers IS 'Core customer records - synced from ASTPP accounts table via Kafka CDC';
COMMENT ON COLUMN customers.astpp_id IS 'Primary key from ASTPP accounts.id - used for CDC sync';
COMMENT ON COLUMN customers.phone_number IS 'Customer phone number - same as ASTPP accounts.number (account_number and phone_number are identical in ASTPP)';
COMMENT ON COLUMN customers.sync_version IS 'Kafka event timestamp for idempotency - prevents out-of-order updates';

-- ============================================================================
-- 2. CUSTOMER APPLICATIONS (KYC Application Metadata)
-- Mirrors: ASTPP applications + wallet_kyc_applications tables
-- Handles: Single application record per customer
-- ============================================================================

CREATE TABLE IF NOT EXISTS customer_applications (
    id BIGSERIAL PRIMARY KEY,
    uuid UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    
    -- Link to customer
    customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    astpp_id INTEGER NOT NULL, -- Denormalized for convenience
    
    -- ASTPP references
    application_id INTEGER UNIQUE, -- From ASTPP applications.id (primary reference) - nullable for wallet KYC created before ASTPP registration
    application_number VARCHAR(64), -- From ASTPP applications.applicationid (can be null for wallet KYC)
    
    -- KYC Status
    kyc_status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    kyc_tier VARCHAR(20) NOT NULL DEFAULT 'TIER_1', -- TIER_0, TIER_1, TIER_2, TIER_3
    
    -- SasaPay WaaS Integration (for wallet onboarding)
    sasapay_request_id VARCHAR(128), -- From SasaPay personal onboarding API
    sasapay_account_number VARCHAR(64), -- SasaPay wallet account number
    sasapay_account_status VARCHAR(32), -- AWAITING_KYC_UPLOAD, ACTIVE, AWAITING_APPROVAL, etc.
    submitted_at TIMESTAMPTZ, -- When KYC was submitted
    
    -- Review tracking
    kyc_verified_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    rejected_at TIMESTAMPTZ,
    rejection_reason TEXT,
    system_notes TEXT,
    reviewer_notes TEXT,
    reviewed_by VARCHAR(64),
    reviewed_at TIMESTAMPTZ,
    
    -- CDC Sync tracking
    sync_version BIGINT,
    synced_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_applications_application_id ON customer_applications(application_id) WHERE application_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_applications_customer_id ON customer_applications(customer_id);
CREATE INDEX IF NOT EXISTS idx_applications_astpp_id ON customer_applications(astpp_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON customer_applications(kyc_status);
CREATE INDEX IF NOT EXISTS idx_applications_sasapay_account ON customer_applications(sasapay_account_number) WHERE sasapay_account_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_applications_sasapay_req ON customer_applications(sasapay_request_id) WHERE sasapay_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_applications_submitted ON customer_applications(submitted_at DESC) WHERE submitted_at IS NOT NULL;

COMMENT ON TABLE customer_applications IS 'KYC applications - one record per customer (merged from ASTPP applications and wallet_kyc_applications)';
COMMENT ON COLUMN customer_applications.application_id IS 'Primary reference to ASTPP applications.id';
COMMENT ON COLUMN customer_applications.sasapay_request_id IS 'SasaPay personal onboarding request ID';
COMMENT ON COLUMN customer_applications.sasapay_account_number IS 'SasaPay wallet account number after successful onboarding';

-- ============================================================================
-- 3. DOCUMENT POLICIES
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

CREATE UNIQUE INDEX IF NOT EXISTS uq_document_active_policy
    ON document_policies(document_type)
    WHERE is_active = TRUE;

COMMENT ON TABLE document_policies IS
    'Versioned document requirements for KYC submissions (used for SasaPay and other providers)';

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
-- 3. CUSTOMER APPLICANT DETAILS (KYC Documents & Identity Info)
-- Mirrors: ASTPP applicant_details + wallet_application_images tables
-- Handles: Multiple document sets per customer (primary_kyc, wallet_kyc, etc.)
-- ============================================================================

CREATE TABLE IF NOT EXISTS customer_applicant_details (
    id BIGSERIAL PRIMARY KEY,
    uuid UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    
    -- Link to application
    customer_application_id BIGINT NOT NULL REFERENCES customer_applications(id) ON DELETE CASCADE,
    customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    astpp_id INTEGER NOT NULL,
    
    -- Application type (identifies which KYC document set this is)
    application_type VARCHAR(20) NOT NULL DEFAULT 'primary_kyc', -- 'primary_kyc', 'wallet_kyc', or 'sasapay_kyc'
    
    -- Personal Information
    name VARCHAR(100) NOT NULL, -- Full name from ASTPP
    identity_document_type VARCHAR(50) NOT NULL DEFAULT 'NATIONAL_ID', -- From ASTPP (stored as integer, but we convert to string)
    identity_document_number VARCHAR(64) NOT NULL,
    issuing_country VARCHAR(3) DEFAULT 'KEN',
    date_of_birth DATE,
    gender gender_enum,
    nationality INTEGER, -- Country ID from ASTPP
    physical_address TEXT,
    
    -- Document URLs (S3 paths or file references from ASTPP)
    passport_photo_url TEXT, -- From ASTPP applicant_details.id_verification OR wallet_application_images
    doc_front_url TEXT, -- From ASTPP applicant_details.identity_document
    doc_back_url TEXT, -- From ASTPP applicant_details.identity_document_back
    
    -- Additional document images (for wallet KYC from wallet_application_images table)
    -- JSONB array: [{image_id, filename, original_name, image_type, file_size, mime_type, description, uploaded_at}]
    images JSONB DEFAULT '[]'::jsonb,
    
    -- SasaPay submission policy and current workflow state
    policy_id BIGINT REFERENCES document_policies(id) ON DELETE SET NULL,
    policy_version INTEGER,
    sasapay_submission_status VARCHAR(32),
    sasapay_request_id VARCHAR(128),
    sasapay_submitted_at TIMESTAMPTZ,
    sasapay_result_at TIMESTAMPTZ,
    sasapay_callback_payload JSONB,
    sasapay_psp_status VARCHAR(32),
    sasapay_psp_reason TEXT,
    review_status VARCHAR(16),
    review_decision VARCHAR(16),
    reviewed_by VARCHAR(128),
    reviewed_at TIMESTAMPTZ,
    review_reason TEXT,
    required_documents TEXT[] DEFAULT '{}',

    -- ASTPP metadata
    registration_type INTEGER, -- From ASTPP applicant_details.registration_type
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
CREATE INDEX IF NOT EXISTS idx_applicant_sasapay_request
    ON customer_applicant_details(sasapay_request_id)
    WHERE sasapay_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_applicant_sasapay_status
    ON customer_applicant_details(sasapay_submission_status, created_at DESC)
    WHERE sasapay_submission_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_applicant_review_status
    ON customer_applicant_details(review_status, created_at DESC)
    WHERE review_status IS NOT NULL;

COMMENT ON TABLE customer_applicant_details IS 'KYC documents and identity details - multiple records per customer application (primary_kyc, wallet_kyc, etc.)';
COMMENT ON COLUMN customer_applicant_details.customer_application_id IS 'References customer_applications.id (not ASTPP application_id)';
COMMENT ON COLUMN customer_applicant_details.application_type IS 'Type of KYC: primary_kyc = initial onboarding, wallet_kyc = secondary KYC, sasapay_kyc = SasaPay submission';
COMMENT ON COLUMN customer_applicant_details.images IS 'JSONB array of document images. SasaPay submissions store document_front, document_back, and selfie here.';
COMMENT ON COLUMN customer_applicant_details.identity_document_type IS 'Document type as string (ASTPP stores as integer: 0=NATIONAL_ID, 1=PASSPORT, etc.)';
COMMENT ON COLUMN customer_applicant_details.sasapay_submission_status IS 'SasaPay submission workflow status - only populated for application_type = ''sasapay_kyc''';
COMMENT ON COLUMN customer_applicant_details.policy_id IS 'Reference to document_policies - tracks which policy version was used for this submission';

-- ============================================================================
-- 4. SASAPAY KYC SUBMISSION LOG (Audit Trail)
-- ============================================================================

CREATE TABLE IF NOT EXISTS sasapay_kyc_submission_log (
    id BIGSERIAL PRIMARY KEY,
    customer_application_id BIGINT NOT NULL REFERENCES customer_applications(id) ON DELETE CASCADE,
    customer_applicant_detail_id BIGINT REFERENCES customer_applicant_details(id) ON DELETE SET NULL,
    policy_id BIGINT REFERENCES document_policies(id) ON DELETE SET NULL,
    event_type VARCHAR(64) NOT NULL,
    event_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    triggered_by VARCHAR(128),
    document_type VARCHAR(50),
    policy_version INTEGER,
    required_documents TEXT[],
    submission_status VARCHAR(32),
    sasapay_request_id VARCHAR(128),
    sasapay_submitted_at TIMESTAMPTZ,
    sasapay_result_at TIMESTAMPTZ,
    sasapay_callback_payload JSONB,
    sasapay_psp_status VARCHAR(32),
    sasapay_psp_reason TEXT,
    review_status VARCHAR(16),
    review_decision VARCHAR(16),
    reviewed_by VARCHAR(128),
    reviewed_at TIMESTAMPTZ,
    review_reason TEXT,
    uploaded_documents JSONB,
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

COMMENT ON TABLE sasapay_kyc_submission_log IS
    'Audit log of SasaPay KYC submission events and state changes; current state is held in customer_applicant_details';
COMMENT ON COLUMN sasapay_kyc_submission_log.event_type IS
    'Type of event that triggered this log entry';
COMMENT ON COLUMN sasapay_kyc_submission_log.triggered_by IS
    'Who or what triggered this event: customer, admin, system, or SasaPay callback';

-- ============================================================================
-- 2. SECURITY, PIN MANAGEMENT & ANTI-BRUTE-FORCE LOCKOUT
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
    attempt_type VARCHAR(32) NOT NULL, -- 'PIN_VERIFY', 'PIN_CHANGE', 'OTP_VERIFY', 'LOGIN'
    is_successful BOOLEAN NOT NULL,
    failure_reason VARCHAR(255),
    ip_address VARCHAR(45),
    user_agent TEXT,
    device_uuid UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_attempts_customer_time ON customer_auth_attempts(customer_id, created_at DESC);

-- ============================================================================
-- 3. DEVICE REGISTRATION & STRICT SINGLE-ACTIVE-DEVICE ENFORCEMENT
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
    app_version VARCHAR(32) NOT NULL,
    callkit_token TEXT,
    apns_token TEXT,
    fcm_token TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'revoked')),
    ip_address VARCHAR(45),
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Conditional unique index to enforce that only ONE device can be active per customer
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_single_active_device 
ON customer_devices(customer_id) 
WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_devices_lookup ON customer_devices(customer_id, device_uuid_hash);

-- ============================================================================
-- 4. STATEFUL OTP & RECOVERY SESSIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS customer_otp_codes (
    id BIGSERIAL PRIMARY KEY,
    customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    otp_hash VARCHAR(255) NOT NULL,
    purpose VARCHAR(32) NOT NULL, -- 'PIN_RESET', 'DEVICE_LOGOUT', 'KYC_VERIFICATION'
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 3,
    is_used BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_otp_active ON customer_otp_codes(customer_id, purpose) WHERE is_used = FALSE;

CREATE TABLE IF NOT EXISTS customer_pin_reset_sessions (
    id BIGSERIAL PRIMARY KEY,
    uuid UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    session_token_hash CHAR(64) NOT NULL UNIQUE,
    customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    state VARCHAR(32) NOT NULL DEFAULT 'id_verified', -- 'id_verified', 'otp_sent', 'otp_verified', 'completed'
    resend_count INT NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    invalidated_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_device_logout_sessions (
    id BIGSERIAL PRIMARY KEY,
    uuid UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    session_token_hash CHAR(64) NOT NULL UNIQUE,
    customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    state VARCHAR(32) NOT NULL DEFAULT 'id_verified', -- 'id_verified', 'otp_sent', 'otp_verified', 'completed'
    resend_count INT NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    invalidated_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 4. ACCOUNT / WALLET STATUS & LOCK CONTROLS
-- ============================================================================

CREATE TABLE IF NOT EXISTS customer_wallets (
    id BIGSERIAL PRIMARY KEY,
    uuid UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    astpp_id INTEGER, -- Link to ASTPP for sync tracking
    account_number VARCHAR(32) NOT NULL UNIQUE,
    currency CHAR(3) NOT NULL DEFAULT 'KES',
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CONSTRAINT customer_wallets_status_check
        CHECK (status IN ('active', 'inactive', 'frozen', 'locked', 'closed')),
    is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    lock_reason TEXT,
    locked_by VARCHAR(64), -- 'CUSTOMER_SELF_LOCK', 'ADMIN:operator_id', 'SYSTEM_SECURITY', 'SYSTEM_CDC'
    locked_at TIMESTAMPTZ,
    freeze_type VARCHAR(32), -- 'customer_initiated', 'admin_compliance', 'suspicious_activity'
    tier_level VARCHAR(20) NOT NULL DEFAULT 'TIER_1',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
 
CREATE INDEX IF NOT EXISTS idx_wallets_customer ON customer_wallets(customer_id);
CREATE INDEX IF NOT EXISTS idx_wallets_astpp_id ON customer_wallets(astpp_id);
CREATE INDEX IF NOT EXISTS idx_wallets_status ON customer_wallets(status);
 
COMMENT ON TABLE customer_wallets IS 'Customer wallet accounts - linked to ASTPP for balance sync';
COMMENT ON COLUMN customer_wallets.astpp_id IS 'Link to ASTPP accounts.id for sync tracking';
COMMENT ON COLUMN customer_wallets.status IS 'active | inactive (set by CDC when ASTPP account is deleted) | frozen | locked | closed';
 

-- ============================================================================
-- 5. CUSTOMER AUDIT TRAIL & LIFECYCLE LOGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS customer_activity_logs (
    id BIGSERIAL PRIMARY KEY,
    uuid UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    event_type VARCHAR(64) NOT NULL, -- 'PIN_SET', 'PIN_CHANGED', 'DEVICE_BOUND', 'WALLET_LOCKED', 'KYC_APPROVED', etc.
    actor_type VARCHAR(32) NOT NULL DEFAULT 'CUSTOMER', -- 'CUSTOMER', 'ADMIN', 'SYSTEM'
    actor_id VARCHAR(64),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_customer ON customer_activity_logs(customer_id, created_at DESC);

-- ============================================================================
-- 6. DURABLE JOBS, OUTBOX EVENTS & IDEMPOTENCY
-- ============================================================================

CREATE TABLE IF NOT EXISTS jobs (
    id BIGSERIAL PRIMARY KEY,
    uuid UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    job_type VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 3,
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_at TIMESTAMPTZ,
    locked_by VARCHAR(128),
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_jobs_pending ON jobs(status, available_at) WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS events (
    id BIGSERIAL PRIMARY KEY,
    uuid UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    event_type VARCHAR(128) NOT NULL,
    aggregate_type VARCHAR(64) NOT NULL,
    aggregate_id VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_processing (
    id BIGSERIAL PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    handler_name VARCHAR(128) NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_event_handler UNIQUE (event_id, handler_name)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
    id BIGSERIAL PRIMARY KEY,
    key VARCHAR(128) NOT NULL UNIQUE,
    request_path VARCHAR(255) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    response_code INT,
    response_body JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

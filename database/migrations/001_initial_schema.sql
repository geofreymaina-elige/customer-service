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
    currency_id INTEGER, -- From ASTPP accounts.currency_id
    customer_type INTEGER, -- From ASTPP accounts.customer_type
    account_status INTEGER, -- From ASTPP accounts.status
    account_type INTEGER, -- From ASTPP accounts.type
    
    -- Customer Details
    voip_number VARCHAR(32), -- Optional: for VoIP-specific routing if needed
    email VARCHAR(255),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    gender VARCHAR(20),
    date_of_birth DATE,
    timezone VARCHAR(50) DEFAULT 'Africa/Nairobi',
    
    -- Status & Wallet
    status customer_status_enum NOT NULL DEFAULT 'pending_verification',
    has_wallet BOOLEAN NOT NULL DEFAULT FALSE,
    
    -- Wallet KYC (Secondary KYC for wallet activation)
    wallet_kyc_status VARCHAR(20), -- 'pending', 'approved', 'rejected', null (null = not required)
    wallet_kyc_required BOOLEAN NOT NULL DEFAULT FALSE, -- Flag if secondary KYC needed
    wallet_kyc_flagged_at TIMESTAMPTZ,
    
    -- Soft Delete
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at TIMESTAMPTZ,
    
    -- CDC Sync Tracking
    sync_version BIGINT, -- For idempotency (from Kafka __source_ts_ms)
    synced_at TIMESTAMPTZ, -- Last sync timestamp
    astpp_created_at TIMESTAMPTZ, -- From ASTPP accounts.creation
    
    -- Metadata (flexible storage for additional ASTPP data)
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_astpp_id ON customers(astpp_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone_number);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
CREATE INDEX IF NOT EXISTS idx_customers_wallet_kyc_status ON customers(wallet_kyc_status);
CREATE INDEX IF NOT EXISTS idx_customers_sync_version ON customers(sync_version);
CREATE INDEX IF NOT EXISTS idx_customers_deleted ON customers(deleted) WHERE deleted = FALSE;

COMMENT ON TABLE customers IS 'Core customer records - synced from ASTPP accounts table via Kafka CDC';
COMMENT ON COLUMN customers.astpp_id IS 'Primary key from ASTPP accounts.id - used for CDC sync';
COMMENT ON COLUMN customers.phone_number IS 'Customer phone number - same as ASTPP accounts.number (account_number and phone_number are identical in ASTPP)';
COMMENT ON COLUMN customers.wallet_kyc_status IS 'Secondary wallet KYC status - null means not required, pending/approved/rejected for flagged customers';
COMMENT ON COLUMN customers.sync_version IS 'Kafka event timestamp for idempotency - prevents out-of-order updates';

-- ============================================================================
-- 2. CUSTOMER APPLICATIONS (KYC Application Metadata)
-- Mirrors: ASTPP applications + wallet_kyc_applications tables
-- Handles: Both primary KYC (onboarding) and secondary wallet KYC
-- ============================================================================

CREATE TABLE IF NOT EXISTS customer_applications (
    id BIGSERIAL PRIMARY KEY,
    uuid UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    
    -- Link to customer
    customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    astpp_id INTEGER NOT NULL, -- Denormalized for convenience
    
    -- ASTPP references
    application_id INTEGER NOT NULL UNIQUE, -- From ASTPP applications.id OR wallet_kyc_applications.id
    application_number VARCHAR(64), -- From ASTPP applications.applicationid (can be null for wallet KYC)
    
    -- Application type (distinguishes primary vs secondary KYC)
    application_type VARCHAR(20) NOT NULL DEFAULT 'primary_kyc', -- 'primary_kyc' or 'wallet_kyc'
    
    -- KYC Status
    kyc_status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    kyc_tier VARCHAR(20) NOT NULL DEFAULT 'TIER_1', -- TIER_0, TIER_1, TIER_2, TIER_3
    
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

CREATE UNIQUE INDEX IF NOT EXISTS uq_applications_application_id ON customer_applications(application_id);
CREATE INDEX IF NOT EXISTS idx_applications_customer ON customer_applications(customer_id);
CREATE INDEX IF NOT EXISTS idx_applications_astpp_id ON customer_applications(astpp_id);
CREATE INDEX IF NOT EXISTS idx_applications_type ON customer_applications(application_type);
CREATE INDEX IF NOT EXISTS idx_applications_status ON customer_applications(kyc_status);
CREATE INDEX IF NOT EXISTS idx_applications_type_status ON customer_applications(application_type, kyc_status);

COMMENT ON TABLE customer_applications IS 'KYC applications - handles both primary KYC (ASTPP applications) and secondary wallet KYC (ASTPP wallet_kyc_applications)';
COMMENT ON COLUMN customer_applications.application_type IS 'primary_kyc = initial onboarding, wallet_kyc = secondary KYC for wallet activation';

-- ============================================================================
-- 3. CUSTOMER APPLICANT DETAILS (KYC Documents & Identity Info)
-- Mirrors: ASTPP applicant_details + wallet_application_images tables
-- Handles: Documents for both primary and wallet KYC
-- ============================================================================

CREATE TABLE IF NOT EXISTS customer_applicant_details (
    id BIGSERIAL PRIMARY KEY,
    uuid UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    
    -- Link to application
    application_id INTEGER NOT NULL REFERENCES customer_applications(application_id) ON DELETE CASCADE,
    customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    astpp_id INTEGER NOT NULL,
    
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
    
    -- ASTPP metadata
    registration_type INTEGER, -- From ASTPP applicant_details.registration_type
    local_id_allowed BOOLEAN,
    employee_accountid INTEGER,
    
    -- CDC Sync tracking
    sync_version BIGINT,
    synced_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_applicant_details_application_id ON customer_applicant_details(application_id);
CREATE INDEX IF NOT EXISTS idx_applicant_details_customer ON customer_applicant_details(customer_id);
CREATE INDEX IF NOT EXISTS idx_applicant_details_astpp_id ON customer_applicant_details(astpp_id);
CREATE INDEX IF NOT EXISTS idx_applicant_details_doc_number ON customer_applicant_details(identity_document_number);

COMMENT ON TABLE customer_applicant_details IS 'KYC documents and identity details - linked to customer_applications (handles both primary and wallet KYC documents)';
COMMENT ON COLUMN customer_applicant_details.images IS 'JSONB array of additional document images from ASTPP wallet_application_images table';
COMMENT ON COLUMN customer_applicant_details.identity_document_type IS 'Document type as string (ASTPP stores as integer: 0=NATIONAL_ID, 1=PASSPORT, etc.)';

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
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'locked', 'closed')),
    is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    lock_reason TEXT,
    locked_by VARCHAR(64), -- 'CUSTOMER_SELF_LOCK', 'ADMIN:operator_id', 'SYSTEM_SECURITY'
    locked_at TIMESTAMPTZ,
    freeze_type VARCHAR(32), -- 'customer_initiated', 'admin_compliance', 'suspicious_activity'
    tier_level VARCHAR(20) NOT NULL DEFAULT 'TIER_1',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallets_customer ON customer_wallets(customer_id);
CREATE INDEX IF NOT EXISTS idx_wallets_astpp_id ON customer_wallets(astpp_id);
CREATE INDEX IF NOT EXISTS idx_wallets_status ON customer_wallets(status);

COMMENT ON TABLE customer_wallets IS 'Customer wallet accounts - linked to ASTPP for balance sync';
COMMENT ON COLUMN customer_wallets.astpp_id IS 'Link to ASTPP accounts.id for sync tracking';

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
    max_attempts INT NOT NULL DEFAULT 5,
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

-- ============================================================================
-- 002_add_sasapay_wallet_columns.sql
-- Add SasaPay WaaS tracking fields and make application_id nullable for
-- wallet KYC applications created prior to ASTPP registration.
-- ============================================================================

-- 1. Add SasaPay tracking columns to customer_applications
ALTER TABLE customer_applications 
    ADD COLUMN IF NOT EXISTS sasapay_request_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS sasapay_account_number VARCHAR(64),
    ADD COLUMN IF NOT EXISTS sasapay_account_status VARCHAR(32),
    ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;

-- 2. Make application_id nullable for WaaS self-initiated applications
ALTER TABLE customer_applications 
    ALTER COLUMN application_id DROP NOT NULL;

-- 3. Add unique constraint on (customer_id, application_type) so ON CONFLICT works cleanly
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_customer_application_type'
    ) THEN
        ALTER TABLE customer_applications 
            ADD CONSTRAINT uq_customer_application_type UNIQUE (customer_id, application_type);
    END IF;
END $$;

-- 4. Helpful indices
CREATE INDEX IF NOT EXISTS idx_applications_sasapay_req ON customer_applications(sasapay_request_id);
CREATE INDEX IF NOT EXISTS idx_applications_submitted ON customer_applications(submitted_at DESC);

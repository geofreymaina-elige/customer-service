-- ============================================================================
-- Migration 003: Ensure country_code column on customers
-- ============================================================================
-- country_code stores the ISO 2-letter code (e.g. 'KE', 'US') looked up from
-- the ASTPP countrycode table using accounts.country_id.
-- The column is defined in the initial schema DDL; this migration is an
-- idempotent guard for databases created from an older snapshot.
-- ============================================================================

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS country_code VARCHAR(10);


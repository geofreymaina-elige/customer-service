# Database Schema Documentation

## Overview

This directory contains the complete database schema for the Customer Management Service.

## Files

### `schema.sql`
**Single consolidated schema file** representing the current state of the database. This file merges all migrations (001-007) into one comprehensive schema definition.

**Use this file when**:
- Setting up a fresh database
- Creating test/staging environments
- Documenting the complete database structure
- Onboarding new developers

### `migrations/` directory
**Historical migration files** (001-007) showing how the schema evolved over time.

**Use these when**:
- Understanding schema evolution
- Debugging migration-related issues
- Reference for creating new migrations

### Migration Files (Historical Reference)
- `001_initial_schema.sql` - Base schema (customers, applications, wallets, devices, etc.)
- `002_allow_inactive_wallet_status.sql` - Added 'inactive' wallet status
- `003_add_country_code_to_customers.sql` - Added country_code column
- `004_sasapay_kyc_workflow.sql` - Created original SasaPay tables (now superseded)
- `005_seed_document_policies.sql` - Seeded document policies
- `006_simplify_sasapay_to_applicant_details.sql` - Simplified SasaPay schema
- `007_add_sasapay_submission_log.sql` - Added audit log table

## Quick Start

### Option 1: Fresh Database Setup (Recommended)

For a new database, use the consolidated schema:

```bash
# Create database
createdb ambia_pay

# Apply schema
psql -U postgres -d ambia_pay -f database/schema.sql
```

### Option 2: Using Migrations (Existing Databases)

For databases that need to be migrated:

```bash
# Run all migrations
npm run migrate

# Or run a specific migration
npx ts-node database/run-007.ts
```

## Schema Overview

### Core Tables

#### Customers & Identity
- `customers` - Customer master records
- `customer_applications` - Wallet applications
- `customer_applicant_details` - KYC documents (primary, wallet, sasapay)

#### Document Policies & Audit
- `document_policies` - KYC document requirements
- `sasapay_kyc_submission_log` - **Audit log** of all SasaPay KYC events
- `sasapay_kyc_callback_receipts` - SasaPay callback deduplication

#### Security & Authentication
- `customer_pins` - PIN hashes and lockout status
- `customer_auth_attempts` - Authentication audit trail
- `customer_devices` - Registered devices
- `customer_sessions` - Active sessions

#### Wallets
- `customer_wallets` - Wallet accounts

#### System
- `events` - Domain events
- `jobs` - Background job queue

## KYC Implementation

### Two-Table Architecture

The SasaPay KYC implementation uses a **two-table design**:

#### 1. `customer_applicant_details` (Current State)
- Stores **current** KYC submission state
- Uses `application_type` to distinguish:
  - `'primary_kyc'` - Initial onboarding KYC
  - `'wallet_kyc'` - Secondary wallet KYC
  - `'sasapay_kyc'` - SasaPay submission
- Images stored in JSONB `images` field
- Fast queries for current status

#### 2. `sasapay_kyc_submission_log` (History/Audit)
- **Immutable event log** - append-only
- Complete audit trail for compliance
- Tracks all state changes with timestamps
- Records who triggered each action
- Stores document snapshots at each event

### Example Queries

#### Get customer's current KYC status
```sql
SELECT 
    application_type,
    sasapay_submission_status,
    review_status,
    images
FROM customer_applicant_details
WHERE customer_id = 6516
  AND application_type = 'sasapay_kyc';
```

#### Get full submission history
```sql
SELECT 
    event_type,
    event_timestamp,
    triggered_by,
    submission_status,
    review_decision,
    metadata
FROM sasapay_kyc_submission_log
WHERE customer_application_id = 4652
ORDER BY event_timestamp DESC;
```

#### Get prioritized KYC (sasapay > wallet > primary)
```sql
SELECT 
    ca.id,
    CASE 
        WHEN sasapay.id IS NOT NULL THEN 'sasapay_kyc'
        WHEN wallet.id IS NOT NULL THEN 'wallet_kyc'
        WHEN primary_kyc.id IS NOT NULL THEN 'primary_kyc'
        ELSE NULL
    END AS kyc_source,
    COALESCE(sasapay.images, wallet.images, primary_kyc.images) AS images
FROM customer_applications ca
LEFT JOIN customer_applicant_details sasapay
    ON sasapay.customer_application_id = ca.id 
    AND sasapay.application_type = 'sasapay_kyc'
LEFT JOIN customer_applicant_details wallet
    ON wallet.customer_application_id = ca.id 
    AND wallet.application_type = 'wallet_kyc'
LEFT JOIN customer_applicant_details primary_kyc
    ON primary_kyc.customer_application_id = ca.id 
    AND primary_kyc.application_type = 'primary_kyc'
WHERE ca.customer_id = 6516;
```

## Document Policies

Three document types are seeded by default:
- `national_id` - Kenya National ID
- `passport` - International Passport
- `alien_id` - Alien ID Card

Each requires: `document_front`, `document_back`, `selfie`  
Max file size: 20MB  
Accepted formats: JPEG, PNG, WebP

## Environment Variables

Required for database connection:

```env
DATABASE_HOST=196.251.146.233
DATABASE_PORT=5432
DATABASE_NAME=ambia_pay
DATABASE_USER=dist_user
DATABASE_PASSWORD=your_password_here
DATABASE_SSL=false
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=20
```

## Maintenance

### Backup
```bash
pg_dump -U postgres -d ambia_pay -F c -f backup_$(date +%Y%m%d).dump
```

### Restore
```bash
pg_restore -U postgres -d ambia_pay -c backup_20261005.dump
```

### Verify Schema
```bash
psql -U postgres -d ambia_pay -c "\dt"  # List tables
psql -U postgres -d ambia_pay -c "\d+ customer_applicant_details"  # Describe table
```

## Development Notes

### Creating New Migrations

When adding new migrations, update both:
1. Create `migrations/008_your_migration.sql`
2. Update `database/schema.sql` to reflect the final state

### Migration Best Practices
- Use `IF NOT EXISTS` for all CREATE statements
- Add comments explaining purpose
- Include rollback instructions in comments
- Test on staging before production

## Support

For issues or questions:
- Check migration logs: `npm run migrate`
- Review `schema.sql` for current structure
- Examine `sasapay_kyc_submission_log` for audit trail

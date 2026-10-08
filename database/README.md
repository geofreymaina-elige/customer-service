# Database Schema Documentation

## Overview

This directory contains the complete database schema for the Customer Management Service.

## Files

### `migrations/001_initial_schema.sql`
The single canonical schema for a new database. It includes the current customer, wallet,
device, jobs, document-policy, and SasaPay KYC audit structures. It intentionally excludes
the retired `sasapay_kyc_submissions` and `sasapay_kyc_submission_images` tables.

Apply this file to a **new, empty database**. It is not an upgrade script for an existing
database because `CREATE TABLE IF NOT EXISTS` will not add missing columns to tables that
already exist.

### `migrations/002_customer_balance_audit.sql`
Upgrade migration that adds the append-only `customer_balance_audit` table. Apply it after
`001_initial_schema.sql` on new databases and to existing databases before deploying the
application version that writes balance audit records.

## Quick Start

### Fresh Database Setup

```bash
# Create database
createdb ambia_pay

# Apply the canonical initial schema
psql -U postgres -d ambia_pay -f database/migrations/001_initial_schema.sql

# Apply incremental balance audit schema
psql -U postgres -d ambia_pay -f database/migrations/002_customer_balance_audit.sql
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
- `customer_balance_audit` - **Append-only audit log** of balance lookups and returned values

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

The migration directory is intentionally kept to the single initial schema. If the project
later adopts incremental migrations, document that workflow separately and preserve this file
as the fresh-database baseline.

## Support

For issues or questions, review `migrations/001_initial_schema.sql` for the fresh-database
structure and `sasapay_kyc_submission_log` for the SasaPay KYC audit trail.

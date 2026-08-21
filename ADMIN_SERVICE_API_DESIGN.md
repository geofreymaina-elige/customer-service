# Admin Service API Design Document
**Customer Management Microservice - Administrative Operations**

---

## Overview

The Admin Service is a separate microservice that shares the same PostgreSQL database with the Customer Service microservice. It provides comprehensive administrative and backoffice operations for customer management, security controls, and system configuration.

**Shared Database:** Both services read/write to the same `customer_management` PostgreSQL database.

**Security Model:**
- Admin Service: Internal network only, OAuth2/API key authentication, role-based access control
- Customer Service: Public-facing, JWT-based customer authentication
- Customer Service reacts to changes made by Admin Service (e.g., locked accounts block authentication)

---

## 1. Customer Management APIs

### 1.1 Customer Search & Listing
**Endpoint:** `GET /admin/api/v1/customers`

**Query Parameters:**
- `search` - Search across phone_number, email, first_name, last_name, astpp_id
- `status` - Filter by customer status (active, suspended, pending_verification, closed)
- `wallet_kyc_status` - Filter by wallet KYC status (pending, approved, rejected, null)
- `has_wallet` - Filter by wallet existence (true/false)
- `created_after` - Date range filter
- `created_before` - Date range filter
- `page` - Pagination
- `limit` - Results per page (max 100)

**Database Query:**
```sql
SELECT 
  id, uuid, astpp_id, phone_number, email, 
  first_name, last_name, status, has_wallet, 
  wallet_kyc_status, created_at, updated_at
FROM customers
WHERE deleted = FALSE
  AND ($search IS NULL OR 
       phone_number ILIKE $search OR 
       email ILIKE $search OR 
       first_name ILIKE $search OR 
       last_name ILIKE $search OR
       CAST(astpp_id AS TEXT) ILIKE $search)
  AND ($status IS NULL OR status = $status)
  AND ($wallet_kyc_status IS NULL OR wallet_kyc_status = $wallet_kyc_status)
ORDER BY created_at DESC
LIMIT $limit OFFSET $offset;
```

**Indexes Required:**
```sql
CREATE INDEX idx_customers_search_phone ON customers USING gin(phone_number gin_trgm_ops);
CREATE INDEX idx_customers_search_email ON customers USING gin(email gin_trgm_ops);
CREATE INDEX idx_customers_search_name ON customers USING gin((first_name || ' ' || last_name) gin_trgm_ops);
CREATE EXTENSION IF NOT EXISTS pg_trgm; -- For ILIKE performance
```

---

### 1.2 Get Customer Details (Full Profile)
**Endpoint:** `GET /admin/api/v1/customers/:uuid`

**Database Queries:**
1. Customer basic info
2. Customer applications (primary KYC + wallet KYC)
3. Customer applicant details
4. Wallet details
5. PIN status
6. Active devices
7. Recent activity logs

**Query 1: Customer Info**
```sql
SELECT * FROM customers WHERE uuid = $uuid;
```

**Query 2: Applications**
```sql
SELECT 
  ca.id, ca.application_type, ca.kyc_status, 
  ca.sasapay_request_id, ca.sasapay_account_status,
  ca.submitted_at, ca.approved_at, ca.rejected_at
FROM customer_applications ca
WHERE ca.customer_id = $customer_id
ORDER BY ca.created_at DESC;
```

**Query 3: Applicant Details**
```sql
SELECT 
  document_type, document_number, date_of_birth, 
  nationality, physical_address, images
FROM customer_applicant_details
WHERE customer_id = $customer_id;
```

**Query 4: Wallet**
```sql
SELECT * FROM customer_wallets WHERE customer_id = $customer_id;
```

**Query 5: PIN Status**
```sql
SELECT 
  is_permanently_locked, locked_until, failed_attempts, 
  last_verified_at, created_at
FROM customer_pins
WHERE customer_id = $customer_id;
```

**Query 6: Devices**
```sql
SELECT 
  uuid, device_identifier, device_model, device_os, 
  mobile_type, is_active, last_active_at, created_at
FROM customer_devices
WHERE customer_id = $customer_id
ORDER BY created_at DESC;
```

**Query 7: Activity Logs**
```sql
SELECT 
  event_type, actor_type, actor_id, details, created_at
FROM customer_activity_logs
WHERE customer_id = $customer_id
ORDER BY created_at DESC
LIMIT 50;
```

---

### 1.3 Update Customer Status
**Endpoint:** `PATCH /admin/api/v1/customers/:uuid/status`

**Payload:** `{ "status": "suspended", "reason": "Fraudulent activity detected" }`

**Database Update:**
```sql
UPDATE customers
SET status = $status, updated_at = NOW()
WHERE uuid = $uuid;

-- Log activity
INSERT INTO customer_activity_logs (customer_id, event_type, actor_type, actor_id, details)
VALUES ($customer_id, 'STATUS_CHANGED', 'ADMIN', $admin_id, jsonb_build_object('old_status', $old_status, 'new_status', $status, 'reason', $reason));
```

**Customer Service Impact:**
- If status is `suspended` or `closed`, JWT generation blocked in `/api/v1/auth/pin/verify`
- Middleware checks customer status before allowing any authenticated action

---

### 1.4 Lock/Unlock Customer Account (Full Account Lock)
**Endpoint:** `POST /admin/api/v1/customers/:uuid/lock`
**Endpoint:** `POST /admin/api/v1/customers/:uuid/unlock`

**Payload:** `{ "reason": "Compliance review required", "lock_type": "compliance" }`

**Database Update:**
```sql
UPDATE customers
SET 
  status = 'suspended',
  metadata = jsonb_set(
    metadata, 
    '{admin_lock}', 
    jsonb_build_object(
      'locked', true, 
      'reason', $reason, 
      'locked_by', $admin_id, 
      'locked_at', NOW(), 
      'lock_type', $lock_type
    )
  ),
  updated_at = NOW()
WHERE uuid = $uuid;

-- Invalidate all active JWT sessions
INSERT INTO jwt_blacklist (customer_id, reason, expires_at, created_at)
SELECT customer_id, 'account_locked', NOW() + INTERVAL '30 days', NOW()
FROM customers WHERE uuid = $uuid;

-- Log activity
INSERT INTO customer_activity_logs (customer_id, event_type, actor_type, actor_id, details)
VALUES ($customer_id, 'ACCOUNT_LOCKED', 'ADMIN', $admin_id, jsonb_build_object('reason', $reason));
```

**Customer Service Impact:**
- All API calls return 403 Forbidden with message: "Account locked by administrator. Contact support."
- Middleware checks `metadata->admin_lock->locked` before processing any request
- Existing JWTs invalidated via blacklist check

---

### 1.5 Soft Delete Customer
**Endpoint:** `DELETE /admin/api/v1/customers/:uuid`

**Payload:** `{ "reason": "Customer requested account deletion", "admin_notes": "GDPR compliance" }`

**Database Update:**
```sql
UPDATE customers
SET 
  deleted = TRUE,
  deleted_at = NOW(),
  status = 'closed',
  metadata = jsonb_set(
    metadata, 
    '{deletion}', 
    jsonb_build_object('reason', $reason, 'deleted_by', $admin_id, 'notes', $admin_notes)
  )
WHERE uuid = $uuid;

-- Deactivate all devices
UPDATE customer_devices
SET is_active = FALSE, updated_at = NOW()
WHERE customer_id = $customer_id;

-- Lock wallet
UPDATE customer_wallets
SET status = 'closed', is_locked = TRUE, updated_at = NOW()
WHERE customer_id = $customer_id;
```

**Customer Service Impact:**
- Customer cannot authenticate (deleted customers excluded from login queries)
- All endpoints return 404 Not Found

---

## 2. Wallet Management APIs

### 2.1 List All Customer Wallets
**Endpoint:** `GET /admin/api/v1/wallets`

**Query Parameters:**
- `status` - active, locked, frozen, closed
- `tier_level` - TIER_0, TIER_1, TIER_2, TIER_3
- `is_locked` - true/false
- `freeze_type` - customer_initiated, admin_compliance, security_hold
- `search` - Search by account_number, customer phone, customer name
- `page`, `limit`

**Database Query:**
```sql
SELECT 
  w.uuid, w.account_number, w.currency, w.status, 
  w.is_locked, w.lock_reason, w.freeze_type, w.tier_level,
  c.uuid as customer_uuid, c.phone_number, c.first_name, c.last_name,
  w.created_at, w.updated_at
FROM customer_wallets w
INNER JOIN customers c ON w.customer_id = c.id
WHERE c.deleted = FALSE
  AND ($status IS NULL OR w.status = $status)
  AND ($is_locked IS NULL OR w.is_locked = $is_locked)
ORDER BY w.created_at DESC
LIMIT $limit OFFSET $offset;
```

---

### 2.2 Freeze/Unfreeze Wallet (Admin Compliance Lock)
**Endpoint:** `POST /admin/api/v1/wallets/:uuid/freeze`
**Endpoint:** `POST /admin/api/v1/wallets/:uuid/unfreeze`

**Payload:** `{ "reason": "AML investigation", "freeze_type": "admin_compliance" }`

**Database Update:**
```sql
UPDATE customer_wallets
SET 
  status = 'frozen',
  is_locked = TRUE,
  lock_reason = $reason,
  locked_by = $admin_id,
  locked_at = NOW(),
  freeze_type = $freeze_type,
  updated_at = NOW()
WHERE uuid = $uuid;

-- Log activity
INSERT INTO customer_activity_logs (customer_id, event_type, actor_type, actor_id, details)
VALUES (
  (SELECT customer_id FROM customer_wallets WHERE uuid = $uuid),
  'WALLET_FROZEN',
  'ADMIN',
  $admin_id,
  jsonb_build_object('reason', $reason, 'freeze_type', $freeze_type)
);
```

**Customer Service Impact:**
- `/api/v1/wallets/me/onboarding-status` returns message: "Wallet locked by administrator. Contact support."
- All transaction APIs return 403 Forbidden
- Customer can view wallet but cannot transact

---

### 2.3 Update Wallet Tier Level
**Endpoint:** `PATCH /admin/api/v1/wallets/:uuid/tier`

**Payload:** `{ "tier_level": "TIER_2", "reason": "KYC upgrade approved" }`

**Database Update:**
```sql
UPDATE customer_wallets
SET tier_level = $tier_level, updated_at = NOW()
WHERE uuid = $uuid;

-- Log activity
INSERT INTO customer_activity_logs (customer_id, event_type, actor_type, actor_id, details)
VALUES (
  (SELECT customer_id FROM customer_wallets WHERE uuid = $uuid),
  'WALLET_TIER_UPDATED',
  'ADMIN',
  $admin_id,
  jsonb_build_object('old_tier', $old_tier, 'new_tier', $tier_level, 'reason', $reason)
);
```

---

### 2.4 Close Wallet Permanently
**Endpoint:** `DELETE /admin/api/v1/wallets/:uuid`

**Payload:** `{ "reason": "Compliance closure", "final_balance_action": "refunded" }`

**Database Update:**
```sql
UPDATE customer_wallets
SET 
  status = 'closed',
  is_locked = TRUE,
  lock_reason = $reason,
  locked_by = $admin_id,
  locked_at = NOW(),
  updated_at = NOW()
WHERE uuid = $uuid;
```

**Customer Service Impact:**
- Wallet no longer accessible
- `/api/v1/wallets/me` returns 404 Not Found

---

## 3. Device Management APIs

### 3.1 List Customer Devices
**Endpoint:** `GET /admin/api/v1/customers/:uuid/devices`

**Database Query:**
```sql
SELECT 
  uuid, device_identifier, device_model, device_os, 
  mobile_type, app_version, is_active, 
  last_active_at, last_ip, created_at
FROM customer_devices
WHERE customer_id = (SELECT id FROM customers WHERE uuid = $uuid)
ORDER BY created_at DESC;
```

---

### 3.2 Deactivate/Revoke Device
**Endpoint:** `POST /admin/api/v1/devices/:uuid/revoke`

**Payload:** `{ "reason": "Security breach reported" }`

**Database Update:**
```sql
UPDATE customer_devices
SET is_active = FALSE, updated_at = NOW()
WHERE uuid = $uuid;

-- Invalidate JWTs issued to this device
INSERT INTO jwt_blacklist (customer_id, device_hash, reason, expires_at, created_at)
SELECT 
  customer_id, 
  device_hash, 
  $reason, 
  NOW() + INTERVAL '30 days', 
  NOW()
FROM customer_devices
WHERE uuid = $uuid;

-- Log activity
INSERT INTO customer_activity_logs (customer_id, event_type, actor_type, actor_id, details)
VALUES (
  (SELECT customer_id FROM customer_devices WHERE uuid = $uuid),
  'DEVICE_REVOKED_ADMIN',
  'ADMIN',
  $admin_id,
  jsonb_build_object('device_uuid', $uuid, 'reason', $reason)
);
```

**Customer Service Impact:**
- Device cannot authenticate (excluded from device verification queries)
- Existing JWTs from this device rejected via blacklist check
- User must register a new device

---

### 3.3 List All Devices (Global View)
**Endpoint:** `GET /admin/api/v1/devices`

**Query Parameters:**
- `is_active` - true/false
- `mobile_type` - android, ios
- `last_active_after` - Date filter for dormant devices
- `page`, `limit`

**Database Query:**
```sql
SELECT 
  d.uuid, d.device_identifier, d.device_model, d.mobile_type, 
  d.is_active, d.last_active_at,
  c.uuid as customer_uuid, c.phone_number, c.first_name, c.last_name
FROM customer_devices d
INNER JOIN customers c ON d.customer_id = c.id
WHERE c.deleted = FALSE
  AND ($is_active IS NULL OR d.is_active = $is_active)
  AND ($last_active_after IS NULL OR d.last_active_at > $last_active_after)
ORDER BY d.last_active_at DESC
LIMIT $limit OFFSET $offset;
```

---

## 4. PIN & Security Management APIs

### 4.1 View Customer PIN Status
**Endpoint:** `GET /admin/api/v1/customers/:uuid/pin-status`

**Database Query:**
```sql
SELECT 
  is_permanently_locked, locked_until, failed_attempts, 
  last_verified_at, last_changed_at, created_at
FROM customer_pins
WHERE customer_id = (SELECT id FROM customers WHERE uuid = $uuid);
```

---

### 4.2 Unlock Permanently Locked PIN
**Endpoint:** `POST /admin/api/v1/customers/:uuid/pin/unlock`

**Payload:** `{ "reason": "Customer verified via support call" }`

**Database Update:**
```sql
UPDATE customer_pins
SET 
  is_permanently_locked = FALSE,
  locked_until = NULL,
  failed_attempts = 0,
  updated_at = NOW()
WHERE customer_id = (SELECT id FROM customers WHERE uuid = $uuid);

-- Log activity
INSERT INTO customer_activity_logs (customer_id, event_type, actor_type, actor_id, details)
VALUES (
  (SELECT id FROM customers WHERE uuid = $uuid),
  'PIN_UNLOCKED_ADMIN',
  'ADMIN',
  $admin_id,
  jsonb_build_object('reason', $reason)
);
```

**Customer Service Impact:**
- Customer can now verify PIN and authenticate
- `/api/v1/auth/pin/verify` no longer returns "permanently locked" error

---

### 4.3 Force PIN Reset
**Endpoint:** `POST /admin/api/v1/customers/:uuid/pin/force-reset`

**Payload:** `{ "reason": "Forgot PIN, ID verified" }`

**Database Update:**
```sql
UPDATE customer_pins
SET 
  is_permanently_locked = FALSE,
  locked_until = NULL,
  failed_attempts = 0,
  updated_at = NOW()
WHERE customer_id = (SELECT id FROM customers WHERE uuid = $uuid);

-- Invalidate all JWTs (force re-authentication)
INSERT INTO jwt_blacklist (customer_id, reason, expires_at, created_at)
VALUES (
  (SELECT id FROM customers WHERE uuid = $uuid),
  'pin_force_reset',
  NOW() + INTERVAL '30 days',
  NOW()
);

-- Send OTP or initiate PIN reset flow
```

**Customer Service Impact:**
- Customer must go through PIN reset flow
- All existing sessions invalidated

---

## 5. KYC Management APIs

### 5.1 Review KYC Application
**Endpoint:** `GET /admin/api/v1/kyc/applications/:uuid`

**Database Query:**
```sql
SELECT 
  ca.id, ca.uuid, ca.application_type, ca.kyc_status,
  ca.sasapay_request_id, ca.sasapay_account_status,
  ca.submitted_at, ca.approved_at, ca.rejected_at,
  cad.document_type, cad.document_number, cad.date_of_birth,
  cad.nationality, cad.physical_address, cad.images,
  c.uuid as customer_uuid, c.phone_number, c.first_name, c.last_name
FROM customer_applications ca
INNER JOIN customer_applicant_details cad ON ca.id = cad.application_id
INNER JOIN customers c ON ca.customer_id = c.id
WHERE ca.uuid = $uuid;
```

---

### 5.2 Approve/Reject KYC Application
**Endpoint:** `POST /admin/api/v1/kyc/applications/:uuid/approve`
**Endpoint:** `POST /admin/api/v1/kyc/applications/:uuid/reject`

**Payload:** `{ "reviewer_notes": "Documents verified via IPRS", "reviewer_id": "admin_123" }`

**Database Update (Approve):**
```sql
UPDATE customer_applications
SET 
  kyc_status = 'approved',
  approved_at = NOW(),
  approved_by = $reviewer_id,
  reviewer_notes = $reviewer_notes,
  updated_at = NOW()
WHERE uuid = $uuid;

-- If wallet KYC, create wallet
INSERT INTO customer_wallets (customer_id, astpp_id, account_number, currency, status, tier_level, created_at, updated_at)
SELECT 
  ca.customer_id,
  c.astpp_id,
  c.phone_number,
  'KES',
  'active',
  'TIER_1',
  NOW(),
  NOW()
FROM customer_applications ca
INNER JOIN customers c ON ca.customer_id = c.id
WHERE ca.uuid = $uuid AND ca.application_type = 'wallet_kyc'
ON CONFLICT (customer_id) DO NOTHING;

-- Update customer
UPDATE customers
SET has_wallet = TRUE, wallet_kyc_status = 'approved', updated_at = NOW()
WHERE id = (SELECT customer_id FROM customer_applications WHERE uuid = $uuid);
```

**Database Update (Reject):**
```sql
UPDATE customer_applications
SET 
  kyc_status = 'rejected',
  rejected_at = NOW(),
  rejected_by = $reviewer_id,
  reviewer_notes = $reviewer_notes,
  rejection_reason = $rejection_reason,
  updated_at = NOW()
WHERE uuid = $uuid;

-- Update customer
UPDATE customers
SET wallet_kyc_status = 'rejected', updated_at = NOW()
WHERE id = (SELECT customer_id FROM customer_applications WHERE uuid = $uuid);
```

**Customer Service Impact:**
- `/api/v1/wallets/me/onboarding-status` reflects approval/rejection
- Approved: Wallet becomes accessible
- Rejected: User sees rejection message and contact support prompt

---

### 5.3 List Pending KYC Applications
**Endpoint:** `GET /admin/api/v1/kyc/applications/pending`

**Query Parameters:**
- `application_type` - primary_kyc, wallet_kyc
- `submitted_after` - Date filter
- `page`, `limit`

**Database Query:**
```sql
SELECT 
  ca.uuid, ca.application_type, ca.kyc_status, ca.submitted_at,
  c.uuid as customer_uuid, c.phone_number, c.first_name, c.last_name
FROM customer_applications ca
INNER JOIN customers c ON ca.customer_id = c.id
WHERE ca.kyc_status IN ('pending', 'requires_kyc_upload')
  AND ($application_type IS NULL OR ca.application_type = $application_type)
ORDER BY ca.submitted_at ASC
LIMIT $limit OFFSET $offset;
```

---

## 6. Activity Logs & Audit APIs

### 6.1 Get Customer Activity Logs
**Endpoint:** `GET /admin/api/v1/customers/:uuid/activity`

**Query Parameters:**
- `event_type` - Filter by event type
- `from_date`, `to_date` - Date range
- `limit` - Default 100, max 500

**Database Query:**
```sql
SELECT 
  event_type, actor_type, actor_id, details, 
  ip_address, user_agent, created_at
FROM customer_activity_logs
WHERE customer_id = (SELECT id FROM customers WHERE uuid = $uuid)
  AND ($event_type IS NULL OR event_type = $event_type)
  AND ($from_date IS NULL OR created_at >= $from_date)
  AND ($to_date IS NULL OR created_at <= $to_date)
ORDER BY created_at DESC
LIMIT $limit;
```

---

### 6.2 Global Activity Search
**Endpoint:** `GET /admin/api/v1/activity`

**Query Parameters:**
- `event_type` - WALLET_LOCKED, DEVICE_REVOKED_ADMIN, STATUS_CHANGED, etc.
- `actor_type` - ADMIN, SYSTEM, CUSTOMER
- `actor_id` - Specific admin ID
- `from_date`, `to_date`
- `page`, `limit`

**Database Query:**
```sql
SELECT 
  cal.event_type, cal.actor_type, cal.actor_id, cal.details,
  cal.ip_address, cal.created_at,
  c.uuid as customer_uuid, c.phone_number, c.first_name, c.last_name
FROM customer_activity_logs cal
INNER JOIN customers c ON cal.customer_id = c.id
WHERE ($event_type IS NULL OR cal.event_type = $event_type)
  AND ($actor_type IS NULL OR cal.actor_type = $actor_type)
  AND ($from_date IS NULL OR cal.created_at >= $from_date)
ORDER BY cal.created_at DESC
LIMIT $limit OFFSET $offset;
```

---

## 7. JWT Blacklist & Session Management

### 7.1 New Table: jwt_blacklist

**Purpose:** Track invalidated JWTs when admin locks accounts, revokes devices, or forces logout.

**Schema:**
```sql
CREATE TABLE IF NOT EXISTS jwt_blacklist (
    id BIGSERIAL PRIMARY KEY,
    customer_id BIGINT NOT NULL REFERENCES customers(id),
    device_hash VARCHAR(255), -- NULL means all devices
    jti VARCHAR(255), -- JWT ID (if tracking individual tokens)
    reason VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL, -- When to stop checking (JWT expiry)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_jwt_blacklist_customer ON jwt_blacklist(customer_id, expires_at);
CREATE INDEX idx_jwt_blacklist_device ON jwt_blacklist(device_hash, expires_at) WHERE device_hash IS NOT NULL;
CREATE INDEX idx_jwt_blacklist_jti ON jwt_blacklist(jti, expires_at) WHERE jti IS NOT NULL;
CREATE INDEX idx_jwt_blacklist_expires ON jwt_blacklist(expires_at); -- For cleanup job
```

**Cleanup Job:**
```sql
-- Run daily
DELETE FROM jwt_blacklist WHERE expires_at < NOW();
```

---

### 7.2 Invalidate All Customer Sessions
**Endpoint:** `POST /admin/api/v1/customers/:uuid/sessions/invalidate`

**Payload:** `{ "reason": "Security incident" }`

**Database Insert:**
```sql
INSERT INTO jwt_blacklist (customer_id, reason, expires_at, created_at)
VALUES (
  (SELECT id FROM customers WHERE uuid = $uuid),
  $reason,
  NOW() + INTERVAL '30 days', -- Max JWT expiry
  NOW()
);

-- Log activity
INSERT INTO customer_activity_logs (customer_id, event_type, actor_type, actor_id, details)
VALUES (
  (SELECT id FROM customers WHERE uuid = $uuid),
  'SESSIONS_INVALIDATED',
  'ADMIN',
  $admin_id,
  jsonb_build_object('reason', $reason)
);
```

**Customer Service Impact:**
- Middleware checks `jwt_blacklist` table on every authenticated request
- If customer_id + device_hash match (or customer_id + NULL device), reject JWT
- User must re-authenticate

---

### 7.3 JWT Verification Middleware (Customer Service)

**Fast Check Query:**
```sql
-- Cache in Redis: key = "jwt_blacklist:{customer_id}:{device_hash}", TTL = 60 seconds
SELECT 1 
FROM jwt_blacklist
WHERE customer_id = $customer_id
  AND (device_hash IS NULL OR device_hash = $device_hash)
  AND expires_at > NOW()
LIMIT 1;
```

**Implementation:**
1. Check Redis cache first (avoid DB hit)
2. If cache miss, query database
3. If found, reject JWT with 401 Unauthorized: "Session invalidated. Please log in again."
4. Cache result for 60 seconds

---

## 8. System Configuration & Maintenance Mode

### 8.1 New Table: system_config

**Purpose:** Store frequently-accessed configurations (maintenance mode, feature flags, rate limits) with in-memory caching to avoid DB overload.

**Schema:**
```sql
CREATE TABLE IF NOT EXISTS system_config (
    id SERIAL PRIMARY KEY,
    config_key VARCHAR(255) NOT NULL UNIQUE,
    config_value TEXT NOT NULL,
    config_type VARCHAR(50) NOT NULL DEFAULT 'string', -- string, boolean, json, integer
    description TEXT,
    is_cached BOOLEAN NOT NULL DEFAULT FALSE, -- If true, cache in memory
    cache_ttl_seconds INTEGER DEFAULT 60, -- Cache TTL
    updated_by VARCHAR(255),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default configs
INSERT INTO system_config (config_key, config_value, config_type, description, is_cached, cache_ttl_seconds)
VALUES 
  ('maintenance_mode', 'false', 'boolean', 'Global maintenance mode for the microservice', true, 30),
  ('maintenance_message', 'System maintenance in progress. Please try again later.', 'string', 'Message shown during maintenance', true, 30),
  ('max_failed_login_attempts', '5', 'integer', 'Max failed PIN attempts before lockout', true, 300),
  ('pin_lockout_minutes', '15', 'integer', 'Temporary lockout duration in minutes', true, 300),
  ('onboarding_enabled', 'true', 'boolean', 'Enable/disable new customer onboarding', true, 60),
  ('wallet_kyc_enabled', 'true', 'boolean', 'Enable/disable wallet KYC onboarding', true, 60),
  ('device_registration_enabled', 'true', 'boolean', 'Enable/disable new device registration', true, 60);
```

---

### 8.2 Get System Configuration
**Endpoint:** `GET /admin/api/v1/system/config`

**Database Query:**
```sql
SELECT config_key, config_value, config_type, description, updated_at
FROM system_config
ORDER BY config_key ASC;
```

---

### 8.3 Update System Configuration
**Endpoint:** `PATCH /admin/api/v1/system/config/:key`

**Payload:** `{ "config_value": "true", "updated_by": "admin_123" }`

**Database Update:**
```sql
UPDATE system_config
SET 
  config_value = $config_value,
  updated_by = $updated_by,
  updated_at = NOW()
WHERE config_key = $key;

-- Invalidate cache (Customer Service must refresh)
-- Publish event: "config.updated" via Redis pub/sub or database trigger
```

**Customer Service Impact:**
- ConfigService caches `system_config` values in memory
- TTL: 30-300 seconds depending on config
- On update, Admin Service publishes event → Customer Service refreshes cache

---

### 8.4 Enable Maintenance Mode
**Endpoint:** `POST /admin/api/v1/system/maintenance/enable`

**Payload:** `{ "message": "Scheduled maintenance: Database upgrade in progress", "enabled_by": "admin_123" }`

**Database Update:**
```sql
UPDATE system_config
SET 
  config_value = 'true',
  updated_by = $enabled_by,
  updated_at = NOW()
WHERE config_key = 'maintenance_mode';

UPDATE system_config
SET 
  config_value = $message,
  updated_by = $enabled_by,
  updated_at = NOW()
WHERE config_key = 'maintenance_message';
```

**Customer Service Impact:**
- Middleware checks `maintenance_mode` config (cached, refreshed every 30 seconds)
- If enabled, return 503 Service Unavailable:
  ```json
  {
    "success": false,
    "message": "Scheduled maintenance: Database upgrade in progress",
    "statusCode": 503
  }
  ```
- Exceptions: Health check endpoint (`/health`) always accessible

---

### 8.5 Disable Maintenance Mode
**Endpoint:** `POST /admin/api/v1/system/maintenance/disable`

**Database Update:**
```sql
UPDATE system_config
SET 
  config_value = 'false',
  updated_by = $disabled_by,
  updated_at = NOW()
WHERE config_key = 'maintenance_mode';
```

**Customer Service Impact:**
- Service resumes normal operation within 30 seconds (cache refresh)

---

## 9. Customer Service Middleware & Guardrails

### 9.1 Fast Status Check Middleware

**Purpose:** Block requests from locked/suspended customers before processing business logic.

**Execution Order:**
1. JWT validation
2. **Status check middleware** (this)
3. Business logic

**Redis Cache Keys:**
```
customer_status:{customer_id} → "active" | "suspended" | "closed"
customer_lock:{customer_id} → true | false
device_active:{device_hash} → true | false
maintenance_mode → true | false
```

**Cache TTL:** 60 seconds

**Database Fallback Query:**
```sql
-- Single fast query
SELECT 
  c.status,
  c.metadata->'admin_lock'->>'locked' as admin_locked,
  d.is_active as device_active
FROM customers c
LEFT JOIN customer_devices d ON d.customer_id = c.id AND d.device_hash = $device_hash
WHERE c.id = $customer_id;
```

**Rejection Logic:**
- If `status IN ('suspended', 'closed')` → 403 Forbidden: "Account suspended. Contact support."
- If `admin_locked = true` → 403 Forbidden: "Account locked by administrator. Contact support."
- If `device_active = false` → 403 Forbidden: "Device session expired. Please log in again."
- If `maintenance_mode = true` → 503 Service Unavailable: "{maintenance_message}"

**Performance:**
- Cache hit: ~1-2ms (in-memory check)
- Cache miss: ~5-10ms (single DB query + cache write)

---

### 9.2 JWT Blacklist Check Middleware

**Purpose:** Invalidate JWTs when admin revokes sessions.

**Execution Order:**
1. JWT validation
2. Status check middleware
3. **JWT blacklist check** (this)
4. Business logic

**Redis Cache Key:**
```
jwt_blacklisted:{customer_id}:{device_hash} → true | false
```

**Cache TTL:** 60 seconds

**Database Fallback Query:**
```sql
SELECT 1 
FROM jwt_blacklist
WHERE customer_id = $customer_id
  AND (device_hash IS NULL OR device_hash = $device_hash)
  AND expires_at > NOW()
LIMIT 1;
```

**Rejection Logic:**
- If found → 401 Unauthorized: "Session invalidated. Please log in again."

---

### 9.3 PIN Verification Impact

**Endpoint:** `POST /api/v1/auth/pin/verify`

**Additional Checks:**
1. Check `customers.status` (suspended/closed blocked)
2. Check `customers.metadata->admin_lock` (admin lock blocked)
3. Check `customer_pins.is_permanently_locked`
4. Check `jwt_blacklist` (all sessions invalidated)

**Error Responses:**
- Account suspended: "Account suspended by administrator. Contact support."
- Admin locked: "Account locked for compliance review. Contact support."
- PIN locked: "PIN permanently locked. Contact support to unlock."

---

### 9.4 Profile Update Impact

**Endpoint:** `PATCH /api/v1/customers/me`

**Additional Checks:**
1. Status check middleware (suspended/closed blocked)
2. Admin lock check (locked accounts cannot update profile)

**Error Response:**
- "Account locked by administrator. Contact support for assistance."

---

### 9.5 Wallet Status API Impact

**Endpoint:** `GET /api/v1/wallets/me/onboarding-status`

**Additional Response Fields:**
```json
{
  "data": {
    "hasWallet": false,
    "applicationStatus": "pending",
    "isAdminLocked": true,
    "adminLockReason": "Compliance review in progress",
    "message": "Your account is under review. Please contact support.",
    "nextAction": "contact_support"
  }
}
```

**Logic:**
- Check `customers.metadata->admin_lock->locked`
- If true, override message and set `nextAction = "contact_support"`

---

## 10. Database Schema Changes Required

### 10.1 New Tables

**jwt_blacklist**
```sql
CREATE TABLE IF NOT EXISTS jwt_blacklist (
    id BIGSERIAL PRIMARY KEY,
    customer_id BIGINT NOT NULL REFERENCES customers(id),
    device_hash VARCHAR(255),
    jti VARCHAR(255),
    reason VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_jwt_blacklist_customer ON jwt_blacklist(customer_id, expires_at);
CREATE INDEX idx_jwt_blacklist_device ON jwt_blacklist(device_hash, expires_at) WHERE device_hash IS NOT NULL;
CREATE INDEX idx_jwt_blacklist_expires ON jwt_blacklist(expires_at);
```

**system_config**
```sql
CREATE TABLE IF NOT EXISTS system_config (
    id SERIAL PRIMARY KEY,
    config_key VARCHAR(255) NOT NULL UNIQUE,
    config_value TEXT NOT NULL,
    config_type VARCHAR(50) NOT NULL DEFAULT 'string',
    description TEXT,
    is_cached BOOLEAN NOT NULL DEFAULT FALSE,
    cache_ttl_seconds INTEGER DEFAULT 60,
    updated_by VARCHAR(255),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_system_config_cached ON system_config(is_cached) WHERE is_cached = TRUE;
```

---

### 10.2 Modify Existing Tables

**customers table - Add admin_lock to metadata**
```sql
-- No schema change needed - use existing JSONB metadata column
-- Structure: metadata->admin_lock = {locked: true, reason: "...", locked_by: "...", locked_at: "..."}
```

**customer_applications table - Add reviewer fields**
```sql
ALTER TABLE customer_applications
ADD COLUMN approved_by VARCHAR(255),
ADD COLUMN rejected_by VARCHAR(255),
ADD COLUMN reviewer_notes TEXT,
ADD COLUMN rejection_reason TEXT;
```

**customer_activity_logs table - Ensure admin actor support**
```sql
-- No changes needed if actor_type already supports 'ADMIN'
```

---

### 10.3 New Indexes for Performance

```sql
-- Fast customer search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_customers_search_phone ON customers USING gin(phone_number gin_trgm_ops);
CREATE INDEX idx_customers_search_email ON customers USING gin(email_number gin_trgm_ops);

-- Fast wallet lookups
CREATE INDEX idx_wallets_status ON customer_wallets(status, is_locked);
CREATE INDEX idx_wallets_freeze_type ON customer_wallets(freeze_type) WHERE freeze_type IS NOT NULL;

-- Fast KYC application queries
CREATE INDEX idx_applications_pending ON customer_applications(kyc_status, submitted_at) 
  WHERE kyc_status IN ('pending', 'requires_kyc_upload');

-- Fast activity log queries
CREATE INDEX idx_activity_event_type ON customer_activity_logs(event_type, created_at);
CREATE INDEX idx_activity_actor ON customer_activity_logs(actor_type, actor_id, created_at);
```

---

## 11. Admin Service Architecture Summary

### Service Design
- **Technology:** NestJS (TypeScript)
- **Authentication:** OAuth2 / API Keys with RBAC
- **Database:** Same PostgreSQL as Customer Service (shared)
- **Caching:** Redis for session invalidation and config caching
- **Event Bus:** Redis Pub/Sub or Kafka for config update notifications

### RBAC Roles
- `admin:customer:read` - View customer details
- `admin:customer:write` - Update customer status, lock accounts
- `admin:wallet:write` - Freeze wallets, update tiers
- `admin:kyc:review` - Approve/reject KYC applications
- `admin:security:write` - Revoke devices, unlock PINs
- `admin:system:write` - Update system config, enable maintenance mode

### Audit Trail
- Every admin action logged to `customer_activity_logs` with:
  - `actor_type = 'ADMIN'`
  - `actor_id = admin_user_id`
  - `details = JSONB` with action metadata

---

## 12. Customer Service Impact Summary

| Admin Action | Customer Service Impact | Implementation |
|--------------|-------------------------|----------------|
| Lock customer account | 403 Forbidden on all APIs | Status check middleware |
| Suspend customer | 403 Forbidden, "Account suspended" | Status check middleware |
| Freeze wallet | Wallet APIs return 403 | Wallet service checks `is_locked` |
| Revoke device | Device cannot authenticate | Device query checks `is_active` |
| Invalidate sessions | JWT rejected, force re-login | JWT blacklist middleware |
| Unlock PIN | PIN verification succeeds | `customer_pins.is_permanently_locked = false` |
| Enable maintenance mode | 503 on all APIs (except `/health`) | Maintenance mode middleware |
| Approve KYC | Wallet becomes accessible | `customer_applications.kyc_status = 'approved'` |
| Reject KYC | Onboarding status shows rejection | `customer_applications.kyc_status = 'rejected'` |

---

## 13. Caching Strategy

### Redis Cache Keys
```
# Customer status (TTL: 60s)
customer_status:{customer_id} → "active" | "suspended" | "closed"
customer_lock:{customer_id} → true | false

# Device status (TTL: 60s)
device_active:{device_hash} → true | false

# JWT blacklist (TTL: 60s)
jwt_blacklisted:{customer_id}:{device_hash} → true | false

# System config (TTL: 30-300s depending on config)
config:maintenance_mode → true | false
config:maintenance_message → "..."
config:onboarding_enabled → true | false
```

### Cache Invalidation
1. **Admin Service writes to DB** → Deletes Redis cache key
2. **Admin Service publishes event** → `config.updated`, `customer.locked`, etc.
3. **Customer Service subscribes** → Refreshes in-memory cache on event

---

## 14. Performance Goals

| Operation | Target Response Time |
|-----------|---------------------|
| Customer search | <100ms |
| Get customer details | <150ms |
| Lock/unlock account | <50ms (write) |
| JWT blacklist check (cached) | <2ms |
| Status check middleware (cached) | <2ms |
| Maintenance mode check (cached) | <1ms |

---

## End of Document

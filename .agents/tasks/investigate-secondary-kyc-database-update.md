# Investigation Report: Database Changes to Flag Customer 333407 for Secondary KYC

## Executive Summary

**Solution:** Insert a row into the `customer_applicant_details` table with `application_type = 'sasapay_kyc'` and `sasapay_submission_status = 'awaiting_documents'` for customer 333407. This will cause both the onboarding status API and wallet status API to indicate that the customer needs to upload secondary KYC documents.

**Key Finding:** The system uses a prioritized KYC source (sasapay_kyc > wallet_kyc > primary_kyc) to determine which document set controls the API responses. Creating a sasapay_kyc submission with status 'awaiting_documents' will override any existing primary_kyc data and display the "upload_kyc_documents" action to the customer.

---

## Background

Customer 333407 attempted to onboard with:
- **Document Type:** 2 (accepted)
- **Document Number:** 123456788 (invalid)
- **Phone Number:** 254727265334
- **SasaPay Response:** Success (status: true, responseCode: "0") but OTP never sent
- **Job Status:** COMPLETED (UUID: 4f9b201c-1c84-4cdc-9527-fa015baf7a3e)
- **Multiple SASAPAY_PERSONAL_ONBOARDING_INITIATED events** logged with status "otp_sent"

The issue is that SasaPay returns a success response even when the document number is invalid, so the system has no way to detect the failure automatically. The customer is stuck in a completed onboarding state without being able to proceed.

---

## API Behavior Analysis

### 1. Onboarding Status API (`GET /api/v2/customers/onboarding-status`)

**File:** `src/modules/onboarding/services/onboarding-status.service.ts`

**Logic Flow (lines 18-109):**

```typescript
async getStatus(customerId: number) {
  // 1. Fetch wallet, application, and KYC submission
  const wallet = await this.db.queryOne(/* fetch customer_wallets */);
  const application = await this.db.queryOne(/* fetch customer_applications */);
  const kycSubmission = await this.sasaPayKyc.getCurrentStatus(customerId);
  
  // 2. Check for secondary KYC requirement
  const requiredDocuments = kycSubmission?.requiredDocuments || [];
  if (kycSubmission?.status === 'awaiting_documents' && requiredDocuments.length) {
    applicationStatus = 'requires_kyc_upload';  // ← KEY LINE 46-47
  }
  
  // 3. Determine next action
  if (application?.sasapay_account_number 
      && kycSubmission?.status === 'awaiting_documents'
      && requiredDocuments.length) {
    nextAction = {
      type: 'upload_kyc_documents',  // ← KEY LINE 66
      method: 'POST',
      endpoint: '/api/v2/customers/kyc/submissions/images',
    };
  }
}
```

**Key Decision Point (lines 46-47):**
If `kycSubmission.status === 'awaiting_documents'` and `requiredDocuments.length > 0`, the API sets `applicationStatus = 'requires_kyc_upload'`.

**Key Decision Point (lines 62-68):**
If customer has a sasapay_account_number AND kycSubmission status is 'awaiting_documents' with required documents, the API returns `nextAction.type = 'upload_kyc_documents'`.

---

### 2. KYC Submission Status Logic

**File:** `src/modules/onboarding/services/sasapay-kyc.service.ts`

**Method:** `getCurrentStatus(customerId: number)` (lines 237-277)

```sql
SELECT ca.id, ca.customer_id,
       sasapay.id AS detail_id,
       sasapay.sasapay_submission_status AS status,
       sasapay.required_documents,
       ...
FROM customer_applications ca
LEFT JOIN customer_applicant_details sasapay
  ON sasapay.customer_application_id = ca.id 
  AND sasapay.application_type = 'sasapay_kyc'  -- ← FILTERS FOR sasapay_kyc ONLY
WHERE ca.customer_id = $1
```

**Returns:** Only the `sasapay_kyc` submission if it exists. If no sasapay_kyc row exists, returns `null`.

**Key Logic (lines 265-268):**
```typescript
const images = Array.isArray(application.images) ? application.images : [];
const uploadedTypes = new Set(images.map(img => img.type));
const requiredDocuments = this.withRequiredSelfie(application.required_documents)
  .filter((documentType) => !uploadedTypes.has(documentType));
```

If `requiredDocuments` has items and status is 'awaiting_documents', the customer must upload those documents.

---

### 3. KYC Source Priority

**File:** `src/modules/onboarding/services/sasapay-kyc.service.ts`

**Method:** `getAllKycStatus(customerId: number)` (lines 93-221)

The system uses a **prioritized source hierarchy** to determine which KYC data to show:

```sql
CASE 
  WHEN sasapay.id IS NOT NULL THEN 'sasapay_kyc'      -- HIGHEST PRIORITY
  WHEN wallet.id IS NOT NULL THEN 'wallet_kyc'
  WHEN primary_kyc.id IS NOT NULL THEN 'primary_kyc'  -- LOWEST PRIORITY
  ELSE NULL
END AS kyc_source
```

**Lines 99-101:** The presence of a `sasapay_kyc` row takes precedence over `wallet_kyc` and `primary_kyc`.

**Lines 149-172:** If `kyc_source === 'sasapay_kyc'`, the API returns images from the sasapay submission's `images` JSONB column.

---

## Database Schema Analysis

### Key Tables

#### 1. `customer_applications` (migration 001_initial_schema.sql, lines 73-139)

Stores one application record per customer:

| Column | Type | Description |
|--------|------|-------------|
| `id` | BIGSERIAL | Primary key |
| `customer_id` | BIGINT | Foreign key to customers |
| `astpp_id` | INTEGER | Denormalized ASTPP ID |
| `kyc_status` | VARCHAR(20) | 'pending', 'approved', 'rejected' |
| `sasapay_account_number` | VARCHAR(64) | SasaPay wallet account number |
| `sasapay_account_status` | VARCHAR(32) | ACTIVE, REJECTED, etc. |

**Key Constraint:** `UNIQUE INDEX uq_applications_customer_id ON customer_applications(customer_id)` — one application per customer.

---

#### 2. `customer_applicant_details` (migration 001_initial_schema.sql, lines 182-287)

Stores multiple KYC document sets per customer:

| Column | Type | Description |
|--------|------|-------------|
| `id` | BIGSERIAL | Primary key |
| `customer_application_id` | BIGINT | FK to customer_applications |
| `customer_id` | BIGINT | FK to customers |
| `astpp_id` | INTEGER | Denormalized ASTPP ID |
| `application_type` | VARCHAR(20) | **'primary_kyc', 'wallet_kyc', 'sasapay_kyc'** |
| `name` | VARCHAR(100) | Full name |
| `identity_document_type` | VARCHAR(50) | 'NATIONAL_ID', 'PASSPORT', etc. |
| `identity_document_number` | VARCHAR(64) | Document number |
| `issuing_country` | VARCHAR(3) | Country code (default 'KEN') |
| `date_of_birth` | DATE | Customer DOB |
| `gender` | gender_enum | 'male', 'female', 'other' |
| `nationality` | INTEGER | Country ID |
| `physical_address` | TEXT | Address |
| `images` | JSONB | Array of uploaded document images |
| `policy_id` | BIGINT | FK to document_policies |
| `policy_version` | INTEGER | Policy version at time of submission |
| `sasapay_submission_status` | VARCHAR(32) | **'awaiting_documents', 'submitted_for_review', etc.** |
| `required_documents` | TEXT[] | Array: ['document_front', 'document_back', 'selfie'] |

**Key Constraint (line 268):** `UNIQUE INDEX uq_applicant_details_application_type ON customer_applicant_details(customer_application_id, application_type)` — one record per application per type.

**Key Constraint (line 254):** `CHECK` constraint on `sasapay_submission_status` allows: 'awaiting_documents', 'submitted_for_review', 'approved_for_psp', 'rejected', 'awaiting_psp_result', 'processing_psp_upload', 'psp_upload_failed', 'psp_approved', 'psp_rejected'.

**Key Constraint (line 263):** `CHECK` constraint on `required_documents` ensures values are subset of ['document_front', 'document_back', 'selfie'] and selfie is always included if any documents are required.

---

#### 3. `document_policies` (migration 001_initial_schema.sql, lines 141-180)

Stores versioned document requirements:

| Column | Type | Description |
|--------|------|-------------|
| `id` | BIGSERIAL | Primary key |
| `document_type` | VARCHAR(50) | 'national_id', 'passport', 'alien_id' |
| `version` | INTEGER | Policy version |
| `required_documents` | TEXT[] | ['document_front', 'document_back', 'selfie'] |
| `accepted_mime_types` | TEXT[] | ['image/jpeg', 'image/png', 'image/webp'] |
| `max_file_size_bytes` | INTEGER | 20971520 (20MB) |
| `is_active` | BOOLEAN | Only one active policy per document type |

**Seed Data (lines 171-179):** Policies exist for 'national_id', 'passport', and 'alien_id' with version 1, all requiring 3 documents.

---

## Solution: Database UPDATE Statements

### Prerequisites

Before executing the solution, verify the customer's current state:

```sql
-- 1. Get customer_id from customer 333407
SELECT id, astpp_id, phone_number, first_name, last_name, status
FROM customers
WHERE astpp_id = 102627;  -- From job payload

-- 2. Get application_id
SELECT id, customer_id, astpp_id, kyc_status, sasapay_account_number, sasapay_account_status
FROM customer_applications
WHERE customer_id = 333407;

-- 3. Get existing primary_kyc details
SELECT id, customer_application_id, application_type, identity_document_type, 
       identity_document_number, name, sasapay_submission_status, required_documents
FROM customer_applicant_details
WHERE customer_id = 333407
  AND application_type = 'primary_kyc';

-- 4. Check if sasapay_kyc row already exists
SELECT id, customer_application_id, application_type, sasapay_submission_status, required_documents
FROM customer_applicant_details
WHERE customer_id = 333407
  AND application_type = 'sasapay_kyc';

-- 5. Get the active document policy for the customer's document type
SELECT id, document_type, version, required_documents
FROM document_policies
WHERE document_type = 'national_id'  -- or 'passport', 'alien_id' based on step 3
  AND is_active = TRUE;
```

---

### Solution SQL Statements

Assuming the prerequisites queries returned:
- `customer_id = 333407`
- `application_id = X` (from customer_applications query)
- `astpp_id = 102627`
- `identity_document_type = 'NATIONAL_ID'` (document type 2 from activity logs)
- `policy_id = 1` (national_id policy from seed data)
- No existing sasapay_kyc row

**Execute this INSERT:**

```sql
-- Create sasapay_kyc submission with awaiting_documents status
INSERT INTO customer_applicant_details (
  customer_application_id,
  customer_id,
  astpp_id,
  application_type,
  name,
  identity_document_type,
  identity_document_number,
  issuing_country,
  date_of_birth,
  gender,
  nationality,
  physical_address,
  policy_id,
  policy_version,
  sasapay_submission_status,
  required_documents,
  images,
  created_at,
  updated_at
)
SELECT
  ca.id AS customer_application_id,
  333407 AS customer_id,
  102627 AS astpp_id,
  'sasapay_kyc' AS application_type,
  COALESCE(cad.name, c.first_name || ' ' || c.last_name) AS name,
  COALESCE(cad.identity_document_type, 'NATIONAL_ID') AS identity_document_type,
  COALESCE(cad.identity_document_number, '123456788') AS identity_document_number,
  COALESCE(cad.issuing_country, 'KEN') AS issuing_country,
  COALESCE(cad.date_of_birth, c.date_of_birth) AS date_of_birth,
  cad.gender,
  cad.nationality,
  cad.physical_address,
  dp.id AS policy_id,
  dp.version AS policy_version,
  'awaiting_documents' AS sasapay_submission_status,
  dp.required_documents AS required_documents,
  '[]'::jsonb AS images,
  NOW() AS created_at,
  NOW() AS updated_at
FROM customers c
JOIN customer_applications ca ON ca.customer_id = c.id
LEFT JOIN customer_applicant_details cad 
  ON cad.customer_application_id = ca.id 
  AND cad.application_type = 'primary_kyc'
JOIN document_policies dp 
  ON LOWER(dp.document_type) = LOWER(COALESCE(cad.identity_document_type, 'national_id'))
  AND dp.is_active = TRUE
WHERE c.id = 333407
  AND NOT EXISTS (
    SELECT 1 FROM customer_applicant_details
    WHERE customer_application_id = ca.id
      AND application_type = 'sasapay_kyc'
  );
```

**Expected Result:** 1 row inserted.

---

### Verification Queries

After executing the INSERT, verify the changes:

```sql
-- 1. Verify sasapay_kyc row was created
SELECT id, customer_application_id, application_type, 
       sasapay_submission_status, required_documents, 
       policy_id, policy_version, images
FROM customer_applicant_details
WHERE customer_id = 333407
  AND application_type = 'sasapay_kyc';

-- Expected: One row with:
-- - sasapay_submission_status = 'awaiting_documents'
-- - required_documents = ['document_front', 'document_back', 'selfie']
-- - images = []

-- 2. Simulate the API query to verify nextAction
SELECT 
  CASE 
    WHEN sasapay.sasapay_submission_status = 'awaiting_documents' 
         AND CARDINALITY(sasapay.required_documents) > 0 
    THEN 'upload_kyc_documents'
    ELSE 'other'
  END AS next_action
FROM customer_applications ca
LEFT JOIN customer_applicant_details sasapay
  ON sasapay.customer_application_id = ca.id 
  AND sasapay.application_type = 'sasapay_kyc'
WHERE ca.customer_id = 333407;

-- Expected: next_action = 'upload_kyc_documents'

-- 3. Verify priority (sasapay_kyc overrides primary_kyc)
SELECT 
  CASE 
    WHEN sasapay.id IS NOT NULL THEN 'sasapay_kyc'
    WHEN wallet.id IS NOT NULL THEN 'wallet_kyc'
    WHEN primary_kyc.id IS NOT NULL THEN 'primary_kyc'
    ELSE NULL
  END AS kyc_source
FROM customer_applications ca
LEFT JOIN customer_applicant_details sasapay
  ON sasapay.customer_application_id = ca.id AND sasapay.application_type = 'sasapay_kyc'
LEFT JOIN customer_applicant_details wallet
  ON wallet.customer_application_id = ca.id AND wallet.application_type = 'wallet_kyc'
LEFT JOIN customer_applicant_details primary_kyc
  ON primary_kyc.customer_application_id = ca.id AND primary_kyc.application_type = 'primary_kyc'
WHERE ca.customer_id = 333407;

-- Expected: kyc_source = 'sasapay_kyc'
```

---

## API Response Changes

### Before the Database Change

**GET /api/v2/customers/onboarding-status?astppId=102627**

```json
{
  "success": true,
  "message": "Pending approval",
  "data": {
    "applicationStatus": "pending",
    "wallet": {
      "walletId": "...",
      "accountNumber": "...",
      "currency": "KES",
      "status": "active",
      "createdAt": "..."
    },
    "application": {
      "sasapayRequestId": "...",
      "sasapayAccountNumber": "...",
      "sasapayAccountStatus": "ACTIVE",
      "submittedAt": "...",
      "approvedAt": null,
      "rejectedAt": null
    },
    "requiredDocuments": [],
    "nextAction": {
      "type": "wait_for_update"
    }
  }
}
```

---

### After the Database Change

**GET /api/v2/customers/onboarding-status?astppId=102627**

```json
{
  "success": true,
  "message": "KYC details required",
  "data": {
    "applicationStatus": "requires_kyc_upload",
    "wallet": {
      "walletId": "...",
      "accountNumber": "...",
      "currency": "KES",
      "status": "active",
      "createdAt": "..."
    },
    "application": {
      "sasapayRequestId": "...",
      "sasapayAccountNumber": "...",
      "sasapayAccountStatus": "ACTIVE",
      "submittedAt": "...",
      "approvedAt": null,
      "rejectedAt": null
    },
    "requiredDocuments": ["document_front", "document_back", "selfie"],
    "nextAction": {
      "type": "upload_kyc_documents",
      "method": "POST",
      "endpoint": "/api/v2/customers/kyc/submissions/images"
    }
  }
}
```

**Key Changes:**
1. `applicationStatus` changes from `"pending"` to `"requires_kyc_upload"`
2. `message` changes to `"KYC details required"`
3. `requiredDocuments` populates with `["document_front", "document_back", "selfie"]`
4. `nextAction.type` changes from `"wait_for_update"` to `"upload_kyc_documents"`

---

## Code Evidence

### 1. Status Service Decision Logic

**File:** `src/modules/onboarding/services/onboarding-status.service.ts`
**Lines:** 44-47

```typescript
const kycSubmission = await this.sasaPayKyc.getCurrentStatus(customerId);
const requiredDocuments: string[] = kycSubmission?.requiredDocuments || [];
if (kycSubmission?.status === 'awaiting_documents' && requiredDocuments.length) {
  applicationStatus = 'requires_kyc_upload';
}
```

**Lines:** 60-68

```typescript
if (
  application?.sasapay_account_number
  && kycSubmission?.status === 'awaiting_documents'
  && requiredDocuments.length
) {
  nextAction = {
    type: 'upload_kyc_documents',
    method: 'POST',
    endpoint: '/api/v2/customers/kyc/submissions/images',
  };
}
```

---

### 2. getCurrentStatus Query

**File:** `src/modules/onboarding/services/sasapay-kyc.service.ts`
**Lines:** 237-277

```typescript
const application = await this.db.queryOne(
  `SELECT ca.id, ca.customer_id,
          sasapay.id AS detail_id,
          sasapay.sasapay_submission_status AS status,
          sasapay.required_documents,
          ...
   FROM customer_applications ca
   LEFT JOIN customer_applicant_details sasapay
     ON sasapay.customer_application_id = ca.id 
     AND sasapay.application_type = 'sasapay_kyc'
   WHERE ca.customer_id = $1
   LIMIT 1`,
  [customerId],
);

if (!application || !application.detail_id) {
  return null;
}
```

---

### 3. KYC Source Priority

**File:** `src/modules/onboarding/services/sasapay-kyc.service.ts`
**Lines:** 98-102

```typescript
CASE 
  WHEN sasapay.id IS NOT NULL THEN 'sasapay_kyc'
  WHEN wallet.id IS NOT NULL THEN 'wallet_kyc'
  WHEN primary_kyc.id IS NOT NULL THEN 'primary_kyc'
  ELSE NULL
END AS kyc_source
```

---

## Recommendations

### 1. Immediate Action for Customer 333407

Execute the INSERT statement provided above to create a `sasapay_kyc` submission record with `sasapay_submission_status = 'awaiting_documents'`. This will immediately flag the customer as requiring secondary KYC in both API responses.

---

### 2. Document Type Mapping

The customer's document type in the activity logs is `"documentType": "2"`. Verify the mapping in the codebase to determine whether this is:
- 0 = NATIONAL_ID
- 1 = PASSPORT
- 2 = ALIEN_CARD/ALIEN_ID
- 3 = SERVICE_CARD

Based on the schema seed data (lines 171-179), the available policies are for 'national_id', 'passport', and 'alien_id'. Adjust the INSERT statement's `identity_document_type` value accordingly.

---

### 3. Customer Communication

After the database change, the customer will see the "upload_kyc_documents" action in the app. Consider:
1. Sending a push notification explaining why they need to re-submit documents
2. Including instructions on how to obtain a valid document number
3. Providing customer support contact information

---

### 4. Future Prevention

The root cause is that SasaPay returns a success response even when the document number is invalid. Consider:
1. Adding validation rules for document numbers (length, format, check digits)
2. Logging SasaPay responses with status=true but no actual OTP delivery
3. Creating alerts for jobs that complete without progressing the customer's onboarding state

---

### 5. Monitoring After Change

After executing the database change, monitor:
1. Customer 333407's API calls to verify they see the new nextAction
2. Document upload attempts to the `/api/v2/customers/kyc/submissions/images` endpoint
3. Activity logs for SASAPAY_KYC_SUBMISSION events

---

## Alternative Approaches Considered

### 1. Update kyc_status in customer_applications

**Rejected Reason:** The `kyc_status` column in `customer_applications` is a general status ('pending', 'approved', 'rejected'). It does not control the nextAction logic. The API specifically checks for a `sasapay_kyc` submission with `sasapay_submission_status = 'awaiting_documents'`.

---

### 2. Create a wallet_kyc submission instead of sasapay_kyc

**Rejected Reason:** The API's `getCurrentStatus` method (lines 237-277) explicitly filters for `application_type = 'sasapay_kyc'`. Creating a `wallet_kyc` row would not trigger the secondary KYC flow.

---

### 3. Mark the existing job as FAILED

**Rejected Reason:** The job has already completed. Changing its status would not affect the customer's onboarding state or API responses. The status check logic relies on the presence of a `sasapay_kyc` submission, not job status.

---

## Conclusion

The solution is a **single INSERT statement** that creates a `sasapay_kyc` submission record with:
- `application_type = 'sasapay_kyc'`
- `sasapay_submission_status = 'awaiting_documents'`
- `required_documents = ['document_front', 'document_back', 'selfie']`
- `images = []`

This leverages the existing secondary KYC workflow without requiring any code changes. The API's prioritized KYC source logic will automatically use the sasapay_kyc data, and the status checks will display the "upload_kyc_documents" action to the customer.

**Tables Modified:** `customer_applicant_details` (1 INSERT)

**Columns Affected:**
- `application_type`
- `sasapay_submission_status`
- `required_documents`

**API Endpoints Affected:**
1. `GET /api/v2/customers/onboarding-status` - will return nextAction.type = 'upload_kyc_documents'
2. `GET /api/v2/customers/kyc/submissions/status` - will return the new submission with awaiting_documents status
3. `POST /api/v2/customers/kyc/submissions/images` - will accept document uploads from the customer

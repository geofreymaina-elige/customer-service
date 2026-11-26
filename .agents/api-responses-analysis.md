# API Response Analysis for Customer 333407 (Invalid KYC Documents)

## Current State

Customer 333407 has:
- Invalid document number: `123456788`
- Document type: `2` (NATIONAL_ID - accepted by system)
- SasaPay returns success but never sends OTP
- Job status: COMPLETED
- Multiple `SASAPAY_PERSONAL_ONBOARDING_INITIATED` events with `status: "otp_sent"`

## API Endpoints

### 1. GET `/api/v2/customers/onboarding-status?astppId=102627`

**Controller:** `src/modules/wallets/controllers/wallet.controller.ts` (line 69)
**Service:** `src/modules/onboarding/services/onboarding-status.service.ts` (line 24)

#### Current Response (Before Database Change)

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
      "createdAt": "2026-11-26T06:23:02.737Z"
    },
    "application": {
      "sasapayRequestId": "c71afb6b-b776-4343-ba86-2fcd96cffe2c",
      "sasapayAccountNumber": "...",
      "sasapayAccountStatus": "ACTIVE",
      "submittedAt": "2026-11-26T06:24:02.699Z",
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

**Key Issues:**
- `applicationStatus: "pending"` - Customer appears to be waiting
- `nextAction.type: "wait_for_update"` - No action for customer to take
- `requiredDocuments: []` - No documents required
- Customer is stuck with no way to proceed

#### Expected Response (After Database Change)

After inserting a `sasapay_kyc` row with `sasapay_submission_status = 'awaiting_documents'`:

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
      "createdAt": "2026-11-26T06:23:02.737Z"
    },
    "application": {
      "sasapayRequestId": "c71afb6b-b776-4343-ba86-2fcd96cffe2c",
      "sasapayAccountNumber": "...",
      "sasapayAccountStatus": "ACTIVE",
      "submittedAt": "2026-11-26T06:24:02.699Z",
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

**Changes:**
- `applicationStatus: "requires_kyc_upload"` - Clear status that action is needed
- `message: "KYC details required"` - Informative message
- `requiredDocuments: ["document_front", "document_back", "selfie"]` - Lists what's needed
- `nextAction.type: "upload_kyc_documents"` - Clear call to action
- `nextAction.endpoint` - Points to upload endpoint

---

### 2. POST `/api/v2/auth/sessions/device`

**Controller:** `src/modules/onboarding/controllers/onboarding.controller.ts` (line 94)
**Service:** `src/modules/onboarding/services/onboarding.service.ts`

This endpoint handles device registration and returns session tokens. It's the initial entry point.

#### Current Response (Likely)

For a returning customer with invalid KYC:

```json
{
  "success": true,
  "message": "Welcome! Your customer profile and account have been created.",
  "data": {
    "user": {
      "userId": "a39cea49-31a9-4d42-9f1b-2bcade19580d",
      "astppId": 102627,
      "phoneNumber": "254727265334",
      "firstName": "Teresa",
      "lastName": "Wanjiku",
      "isWalletPinSet": true
    },
    "token": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "tokenType": "Bearer",
      "expiresInSeconds": 2592000
    },
    "otpPending": false
  }
}
```

**Key Issues:**
- `otpPending: false` - Customer not prompted for any action
- Returns access token but customer has no clear next step
- Must rely on subsequent call to `/onboarding-status` to know what to do

#### Expected Behavior (After Database Change)

This endpoint's response doesn't change. However, the app should:
1. Call this endpoint first to get access token
2. Then call `/api/v2/customers/onboarding-status` to check status
3. The status endpoint will return `nextAction.type: "upload_kyc_documents"`
4. App redirects customer to KYC upload screen

---

## Code Logic Analysis

### How the Status is Determined

From `onboarding-status.service.ts` lines 44-47:

```typescript
const kycSubmission = await this.sasaPayKyc.getCurrentStatus(customerId);
const requiredDocuments: string[] = kycSubmission?.requiredDocuments || [];
if (kycSubmission?.status === 'awaiting_documents' && requiredDocuments.length) {
  applicationStatus = 'requires_kyc_upload';
}
```

**Key Decision Point:** If there's a `sasapay_kyc` submission with status `awaiting_documents` and documents are required, the status becomes `requires_kyc_upload`.

From lines 60-68:

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

**Key Decision Point:** If customer has a SasaPay account AND needs documents, the next action is set to upload KYC.

### Where getCurrentStatus Gets Data

From `sasapay-kyc.service.ts` lines 237-277:

```sql
SELECT ca.id, ca.customer_id,
       sasapay.id AS detail_id,
       sasapay.sasapay_submission_status AS status,
       sasapay.required_documents,
       ...
FROM customer_applications ca
LEFT JOIN customer_applicant_details sasapay
  ON sasapay.customer_application_id = ca.id 
  AND sasapay.application_type = 'sasapay_kyc'
WHERE ca.customer_id = $1
```

**Critical:** This query ONLY looks for `application_type = 'sasapay_kyc'`. If no such row exists, it returns `null`, and the status logic treats the customer as not needing secondary KYC.

---

## Solution Summary

### Database Change Required

Insert ONE row into `customer_applicant_details`:

```sql
INSERT INTO customer_applicant_details (
  customer_application_id,
  customer_id,
  astpp_id,
  application_type,
  name,
  identity_document_type,
  identity_document_number,
  issuing_country,
  sasapay_submission_status,
  required_documents,
  images,
  policy_id,
  policy_version,
  created_at,
  updated_at
)
VALUES (
  (SELECT id FROM customer_applications WHERE customer_id = 333407),
  333407,
  102627,
  'sasapay_kyc',
  'Teresa Wanjiku',
  'NATIONAL_ID',
  '123456788',
  'KEN',
  'awaiting_documents',
  ARRAY['document_front', 'document_back', 'selfie'],
  '[]'::jsonb,
  (SELECT id FROM document_policies WHERE document_type = 'national_id' AND is_active = TRUE),
  1,
  NOW(),
  NOW()
);
```

### What This Achieves

1. **Both APIs will immediately reflect the change** - No code deployment needed
2. **Customer can proceed** - App will show KYC upload screen
3. **Customer can upload valid documents** - POST to `/api/v2/customers/kyc/submissions/images`
4. **Status updates as documents are uploaded** - System tracks progress
5. **Documents can be reviewed** - Admin can approve/reject the new submission

### App Flow After Change

1. Customer opens app
2. App calls `POST /api/v2/auth/sessions/device` - Gets access token
3. App calls `GET /api/v2/customers/onboarding-status?astppId=102627`
4. API returns `nextAction.type = "upload_kyc_documents"`
5. App navigates to KYC document upload screen
6. Customer uploads valid ID documents
7. Documents are submitted to SasaPay
8. Customer completes onboarding

---

## Alternative: What if We DON'T Want Secondary KYC?

If the goal is to simply unblock the customer without requiring document uploads, you would need to:

1. Update the job status to show it failed (not recommended - job actually completed)
2. OR trigger a re-attempt of the onboarding flow (creates duplicate issues)
3. OR manually create the wallet connection (bypasses SasaPay validation)

**None of these are recommended.** The secondary KYC flow is the proper solution when primary KYC fails at the provider level.

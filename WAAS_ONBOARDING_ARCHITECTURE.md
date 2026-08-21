# WaaS Onboarding Architecture

## Overview
Multi-step asynchronous onboarding flow for SasaPay Wallet as a Service (WaaS) integration with automated KYC image fetching from ASTPP server via SSH.

## Simplified API Response

### POST /api/v1/onboarding/user-device
**Response:**
```json
{
  "success": true,
  "message": "Onboarding initiated",
  "data": {
    "user": {
      "userId": "customer-uuid",
      "astppId": "10492",
      "phoneNumber": "+254700010492",
      "firstName": "Jeff",
      "lastName": "Test",
      "isWalletPinSet": false
    },
    "token": null  // Only present if PIN already set
  }
}
```

**What happens:**
1. Customer record created/updated in PostgreSQL
2. Device registered with single-device enforcement
3. Background job enqueued: `sasapay_waas_onboarding`
4. Returns immediately with basic user info

---

## Background Job Flow

### Job Type: `sasapay_waas_onboarding`

**Payload:**
```json
{
  "customerId": 12345,
  "astppId": 10492,
  "applicationId": 10285  // From ASTPP MySQL applications.id
}
```

**Job State Machine:**
```
sasapay_init → awaiting_otp → fetch_images → upload_kyc → completed
```

---

## Step-by-Step Flow

### Step 1: SasaPay WaaS Initiation
**Trigger:** Automatic (when job starts)

**Actions:**
1. Fetch customer data from PostgreSQL (name, phone, email)
2. Fetch primary KYC details from `customer_applications` + `customer_applicant_details`
3. Call SasaPay API: `POST /api/v2/waas/personal-onboarding/`
4. Store `sasapay_request_id` in `customer_applications` table
5. Update job state to `awaiting_otp`

**SasaPay Request:**
```json
{
  "merchantCode": "600980",
  "firstName": "Jeff",
  "middleName": "",
  "lastName": "Test",
  "countryCode": "254",
  "mobileNumber": "0700010492",
  "documentType": "1",
  "documentNumber": "12345678",
  "email": "jeff@example.com",
  "callbackUrl": "https://api.example.com/api/v1/onboarding/callback/sasapay"
}
```

**SasaPay Response:**
```json
{
  "status": true,
  "responseCode": "0",
  "message": "Confirmation code has been sent to 254700010492",
  "requestId": "ef348e2f-f59b-446a-b92c-4d93ebf580a0"
}
```

---

### Step 2: OTP Verification
**Trigger:** User calls `/api/v1/onboarding/personal/confirm` with OTP

**Client Request:**
```json
{
  "requestId": "ef348e2f-f59b-446a-b92c-4d93ebf580a0",
  "otp": "123456"
}
```

**Actions:**
1. Call SasaPay API: `POST /api/v2/waas/personal-onboarding/confirmation/`
2. Check `accountStatus` in response:
   - `ACTIVE` → No KYC upload needed (job completes)
   - `AWAITING_KYC_UPLOAD` → Trigger Step 3 (fetch images)
   - `AWAITING_APPROVAL` → Wait for manual approval
3. Store `sasapay_account_number` and `accountStatus` in job state
4. Update job state to `fetch_images` if KYC upload required

**SasaPay Response:**
```json
{
  "status": true,
  "responseCode": "0",
  "message": "Registration successful",
  "data": {
    "merchantCode": "600980",
    "accountNumber": "254700010492",
    "displayName": "Jeff Test",
    "accountStatus": "AWAITING_KYC_UPLOAD",
    "accountBalance": 0
  }
}
```

---

### Step 3: Fetch KYC Images via SSH
**Trigger:** Automatic (when `accountStatus` is `AWAITING_KYC_UPLOAD`)

**Actions:**
1. Query ASTPP MySQL `wallet_application_images` table for wallet KYC images:
   ```sql
   SELECT filename, image_type, description, mime_type
   FROM wallet_application_images
   WHERE application_id = 10285 
     AND status = 1 
     AND purpose = 'wallet_kyc'
   ORDER BY upload_date DESC
   ```

2. Prioritize wallet KYC images:
   - `image_type = 'identity_document'` → Front
   - `image_type = 'identity_document_back'` → Back
   - `image_type = 'passport_photo'` → Selfie

3. Fallback to primary KYC from `applicant_details` if wallet images not found:
   ```sql
   SELECT identity_document, identity_document_back, id_verification
   FROM applicant_details
   WHERE application_id = 10285
   ```

4. SSH into ASTPP server:
   - Host: Configured in `.env` (`ASTPP_SSH_HOST`)
   - Username: `jeff` (or configured)
   - Auth: Private key (`ASTPP_SSH_PRIVATE_KEY_PATH`)
   - Remote path: `/var/www/html/astpp/application_images/10285/`

5. Download images to temporary directory:
   - `/tmp/kyc_12345_1234567890/front.jpg`
   - `/tmp/kyc_12345_1234567890/back.jpg`
   - `/tmp/kyc_12345_1234567890/selfie.jpg`

6. Update job state to `upload_kyc`

**Example File Listing:**
```bash
/var/www/html/astpp/application_images/10285/
├── bean-dancing_1759991601_identity_document.png  # Front (wallet KYC)
├── beanny_1759991601_identity_document_back.jpg   # Back (wallet KYC)
├── 1756732809828_photo.jpg                         # Selfie (primary KYC)
```

---

### Step 4: Upload KYC to SasaPay
**Trigger:** Automatic (after images fetched)

**Actions:**
1. Prepare multipart/form-data with downloaded images
2. Call SasaPay API: `POST /api/v2/waas/personal-onboarding/kyc/`
3. Clean up temporary image files
4. Update `customer_applications.kyc_status` to `requires_kyc_upload`
5. Update job state to `completed`

**SasaPay Request (multipart/form-data):**
```
merchantCode: 600980
customerMobileNumber: 0700010492
documentImageFront: [FILE: front.jpg]
documentImageBack: [FILE: back.jpg]
passportSizePhoto: [FILE: selfie.jpg]
```

**SasaPay Response:**
```json
{
  "status": true,
  "responseCode": "0",
  "message": "Documents uploaded successfully."
}
```

---

### Step 5: SasaPay Callback (Final Status)
**Trigger:** SasaPay webhook (when KYC review completes)

**Webhook Payload:**
```json
{
  "merchantCode": "600980",
  "displayName": "Jeff Test",
  "accountNumber": "254700010492",
  "accountStatus": "APPROVED",  // or "REJECTED"
  "description": "Onboarding completed successfully."
}
```

**Actions:**
1. Update `customer_applications.kyc_status` to `approved` or `rejected`
2. If approved:
   - Create wallet record in `customer_wallets`
   - Update `customers.wallet_kyc_status` to `approved`
   - Emit event: `customer.wallet_kyc_approved`

---

## Configuration Required

### Environment Variables (.env)

```bash
# ASTPP SSH Configuration
ASTPP_SSH_HOST=newastpp.example.com
ASTPP_SSH_PORT=22
ASTPP_SSH_USERNAME=jeff
ASTPP_SSH_PRIVATE_KEY_PATH=/path/to/private/key
ASTPP_IMAGES_PATH=/var/www/html/astpp/application_images

# SasaPay WaaS Configuration
SASAPAY_BASE_URL=https://sandbox.sasapay.app
SASAPAY_CLIENT_ID=your_client_id
SASAPAY_CLIENT_SECRET=your_client_secret
SASAPAY_MERCHANT_CODE=600980
SASAPAY_CALLBACK_URL=https://api.example.com/api/v1/onboarding/callback/sasapay
```

### Dependencies to Install

```bash
npm install ssh2 form-data
```

---

## Database Schema Updates Needed

### Add to 001_initial_schema.sql:

```sql
-- Store onboarding job state
CREATE TABLE IF NOT EXISTS waas_onboarding_jobs (
    id BIGSERIAL PRIMARY KEY,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    customer_id BIGINT NOT NULL REFERENCES customers(id),
    astpp_id INTEGER,
    application_id INTEGER,
    
    -- Job state
    current_step VARCHAR(50) NOT NULL DEFAULT 'sasapay_init',
    sasapay_request_id VARCHAR(255),
    sasapay_account_number VARCHAR(50),
    sasapay_account_status VARCHAR(50),
    
    -- Image paths (temporary)
    local_front_image TEXT,
    local_back_image TEXT,
    local_selfie_image TEXT,
    
    -- Audit
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    error_message TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_waas_jobs_customer ON waas_onboarding_jobs(customer_id);
CREATE INDEX IF NOT EXISTS idx_waas_jobs_step ON waas_onboarding_jobs(current_step);
```

---

## API Endpoints Summary

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/v1/onboarding/user-device` | Initiate onboarding (enqueues background job) |
| POST | `/api/v1/onboarding/personal/confirm` | Verify OTP (triggers image fetch if needed) |
| POST | `/api/v1/onboarding/callback/sasapay` | Webhook for final KYC status |

---

## Client Flow

1. **Call** `POST /api/v1/onboarding/user-device` with `astpp_id` and device details
2. **Receive** simplified response with `user` data and optional `token`
3. **User receives SMS OTP** from SasaPay
4. **Call** `POST /api/v1/onboarding/personal/confirm` with OTP code
5. **Background job** automatically fetches images and uploads to SasaPay
6. **Wait for webhook** callback with final approval status

**Total client API calls: 2** (down from 3)

---

## Error Handling

- **SSH connection fails**: Job retries with exponential backoff (max 5 attempts)
- **Images missing**: Job fails with descriptive error (manual intervention needed)
- **SasaPay API fails**: Job retries with delay
- **OTP invalid**: User can retry (no job impact)

---

## Security Considerations

1. **SSH Private Key**: Store securely, never commit to repository
2. **Temporary Files**: Cleaned up after upload (stored in OS temp directory)
3. **SasaPay Token**: Cached in memory, refreshed automatically
4. **Job Queue**: Uses PostgreSQL `FOR UPDATE SKIP LOCKED` for concurrency

---

## Monitoring & Observability

**Key Metrics:**
- Onboarding job success rate
- Average time per step
- SSH connection failures
- SasaPay API response times
- Image fetch success rate

**Logs:**
- `[STEP 1]` SasaPay WaaS initiation
- `[STEP 2]` SSH image fetch
- `[STEP 3]` KYC upload
- `[CALLBACK]` Final status update

**Database Query:**
```sql
SELECT customer_id, current_step, started_at, error_message
FROM waas_onboarding_jobs
WHERE completed_at IS NULL
ORDER BY started_at DESC;
```

---

## Future Enhancements

1. **Retry Logic**: Exponential backoff for transient failures
2. **Image Validation**: Check file size, format, dimensions before upload
3. **Notification**: Send SMS/email when KYC is approved/rejected
4. **Admin Dashboard**: View onboarding job status and manually retry
5. **Metrics Dashboard**: Real-time monitoring of onboarding pipeline


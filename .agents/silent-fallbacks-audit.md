# Silent Fallbacks Audit

## Overview
Audit of all silent fallback patterns (`|| 'default_value'`) in the codebase to identify potential data quality issues.

---

## Critical Fallbacks (External API Calls)

### ✅ FIXED: waas-onboarding-job.service.ts

**Before:**
```typescript
documentType: this.mapDocTypeToSasaPay(kycDetails?.identity_document_type || 'NATIONAL_ID'),
documentNumber: kycDetails?.identity_document_number || `ID${customer.astpp_id}`,
```

**After:**
```typescript
// Now throws explicit errors if data is missing
if (!kycDetails?.identity_document_type) {
  throw new Error(`Customer ${customer.id} has no identity_document_type in KYC details.`);
}
if (!kycDetails?.identity_document_number) {
  throw new Error(`Customer ${customer.id} has no identity_document_number in KYC details.`);
}
documentType: mapPostgresToSasaPay(kycDetails.identity_document_type),
documentNumber: kycDetails.identity_document_number,
```

**Impact:** High - this was sending data to SasaPay API, silent fallbacks could cause invalid submissions.

---

## Non-Critical Fallbacks (Internal Use)

### 1. customer.service.ts - GET API Response

**Location:** Line 91
```typescript
kyc: primaryKyc ? {
  documentType: primaryKyc.identity_document_type || 'NATIONAL_ID',
  documentNumber: primaryKyc.identity_document_number,
  issuingCountry: primaryKyc.issuing_country || 'KEN',
  kycStatus: primaryKyc.kyc_status || 'pending',
  kycTier: primaryKyc.kyc_tier || 'TIER_1',
  // ...
}
```

**Assessment:** ⚠️ LOW PRIORITY
- This is a GET endpoint returning customer data to frontend
- Fallbacks provide sensible defaults for display purposes
- Not sending to external APIs
- Database constraints should prevent NULLs in the first place

**Recommendation:** Keep as-is, but add database constraint validation to ensure `identity_document_type` is never NULL in `customer_applicant_details`.

---

### 2. Data Sync Workers (CDC, Snapshot, WaaS Job)

**Locations:**
- `src/workers/cdc/cdc-consumer.worker.ts:479` - `identity_document_number || ''`
- `src/workers/snapshot/snapshot.worker.ts:399` - `identity_document_number || ''`
- `src/workers/snapshot/snapshot.worker.ts:444` - `identity_document_number || ''`
- `src/modules/onboarding/services/waas-onboarding-job.service.ts:568` - `identity_document_number || ''`
- `src/modules/onboarding/services/waas-onboarding-job.service.ts:641` - `identity_document_number || ''`

**Example:**
```typescript
await this.db.query(
  `INSERT INTO customer_applicant_details (..., identity_document_number, ...)
   VALUES (..., $6, ...)`,
  [
    // ...
    identity_document_number || '',  // Fallback to empty string
    // ...
  ]
);
```

**Assessment:** ✅ ACCEPTABLE
- These are syncing data from ASTPP MySQL → PostgreSQL
- Empty strings are acceptable for missing data (database column allows empty string)
- Not being sent to external APIs at this point
- Source data quality in ASTPP should be validated separately

**Recommendation:** Keep as-is. If ASTPP has NULL/empty document numbers, we should preserve that state rather than failing the sync.

---

### 3. ASTPP Adapter Service

**Location:** `src/modules/astpp/astpp-adapter.service.ts:169`
```typescript
applicantDetails: applicant ? {
  name: applicant.name || `${account.first_name || ''} ${account.last_name || ''}`.trim(),
  identityDocumentType: applicant.identity_document_type ?? 0,
  identityDocumentNumber: applicant.identity_document_number || '',
  // ...
}
```

**Assessment:** ✅ ACCEPTABLE
- This is reading from ASTPP (read-only operation)
- Returns a data transfer object for internal use
- Fallbacks handle cases where ASTPP has incomplete data
- Not sending to external APIs

**Recommendation:** Keep as-is. This is a defensive read operation.

---

### 4. SasaPay KYC Service

**Location:** `src/modules/onboarding/services/sasapay-kyc.service.ts` (multiple lines)

**Examples:**
```typescript
status: application.sasapay_submission_status || null,
submittedAt: application.sasapay_submitted_at || application.submitted_at || null,
reviewedAt: application.sasapay_result_at || null,
reason: application.psp_reason || null,
```

**Assessment:** ✅ ACCEPTABLE
- These are building response DTOs for GET endpoints
- Fallbacks to `null` are explicit (not hiding data issues)
- Not constructing external API requests
- Used for status checking and reporting

**Recommendation:** Keep as-is.

---

## Summary

### Fixed (High Priority)
✅ **waas-onboarding-job.service.ts** - Removed silent fallbacks for SasaPay API calls
  - Now throws explicit errors if document type/number missing
  - Forces data quality at the point of external API submission

### Keep (Low Priority / Acceptable)
✅ **customer.service.ts** - GET API response fallbacks (display only)  
✅ **Data sync workers** - Empty string fallbacks for incomplete ASTPP data  
✅ **astpp-adapter.service.ts** - Defensive reading from source database  
✅ **sasapay-kyc.service.ts** - Explicit NULL fallbacks in response DTOs  

---

## Recommendations

### 1. Database Constraints
Add NOT NULL constraints where appropriate:
```sql
ALTER TABLE customer_applicant_details
  ALTER COLUMN identity_document_type SET NOT NULL,
  ALTER COLUMN identity_document_number SET NOT NULL;
```

This prevents the problem at the data layer rather than relying on application logic.

### 2. Validation at Data Entry
Ensure ASTPP has proper validation so incomplete records never enter the system in the first place.

### 3. Monitoring
Add logging/metrics when fallbacks are used in data sync operations:
```typescript
if (!identity_document_number) {
  this.logger.warn(`ASTPP customer ${astppId} missing document number, using empty string`);
}
```

---

## Test Cases

### Unit Tests Needed
```typescript
describe('WaaS Onboarding Job - Data Validation', () => {
  it('should throw error when identity_document_type is missing', async () => {
    const payload = { customerId: 123, astppId: 456, applicationId: null };
    // Mock kycDetails query to return { identity_document_type: null }
    
    await expect(service.step1_InitiateSasaPayWaaS(payload))
      .rejects.toThrow('Customer 123 has no identity_document_type in KYC details.');
  });

  it('should throw error when identity_document_number is missing', async () => {
    const payload = { customerId: 123, astppId: 456, applicationId: null };
    // Mock kycDetails query to return { identity_document_number: null }
    
    await expect(service.step1_InitiateSasaPayWaaS(payload))
      .rejects.toThrow('Customer 123 has no identity_document_number in KYC details.');
  });

  it('should succeed when all required fields are present', async () => {
    const payload = { customerId: 123, astppId: 456, applicationId: null };
    // Mock kycDetails query to return complete data
    
    const result = await service.step1_InitiateSasaPayWaaS(payload);
    expect(result.step).toBe('awaiting_otp');
  });
});
```

---

## Related Documents
- **Centralized mappings:** `.agents/centralized-document-mappings.md`
- **Document type fix:** `.agents/document-type-fix-applied.md`
- **Original investigation:** `.agents/document-type-mapping-issue.md`

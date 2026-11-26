# Document Type Mapping Issue - CRITICAL BUG

## Problem Summary

There are **THREE DIFFERENT document type mappings** between ASTPP (MySQL) and the application, causing **data corruption** when syncing customer KYC data and sending it to SasaPay.

---

## The Three Conflicting Mappings

### 1. ASTPP MySQL → PostgreSQL (CDC Worker)
**File:** `src/workers/cdc/cdc-consumer.worker.ts` (line 584)

```typescript
private mapDocumentType(type: number | undefined): string {
  if (!type) return 'NATIONAL_ID';
  switch (type) {
    case 0: return 'NATIONAL_ID';
    case 1: return 'PASSPORT';        // ❌ WRONG
    case 2: return 'ALIEN_CARD';      // ❌ WRONG
    case 3: return 'SERVICE_CARD';    // ❌ WRONG
    default: return 'NATIONAL_ID';
  }
}
```

### 2. ASTPP MySQL → PostgreSQL (Snapshot/WaaS Job Worker)
**File:** `src/modules/onboarding/services/waas-onboarding-job.service.ts` (line 1120)

```typescript
private mapDocumentType(type: number | undefined): string {
  switch (type) {
    case 1: return 'PASSPORT';        // ❌ WRONG
    case 2: return 'ALIEN_CARD';      // ❌ WRONG
    case 3: return 'SERVICE_CARD';    // ❌ WRONG
    default: return 'NATIONAL_ID';
  }
}
```

### 3. PostgreSQL → SasaPay API
**File:** `src/modules/onboarding/services/waas-onboarding-job.service.ts` (line 1133)

```typescript
private mapDocTypeToSasaPay(docType: string): string {
  const mapping: Record<string, string> = {
    NATIONAL_ID: '1',
    SERVICE_CARD: '1',      // Maps to same as NATIONAL_ID
    ALIEN_CARD: '2',        // ❌ WRONG - SasaPay expects '3'
    PASSPORT: '3',          // ❌ WRONG - SasaPay expects '2'
  };
  return mapping[docType] ?? '1';
}
}
```

---

## Correct Mappings

### ASTPP MySQL Numbers
According to your specification:
- `0` → National ID Card
- `1` → Service/Military Card
- `2` → Alien Card
- `3` → Passport

### SasaPay API Numbers
According to your specification and the DTO validation comment:
- `"1"` → ID card (National ID)
- `"2"` → Passport
- `"3"` → Alien ID

**DTO Validation:** `src/modules/onboarding/dto/onboarding.dto.ts` line 61:
```typescript
@IsIn(['1', '2', '3']) // "1" (ID card), "2" (Passport), "3" (Alien ID)
documentType: string;
```

---

## Impact Analysis

### Customer 333407 Issue

Looking at the activity logs:
```json
{
  "documentType": "2",
  "documentNumber": "123456788"
}
```

**Current Flow (BROKEN):**

1. **ASTPP has:** `identity_document_type = 2` (Alien Card)
2. **CDC Worker stores in PG:** `ALIEN_CARD` (correct if ASTPP = 2)
3. **WaaS job reads PG:** `ALIEN_CARD`
4. **WaaS job sends to SasaPay:** `documentType: "2"` (via `mapDocTypeToSasaPay`)
5. **SasaPay receives:** `"2"` = **PASSPORT** (not Alien Card!)
6. **Document number `123456788`** is invalid for a PASSPORT
7. **SasaPay returns success but doesn't send OTP** (silent failure)

### Real-World Impact

#### Scenario 1: Customer has ASTPP document_type = 2 (Alien Card)
- CDC Worker stores: `ALIEN_CARD` ✓
- Waas Job sends SasaPay: `"2"` (Passport) ❌
- **Result:** SasaPay validates as Passport with Alien Card number → FAILS

#### Scenario 2: Customer has ASTPP document_type = 3 (Passport)
- CDC Worker stores: `SERVICE_CARD` ❌ (should be PASSPORT)
- Waas Job sends SasaPay: `"1"` (ID card) ❌ (should be "2")
- **Result:** SasaPay validates as ID card with Passport number → FAILS

#### Scenario 3: Customer has ASTPP document_type = 1 (Service Card)
- CDC Worker stores: `PASSPORT` ❌ (should be SERVICE_CARD)
- Waas Job sends SasaPay: `"3"` (Alien ID) ❌ (should be "1")
- **Result:** SasaPay validates as Alien ID with Service Card number → FAILS

#### Scenario 4: Customer has ASTPP document_type = 0 (National ID)
- CDC Worker stores: `NATIONAL_ID` ✓
- Waas Job sends SasaPay: `"1"` (ID card) ✓
- **Result:** Works correctly (by luck)

**Only National ID customers (type = 0) are onboarding successfully. All other document types are failing silently.**

---

## Affected Code Locations

### 1. CDC Worker
**File:** `src/workers/cdc/cdc-consumer.worker.ts`
**Line:** 584
**Function:** `private mapDocumentType(type: number | undefined): string`

### 2. Snapshot Worker
**File:** `src/workers/snapshot/snapshot.worker.ts`
**Expected:** Same mapping as CDC worker (needs verification)

### 3. WaaS Onboarding Job Service
**File:** `src/modules/onboarding/services/waas-onboarding-job.service.ts`
**Lines:** 
- 1120 (ASTPP → PG mapping)
- 1133 (PG → SasaPay mapping)

### 4. Any other services that read/write document types
Needs investigation for:
- `src/modules/customers/services/customer.service.ts`
- `src/modules/onboarding/services/sasapay-kyc.service.ts`
- `src/modules/operations/services/admin-sasapay-kyc.service.ts`
- `src/modules/operations/services/wallet-kyc-sync.service.ts`

---

## Correct Mapping Functions

### ASTPP MySQL → PostgreSQL

```typescript
private mapDocumentType(type: number | undefined): string {
  if (type === undefined || type === null) return 'NATIONAL_ID';
  
  switch (type) {
    case 0: return 'NATIONAL_ID';
    case 1: return 'SERVICE_CARD';
    case 2: return 'ALIEN_CARD';
    case 3: return 'PASSPORT';
    default: return 'NATIONAL_ID';
  }
}
```

### PostgreSQL → SasaPay API

```typescript
private mapDocTypeToSasaPay(docType: string): string {
  const mapping: Record<string, string> = {
    'NATIONAL_ID': '1',
    'SERVICE_CARD': '1',  // Service/Military cards treated as National ID
    'ALIEN_CARD': '3',    // ✓ FIXED
    'PASSPORT': '2',      // ✓ FIXED
  };
  return mapping[docType] ?? '1';
}
```

---

## Database Corruption Check

### Query to Find Affected Customers

```sql
-- Find customers with potentially wrong document types
SELECT 
  c.id,
  c.astpp_id,
  c.phone_number,
  c.first_name,
  c.last_name,
  cad.identity_document_type,
  cad.identity_document_number,
  ca.sasapay_account_status,
  ca.kyc_status
FROM customers c
JOIN customer_applications ca ON ca.customer_id = c.id
JOIN customer_applicant_details cad ON cad.customer_application_id = ca.id
WHERE cad.application_type = 'primary_kyc'
  AND cad.identity_document_type IN ('PASSPORT', 'ALIEN_CARD', 'SERVICE_CARD')
ORDER BY c.id DESC;
```

### Query to Find Failed Onboarding Events

```sql
-- Find customers with SASAPAY_PERSONAL_ONBOARDING_INITIATED but no wallet
SELECT 
  cal.customer_id,
  c.astpp_id,
  c.phone_number,
  cal.details->>'documentType' AS sent_doc_type,
  cal.details->>'documentNumber' AS doc_number,
  cal.details->>'status' AS event_status,
  cal.created_at,
  cw.id AS wallet_id
FROM customer_activity_logs cal
JOIN customers c ON c.id = cal.customer_id
LEFT JOIN customer_wallets cw ON cw.customer_id = cal.customer_id
WHERE cal.event_type = 'SASAPAY_PERSONAL_ONBOARDING_INITIATED'
  AND cal.details->>'status' = 'otp_sent'
  AND cw.id IS NULL
ORDER BY cal.created_at DESC
LIMIT 50;
```

---

## Fix Strategy

### Phase 1: Stop New Corruption (URGENT)

1. **Fix CDC Worker mapping** (`cdc-consumer.worker.ts`)
2. **Fix WaaS Job mappings** (`waas-onboarding-job.service.ts`)
3. **Verify Snapshot Worker** (`snapshot.worker.ts`)
4. Deploy immediately

### Phase 2: Data Correction

#### Option A: Re-sync from ASTPP (Recommended)
- Run snapshot worker to re-fetch all customer data with correct mappings
- Updates will only affect customers where the mapping was wrong

#### Option B: Direct SQL Update
Only if Option A is not feasible:

```sql
-- Back up first!
CREATE TABLE customer_applicant_details_backup AS 
SELECT * FROM customer_applicant_details;

-- Fix corrupted document types (reverse the wrong mapping)
UPDATE customer_applicant_details
SET identity_document_type = CASE identity_document_type
  WHEN 'PASSPORT' THEN 'SERVICE_CARD'
  WHEN 'ALIEN_CARD' THEN 'ALIEN_CARD'  -- Actually correct if from type=2
  WHEN 'SERVICE_CARD' THEN 'PASSPORT'
  ELSE identity_document_type
END,
updated_at = NOW()
WHERE application_type = 'primary_kyc'
  AND identity_document_type IN ('PASSPORT', 'SERVICE_CARD')
  AND sync_version IS NOT NULL;  -- Only CDC/snapshot-synced records
```

**WARNING:** This SQL assumes the CDC worker was the source. If data came from other sources, manual verification is needed.

### Phase 3: Customer Recovery

For affected customers like 333407:

1. **Check ASTPP source data:**
   ```sql
   SELECT identity_document_type, identity_document_number, name
   FROM astpp.applicant_details
   WHERE accountid = 102627;
   ```

2. **If document type was actually valid in ASTPP:**
   - Use the secondary KYC solution (insert `sasapay_kyc` row)
   - Customer uploads correct documents through app

3. **If document was invalid in ASTPP:**
   - Customer needs to update their ASTPP record first
   - Then re-trigger onboarding

---

## Testing Checklist

After deploying the fix:

- [ ] Test customer with ASTPP document_type = 0 (National ID)
- [ ] Test customer with ASTPP document_type = 1 (Service Card)
- [ ] Test customer with ASTPP document_type = 2 (Alien Card)
- [ ] Test customer with ASTPP document_type = 3 (Passport)
- [ ] Verify SasaPay receives correct documentType for each
- [ ] Verify OTP is sent for valid document numbers
- [ ] Run snapshot worker on test customer
- [ ] Run CDC consumer on test customer change event
- [ ] Check all customer_applicant_details records have correct types

---

## Root Cause

1. **No centralized mapping utility** - Three different implementations
2. **No validation tests** - Mapping bugs went undetected
3. **Off-by-one error** - Original developer likely started from 1 instead of 0
4. **Swapped SasaPay codes** - Passport and Alien Card were reversed

---

## Recommendations

### Immediate

1. Create a centralized `DocumentTypeMapper` utility class
2. Add unit tests for all mapping functions
3. Add integration test: ASTPP → PG → SasaPay round-trip
4. Document the authoritative source for each system's numbering

### Long-term

1. Use enums in database instead of magic numbers
2. Add database constraints to validate document types
3. Add monitoring/alerts for SasaPay "success but no OTP" responses
4. Create data quality dashboard showing document type distribution

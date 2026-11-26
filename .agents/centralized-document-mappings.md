# Centralized Document Type Mappings

## Overview

All document type mappings have been centralized into a single source of truth:
**`src/core/constants/document-types.constant.ts`**

This eliminates duplication, reduces mapping errors, and provides a single place to configure document type behavior across the entire application.

---

## Architecture

### Enums

```typescript
// ASTPP MySQL numeric codes (source of truth)
enum AstppDocumentType {
  NATIONAL_ID = 0,
  SERVICE_CARD = 1,
  ALIEN_CARD = 2,
  PASSPORT = 3,
}

// PostgreSQL internal representation
enum DocumentType {
  NATIONAL_ID = 'NATIONAL_ID',
  SERVICE_CARD = 'SERVICE_CARD',
  ALIEN_CARD = 'ALIEN_CARD',
  PASSPORT = 'PASSPORT',
}

// SasaPay API codes
enum SasaPayDocumentType {
  ID_CARD = '1',
  PASSPORT = '2',
  ALIEN_ID = '3',
}
```

### Mapping Tables

```typescript
// ASTPP → PostgreSQL
const ASTPP_TO_POSTGRES_DOC_TYPE: Record<number, DocumentType> = {
  0: 'NATIONAL_ID',
  1: 'SERVICE_CARD',
  2: 'ALIEN_CARD',
  3: 'PASSPORT',
};

// PostgreSQL → SasaPay
const POSTGRES_TO_SASAPAY_DOC_TYPE: Record<DocumentType, SasaPayDocumentType> = {
  NATIONAL_ID: '1',
  SERVICE_CARD: '1',  // Fallback - requires manual KYC
  ALIEN_CARD: '3',
  PASSPORT: '2',
};
```

### Helper Functions

```typescript
// Map ASTPP numeric to PostgreSQL string
function mapAstppToPostgres(astppType: number): DocumentType

// Map PostgreSQL string to SasaPay API code
function mapPostgresToSasaPay(postgresType: string): SasaPayDocumentType

// Map ASTPP numeric directly to SasaPay (bypass PostgreSQL)
function mapAstppToSasaPay(astppType: number): SasaPayDocumentType

// Check if document type is supported by SasaPay auto-onboarding
function isSasaPayAutoOnboardingSupported(documentType: string): boolean

// Check if document type requires manual KYC upload
function requiresManualKyc(documentType: string): boolean
```

---

## Usage

### Before (Duplicated Logic)

Each file had its own mapping function:

```typescript
// cdc-consumer.worker.ts
private mapDocumentType(type: number): string {
  switch (type) {
    case 0: return 'NATIONAL_ID';
    case 1: return 'SERVICE_CARD';
    // ...
  }
}

// snapshot.worker.ts
private mapDocumentType(type: number): string {
  switch (type) {
    case 0: return 'NATIONAL_ID';
    case 1: return 'SERVICE_CARD';
    // ...
  }
}

// waas-onboarding-job.service.ts
private mapDocumentType(type: number): string {
  switch (type) {
    case 0: return 'NATIONAL_ID';
    case 1: return 'SERVICE_CARD';
    // ...
  }
}
```

**Problems:**
- 5 different mapping functions across 4 files
- Easy to have inconsistencies
- Hard to update when requirements change
- No single source of truth

### After (Centralized)

All files now import from the centralized constant:

```typescript
import { mapAstppToPostgres, mapPostgresToSasaPay } from '../../core/constants';

// CDC Consumer, Snapshot Worker, Onboarding Service
private mapDocumentType(type: number): string {
  return mapAstppToPostgres(type);
}

// WaaS Onboarding Job
private mapDocTypeToSasaPay(docType: string): string {
  return mapPostgresToSasaPay(docType);
}
```

**Benefits:**
- Single source of truth
- Consistent across all services
- Easy to update (change once, applies everywhere)
- Self-documenting with clear enums
- Helper functions for common operations

---

## SasaPay Limitation: Service Cards

**Critical:** SasaPay API only supports 3 document types:
- `"1"` = ID card (National ID)
- `"2"` = Passport
- `"3"` = Alien ID

**Service/Military Cards are NOT supported** by SasaPay's automatic onboarding API.

### How It's Handled

1. **Storage:** Service Cards are correctly stored in PostgreSQL as `SERVICE_CARD`
2. **Mapping:** When mapped to SasaPay, they fall back to `"1"` (ID card)
3. **Detection:** Use `requiresManualKyc('SERVICE_CARD')` to detect this scenario
4. **Flow:** Customers with Service Cards must use manual KYC upload flow:
   - `GET /onboarding-status` - API returns status indicating manual KYC required
   - `POST /sessions/device` - Customer uploads additional KYC documents via app

### Implementation Recommendation

The WaaS onboarding job should check if manual KYC is required:

```typescript
import { requiresManualKyc } from '../../../core/constants';

const kycDetails = await this.getCustomerKycDetails(customerId);

if (requiresManualKyc(kycDetails.identity_document_type)) {
  // Skip automatic onboarding, mark as "manual_kyc_required"
  await this.markForManualKyc(customerId);
  
  // Customer will see in-app prompt to upload documents
  return { status: 'manual_kyc_required' };
}

// Otherwise proceed with automatic SasaPay onboarding
await this.sasapayWaas.initiatePersonalOnboardingAuto({
  documentType: mapPostgresToSasaPay(kycDetails.identity_document_type),
  // ...
});
```

---

## Files Modified

All mapping functions now delegate to centralized constants:

1. ✅ `src/core/constants/document-types.constant.ts` - **NEW** (centralized source)
2. ✅ `src/core/constants/index.ts` - **NEW** (barrel export)
3. ✅ `src/workers/cdc/cdc-consumer.worker.ts` - Updated to use `mapAstppToPostgres`
4. ✅ `src/workers/snapshot/snapshot.worker.ts` - Updated to use `mapAstppToPostgres`
5. ✅ `src/modules/onboarding/services/waas-onboarding-job.service.ts` - Updated to use both helpers
6. ✅ `src/modules/onboarding/services/onboarding.service.ts` - Updated to use `mapAstppToPostgres`

---

## Configuration Changes

To modify document type mappings in the future:

1. **Edit only** `src/core/constants/document-types.constant.ts`
2. Update the relevant mapping table or helper function
3. Rebuild: `npm run build`
4. Restart services: `pm2 restart customer-service-*`

**All services automatically inherit the changes** - no need to update multiple files!

---

## Testing

### Unit Tests (Recommended)

```typescript
import {
  mapAstppToPostgres,
  mapPostgresToSasaPay,
  requiresManualKyc,
  isSasaPayAutoOnboardingSupported,
} from '../../../core/constants';

describe('Document Type Mappings', () => {
  describe('ASTPP to PostgreSQL', () => {
    it('should map type 0 to NATIONAL_ID', () => {
      expect(mapAstppToPostgres(0)).toBe('NATIONAL_ID');
    });
    
    it('should map type 1 to SERVICE_CARD', () => {
      expect(mapAstppToPostgres(1)).toBe('SERVICE_CARD');
    });
    
    it('should map type 2 to ALIEN_CARD', () => {
      expect(mapAstppToPostgres(2)).toBe('ALIEN_CARD');
    });
    
    it('should map type 3 to PASSPORT', () => {
      expect(mapAstppToPostgres(3)).toBe('PASSPORT');
    });
    
    it('should default to NATIONAL_ID for undefined', () => {
      expect(mapAstppToPostgres(undefined)).toBe('NATIONAL_ID');
    });
  });

  describe('PostgreSQL to SasaPay', () => {
    it('should map NATIONAL_ID to "1"', () => {
      expect(mapPostgresToSasaPay('NATIONAL_ID')).toBe('1');
    });
    
    it('should map SERVICE_CARD to "1" (fallback)', () => {
      expect(mapPostgresToSasaPay('SERVICE_CARD')).toBe('1');
    });
    
    it('should map ALIEN_CARD to "3"', () => {
      expect(mapPostgresToSasaPay('ALIEN_CARD')).toBe('3');
    });
    
    it('should map PASSPORT to "2"', () => {
      expect(mapPostgresToSasaPay('PASSPORT')).toBe('2');
    });
  });

  describe('Manual KYC Detection', () => {
    it('should detect SERVICE_CARD requires manual KYC', () => {
      expect(requiresManualKyc('SERVICE_CARD')).toBe(true);
    });
    
    it('should detect SERVICE_CARD is not auto-onboarding supported', () => {
      expect(isSasaPayAutoOnboardingSupported('SERVICE_CARD')).toBe(false);
    });
    
    it('should allow NATIONAL_ID auto-onboarding', () => {
      expect(isSasaPayAutoOnboardingSupported('NATIONAL_ID')).toBe(true);
    });
  });
});
```

---

## Migration Notes

### Existing Code

Old mapping functions are deprecated but still work (they now delegate to centralized helpers). This ensures backward compatibility.

```typescript
// Old code still works
private mapDocumentType(type: number): string {
  return mapAstppToPostgres(type);  // Delegates to centralized helper
}

// New code can directly import
import { mapAstppToPostgres } from '../../core/constants';
const docType = mapAstppToPostgres(astppType);
```

### Future Work

1. **Remove deprecated wrapper functions** after verifying all systems work
2. **Add validation logic** for Service Card manual KYC flow in waas-onboarding-job
3. **Add unit tests** for all mapping functions
4. **Document manual KYC flow** in API documentation

---

## Related Documents

- **Bug fix details:** `.agents/document-type-fix-applied.md`
- **Original investigation:** `.agents/document-type-mapping-issue.md`
- **Data corruption fix:** `scripts/fix-document-types.js`


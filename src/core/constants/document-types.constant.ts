/**
 * Document Type Mappings - Centralized Configuration
 * 
 * This file defines the canonical mappings between:
 * - ASTPP MySQL numeric types (source of truth)
 * - PostgreSQL string enums (internal representation)
 * - SasaPay API string codes (external API)
 */

/**
 * ASTPP MySQL document type numeric codes
 */
export enum AstppDocumentType {
  NATIONAL_ID = 0,
  SERVICE_CARD = 1,
  ALIEN_CARD = 2,
  PASSPORT = 3,
}

/**
 * PostgreSQL string enum values (internal representation)
 */
export enum DocumentType {
  NATIONAL_ID = 'NATIONAL_ID',
  SERVICE_CARD = 'SERVICE_CARD',
  ALIEN_CARD = 'ALIEN_CARD',
  PASSPORT = 'PASSPORT',
}

/**
 * SasaPay API document type codes
 * API spec: "1" (ID card), "2" (Passport), "3" (Alien ID)
 */
export enum SasaPayDocumentType {
  ID_CARD = '1',
  PASSPORT = '2',
  ALIEN_ID = '3',
}

/**
 * Map ASTPP numeric type to PostgreSQL string enum
 * Used by: CDC consumer, Snapshot worker
 */
export const ASTPP_TO_POSTGRES_DOC_TYPE: Record<number, DocumentType> = {
  [AstppDocumentType.NATIONAL_ID]: DocumentType.NATIONAL_ID,
  [AstppDocumentType.SERVICE_CARD]: DocumentType.SERVICE_CARD,
  [AstppDocumentType.ALIEN_CARD]: DocumentType.ALIEN_CARD,
  [AstppDocumentType.PASSPORT]: DocumentType.PASSPORT,
};

/**
 * Map PostgreSQL string enum to SasaPay API code
 * Used by: WaaS onboarding job, Onboarding service
 * 
 * IMPORTANT: SasaPay only supports 3 document types:
 * - "1" (ID card / National ID)
 * - "2" (Passport)
 * - "3" (Alien ID)
 * 
 * Service/Military Card is NOT supported by SasaPay API.
 * Customers with Service Cards CANNOT complete onboarding via the automatic flow.
 * They must use the manual KYC upload flow (GET /onboarding-status, POST /sessions/device).
 * 
 * This mapping intentionally returns "1" for SERVICE_CARD as a fallback, but the
 * onboarding logic should detect this scenario and redirect to manual KYC flow.
 */
export const POSTGRES_TO_SASAPAY_DOC_TYPE: Record<DocumentType, SasaPayDocumentType> = {
  [DocumentType.NATIONAL_ID]: SasaPayDocumentType.ID_CARD,
  [DocumentType.SERVICE_CARD]: SasaPayDocumentType.ID_CARD, // Fallback - customer needs manual KYC
  [DocumentType.ALIEN_CARD]: SasaPayDocumentType.ALIEN_ID,
  [DocumentType.PASSPORT]: SasaPayDocumentType.PASSPORT,
};

/**
 * Helper: Map ASTPP type to PostgreSQL string
 */
export function mapAstppToPostgres(astppType: number | null | undefined): DocumentType {
  if (astppType === null || astppType === undefined) {
    return DocumentType.NATIONAL_ID; // Default fallback
  }
  return ASTPP_TO_POSTGRES_DOC_TYPE[astppType] ?? DocumentType.NATIONAL_ID;
}

/**
 * Helper: Map PostgreSQL string to SasaPay API code
 */
export function mapPostgresToSasaPay(postgresType: string | null | undefined): SasaPayDocumentType {
  if (!postgresType) {
    return SasaPayDocumentType.ID_CARD; // Default fallback
  }
  return POSTGRES_TO_SASAPAY_DOC_TYPE[postgresType as DocumentType] ?? SasaPayDocumentType.ID_CARD;
}

/**
 * Helper: Map ASTPP type directly to SasaPay (for cases where we bypass PostgreSQL)
 */
export function mapAstppToSasaPay(astppType: number | null | undefined): SasaPayDocumentType {
  const postgresType = mapAstppToPostgres(astppType);
  return mapPostgresToSasaPay(postgresType);
}

/**
 * Helper: Check if a document type is supported by SasaPay automatic onboarding
 * Returns false for SERVICE_CARD, which requires manual KYC upload flow
 */
export function isSasaPayAutoOnboardingSupported(documentType: string | null | undefined): boolean {
  if (!documentType) return true; // NATIONAL_ID is default and supported
  return documentType !== DocumentType.SERVICE_CARD;
}

/**
 * Helper: Check if a document type requires manual KYC flow
 */
export function requiresManualKyc(documentType: string | null | undefined): boolean {
  return documentType === DocumentType.SERVICE_CARD;
}

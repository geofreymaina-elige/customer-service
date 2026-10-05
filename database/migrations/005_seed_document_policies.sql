-- Seed SasaPay KYC document policies based on SasaPay API requirements
-- https://sandbox.sasapay.app/api/v2/waas/personal-onboarding/kyc/
--
-- SasaPay documentType values:
--   "1" = National ID (ID card)
--   "2" = Passport
--   "3" = Alien ID
--
-- Required uploads for all document types:
--   - passportSizePhoto (selfie)
--   - documentImageFront (front of document)
--   - documentImageBack (back of document)
--
-- Note: This seeds into sasapay_kyc_document_policies (created in migration 004).
-- Migration 006 will rename this table to document_policies.

-- National ID policy
INSERT INTO sasapay_kyc_document_policies (
    document_type,
    version,
    required_documents,
    accepted_mime_types,
    max_file_size_bytes,
    is_active,
    created_by
) VALUES (
    'national_id',
    1,
    ARRAY['document_front', 'document_back', 'selfie']::TEXT[],
    ARRAY['image/jpeg', 'image/png', 'image/webp']::TEXT[],
    20971520, -- 20 MB (matches controller limit)
    TRUE,
    'system_seed'
) ON CONFLICT (document_type, version) DO NOTHING;

-- Passport policy
INSERT INTO sasapay_kyc_document_policies (
    document_type,
    version,
    required_documents,
    accepted_mime_types,
    max_file_size_bytes,
    is_active,
    created_by
) VALUES (
    'passport',
    1,
    ARRAY['document_front', 'document_back', 'selfie']::TEXT[],
    ARRAY['image/jpeg', 'image/png', 'image/webp']::TEXT[],
    20971520, -- 20 MB
    TRUE,
    'system_seed'
) ON CONFLICT (document_type, version) DO NOTHING;

-- Alien ID policy
INSERT INTO sasapay_kyc_document_policies (
    document_type,
    version,
    required_documents,
    accepted_mime_types,
    max_file_size_bytes,
    is_active,
    created_by
) VALUES (
    'alien_id',
    1,
    ARRAY['document_front', 'document_back', 'selfie']::TEXT[],
    ARRAY['image/jpeg', 'image/png', 'image/webp']::TEXT[],
    20971520, -- 20 MB
    TRUE,
    'system_seed'
) ON CONFLICT (document_type, version) DO NOTHING;

-- Verify the policies were created
DO $$
DECLARE
    policy_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO policy_count
    FROM sasapay_kyc_document_policies
    WHERE is_active = TRUE;
    
    IF policy_count < 3 THEN
        RAISE EXCEPTION 'Expected at least 3 active document policies, found %', policy_count;
    END IF;
    
    RAISE NOTICE 'Successfully seeded % active document policies', policy_count;
END $$;

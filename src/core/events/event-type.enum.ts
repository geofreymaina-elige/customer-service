export enum EventType {
  CustomerDeviceRegistered = 'customer.device_registered',
  CustomerDeviceRevoked = 'customer.device_revoked',
  CustomerWalletLocked = 'customer.wallet_locked',
  CustomerWalletUnlocked = 'customer.wallet_unlocked',
  CustomerStatusChanged = 'customer.status_changed',
  CustomerKycApproved = 'customer.kyc_approved',
  CustomerKycDocumentsRequired = 'customer.kyc_documents_required',
  CustomerKycRejected = 'customer.kyc_rejected',
  CustomerKycSubmitted = 'customer.kyc_submitted',
  CustomerPinSet = 'customer.pin_set',
  CustomerPinChanged = 'customer.pin_changed',
  CustomerPinUnlockedByAdmin = 'customer.pin_unlocked_by_admin',
  CustomerOnboardingStateChanged = 'customer.onboarding_state_changed',
  SasaPayKycPspUploadFailed = 'sasapay_kyc.psp_upload_failed',
  SasaPayKycSubmittedForReview = 'sasapay_kyc.submitted_for_review',
}

export const KNOWN_EVENT_TYPES = Object.values(EventType);

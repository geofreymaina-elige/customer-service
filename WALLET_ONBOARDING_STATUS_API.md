# Wallet Onboarding Status API

## Endpoint
```
GET /api/v1/wallets/me/onboarding-status
```

**Authentication:** Required (Bearer token)

**Performance:** 
- Only 2 SQL queries (no joins)
- Fast response time (<50ms typical)

---

## Response Structure

```typescript
{
  success: boolean;
  data: {
    // Wallet existence
    hasWallet: boolean;
    hasApplication: boolean;
    
    // Readiness flags
    isReadyToOnboard: boolean;
    requiresAdditionalKyc: boolean;
    applicationStatus: string;
    
    // Status booleans
    isPending: boolean;
    isApproved: boolean;
    isRejected: boolean;
    
    // User-facing
    message: string;
    nextAction: string | null;
    
    // Optional: Wallet details (if exists)
    wallet?: {
      walletId: string;
      accountNumber: string;
      currency: string;
      status: string;
      tierLevel: string;
      createdAt: string;
    };
    
    // Optional: Application details (if exists)
    application?: {
      status: string;
      sasapayRequestId: string | null;
      sasapayAccountNumber: string | null;
      sasapayAccountStatus: string | null;
      submittedAt: string | null;
      approvedAt: string | null;
      rejectedAt: string | null;
    };
  };
}
```

---

## Scenario 1: User Has Not Started Wallet Onboarding

**Description:** User device is registered, but no wallet application initiated.

**Response:**
```json
{
  "success": true,
  "data": {
    "hasWallet": false,
    "hasApplication": false,
    "isReadyToOnboard": true,
    "requiresAdditionalKyc": true,
    "applicationStatus": "not_started",
    "isPending": false,
    "isApproved": false,
    "isRejected": false,
    "message": "Wallet onboarding not started. Ready to begin.",
    "nextAction": "start_onboarding"
  }
}
```

**Client Action:**
- Show "Start Wallet Onboarding" button
- When clicked, call `/api/v1/onboarding/user-device` (if not done) or initiate wallet flow

---

## Scenario 2: SasaPay Onboarding Initiated (Awaiting OTP)

**Description:** Background job sent SasaPay WaaS request, waiting for user to verify OTP.

**Response:**
```json
{
  "success": true,
  "data": {
    "hasWallet": false,
    "hasApplication": true,
    "isReadyToOnboard": false,
    "requiresAdditionalKyc": true,
    "applicationStatus": "pending",
    "isPending": true,
    "isApproved": false,
    "isRejected": false,
    "message": "Wallet onboarding initiated. Please verify the OTP sent to your phone.",
    "nextAction": "verify_otp",
    "application": {
      "status": "pending",
      "sasapayRequestId": "ef348e2f-f59b-446a-b92c-4d93ebf580a0",
      "sasapayAccountNumber": null,
      "sasapayAccountStatus": null,
      "submittedAt": "2025-02-15T10:30:00Z",
      "approvedAt": null,
      "rejectedAt": null
    }
  }
}
```

**Client Action:**
- Show OTP input screen
- Submit to `/api/v1/onboarding/personal/confirm` with OTP

---

## Scenario 3: OTP Verified, KYC Upload In Progress

**Description:** User verified OTP, background job is fetching images from ASTPP and uploading to SasaPay.

**Response:**
```json
{
  "success": true,
  "data": {
    "hasWallet": false,
    "hasApplication": true,
    "isReadyToOnboard": false,
    "requiresAdditionalKyc": true,
    "applicationStatus": "requires_kyc_upload",
    "isPending": true,
    "isApproved": false,
    "isRejected": false,
    "message": "Your wallet KYC documents are being processed. This may take a few minutes.",
    "nextAction": "wait_for_approval",
    "application": {
      "status": "requires_kyc_upload",
      "sasapayRequestId": "ef348e2f-f59b-446a-b92c-4d93ebf580a0",
      "sasapayAccountNumber": "254700010492",
      "sasapayAccountStatus": "AWAITING_KYC_UPLOAD",
      "submittedAt": "2025-02-15T10:30:00Z",
      "approvedAt": null,
      "rejectedAt": null
    }
  }
}
```

**Client Action:**
- Show loading/processing screen
- Poll this endpoint every 10-15 seconds or use websocket for real-time updates

---

## Scenario 4: Wallet Approved and Active

**Description:** SasaPay approved the KYC, wallet record created in database.

**Response:**
```json
{
  "success": true,
  "data": {
    "hasWallet": true,
    "hasApplication": true,
    "isReadyToOnboard": false,
    "requiresAdditionalKyc": false,
    "applicationStatus": "approved",
    "isPending": false,
    "isApproved": true,
    "isRejected": false,
    "message": "Your wallet has been successfully approved and is ready to use.",
    "nextAction": null,
    "wallet": {
      "walletId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "accountNumber": "254700010492",
      "currency": "KES",
      "status": "active",
      "tierLevel": "TIER_1",
      "createdAt": "2025-02-15T10:45:00Z"
    },
    "application": {
      "status": "approved",
      "sasapayRequestId": "ef348e2f-f59b-446a-b92c-4d93ebf580a0",
      "sasapayAccountNumber": "254700010492",
      "sasapayAccountStatus": "ACTIVE",
      "submittedAt": "2025-02-15T10:30:00Z",
      "approvedAt": "2025-02-15T10:45:00Z",
      "rejectedAt": null
    }
  }
}
```

**Client Action:**
- Hide onboarding flow
- Show wallet dashboard with balance and transaction features
- Allow user to transact

---

## Scenario 5: Wallet Application Rejected

**Description:** SasaPay rejected the KYC documents. User needs to contact support.

**Response:**
```json
{
  "success": true,
  "data": {
    "hasWallet": false,
    "hasApplication": true,
    "isReadyToOnboard": false,
    "requiresAdditionalKyc": true,
    "applicationStatus": "rejected",
    "isPending": false,
    "isApproved": false,
    "isRejected": true,
    "message": "Your wallet application was rejected. Please contact support for assistance.",
    "nextAction": "contact_support",
    "application": {
      "status": "rejected",
      "sasapayRequestId": "ef348e2f-f59b-446a-b92c-4d93ebf580a0",
      "sasapayAccountNumber": "254700010492",
      "sasapayAccountStatus": "REJECTED",
      "submittedAt": "2025-02-15T10:30:00Z",
      "approvedAt": null,
      "rejectedAt": "2025-02-15T11:00:00Z"
    }
  }
}
```

**Client Action:**
- Show rejection message
- Provide "Contact Support" button
- Optionally allow resubmission after document correction

---

## Application Status Values

| Status | Meaning |
|--------|---------|
| `not_started` | No wallet application exists |
| `unverified` | Application created but SasaPay not initiated |
| `pending` | SasaPay WaaS initiated, awaiting OTP |
| `requires_kyc_upload` | OTP verified, KYC upload in progress |
| `approved` | KYC approved by SasaPay, wallet active |
| `rejected` | KYC rejected by SasaPay |

---

## Next Action Values

| Value | Client Should |
|-------|---------------|
| `start_onboarding` | Show "Start Wallet Onboarding" button |
| `verify_otp` | Show OTP input screen |
| `wait_for_approval` | Show loading/processing screen, poll status |
| `contact_support` | Show support contact options |
| `null` | Onboarding complete, show wallet features |

---

## Performance Characteristics

**SQL Queries:**
1. `SELECT FROM customer_wallets WHERE customer_id = ?` (single row lookup)
2. `SELECT FROM customer_applications WHERE customer_id = ? AND application_type = 'wallet_kyc'` (single row lookup, indexed)

**No Joins:** Optimized for speed

**Typical Response Time:**
- Database: 2-5ms per query
- Total: 10-20ms (local), 30-50ms (cloud)

---

## Client Polling Strategy

**Recommended Approach:**

1. **User initiates onboarding** → Call this API immediately after OTP submission
2. **While `isPending === true`** → Poll every 10 seconds
3. **Stop polling when:**
   - `isApproved === true` (show wallet dashboard)
   - `isRejected === true` (show rejection message)
   - `nextAction === null` (onboarding complete)

**Alternative:** Use WebSocket for real-time status updates (future enhancement)

---

## Error Responses

### User Not Authenticated
```json
{
  "success": false,
  "message": "Authentication required to access this resource.",
  "statusCode": 401
}
```

### Customer Not Found
```json
{
  "success": false,
  "message": "Customer record not found.",
  "statusCode": 404
}
```

---

## Integration Example (Frontend)

```typescript
// React/React Native example
async function checkWalletStatus() {
  const response = await fetch('/api/v1/wallets/me/onboarding-status', {
    headers: {
      'Authorization': `Bearer ${authToken}`
    }
  });
  
  const result = await response.json();
  const { data } = result;
  
  if (data.isApproved && data.hasWallet) {
    // Redirect to wallet dashboard
    navigate('/wallet/dashboard');
  } else if (data.nextAction === 'verify_otp') {
    // Show OTP input
    navigate('/wallet/verify-otp');
  } else if (data.isPending) {
    // Show processing screen and poll
    showProcessingScreen();
    setTimeout(checkWalletStatus, 10000); // Poll every 10 seconds
  } else if (data.nextAction === 'start_onboarding') {
    // Show onboarding start button
    showOnboardingButton();
  } else if (data.isRejected) {
    // Show rejection message
    showRejectionMessage(data.message);
  }
}
```

---

## Related Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /api/v1/onboarding/user-device` | Initial device onboarding (triggers wallet flow) |
| `POST /api/v1/onboarding/personal/confirm` | Verify OTP for SasaPay WaaS |
| `GET /api/v1/wallets/me` | Get full wallet details (balance, transactions) |
| `GET /api/v1/wallets/me/status` | Get wallet lock/freeze status |


import { DocumentBuilder } from '@nestjs/swagger';

export function createSwaggerConfig() {
  return new DocumentBuilder()
    .setTitle('AmbiaPay Customer Service API')
    .setDescription(`
# Mobile App Customer Service API

Complete API documentation for mobile app developers to integrate AmbiaPay wallet services.

---

## Authentication

All API requests require multiple authentication layers:

### 1. API Key (Required for ALL requests)
\`\`\`
X-API-Key: your_api_key_here
\`\`\`

### 2. Customer Authentication (varies by endpoint)

**ASTPP Token** - For initial customer identification
\`\`\`
X-Astpp-Token: encrypted_astpp_token
\`\`\`

**App Access Token** - For general wallet operations (24-hour validity)
\`\`\`
Authorization: Bearer app_access_token
\`\`\`

**Transaction Token** - For sensitive operations like balance checks (5-minute validity)
\`\`\`
Authorization: Bearer transaction_token
\`\`\`

---

## Mobile App Integration Workflow

### Step 1: Check Onboarding Status
**Endpoint** \`GET /api/v2/customers/onboarding-status?astppId={astppId}\`

**Purpose** Call this FIRST every time the app launches to determine what screen to show.

**Authentication** X-API-Key + X-Astpp-Token

**Response determines next action**
- \`nextAction.type: "start_onboarding"\` → No wallet, proceed to device registration
- \`nextAction.type: "verify_otp"\` → Wallet creation pending, show OTP screen
- \`nextAction.type: "upload_kyc_documents"\` → Wallet active, need KYC upload
- \`nextAction.type: "set_pin"\` → Wallet approved, need PIN setup
- \`nextAction.type: "make_transaction"\` → Fully onboarded, show home screen

---

### Step 2: Device Registration
**Endpoint** \`POST /api/v2/auth/sessions/device\`

**Purpose** Register device and start wallet creation process. This triggers SasaPay wallet creation and OTP sending.

**Authentication** X-API-Key + X-Astpp-Token

**Response**
- \`otpPending: true\` → Redirect to OTP verification screen
- \`otpPending: false\` → Check \`isWalletPinSet\`
  - If false → Redirect to PIN setup screen
  - If true → Proceed to home screen

**Returns** App access token (24-hour validity) for subsequent API calls

---

### Step 3: OTP Verification (if otpPending=true)
**Endpoint** \`POST /api/v2/auth/wallet-verifications\`

**Purpose** Verify OTP sent to customer's phone to activate wallet

**Authentication** X-API-Key + Bearer (app access token)

**After Success** Wallet becomes active. Check \`isWalletPinSet\` to determine next step.

---

### Step 4: KYC Document Upload (if nextAction=upload_kyc_documents)
**Endpoint** \`GET /api/v2/customers/kyc/requirements\` - Get required documents

**Endpoint** \`POST /api/v2/customers/kyc/submissions/images\` - Upload documents

**Purpose** Submit KYC documents for compliance approval

**Authentication** X-API-Key + Bearer (app access token)

---

### Step 5: PIN Management

**Set Initial PIN** \`POST /api/v2/customers/me/pin\`

**Verify PIN for Transactions** \`POST /api/v2/auth/transaction-tokens\`

**Purpose** Secure wallet with PIN. Transaction token required for sensitive operations.

**Authentication** X-API-Key + Bearer (app access token)

---

### Step 6: Wallet Operations

**Get Balance** \`GET /api/v2/customers/me/balance\`
- Requires transaction token (get via PIN verification)

**Get Wallet Info** \`GET /api/v2/customers/me\`
- Uses app access token

---

## Response Format

All responses follow this structure

\`\`\`json
{
  "success": true | false,
  "message": "Human-readable message",
  "data": { /* response data */ },
  "code": "ERROR_CODE"  // Only on errors
}
\`\`\`

---

## Common Status Codes

- **200** - Success
- **400** - Bad Request (validation error)
- **401** - Unauthorized (invalid/missing token or API key)
- **403** - Forbidden (feature disabled or insufficient permissions)
- **404** - Not Found
- **409** - Conflict (duplicate resource)
- **429** - Too Many Requests (rate limited)
- **500** - Internal Server Error

---

## Token Lifecycle

### App Access Token
- **Validity** 24 hours
- **Purpose** General wallet operations
- **Obtained from** Device registration endpoint
- **Scopes** \`app:access\`

### Transaction Token  
- **Validity** 5 minutes
- **Purpose** Sensitive operations (balance, transfers)
- **Obtained from** PIN verification endpoint
- **Scopes** \`wallet:transact\`

---

## Workflow Decision Tree

\`\`\`
Start App
    ↓
GET /onboarding-status
    ↓
nextAction?
    ├─ start_onboarding → POST /sessions/device
    │                        ↓
    │                     otpPending?
    │                        ├─ true → POST /wallet-verifications
    │                        └─ false → Check isWalletPinSet
    │
    ├─ upload_kyc_documents → POST /kyc/submissions/images
    │
    ├─ set_pin → POST /customers/me/pin
    │
    └─ make_transaction → Home Screen
           ↓
       Need Balance?
           ↓
       POST /transaction-tokens (verify PIN)
           ↓
       GET /customers/me/balance
\`\`\`

---

**API Information**

Version: 2.0  
Last Updated: October 2026  
Base URL: https://api.ambiapay.com

© 2026 AmbiaPay. All rights reserved.
    `)
    .setVersion('2.0')
    .addServer('https://api.ambiapay.com', 'Production')
    .addServer('https://dev-api.ambiapay.com', 'Staging')
    .addServer('http://localhost:5006', 'Local Development')
    .addApiKey(
      {
        type: 'apiKey',
        name: 'X-API-Key',
        in: 'header',
        description: '**[REQUIRED]** API key for all requests. Obtain from AmbiaPay dashboard.'
      },
      'API-Key'
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'X-Astpp-Token',
        in: 'header',
        description: '**[REQUIRED for initial calls]** ASTPP encrypted token for customer identification. Provided by ASTPP system.'
      },
      'ASTPP-Token'
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: '**App Access Token** - 24-hour validity JWT for general wallet operations. Obtained from device registration.'
      },
      'AppAccessToken'
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: '**Transaction Token** - 5-minute validity JWT for sensitive operations (balance, transfers). Obtained from PIN verification.'
      },
      'TransactionToken'
    )
    .addTag('Onboarding', 'Customer onboarding, device registration, and authentication')
    .addTag('KYC', 'Document submission for compliance')
    .addTag('PIN Management', 'PIN management and verification')
    .addTag('Wallet Balance', 'Wallet balance and information')
    .addTag('Configuration and Banners', 'App configuration and banner images')
    .build();
}

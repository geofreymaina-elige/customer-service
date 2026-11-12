import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { swaggerCustomStyles } from './swagger.styles';

/**
 * Injected into the Swagger page (customJsStr).
 *  1. "Test variables" panel (astpp_id, phone_number) saved in localStorage
 *  2. "API Information" footer below the last API section
 * Edit FOOTER to change the footer content.
 */
const swaggerCustomScript = `
(function () {
  /* ---------------- 1. Test variables panel ---------------- */
  var FIELDS = [
    ['astpp_id', 'ASTPP ID', '0000'],
    ['phone_number', 'Phone number', '254711xxx771']
  ];

  function get(k, d) {
    try { return localStorage.getItem('swg_' + k) || d; } catch (e) { return d; }
  }
  function set(k, v) {
    try { localStorage.setItem('swg_' + k, v); } catch (e) {}
  }

  function buildVarsPanel() {
    if (document.querySelector('.swg-vars')) return;
    var box = document.createElement('div');
    box.className = 'swg-vars';
    box.innerHTML = '<b>Test variables</b>';
    FIELDS.forEach(function (f) {
      var l = document.createElement('label');
      l.textContent = f[1];
      var i = document.createElement('input');
      i.type = 'text';
      i.value = get(f[0], f[2]);
      i.oninput = function () { set(f[0], i.value); };
      l.appendChild(i);
      box.appendChild(l);
    });
    document.body.appendChild(box);
  }

  /* ---------------- 2. API Information footer ---------------- */
  var FOOTER = {
    title: 'API Information',
    rows: [
      ['Version', '2.0'],
      ['Last Updated', 'November 2026'],
      ['Production Base URL', 'https://api.ambiapay.com'],
      ['Staging Base URL', 'Not set yet']
    ],
    copyright: '\\u00A9 2026 AmbiaPay. All rights reserved.'
  };

  function buildFooter() {
    if (document.querySelector('.api-footer')) return;
    var wrap = document.createElement('div');
    wrap.className = 'api-footer';

    var rows = FOOTER.rows.map(function (r) {
      return '<div class="api-footer-row"><span class="label">' + r[0] +
             '</span><span class="value">' + r[1] + '</span></div>';
    }).join('');

    wrap.innerHTML =
      '<div class="api-footer-card">' +
        '<h2>' + FOOTER.title + '</h2>' +
        rows +
        '<div class="api-footer-copy">' + FOOTER.copyright + '</div>' +
      '</div>';

    // Appended to <body>, after the #swagger-ui root, so Swagger's React
    // re-renders never remove it and it always sits below the last API.
    document.body.appendChild(wrap);
  }

  function init() {
    buildVarsPanel();
    buildFooter();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;

function formatDuration(seconds: number): string {
  if (seconds % 86400 === 0) return `${seconds / 86400} day${seconds === 86400 ? '' : 's'}`;
  if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds === 3600 ? '' : 's'}`;
  if (seconds % 60 === 0) return `${seconds / 60} minute${seconds === 60 ? '' : 's'}`;
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

export function createSwaggerConfig(
  publicUrl: string,
  appAccessExpiresInSeconds: number,
  transactionExpiresInSeconds: number,
  stagingUrl?: string,
) {
  const transactionValidity = formatDuration(transactionExpiresInSeconds);
  const productionUrl = 'https://api.ambiapay.com';
  const resolvedStagingUrl = stagingUrl || process.env.STAGING_URL || 'https://staging-api.ambiapay.com';

  const builder = new DocumentBuilder()
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

**App Access Token** - For general wallet operations
\`\`\`
Authorization: Bearer app_access_token
\`\`\`

**Transaction Token** - For sensitive operations like balance checks (${transactionValidity} validity)
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
- \`nextAction.type: "upload_kyc_documents"\` → Secondary KYC required (for customers whose KYC was rejected for SasaPay KYC fitness)
- \`nextAction.type: "set_pin"\` → Wallet approved, need PIN setup
- \`nextAction.type: "make_transaction"\` → Fully onboarded, show home screen

---

### Step 2: Device Registration / Session Refresh
**Endpoint** \`POST /api/v2/auth/sessions/device\`

**Purpose** Register device and start wallet creation (new customers), or refresh the customer session.
**IMPORTANT:** Always call this API every time a customer returns to or opens the app. It issues a fresh general App Access Token required for all subsequent API requests.

**Authentication** X-API-Key + X-Astpp-Token

**Response**
- \`otpPending: true\` → Redirect to OTP verification screen
- \`otpPending: false\` → Check \`isWalletPinSet\`
  - If false → Redirect to PIN setup screen
  - If true → Proceed to home screen

**Returns** Fresh App Access Token for subsequent API calls

---

### Step 3: OTP Verification (if otpPending=true)
**Endpoint** \`POST /api/v2/auth/wallet-verifications\`

**Purpose** Verify OTP sent to customer's phone to activate wallet

**Authentication** X-API-Key + Bearer (app access token)

**After Success** Wallet becomes active. Check \`isWalletPinSet\` to determine next step.

---

### Step 4: Secondary KYC Document Upload (if nextAction=upload_kyc_documents)
**Endpoint** \`GET /api/v2/customers/kyc/requirements\` - Get required documents

**Endpoint** \`POST /api/v2/customers/kyc/submissions/images\` - Upload documents

**Purpose** Secondary KYC verification for customers whose initial KYC was rejected for SasaPay KYC fitness. Allows submitting clear identity documents (front, back, selfie) for re-verification and compliance review.

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
- **Purpose** General wallet operations
- **Obtained from** Response of \`/sessions/device\`
- **Scopes** \`app:access\`

### Transaction Token
- **Validity** ${transactionValidity}
- **Purpose** Sensitive operations (balance, transfers)
- **Obtained from** PIN validations
- **Scopes** \`wallet:transact\`

---

## Device and Logout Management

A customer can have only one active device session at a time. Use
\`GET /api/v2/customers/me/sessions\` with the current device's App Access Token
to view the customer's device sessions.

To move to a new device, the recommended flow is:

1. While still signed in on the current device, call
   \`DELETE /api/v2/auth/sessions/current\` with its valid, unexpired App Access
   Token. This revokes all active sessions. A missing or invalid token returns
   a "No active sessions to revoke" response and does not sign the customer out.
2. Sign in or register the new device using the normal device registration flow.

If the customer cannot access the current device or its valid token, use device
recovery instead:

1. Call \`POST /api/v2/auth/sessions/recovery\` with the ASTPP ID, registered
   KYC identity document number, PIN, and new-device details. Include the
   required X-Astpp-Token. An OTP is sent to the customer's registered phone.
2. Call \`POST /api/v2/auth/sessions/recovery-otp\` with the recovery session
   token, OTP, and new-device details.
3. After successful OTP verification, previous active sessions are revoked,
   the new device is activated, and a new App Access Token is returned.

---

## Workflow Decision Tree

\`\`\`
App Launch / Returning Customer
    ↓
POST /sessions/device (Always call to get a fresh App Access Token)
    ↓
GET /onboarding-status (Check onboarding state & next screen)
    ↓
nextAction?
    ├─ start_onboarding → POST /sessions/device
    │                        ↓
    │                     otpPending?
    │                        ├─ true → POST /wallet-verifications
    │                        └─ false → Check isWalletPinSet
    │
    ├─ upload_kyc_documents → POST /kyc/submissions/images (Secondary KYC)
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
    `)
    .setVersion('2.0')
    .addServer(productionUrl, 'Production')
    .addServer(resolvedStagingUrl, 'Staging (Not set yet)');

  if (publicUrl && publicUrl !== productionUrl && publicUrl !== resolvedStagingUrl) {
    builder.addServer(publicUrl, 'Local / Current Server');
  }

  return builder
    .addApiKey(
      {
        type: 'apiKey',
        name: 'X-API-Key',
        in: 'header',
        description: 'API key (Header: X-API-Key)',
      },
      'API-Key',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'X-Astpp-Token',
        in: 'header',
        description: 'ASTPP customer identification token (Header: X-Astpp-Token)',
      },
      'ASTPP-Token',
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'App Access Token (Header: Authorization: Bearer <token>). Obtained from the response of /sessions/device.',
      },
      'AppAccessToken',
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Transaction Token (Header: Authorization: Bearer <token>). Obtained from PIN validations (POST /api/v2/auth/transaction-tokens).',
      },
      'TransactionToken',
    )
    .addTag('Onboarding', 'Customer onboarding, device registration, and authentication')
    .addTag('KYC', 'Document submission for compliance')
    .addTag('PIN Management', 'PIN management and verification')
    .addTag('Device and Logout Management', 'View device sessions, sign out, and recover access on a new device')
    .addTag('Wallet Balance', 'Wallet balance and information')
    .addTag('Configuration and Banners', 'App configuration and banner images')
    .build();
}

/**
 * Call this from main.ts:  setupSwagger(app);
 */
export function setupSwagger(
  app: INestApplication,
  publicUrl: string,
  appAccessExpiresInSeconds: number,
  transactionExpiresInSeconds: number,
  path = 'docs',
  stagingUrl?: string,
) {
  const document = SwaggerModule.createDocument(
    app,
    createSwaggerConfig(publicUrl, appAccessExpiresInSeconds, transactionExpiresInSeconds, stagingUrl),
  );

  SwaggerModule.setup(path, app, document, {
    customSiteTitle: 'AmbiaPay Customer Service API',
    customCss: swaggerCustomStyles,
    customJsStr: swaggerCustomScript,
    swaggerOptions: {
      persistAuthorization: true, // keep API key / tokens after a page refresh
      displayRequestDuration: true,
      tryItOutEnabled: true,

      // NOTE: Nest serialises this function into the page, so it must be
      // self-contained (no imports, no outer variables).
      requestInterceptor: (req: any) => {
        var vars: any = {
          '{{astpp_id}}': localStorage.getItem('swg_astpp_id') || '',
          '{{phone_number}}': localStorage.getItem('swg_phone_number') || '',
        };
        Object.keys(vars).forEach(function (k) {
          req.url = req.url.split(encodeURIComponent(k)).join(vars[k]).split(k).join(vars[k]);
          if (typeof req.body === 'string') {
            req.body = req.body.split(k).join(vars[k]);
          }
        });
        return req;
      },
    },
  });
}
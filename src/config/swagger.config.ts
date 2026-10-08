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
      ['Last Updated', 'October 2026'],
      ['Base URL', 'Use the configured server URL shown in the OpenAPI document.']
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
) {
  const appAccessValidity = formatDuration(appAccessExpiresInSeconds);
  const transactionValidity = formatDuration(transactionExpiresInSeconds);

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

**App Access Token** - For general wallet operations (${appAccessValidity} validity)
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

**Returns** App access token (${appAccessValidity} validity) for subsequent API calls

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
- **Validity** ${appAccessValidity}
- **Purpose** General wallet operations
- **Obtained from** Device registration endpoint
- **Scopes** \`app:access\`

### Transaction Token
- **Validity** ${transactionValidity}
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
    `)
    .setVersion('2.0')
    .addServer(publicUrl, 'Configured environment')
    .addApiKey(
      {
        type: 'apiKey',
        name: 'X-API-Key',
        in: 'header',
        description: '**[REQUIRED]** API key for all requests. Obtain from AmbiaPay dashboard.',
      },
      'API-Key',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'X-Astpp-Token',
        in: 'header',
        description: '**[REQUIRED for initial calls]** ASTPP encrypted token for customer identification. Provided by ASTPP system.',
      },
      'ASTPP-Token',
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: `**App Access Token** - ${appAccessValidity} validity JWT for general wallet operations. Obtained from device registration.`,
      },
      'AppAccessToken',
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: `**Transaction Token** - ${transactionValidity} validity JWT for sensitive operations (balance, transfers). Obtained from PIN verification.`,
      },
      'TransactionToken',
    )
    .addTag('Onboarding', 'Customer onboarding, device registration, and authentication')
    .addTag('KYC', 'Document submission for compliance')
    .addTag('PIN Management', 'PIN management and verification')
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
) {
  const document = SwaggerModule.createDocument(
    app,
    createSwaggerConfig(publicUrl, appAccessExpiresInSeconds, transactionExpiresInSeconds),
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
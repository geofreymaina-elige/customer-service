import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { MessageService } from './core/messages/message.service';
import { GlobalExceptionFilter } from './core/errors/global-exception.filter';
import { ApiKeyGuard } from './core/auth/api-key.guard';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const messageService = app.get(MessageService);

  // Enable CORS Protection
  const allowedOrigins = configService.get<string[]>('cors.allowedOrigins') || [
    'https://api.ambiapay.com',
    'https://admin.ambiapay.com',
    'http://localhost:3000',
    'http://localhost:5173',
  ];

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (such as mobile apps, curl, or server-to-server calls)
      if (!origin) return callback(null, true);

      const isAllowed =
        allowedOrigins.includes(origin) ||
        /^https:\/\/([a-zA-Z0-9-]+\.)?ambiapay\.com$/.test(origin);

      if (isAllowed) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-api-key',
      'x-admin-user-id',
      'x-admin-email',
      'x-request-id',
      'x-device-hash',
      'x-device-identifier',
      'Accept',
      'Origin',
      'X-Requested-With',
    ],
    exposedHeaders: [
      'Content-Range',
      'X-Content-Range',
      'X-Total-Count',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'Retry-After',
    ],
    credentials: true,
    maxAge: 86400,
  });

  // Enable shutdown hooks
  app.enableShutdownHooks();

  // Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      exceptionFactory: (errors) => {
        const errorMessages = errors.map(error => 
          Object.values(error.constraints || {}).join(', ')
        );
        const error = new HttpException({
          message: errorMessages,
          errors: errorMessages
        }, HttpStatus.BAD_REQUEST);
        return error;
      }
    }),
  );

  // Global Exception Filter with centralized messages
  app.useGlobalFilters(new GlobalExceptionFilter(messageService));

  // Global API Key Guard (applies to all routes unless marked with @Public())
  const reflector = app.get(Reflector);
  app.useGlobalGuards(new ApiKeyGuard(configService, reflector));

  // Swagger API Documentation
  const swaggerConfig = new DocumentBuilder()
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

## Support and Resources

**Need Help?**
- Email: support@ambiapay.com
- Documentation: https://docs.ambiapay.com
- Status Page: https://status.ambiapay.com

**API Information**
- Version: 2.0
- Last Updated: October 2026
- Base URL: https://api.ambiapay.com

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

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'AmbiaPay Customer Service API Documentation',
    customCss: `
      .swagger-ui .topbar { display: none; }
      
      /* Background color matching the first image */
      body {
        background-color: #f5f7fa;
      }
      
      .swagger-ui {
        background-color: #f5f7fa;
      }
      
      /* Color scheme from AmbiaPay branding */
      .swagger-ui { 
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      }
      
      /* Main content wrapper */
      .swagger-ui .wrapper {
        background-color: #f5f7fa;
      }
      
      .swagger-ui .information-container {
        background: white;
        padding: 30px;
        border-radius: 8px;
        margin-bottom: 20px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
      }
      
      /* Header styling */
      .swagger-ui .info { 
        margin: 30px 0;
      }
      
      .swagger-ui .info .title { 
        font-size: 36px;
        color: #1a1a1a;
        font-weight: 700;
        margin-bottom: 10px;
      }
      
      .swagger-ui .info .title small { 
        background: #10b981;
        color: white;
        padding: 4px 12px;
        border-radius: 20px;
        font-size: 14px;
        font-weight: 600;
        margin-left: 12px;
        vertical-align: middle;
      }
      
      .swagger-ui .info .description { 
        color: #4b5563;
        font-size: 15px;
        line-height: 1.7;
      }
      
      /* Scheme container */
      .swagger-ui .scheme-container { 
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 20px;
        margin: 20px 0;
      }
      
      /* Operations and tags */
      .swagger-ui .opblock-tag { 
        font-size: 20px;
        font-weight: 600;
        color: #1f2937;
        border-bottom: 2px solid #e5e7eb;
        padding: 15px 0;
        margin: 30px 0 15px 0;
      }
      
      .swagger-ui .opblock { 
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        margin: 0 0 15px 0;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
      }
      
      /* HTTP method colors */
      .swagger-ui .opblock.opblock-get { 
        border-color: #3b82f6;
        background: rgba(59, 130, 246, 0.02);
      }
      
      .swagger-ui .opblock.opblock-get .opblock-summary-method { 
        background: #3b82f6;
      }
      
      .swagger-ui .opblock.opblock-post { 
        border-color: #10b981;
        background: rgba(16, 185, 129, 0.02);
      }
      
      .swagger-ui .opblock.opblock-post .opblock-summary-method { 
        background: #10b981;
      }
      
      .swagger-ui .opblock.opblock-put { 
        border-color: #f59e0b;
        background: rgba(245, 158, 11, 0.02);
      }
      
      .swagger-ui .opblock.opblock-put .opblock-summary-method { 
        background: #f59e0b;
      }
      
      .swagger-ui .opblock.opblock-delete { 
        border-color: #ef4444;
        background: rgba(239, 68, 68, 0.02);
      }
      
      .swagger-ui .opblock.opblock-delete .opblock-summary-method { 
        background: #ef4444;
      }
      
      /* Operation summary */
      .swagger-ui .opblock-summary { 
        padding: 12px 20px;
        cursor: pointer;
      }
      
      .swagger-ui .opblock-summary-method { 
        border-radius: 6px;
        font-weight: 700;
        min-width: 80px;
        text-align: center;
        font-size: 13px;
      }
      
      .swagger-ui .opblock-summary-path { 
        font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
        font-size: 14px;
        color: #1f2937;
        font-weight: 600;
      }
      
      .swagger-ui .opblock-summary-description { 
        font-size: 14px;
        color: #6b7280;
      }
      
      /* Buttons */
      .swagger-ui .btn { 
        border-radius: 6px;
        font-weight: 600;
        font-size: 14px;
        padding: 8px 16px;
      }
      
      .swagger-ui .btn.execute { 
        background: #10b981;
        border-color: #10b981;
      }
      
      .swagger-ui .btn.execute:hover { 
        background: #059669;
        border-color: #059669;
      }
      
      .swagger-ui .btn.try-out__btn { 
        background: #3b82f6;
        border-color: #3b82f6;
        color: white;
      }
      
      .swagger-ui .btn.try-out__btn:hover { 
        background: #2563eb;
        border-color: #2563eb;
      }
      
      /* Authorization button */
      .swagger-ui .btn.authorize { 
        background: #8b5cf6;
        border-color: #8b5cf6;
      }
      
      .swagger-ui .btn.authorize svg { 
        fill: white;
      }
      
      .swagger-ui .btn.authorize:hover { 
        background: #7c3aed;
        border-color: #7c3aed;
      }
      
      /* Parameters and responses */
      .swagger-ui .parameters-col_description { 
        color: #4b5563;
        font-size: 14px;
      }
      
      .swagger-ui .parameter__name { 
        font-weight: 600;
        color: #1f2937;
      }
      
      .swagger-ui .parameter__type { 
        color: #6b7280;
        font-size: 12px;
      }
      
      .swagger-ui .response-col_status { 
        font-weight: 700;
        font-size: 14px;
      }
      
      .swagger-ui .response-col_status .response-col_status__inner { 
        padding: 4px 12px;
        border-radius: 6px;
      }
      
      /* Response codes */
      .swagger-ui .responses-inner h4, .swagger-ui .responses-inner h5 { 
        font-size: 14px;
        font-weight: 600;
        color: #1f2937;
        margin: 20px 0 10px 0;
      }
      
      /* Code blocks */
      .swagger-ui .highlight-code { 
        background: #1f2937;
        border-radius: 6px;
      }
      
      .swagger-ui .highlight-code .microlight { 
        color: #e5e7eb;
        font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
        font-size: 13px;
        padding: 16px;
      }
      
      /* Models */
      .swagger-ui .model-box { 
        background: #f9fafb;
        border-radius: 6px;
        padding: 16px;
      }
      
      .swagger-ui .model-title { 
        color: #1f2937;
        font-weight: 600;
      }
      
      .swagger-ui .model { 
        font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
        font-size: 13px;
      }
      
      /* Tables */
      .swagger-ui table { 
        border-collapse: collapse;
      }
      
      .swagger-ui table thead tr th { 
        background: #f9fafb;
        color: #1f2937;
        font-weight: 600;
        font-size: 13px;
        padding: 12px;
        border-bottom: 2px solid #e5e7eb;
      }
      
      .swagger-ui table tbody tr td { 
        padding: 12px;
        border-bottom: 1px solid #e5e7eb;
        color: #4b5563;
        font-size: 14px;
      }
      
      /* Authorization modal */
      .swagger-ui .dialog-ux { 
        border-radius: 8px;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
      }
      
      .swagger-ui .modal-ux-header { 
        background: #f9fafb;
        border-bottom: 2px solid #e5e7eb;
        padding: 20px;
      }
      
      .swagger-ui .modal-ux-header h3 { 
        color: #1f2937;
        font-weight: 600;
      }
      
      .swagger-ui .modal-ux-content { 
        padding: 20px;
      }
      
      /* Links */
      .swagger-ui a { 
        color: #3b82f6;
        text-decoration: none;
      }
      
      .swagger-ui a:hover { 
        color: #2563eb;
        text-decoration: underline;
      }
      
      /* Markdown content */
      .swagger-ui .markdown p { 
        margin: 0 0 12px 0;
        line-height: 1.7;
      }
      
      .swagger-ui .markdown code { 
        background: #f3f4f6;
        color: #ef4444;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 0.9em;
        font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      }
      
      .swagger-ui .markdown pre { 
        background: #1f2937;
        padding: 16px;
        border-radius: 6px;
        overflow-x: auto;
      }
      
      .swagger-ui .markdown pre code { 
        background: transparent;
        color: #e5e7eb;
        padding: 0;
      }
      
      .swagger-ui .markdown h1 { 
        font-size: 28px;
        font-weight: 700;
        color: #1a1a1a;
        margin: 30px 0 15px 0;
        border-bottom: 2px solid #e5e7eb;
        padding-bottom: 10px;
      }
      
      .swagger-ui .markdown h2 { 
        font-size: 22px;
        font-weight: 600;
        color: #1f2937;
        margin: 25px 0 12px 0;
      }
      
      .swagger-ui .markdown h3 { 
        font-size: 18px;
        font-weight: 600;
        color: #374151;
        margin: 20px 0 10px 0;
      }
      
      .swagger-ui .markdown ul, .swagger-ui .markdown ol { 
        margin: 0 0 12px 20px;
        padding-left: 20px;
      }
      
      .swagger-ui .markdown li { 
        margin: 6px 0;
        line-height: 1.6;
      }
      
      .swagger-ui .markdown hr { 
        border: none;
        border-top: 2px solid #e5e7eb;
        margin: 30px 0;
      }
      
      /* Server selection */
      .swagger-ui select { 
        border: 1px solid #d1d5db;
        border-radius: 6px;
        padding: 8px 12px;
        font-size: 14px;
        color: #1f2937;
      }
      
      /* Input fields */
      .swagger-ui input[type=text], 
      .swagger-ui input[type=password], 
      .swagger-ui textarea { 
        border: 1px solid #d1d5db;
        border-radius: 6px;
        padding: 8px 12px;
        font-size: 14px;
        color: #1f2937;
      }
      
      .swagger-ui input[type=text]:focus, 
      .swagger-ui input[type=password]:focus, 
      .swagger-ui textarea:focus { 
        border-color: #3b82f6;
        outline: none;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }
    `,
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'none',
      filter: true,
      showRequestDuration: true,
      tryItOutEnabled: true,
    },
  });

  const port = configService.get<number>('port') || 5006;
  await app.listen(port, '0.0.0.0');

  console.log(`========================================================================`);
  console.log(`  Ambia Customer Management Service running on http://localhost:${port}`);
  console.log(`  Environment:  ${configService.get<string>('nodeEnv')}`);
  console.log(`  Health Check: http://localhost:${port}/health`);
  console.log(`  API Docs:     http://localhost:${port}/api/docs`);
  console.log(`========================================================================`);
}

bootstrap();

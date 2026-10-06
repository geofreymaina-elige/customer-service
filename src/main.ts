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

## 🔐 Authentication

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

**App Access Token** - For general wallet operations (30-day validity)
\`\`\`
Authorization: Bearer app_access_token
\`\`\`

**Transaction Token** - For sensitive operations like balance checks (10-minute validity)
\`\`\`
Authorization: Bearer transaction_token
\`\`\`

---

## 🚀 Mobile App Integration Workflow

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

**Returns** App access token (30-day validity) for subsequent API calls

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

## 📊 Response Format

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

## 🚦 Common Status Codes

- **200** - Success
- **400** - Bad Request (validation error)
- **401** - Unauthorized (invalid/missing token or API key)
- **403** - Forbidden (feature disabled or insufficient permissions)
- **404** - Not Found
- **409** - Conflict (duplicate resource)
- **429** - Too Many Requests (rate limited)
- **500** - Internal Server Error

---

## 📱 Token Lifecycle

### App Access Token
- **Validity** 30 days
- **Purpose** General wallet operations
- **Obtained from** Device registration endpoint
- **Scopes** \`app:access\`

### Transaction Token  
- **Validity** 10 minutes
- **Purpose** Sensitive operations (balance, transfers)
- **Obtained from** PIN verification endpoint
- **Scopes** \`wallet:transact\`

---

## 🔄 Workflow Decision Tree

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
    .setContact(
      'AmbiaPay Support',
      'https://ambiapay.com',
      'support@ambiapay.com'
    )
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
        description: '**App Access Token** - 30-day validity JWT for general wallet operations. Obtained from device registration.'
      },
      'AppAccessToken'
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: '**Transaction Token** - 10-minute validity JWT for sensitive operations (balance, transfers). Obtained from PIN verification.'
      },
      'TransactionToken'
    )
    .addTag('1. Onboarding', '🚀 Customer onboarding and wallet status check')
    .addTag('2. Authentication', '🔐 Device registration and session management')
    .addTag('3. KYC', '📄 Document submission for compliance')
    .addTag('4. PIN', '🔢 PIN management and verification')
    .addTag('5. Wallet', '💰 Wallet information and balance')
    .addTag('6. Configuration', '⚙️ App configuration and settings')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'Ambia Pay API Documentation',
    customCss: '.swagger-ui .topbar { display: none }',
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

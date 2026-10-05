import { NestFactory } from '@nestjs/core';
import { ValidationPipe, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { MessageService } from './core/messages/message.service';
import { GlobalExceptionFilter } from './core/errors/global-exception.filter';

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

  // Swagger API Documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Ambia Pay Customer Management API')
    .setDescription(`
# Customer Management & KYC API

Complete API documentation for mobile app developers to implement customer onboarding and KYC workflows.

## 🚀 Getting Started

### Authentication Flow
1. **Check Onboarding Status** → \`GET /api/v2/customers/onboarding-status\`
2. **Register Device** → \`POST /api/v2/auth/sessions\` (starts wallet creation)
3. **Verify OTP** → \`POST /api/v2/auth/wallet-verifications\`
4. **Set PIN** → \`POST /api/v2/customers/me/pin\`

### KYC Upload Flow (if required)
1. **Check KYC Status** → \`GET /api/v2/customers/kyc/submissions/status\`
2. **Get Requirements** → \`GET /api/v2/customers/kyc/requirements\`
3. **Upload Documents** → \`POST /api/v2/customers/kyc/submissions/images\`
4. **Check Status Again** → Auto-submitted when all docs uploaded

## 📋 KYC Document Types

Supported document types
- **NATIONAL_ID** - Kenya National ID Card
- **PASSPORT** - International Passport
- **ALIEN_ID** - Alien Registration Card

Each requires
- \`document_front\` - Front of document (required)
- \`document_back\` - Back of document (required)
- \`selfie\` - Passport photo/selfie (required)

## 📸 Image Requirements

- **Formats** JPEG, PNG, WebP
- **Max Size** 20MB per image
- **Quality** Clear, readable, well-lit
- **Content** Full document visible, no glare

## 🔐 Authentication

### ASTPP Token
Most endpoints require \`X-Astpp-Token\` header for authentication.

### Bearer Token
Some endpoints use \`Authorization: Bearer {token}\` after device registration.

## 📊 Response Format

All responses follow this structure

\`\`\`json
{
  "success": true,
  "message": "Human-readable message",
  "data": { /* response data */ },
  "code": "SUCCESS_CODE"  // Only on errors
}
\`\`\`

## 🚦 Status Codes

- **200** - Success
- **400** - Bad Request (validation error)
- **401** - Unauthorized (invalid/missing token)
- **403** - Forbidden (feature disabled)
- **404** - Not Found
- **409** - Conflict (already exists)
- **429** - Too Many Requests (rate limited)
- **500** - Internal Server Error
    `)
    .setVersion('2.0')
    .setContact(
      'Ambia Pay Support',
      'https://ambiapay.com',
      'support@ambiapay.com'
    )
    .addServer('https://api.ambiapay.com', 'Production')
    .addServer('https://dev-api.ambiapay.com', 'Staging')
    .addServer('http://localhost:5006', 'Local Development')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT token obtained from authentication endpoints'
      },
      'JWT'
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'X-Astpp-Token',
        in: 'header',
        description: 'ASTPP encrypted token for the customer account'
      },
      'X-Astpp-Token'
    )
    .addTag('Onboarding', 'Customer onboarding and wallet status')
    .addTag('Authentication', 'Device registration and session management')
    .addTag('KYC', 'Know Your Customer document submission')
    .addTag('PIN', 'PIN management and verification')
    .addTag('Wallet', 'Wallet information and balance')
    .addTag('Transactions', 'Transaction history')
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

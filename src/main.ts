import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { MessageService } from './core/messages/message.service';
import { GlobalExceptionFilter } from './core/errors/global-exception.filter';
import { ApiKeyGuard } from './core/auth/api-key.guard';
import { createSwaggerConfig } from './config/swagger.config';
import { swaggerCustomStyles } from './config/swagger.styles';
import { swaggerOptions } from './config/swagger.options';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const messageService = app.get(MessageService);

  // Enable CORS Protection
  const allowedOrigins = configService.getOrThrow<string[]>('cors.allowedOrigins');

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, false);
      callback(null, allowedOrigins.includes(origin));
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
    credentials: configService.getOrThrow<boolean>('cors.allowCredentials'),
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
  const publicUrl = configService.getOrThrow<string>('publicUrl');
  const swaggerConfig = createSwaggerConfig(
    publicUrl,
    configService.getOrThrow<number>('jwt.appAccessExpiresInSeconds'),
    configService.getOrThrow<number>('jwt.expiresInSeconds'),
  );
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'AmbiaPay Customer Service API Documentation',
    customCss: swaggerCustomStyles,
    swaggerOptions,
  });

  const port = configService.getOrThrow<number>('port');
  await app.listen(port, '0.0.0.0');

  console.log(`========================================================================`);
  console.log(`  Ambia Customer Management Service running on ${publicUrl}`);
  console.log(`  Environment:  ${configService.get<string>('nodeEnv')}`);
  console.log(`  Health Check: ${publicUrl}/health`);
  console.log(`  API Docs:     ${publicUrl}/api/docs`);
  console.log(`========================================================================`);
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[STARTUP] Server failed before becoming ready: ${message}`);
  process.exitCode = 1;
});

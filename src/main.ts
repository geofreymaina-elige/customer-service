import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { MessageService } from './core/messages/message.service';
import { GlobalExceptionFilter } from './core/errors/global-exception.filter';
import { IdempotencyInterceptor } from './core/idempotency/idempotency.interceptor';
import { DatabaseService } from './core/database/database.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    cors: true,
  });

  const configService = app.get(ConfigService);
  const messageService = app.get(MessageService);
  const dbService = app.get(DatabaseService);

  // Enable shutdown hooks
  app.enableShutdownHooks();

  // Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  // Global Exception Filter with centralized messages
  app.useGlobalFilters(new GlobalExceptionFilter(messageService));

  // Global Idempotency Interceptor
  app.useGlobalInterceptors(new IdempotencyInterceptor(dbService));

  const port = configService.get<number>('port') || 5000;
  await app.listen(port, '0.0.0.0');

  console.log(`========================================================================`);
  console.log(`  Ambia Customer Management Service running on http://localhost:${port}`);
  console.log(`  Environment:  ${configService.get<string>('nodeEnv')}`);
  console.log(`  Health Check: http://localhost:${port}/health`);
  console.log(`========================================================================`);
}

bootstrap();

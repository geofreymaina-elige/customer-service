import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import configuration from './config/configuration';
import { MessagesModule } from './core/messages/messages.module';
import { DatabaseModule } from './core/database/database.module';
import { CacheModule } from './core/cache/cache.module';
import { TelemetryModule } from './core/telemetry/telemetry.module';
import { JobsModule } from './core/jobs/jobs.module';
import { EventsModule } from './core/events/events.module';
import { NotificationsModule } from './core/notifications/notifications.module';
import { AstppMysqlModule } from './core/astpp-mysql/astpp-mysql.module';
import { AstppModule } from './modules/astpp/astpp.module';
import { AuthModule } from './modules/auth/auth.module';
import { DevicesModule } from './modules/devices/devices.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { WalletsModule } from './modules/wallets/wallets.module';
import { CustomersModule } from './modules/customers/customers.module';
import { OperationsModule } from './modules/operations/operations.module';
import { HealthModule } from './modules/health/health.module';
import { WorkersModule } from './workers/workers.module';
import { AppConfigModule } from './modules/app-config/app-config.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env', '.env.local'],
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: (config.get<number>('rateLimit.ttl') || 60) * 1000,
          limit: config.get<number>('rateLimit.limit') || 120,
        },
      ],
    }),
    MessagesModule,
    DatabaseModule,
    CacheModule, // Global in-memory cache (swap with Redis later)
    TelemetryModule,
    JobsModule,
    EventsModule,
    NotificationsModule, // Kafka notifications
    AstppMysqlModule,
    AstppModule,
    AuthModule,
    DevicesModule,
    OnboardingModule,
    WalletsModule,
    CustomersModule,
    OperationsModule,
    HealthModule,
    WorkersModule,
    AppConfigModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}

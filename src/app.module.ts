import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { MessagesModule } from './core/messages/messages.module';
import { DatabaseModule } from './core/database/database.module';
import { CacheModule } from './core/cache/cache.module';
import { TelemetryModule } from './core/telemetry/telemetry.module';
import { JobsModule } from './core/jobs/jobs.module';
import { EventsModule } from './core/events/events.module';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env', '.env.local'],
    }),
    MessagesModule,
    DatabaseModule,
    CacheModule, // Global in-memory cache (swap with Redis later)
    TelemetryModule,
    JobsModule,
    EventsModule,
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
  ],
})
export class AppModule {}

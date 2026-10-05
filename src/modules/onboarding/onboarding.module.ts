import { Module } from '@nestjs/common';
import { OnboardingService } from './services/onboarding.service';
import { SasaPayWaasService } from './services/sasapay-waas.service';
import { WaasOnboardingJobService } from './services/waas-onboarding-job.service';
import { OnboardingController } from './controllers/onboarding.controller';
import { SasaPayKycController } from './controllers/sasapay-kyc.controller';
import { SasaPayKycService } from './services/sasapay-kyc.service';
import { AstppModule } from '../astpp/astpp.module';
import { DevicesModule } from '../devices/devices.module';
import { AuthModule } from '../auth/auth.module';
import { SecureJwtService } from '../../core/auth/jwt.service';
import { SasaPayLogger } from '../../core/logging/sasapay-logger.service';

@Module({
  imports: [AstppModule, DevicesModule, AuthModule],
  controllers: [OnboardingController, SasaPayKycController],
  providers: [OnboardingService, SasaPayWaasService, SasaPayKycService, WaasOnboardingJobService, SecureJwtService, SasaPayLogger],
  exports: [OnboardingService, SasaPayWaasService, SasaPayKycService, WaasOnboardingJobService],
})
export class OnboardingModule {}

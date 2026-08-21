import { Module } from '@nestjs/common';
import { OnboardingService } from './services/onboarding.service';
import { SasaPayWaasService } from './services/sasapay-waas.service';
import { OnboardingController } from './controllers/onboarding.controller';
import { AstppModule } from '../astpp/astpp.module';
import { DevicesModule } from '../devices/devices.module';
import { SecureJwtService } from '../../core/auth/jwt.service';

@Module({
  imports: [AstppModule, DevicesModule],
  controllers: [OnboardingController],
  providers: [OnboardingService, SasaPayWaasService, SecureJwtService],
  exports: [OnboardingService, SasaPayWaasService],
})
export class OnboardingModule {}

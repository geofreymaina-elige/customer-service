import { Module } from '@nestjs/common';
import { CustomerService } from './services/customer.service';
import { CustomerController } from './controllers/customer.controller';
import { SecureJwtService } from '../../core/auth/jwt.service';
import { OnboardingModule } from '../onboarding/onboarding.module';

@Module({
  imports: [OnboardingModule],
  controllers: [CustomerController],
  providers: [CustomerService, SecureJwtService],
  exports: [CustomerService],
})
export class CustomersModule {}

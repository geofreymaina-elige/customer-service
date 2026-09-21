import { Module } from '@nestjs/common';
import { WalletService } from './services/wallet.service';
import { WalletController } from './controllers/wallet.controller';
import { SecureJwtService } from '../../core/auth/jwt.service';
import { OnboardingModule } from '../onboarding/onboarding.module';

@Module({
  imports: [OnboardingModule],
  controllers: [WalletController],
  providers: [WalletService, SecureJwtService],
  exports: [WalletService],
})
export class WalletsModule {}

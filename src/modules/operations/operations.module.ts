import { Module } from '@nestjs/common';
import { CustomerOperationsService } from './services/customer-operations.service';
import { WalletKycSyncService } from './services/wallet-kyc-sync.service';
import { OperationsController } from './controllers/operations.controller';
import { WalletKycSyncController } from './controllers/wallet-kyc-sync.controller';
import { OnboardingModule } from '../onboarding/onboarding.module';

@Module({
  imports: [OnboardingModule],
  controllers: [OperationsController, WalletKycSyncController],
  providers: [CustomerOperationsService, WalletKycSyncService],
  exports: [CustomerOperationsService, WalletKycSyncService],
})
export class OperationsModule {}

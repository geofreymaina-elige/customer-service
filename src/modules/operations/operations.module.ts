import { Module } from '@nestjs/common';
import { CustomerOperationsService } from './services/customer-operations.service';
import { WalletKycSyncService } from './services/wallet-kyc-sync.service';
import { AdminSasaPayKycService } from './services/admin-sasapay-kyc.service';
import { OperationsController } from './controllers/operations.controller';
import { WalletKycSyncController } from './controllers/wallet-kyc-sync.controller';
import { AdminSasaPayKycController } from './controllers/admin-sasapay-kyc.controller';
import { OnboardingModule } from '../onboarding/onboarding.module';

@Module({
  imports: [OnboardingModule],
  controllers: [
    OperationsController,
    WalletKycSyncController,
    AdminSasaPayKycController,
  ],
  providers: [
    CustomerOperationsService,
    WalletKycSyncService,
    AdminSasaPayKycService,
  ],
  exports: [
    CustomerOperationsService,
    WalletKycSyncService,
    AdminSasaPayKycService,
  ],
})
export class OperationsModule {}

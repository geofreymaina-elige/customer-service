import { Controller, Post, Param, ParseIntPipe, Body, UseGuards } from '@nestjs/common';
import { WalletKycSyncService } from '../services/wallet-kyc-sync.service';

/**
 * Wallet KYC Sync Controller
 * 
 * Internal API endpoints for syncing wallet KYC data from ASTPP to PostgreSQL.
 * 
 * Base path: /internal/wallet-kyc
 * 
 * IMPORTANT: These are internal endpoints - should be protected with API key
 * or internal network firewall in production.
 */
@Controller('internal/wallet-kyc')
export class WalletKycSyncController {
  constructor(private readonly walletKycSyncService: WalletKycSyncService) {}

  /**
   * Sync wallet KYC for a specific customer
   * 
   * POST /internal/wallet-kyc/sync/:astppId
   * 
   * Triggered by:
   * - Admin after approving/rejecting wallet KYC
   * - Manual sync from admin dashboard
   * - Webhook from ASTPP (if configured)
   * 
   * @param astppId - ASTPP account ID
   */
  @Post('sync/:astppId')
  async syncCustomerWalletKyc(@Param('astppId', ParseIntPipe) astppId: number) {
    const result = await this.walletKycSyncService.syncWalletKyc(astppId);

    return {
      success: result.success,
      message: result.success
        ? `Wallet KYC synced successfully for customer ${astppId}`
        : `No wallet KYC found for customer ${astppId}`,
      data: result,
    };
  }

  /**
   * Bulk sync wallet KYC for multiple customers
   * 
   * POST /internal/wallet-kyc/bulk-sync
   * 
   * Useful for:
   * - Scheduled cron job (every 5-10 minutes)
   * - Catching up after system downtime
   * - Manual batch sync
   * 
   * @param body - { limit?: number }
   */
  @Post('bulk-sync')
  async bulkSyncWalletKyc(@Body('limit') limit?: number) {
    const result = await this.walletKycSyncService.bulkSyncWalletKyc(limit || 100);

    return {
      success: true,
      message: `Bulk wallet KYC sync completed: ${result.successful}/${result.totalProcessed} successful`,
      data: result,
    };
  }
}

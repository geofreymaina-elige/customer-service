import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AstppMysqlService } from '../../../core/astpp-mysql/astpp-mysql.service';
import { DatabaseService } from '../../../core/database/database.service';

/**
 * Wallet KYC Sync Service
 * 
 * Provides on-demand synchronization of wallet KYC applications from ASTPP MySQL
 * to PostgreSQL. This is triggered when:
 * - Admin approves/rejects wallet KYC in ASTPP
 * - Scheduled cron job runs
 * - Manual trigger from admin dashboard
 */
@Injectable()
export class WalletKycSyncService {
  private readonly logger = new Logger(WalletKycSyncService.name);

  constructor(
    private readonly astppMysql: AstppMysqlService,
    private readonly database: DatabaseService,
  ) {}

  /**
   * Sync wallet KYC application for a specific customer
   * 
   * @param astppId - ASTPP account ID
   * @returns Sync result with status and details
   */
  async syncWalletKyc(astppId: number): Promise<{
    success: boolean;
    astppId: number;
    walletKycStatus: string | null;
    applicationId: number | null;
    syncedAt: Date;
    documentsFound: number;
  }> {
    this.logger.log(`Starting wallet KYC sync for customer ${astppId}`);

    // 1. Fetch wallet KYC application from ASTPP
    const walletKyc = await this.astppMysql.queryOne<any>(`
      SELECT id, application_id, name, identity_document_number, physical_address,
             date_of_birth, gender, nationality, account_id, status, rejection_reason,
             system_notes, created_at, updated_at, reviewed_at, reviewed_by
      FROM wallet_kyc_applications
      WHERE account_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `, [astppId]);

    if (!walletKyc) {
      this.logger.warn(`No wallet KYC application found for customer ${astppId}`);
      return {
        success: false,
        astppId,
        walletKycStatus: null,
        applicationId: null,
        syncedAt: new Date(),
        documentsFound: 0,
      };
    }

    // 2. Fetch wallet KYC images
    const walletKycImages = await this.astppMysql.query<any>(`
      SELECT id, account_id, application_id, filename, original_name, image_type,
             file_size, mime_type, description, upload_date
      FROM wallet_application_images
      WHERE account_id = ? AND application_id = ? AND deleted_date IS NULL AND status = 1
      ORDER BY upload_date DESC
    `, [astppId, walletKyc.application_id]);

    this.logger.log(`Found ${walletKycImages.length} wallet KYC images for customer ${astppId}`);

    // 3. Sync to PostgreSQL
    await this.syncToPostgres(astppId, walletKyc, walletKycImages);

    this.logger.log(`✓ Wallet KYC sync completed for customer ${astppId}: status=${walletKyc.status}`);

    return {
      success: true,
      astppId,
      walletKycStatus: walletKyc.status,
      applicationId: walletKyc.id,
      syncedAt: new Date(),
      documentsFound: walletKycImages.length,
    };
  }

  /**
   * Sync wallet KYC data to PostgreSQL
   */
  private async syncToPostgres(
    astppId: number,
    walletKyc: any,
    walletKycImages: any[],
  ): Promise<void> {
    const client = await this.database.getClient();

    try {
      await client.query('BEGIN');

      // Get customer
      const customerResult = await client.query(
        'SELECT id FROM customers WHERE astpp_id = $1',
        [astppId],
      );

      if (customerResult.rows.length === 0) {
        throw new NotFoundException(`Customer with astpp_id ${astppId} not found`);
      }

      const customerId = customerResult.rows[0].id;

      // Upsert wallet KYC application
      await client.query(`
        INSERT INTO customer_applications (
          customer_id, astpp_id, application_id, application_type,
          kyc_status, rejection_reason, system_notes, reviewed_at, reviewed_by,
          synced_at, created_at, updated_at
        ) VALUES (
          $1, $2, $3, 'wallet_kyc', $4, $5, $6, $7, $8, NOW(), $9, $10
        )
        ON CONFLICT (application_id) DO UPDATE SET
          kyc_status = EXCLUDED.kyc_status,
          rejection_reason = EXCLUDED.rejection_reason,
          system_notes = EXCLUDED.system_notes,
          reviewed_at = EXCLUDED.reviewed_at,
          reviewed_by = EXCLUDED.reviewed_by,
          synced_at = NOW(),
          updated_at = EXCLUDED.updated_at
      `, [
        customerId,
        astppId,
        walletKyc.id,
        walletKyc.status || 'pending',
        walletKyc.rejection_reason || null,
        walletKyc.system_notes || null,
        walletKyc.reviewed_at || null,
        walletKyc.reviewed_by || null,
        walletKyc.created_at || new Date(),
        walletKyc.updated_at || new Date(),
      ]);

      // Prepare images JSON
      const imagesJson = JSON.stringify(walletKycImages.map(img => ({
        image_id: img.id,
        filename: img.filename,
        original_name: img.original_name,
        image_type: img.image_type,
        file_size: img.file_size,
        mime_type: img.mime_type,
        description: img.description || '',
        uploaded_at: img.upload_date,
      })));

      // Upsert wallet KYC applicant details
      await client.query(`
        INSERT INTO customer_applicant_details (
          application_id, customer_id, astpp_id, name,
          identity_document_type, identity_document_number,
          date_of_birth, gender, nationality, physical_address,
          images, synced_at, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, NOW(), NOW(), NOW()
        )
        ON CONFLICT (application_id) DO UPDATE SET
          name = EXCLUDED.name,
          identity_document_number = EXCLUDED.identity_document_number,
          date_of_birth = EXCLUDED.date_of_birth,
          gender = EXCLUDED.gender,
          nationality = EXCLUDED.nationality,
          physical_address = EXCLUDED.physical_address,
          images = EXCLUDED.images,
          synced_at = NOW(),
          updated_at = NOW()
      `, [
        walletKyc.id,
        customerId,
        astppId,
        walletKyc.name || '',
        'NATIONAL_ID', // Default
        walletKyc.identity_document_number || '',
        walletKyc.date_of_birth || null,
        this.mapGender(walletKyc.gender),
        walletKyc.nationality || null,
        walletKyc.physical_address || null,
        imagesJson,
      ]);

      // Update customer wallet_kyc_status
      await client.query(`
        UPDATE customers SET
          wallet_kyc_status = $2,
          wallet_kyc_required = true,
          wallet_kyc_flagged_at = COALESCE(wallet_kyc_flagged_at, $3),
          updated_at = NOW()
        WHERE astpp_id = $1
      `, [astppId, walletKyc.status, walletKyc.created_at]);

      // If approved, enable wallet
      if (walletKyc.status === 'approved') {
        await client.query(`
          UPDATE customer_wallets SET
            status = 'active',
            is_locked = false,
            lock_reason = NULL,
            updated_at = NOW()
          WHERE astpp_id = $1
        `, [astppId]);
      }

      // If rejected, disable wallet
      if (walletKyc.status === 'rejected') {
        await client.query(`
          UPDATE customer_wallets SET
            status = 'locked',
            is_locked = true,
            lock_reason = $2,
            locked_by = 'ADMIN_WALLET_KYC',
            locked_at = NOW(),
            updated_at = NOW()
          WHERE astpp_id = $1
        `, [astppId, `Wallet KYC rejected: ${walletKyc.rejection_reason || 'No reason provided'}`]);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Map gender from ASTPP
   */
  private mapGender(gender: number | undefined): string | null {
    if (!gender) return null;
    
    switch (gender) {
      case 1: return 'male';
      case 2: return 'female';
      default: return 'other';
    }
  }

  /**
   * Bulk sync wallet KYC for multiple customers
   * Useful for scheduled jobs
   */
  async bulkSyncWalletKyc(limit: number = 100): Promise<{
    totalProcessed: number;
    successful: number;
    failed: number;
    errors: Array<{ astppId: number; error: string }>;
  }> {
    this.logger.log(`Starting bulk wallet KYC sync (limit: ${limit})`);

    // Find customers with pending wallet KYC
    const pendingCustomers = await this.astppMysql.query<{ account_id: number }>(`
      SELECT DISTINCT account_id
      FROM wallet_kyc_applications
      WHERE status IN ('pending', 'approved', 'rejected')
      ORDER BY updated_at DESC
      LIMIT ?
    `, [limit]);

    this.logger.log(`Found ${pendingCustomers.length} customers with wallet KYC to sync`);

    const results = {
      totalProcessed: 0,
      successful: 0,
      failed: 0,
      errors: [] as Array<{ astppId: number; error: string }>,
    };

    for (const { account_id: astppId } of pendingCustomers) {
      results.totalProcessed++;

      try {
        await this.syncWalletKyc(astppId);
        results.successful++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          astppId,
          error: error.message,
        });
        this.logger.error(`Failed to sync wallet KYC for customer ${astppId}: ${error.message}`);
      }
    }

    this.logger.log(
      `✓ Bulk wallet KYC sync completed: ${results.successful}/${results.totalProcessed} successful`,
    );

    return results;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { AstppMysqlService } from '../../core/astpp-mysql/astpp-mysql.service';
import { DatabaseService } from '../../core/database/database.service';
import { parseDateOrNull, parseTimestampOrNull } from '../../core/utils/date.util';
import * as fs from 'fs/promises';
import * as path from 'path';

interface Checkpoint {
  lastProcessedAstppId: number;
  totalProcessed: number;
  totalSkipped: number;
  totalErrors: number;
  startedAt: string;
  lastCheckpointAt: string;
}

interface CustomerSnapshot {
  account: any;
  application: any;
  applicant_details: any;
  wallet_kyc: any;
  wallet_kyc_images: any[];
  voip_number: string | null;
}

/**
 * Snapshot Worker
 * 
 * One-time worker to load historical customer data from ASTPP MySQL to PostgreSQL.
 * 
 * Usage:
 *   ts-node src/workers/snapshot/run-snapshot.ts
 * 
 * Features:
 * - Resumable (checkpoint system)
 * - Idempotent (can re-run without duplicates)
 * - Batch processing
 * - Progress tracking
 * - Error logging
 */
@Injectable()
export class SnapshotWorker {
  private readonly logger = new Logger(SnapshotWorker.name);
  private readonly checkpointFile = path.join(process.cwd(), 'snapshot_checkpoint.json');
  private readonly errorLogFile = path.join(process.cwd(), 'snapshot_errors.log');
  private readonly batchSize = 100;
  private readonly checkpointInterval = 500;

  constructor(
    private readonly astppMysql: AstppMysqlService,
    private readonly database: DatabaseService,
  ) {}

  /**
   * Run the snapshot worker
   */
  async run(): Promise<void> {
    this.logger.log('========================================');
    this.logger.log('Starting Snapshot Worker');
    this.logger.log('========================================');

    // Load checkpoint (resume if interrupted)
    let checkpoint = await this.loadCheckpoint();

    this.logger.log(`Resuming from astpp_id: ${checkpoint.lastProcessedAstppId}`);
    this.logger.log(`Batch size: ${this.batchSize}, Checkpoint interval: ${this.checkpointInterval}`);

    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      // Fetch batch of customer IDs
      // Note: MySQL doesn't accept bound parameters for LIMIT/OFFSET, so we use string interpolation
      // Filter: Only accounts with type = 9 (customer accounts, not resellers/admins)
      const customerIds = await this.astppMysql.query<{ id: number }>(
        `SELECT id FROM accounts WHERE deleted = 0 AND type = 9 ORDER BY id ASC LIMIT ${this.batchSize} OFFSET ${offset}`,
        [],
      );

      if (customerIds.length === 0) {
        hasMore = false;
        break;
      }

      this.logger.log(`Processing batch: ${customerIds.length} customers (offset: ${offset})`);

      for (const { id: astpp_id } of customerIds) {
        // Skip if already processed (resume scenario)
        if (astpp_id <= checkpoint.lastProcessedAstppId) {
          checkpoint.totalSkipped++;
          continue;
        }

        try {
          // Fetch all related data for this customer
          const customerData = await this.fetchCustomerData(astpp_id);

          if (!customerData.account) {
            this.logger.warn(`Account ${astpp_id} not found, skipping`);
            checkpoint.totalSkipped++;
            continue;
          }

          // Insert into PostgreSQL
          await this.insertCustomerData(customerData);

          checkpoint.totalProcessed++;
          checkpoint.lastProcessedAstppId = astpp_id;

          // Log progress
          if (checkpoint.totalProcessed % 10 === 0) {
            this.logger.log(`Progress: ${checkpoint.totalProcessed} customers processed`);
          }

          // Checkpoint periodically
          if (checkpoint.totalProcessed % this.checkpointInterval === 0) {
            checkpoint.lastCheckpointAt = new Date().toISOString();
            await this.saveCheckpoint(checkpoint);
            this.logger.log(`✓ Checkpoint saved at astpp_id: ${astpp_id}`);
          }
        } catch (error) {
          this.logger.error(`Error processing customer ${astpp_id}: ${error.message}`);
          checkpoint.totalErrors++;

          // Log to error file
          await this.logError({
            astpp_id,
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString(),
          });
        }
      }

      offset += this.batchSize;
    }

    // Final checkpoint
    await this.saveCheckpoint(checkpoint);

    this.logger.log('========================================');
    this.logger.log('Snapshot Complete');
    this.logger.log('========================================');
    this.logger.log(`Total processed: ${checkpoint.totalProcessed}`);
    this.logger.log(`Total skipped: ${checkpoint.totalSkipped}`);
    this.logger.log(`Total errors: ${checkpoint.totalErrors}`);
    this.logger.log(`Duration: ${Date.now() - new Date(checkpoint.startedAt).getTime()}ms`);
  }

  /**
   * Fetch all customer data from ASTPP
   */
  private async fetchCustomerData(astpp_id: number): Promise<CustomerSnapshot> {
    const [account, application, applicant_details, wallet_kyc, voipNumber] = await Promise.all([
      // Core account data (only type = 9 customer accounts)
      this.astppMysql.queryOne(`
        SELECT id, number, first_name, last_name, email,
               telephone_2, country_id, currency_id, type AS account_type,
               deleted, creation
        FROM accounts WHERE id = ? AND deleted = 0 AND type = 9
      `, [astpp_id]),

      // Primary KYC application
      this.astppMysql.queryOne(`
        SELECT id AS application_id, applicationid, accountid, did_id, country_id,
               status, creation_date, approved_date, rejected_date
        FROM applications WHERE accountid = ? AND deleted = 0 LIMIT 1
      `, [astpp_id]),

      // Primary KYC details
      this.astppMysql.queryOne(`
        SELECT name, identity_document_type, identity_document_number, date_of_birth,
               gender, physical_address, nationality, identity_document, identity_document_back,
               id_verification, registration_type
        FROM applicant_details WHERE accountid = ? LIMIT 1
      `, [astpp_id]),

      // Secondary wallet KYC (if exists)
      this.astppMysql.queryOne(`
        SELECT id, application_id, name, identity_document_number, physical_address,
               date_of_birth, gender, nationality, account_id, status, rejection_reason,
               system_notes, created_at, updated_at, reviewed_at, reviewed_by
        FROM wallet_kyc_applications WHERE account_id = ? ORDER BY created_at DESC LIMIT 1
      `, [astpp_id]),

      // VoIP number (DID) associated with this account
      this.astppMysql.queryOne(`
        SELECT number FROM dids WHERE accountid = ? LIMIT 1
      `, [astpp_id]),
    ]);

    // Fetch wallet KYC images if wallet_kyc exists
    let wallet_kyc_images = [];
    if (wallet_kyc) {
      wallet_kyc_images = await this.astppMysql.query(`
        SELECT id, account_id, application_id, filename, original_name, image_type,
               file_size, mime_type, description, upload_date
        FROM wallet_application_images
        WHERE account_id = ? AND application_id = ? AND deleted_date IS NULL AND status = 1
        ORDER BY upload_date DESC
      `, [astpp_id, wallet_kyc.application_id]);
    }

    return {
      account,
      application,
      applicant_details,
      wallet_kyc,
      wallet_kyc_images,
      voip_number: voipNumber?.number || null,
    };
  }

  /**
   * Insert customer data into PostgreSQL
   */
  private async insertCustomerData(data: CustomerSnapshot): Promise<void> {
    const client = await this.database.getClient();

    try {
      await client.query('BEGIN');

      const { account, application, applicant_details, wallet_kyc, wallet_kyc_images, voip_number } = data;

      // Determine KYC statuses
      const kycStatus = this.mapKycStatus(application?.status);

      // Determine deleted_at from ASTPP deleted flag
      const deletedAt = account.deleted === 1 ? new Date() : null;

      // 1. Upsert customer
      await client.query(`
        INSERT INTO customers (
          astpp_id, phone_number, voip_number, first_name, last_name, email,
          country_id, currency_id, account_type,
          deleted_at, astpp_created_at, synced_at, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW(), NOW()
        )
        ON CONFLICT (astpp_id) DO UPDATE SET
          phone_number = EXCLUDED.phone_number,
          voip_number = EXCLUDED.voip_number,
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          email = EXCLUDED.email,
          deleted_at = EXCLUDED.deleted_at,
          synced_at = NOW(),
          updated_at = NOW()
        RETURNING id
      `, [
        account.id,
        account.number,
        voip_number,
        account.first_name || '',
        account.last_name || '',
        account.email || null,
        account.country_id || null,
        account.currency_id || null,
        account.account_type || null,
        deletedAt,
        parseTimestampOrNull(account.creation),
      ]);

      const customerResult = await client.query(
        'SELECT id FROM customers WHERE astpp_id = $1',
        [account.id],
      );
      const customerId = customerResult.rows[0].id;

      // 2. Upsert primary KYC application (if exists)
      if (application && applicant_details) {
        await client.query(`
          INSERT INTO customer_applications (
            customer_id, astpp_id, application_id, application_number,
            application_type, kyc_status, approved_at, rejected_at,
            synced_at, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, 'primary_kyc', $5, $6, $7, NOW(), $8, NOW()
          )
          ON CONFLICT (application_id) DO UPDATE SET
            kyc_status = EXCLUDED.kyc_status,
            approved_at = EXCLUDED.approved_at,
            rejected_at = EXCLUDED.rejected_at,
            synced_at = NOW(),
            updated_at = NOW()
        `, [
          customerId,
          account.id,
          application.application_id,
          application.applicationid || null,
          kycStatus,
          parseTimestampOrNull(application.approved_date),
          parseTimestampOrNull(application.rejected_date),
          parseTimestampOrNull(application.creation_date) || new Date(),
        ]);

        // Insert applicant details
        await client.query(`
          INSERT INTO customer_applicant_details (
            application_id, customer_id, astpp_id, name,
            identity_document_type, identity_document_number,
            date_of_birth, gender, nationality, physical_address,
            passport_photo_url, doc_front_url, doc_back_url,
            registration_type, synced_at, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW(), NOW()
          )
          ON CONFLICT (application_id) DO UPDATE SET
            name = EXCLUDED.name,
            identity_document_number = EXCLUDED.identity_document_number,
            date_of_birth = EXCLUDED.date_of_birth,
            synced_at = NOW(),
            updated_at = NOW()
        `, [
          application.application_id,
          customerId,
          account.id,
          applicant_details.name || '',
          this.mapDocumentType(applicant_details.identity_document_type),
          applicant_details.identity_document_number || '',
          parseDateOrNull(applicant_details.date_of_birth),
          this.mapGender(applicant_details.gender),
          applicant_details.nationality || null,
          applicant_details.physical_address || null,
          applicant_details.id_verification || null,
          applicant_details.identity_document || null,
          applicant_details.identity_document_back || null,
          applicant_details.registration_type || null,
        ]);
      }

      // 3. Upsert secondary wallet KYC (if exists)
      if (wallet_kyc) {
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
            synced_at = NOW(),
            updated_at = EXCLUDED.updated_at
        `, [
          customerId,
          account.id,
          wallet_kyc.id,
          wallet_kyc.status || 'pending',
          wallet_kyc.rejection_reason || null,
          wallet_kyc.system_notes || null,
          parseTimestampOrNull(wallet_kyc.reviewed_at),
          wallet_kyc.reviewed_by || null,
          parseTimestampOrNull(wallet_kyc.created_at) || new Date(),
          parseTimestampOrNull(wallet_kyc.updated_at) || new Date(),
        ]);

        // Insert wallet KYC applicant details with images
        const imagesJson = JSON.stringify(wallet_kyc_images.map(img => ({
          image_id: img.id,
          filename: img.filename,
          original_name: img.original_name,
          image_type: img.image_type,
          file_size: img.file_size,
          mime_type: img.mime_type,
          description: img.description || '',
          uploaded_at: parseTimestampOrNull(img.upload_date)?.toISOString() || null,
        })));

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
            images = EXCLUDED.images,
            synced_at = NOW(),
            updated_at = NOW()
        `, [
          wallet_kyc.id,
          customerId,
          account.id,
          wallet_kyc.name || '',
          'NATIONAL_ID', // Default, will be updated if needed
          wallet_kyc.identity_document_number || '',
          parseDateOrNull(wallet_kyc.date_of_birth),
          this.mapGender(wallet_kyc.gender),
          wallet_kyc.nationality || null,
          wallet_kyc.physical_address || null,
          imagesJson,
        ]);
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
   * Map ASTPP application status to KYC status
   */
  private mapKycStatus(status: number | undefined): string {
    if (!status) return 'pending';
    
    switch (status) {
      case 0: return 'pending';
      case 1: return 'pending';
      case 2: return 'approved';
      case 3: return 'rejected';
      default: return 'pending';
    }
  }

  /**
   * Map ASTPP document type (integer) to string
   */
  private mapDocumentType(type: number | undefined): string {
    if (!type) return 'NATIONAL_ID';
    
    switch (type) {
      case 0: return 'NATIONAL_ID';
      case 1: return 'PASSPORT';
      case 2: return 'ALIEN_CARD';
      case 3: return 'SERVICE_CARD';
      default: return 'NATIONAL_ID';
    }
  }

  /**
   * Map ASTPP gender (integer) to enum
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
   * Load checkpoint from file
   */
  private async loadCheckpoint(): Promise<Checkpoint> {
    try {
      const data = await fs.readFile(this.checkpointFile, 'utf-8');
      return JSON.parse(data);
    } catch {
      return {
        lastProcessedAstppId: 0,
        totalProcessed: 0,
        totalSkipped: 0,
        totalErrors: 0,
        startedAt: new Date().toISOString(),
        lastCheckpointAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Save checkpoint to file
   */
  private async saveCheckpoint(checkpoint: Checkpoint): Promise<void> {
    await fs.writeFile(this.checkpointFile, JSON.stringify(checkpoint, null, 2));
  }

  /**
   * Log error to file
   */
  private async logError(error: any): Promise<void> {
    const errorLine = JSON.stringify(error) + '\n';
    await fs.appendFile(this.errorLogFile, errorLine);
  }
}

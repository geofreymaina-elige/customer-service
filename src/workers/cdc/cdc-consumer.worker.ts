import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../core/database/database.service';
import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';

interface KafkaEvent {
  __op: 'c' | 'r' | 'u' | 'd'; // create, read (snapshot), update, delete
  __source_ts_ms: number;
  [key: string]: any;
}

/**
 * Kafka CDC Consumer Worker
 * 
 * Real-time consumer that syncs customer data from Kafka topics to PostgreSQL.
 * 
 * Subscribes to:
 * - mysql.astpp.accounts
 * - mysql.astpp.applications
 * - mysql.astpp.applicant_details
 * 
 * Features:
 * - Idempotent (uses sync_version to prevent stale updates)
 * - Ordered processing (partitioned by astpp_id)
 * - Error handling with logging
 * - Graceful shutdown
 */
@Injectable()
export class CdcConsumerWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CdcConsumerWorker.name);
  private kafka: Kafka;
  private consumer: Consumer;
  private isRunning = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly database: DatabaseService,
  ) {}

  async onModuleInit() {
    const kafkaConfig = this.configService.get('kafka');

    this.kafka = new Kafka({
      clientId: kafkaConfig.clientId,
      brokers: kafkaConfig.brokers,
      retry: {
        initialRetryTime: 300,
        retries: 10,
      },
    });

    this.consumer = this.kafka.consumer({
      groupId: kafkaConfig.groupId,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
    });

    this.logger.log(`Kafka CDC Consumer initialized`);
    this.logger.log(`Brokers: ${kafkaConfig.brokers.join(', ')}`);
    this.logger.log(`Group ID: ${kafkaConfig.groupId}`);
  }

  async onModuleDestroy() {
    await this.stop();
  }

  /**
   * Start consuming events
   */
  async start() {
    if (this.isRunning) {
      this.logger.warn('CDC Consumer already running');
      return;
    }

    const kafkaConfig = this.configService.get('kafka');
    const topics = [
      kafkaConfig.topics.accounts,
      kafkaConfig.topics.applications,
      kafkaConfig.topics.applicantDetails,
    ];

    await this.consumer.connect();
    this.logger.log('Connected to Kafka');

    await this.consumer.subscribe({
      topics,
      fromBeginning: false, // Only consume new messages (not historical)
    });

    this.logger.log(`Subscribed to topics: ${topics.join(', ')}`);

    this.isRunning = true;

    await this.consumer.run({
      eachMessage: async (payload: EachMessagePayload) => {
        await this.handleMessage(payload);
      },
    });

    this.logger.log('CDC Consumer started successfully');
  }

  /**
   * Stop consuming events
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    await this.consumer.disconnect();
    this.logger.log('CDC Consumer stopped');
  }

  /**
   * Handle incoming Kafka message
   */
  private async handleMessage(payload: EachMessagePayload) {
    const { topic, partition, message } = payload;

    try {
      const value = message.value?.toString();
      if (!value) {
        return;
      }

      const event: KafkaEvent = JSON.parse(value);

      // Route to appropriate handler based on topic
      const kafkaConfig = this.configService.get('kafka');

      if (topic === kafkaConfig.topics.accounts) {
        await this.handleAccountsEvent(event);
      } else if (topic === kafkaConfig.topics.applications) {
        await this.handleApplicationsEvent(event);
      } else if (topic === kafkaConfig.topics.applicantDetails) {
        await this.handleApplicantDetailsEvent(event);
      }
    } catch (error) {
      this.logger.error(
        `Error processing message from ${topic} [${partition}]: ${error.message}`,
        error.stack,
      );
      // Don't throw - we want to continue processing other messages
    }
  }

  /**
   * Handle mysql.astpp.accounts events
   */
  private async handleAccountsEvent(event: KafkaEvent) {
    const { __op, id, deleted, number, first_name, last_name, email, balance, credit_limit, 
            country_id, currency_id, customer_type, status, type: account_type, 
            creation, __source_ts_ms } = event;

    const astpp_id = id;

    switch (__op) {
      case 'c': // INSERT - new customer
      case 'r': // READ (snapshot) - treat as insert
        await this.createOrUpdateCustomer(astpp_id, event);
        this.logger.log(`Customer ${astpp_id} created/read`);
        break;

      case 'u': // UPDATE - customer data changed
        await this.updateCustomer(astpp_id, event);
        this.logger.log(`Customer ${astpp_id} updated`);
        break;

      case 'd': // DELETE - customer hard-deleted
        await this.deleteCustomer(astpp_id, __source_ts_ms);
        this.logger.log(`Customer ${astpp_id} deleted`);
        break;
    }
  }

  /**
   * Create or update customer
   */
  private async createOrUpdateCustomer(astpp_id: number, event: KafkaEvent) {
    const client = await this.database.getClient();

    try {
      await client.query('BEGIN');

      const { number, first_name, last_name, email, balance, credit_limit,
              country_id, currency_id, customer_type, status, type: account_type,
              deleted, creation, __source_ts_ms } = event;

      // Check if customer exists and compare version
      const existing = await client.query(
        'SELECT sync_version FROM customers WHERE astpp_id = $1',
        [astpp_id],
      );

      if (existing.rows.length > 0 && existing.rows[0].sync_version >= __source_ts_ms) {
        // Skip stale update
        await client.query('ROLLBACK');
        this.logger.debug(`Skipping stale event for customer ${astpp_id}`);
        return;
      }

      // Upsert customer
      await client.query(`
        INSERT INTO customers (
          astpp_id, phone_number, first_name, last_name, email, balance, credit_limit,
          country_id, currency_id, customer_type, account_status, account_type,
          deleted, astpp_created_at, sync_version, synced_at, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW(), NOW()
        )
        ON CONFLICT (astpp_id) DO UPDATE SET
          phone_number = EXCLUDED.phone_number,
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          email = EXCLUDED.email,
          balance = EXCLUDED.balance,
          credit_limit = EXCLUDED.credit_limit,
          country_id = EXCLUDED.country_id,
          currency_id = EXCLUDED.currency_id,
          customer_type = EXCLUDED.customer_type,
          account_status = EXCLUDED.account_status,
          account_type = EXCLUDED.account_type,
          deleted = EXCLUDED.deleted,
          sync_version = EXCLUDED.sync_version,
          synced_at = NOW(),
          updated_at = NOW()
      `, [
        astpp_id,
        number || '',
        first_name || '',
        last_name || '',
        email || null,
        balance || 0,
        credit_limit || 0,
        country_id || null,
        currency_id || null,
        customer_type || null,
        status || null,
        account_type || null,
        deleted === 1,
        creation || null,
        __source_ts_ms,
      ]);

      // If deleted flag changed to true, disable wallet
      if (deleted === 1) {
        await this.disableWallet(astpp_id, 'Customer deleted in ASTPP', client);
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
   * Update customer
   */
  private async updateCustomer(astpp_id: number, event: KafkaEvent) {
    // Same as createOrUpdateCustomer - upsert handles both
    await this.createOrUpdateCustomer(astpp_id, event);
  }

  /**
   * Delete customer
   */
  private async deleteCustomer(astpp_id: number, sync_version: number) {
    const client = await this.database.getClient();

    try {
      await client.query('BEGIN');

      // Soft-delete customer
      await client.query(`
        UPDATE customers SET
          deleted = true,
          deleted_at = NOW(),
          sync_version = $2,
          updated_at = NOW()
        WHERE astpp_id = $1
      `, [astpp_id, sync_version]);

      // Disable wallet
      await this.disableWallet(astpp_id, 'Customer deleted in ASTPP', client);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Handle mysql.astpp.applications events
   */
  private async handleApplicationsEvent(event: KafkaEvent) {
    const { __op, id: application_id, accountid: astpp_id, status, 
            approved_date, rejected_date, __source_ts_ms } = event;

    if (__op === 'd') {
      // Ignore deletions on applications
      return;
    }

    const client = await this.database.getClient();

    try {
      await client.query('BEGIN');

      // Get customer ID
      const customerResult = await client.query(
        'SELECT id FROM customers WHERE astpp_id = $1',
        [astpp_id],
      );

      if (customerResult.rows.length === 0) {
        // Customer not yet synced - will be handled when accounts event arrives
        await client.query('ROLLBACK');
        return;
      }

      const customer_id = customerResult.rows[0].id;
      const kyc_status = this.mapKycStatus(status);

      // Upsert application
      await client.query(`
        INSERT INTO customer_applications (
          customer_id, astpp_id, application_id, application_number,
          application_type, kyc_status, approved_at, rejected_at,
          sync_version, synced_at, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, 'primary_kyc', $5, $6, $7, $8, NOW(), NOW(), NOW()
        )
        ON CONFLICT (application_id) DO UPDATE SET
          kyc_status = EXCLUDED.kyc_status,
          approved_at = EXCLUDED.approved_at,
          rejected_at = EXCLUDED.rejected_at,
          sync_version = EXCLUDED.sync_version,
          synced_at = NOW(),
          updated_at = NOW()
      `, [
        customer_id,
        astpp_id,
        application_id,
        event.applicationid || null,
        kyc_status,
        approved_date || null,
        rejected_date || null,
        __source_ts_ms,
      ]);

      // Update customer status if KYC approved
      if (kyc_status === 'approved') {
        await client.query(`
          UPDATE customers SET
            status = 'active',
            has_wallet = true,
            updated_at = NOW()
          WHERE astpp_id = $1
        `, [astpp_id]);
      }

      await client.query('COMMIT');
      this.logger.log(`Application ${application_id} for customer ${astpp_id} updated: ${kyc_status}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Handle mysql.astpp.applicant_details events
   */
  private async handleApplicantDetailsEvent(event: KafkaEvent) {
    const { __op, accountid: astpp_id, name, identity_document_type, identity_document_number,
            date_of_birth, gender, nationality, physical_address, identity_document,
            identity_document_back, id_verification, registration_type, __source_ts_ms } = event;

    if (__op === 'd') {
      // Ignore deletions
      return;
    }

    const client = await this.database.getClient();

    try {
      await client.query('BEGIN');

      // Get customer and their primary application
      const result = await client.query(`
        SELECT c.id as customer_id, ca.application_id
        FROM customers c
        LEFT JOIN customer_applications ca ON ca.astpp_id = c.astpp_id AND ca.application_type = 'primary_kyc'
        WHERE c.astpp_id = $1
      `, [astpp_id]);

      if (result.rows.length === 0 || !result.rows[0].application_id) {
        // Customer or application not yet synced
        await client.query('ROLLBACK');
        return;
      }

      const { customer_id, application_id } = result.rows[0];

      // Upsert applicant details
      await client.query(`
        INSERT INTO customer_applicant_details (
          application_id, customer_id, astpp_id, name,
          identity_document_type, identity_document_number,
          date_of_birth, gender, nationality, physical_address,
          passport_photo_url, doc_front_url, doc_back_url,
          registration_type, sync_version, synced_at, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW(), NOW()
        )
        ON CONFLICT (application_id) DO UPDATE SET
          name = EXCLUDED.name,
          identity_document_type = EXCLUDED.identity_document_type,
          identity_document_number = EXCLUDED.identity_document_number,
          date_of_birth = EXCLUDED.date_of_birth,
          gender = EXCLUDED.gender,
          nationality = EXCLUDED.nationality,
          physical_address = EXCLUDED.physical_address,
          passport_photo_url = EXCLUDED.passport_photo_url,
          doc_front_url = EXCLUDED.doc_front_url,
          doc_back_url = EXCLUDED.doc_back_url,
          sync_version = EXCLUDED.sync_version,
          synced_at = NOW(),
          updated_at = NOW()
      `, [
        application_id,
        customer_id,
        astpp_id,
        name || '',
        this.mapDocumentType(identity_document_type),
        identity_document_number || '',
        date_of_birth || null,
        this.mapGender(gender),
        nationality || null,
        physical_address || null,
        id_verification || null,
        identity_document || null,
        identity_document_back || null,
        registration_type || null,
        __source_ts_ms,
      ]);

      await client.query('COMMIT');
      this.logger.log(`Applicant details for customer ${astpp_id} updated`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Disable wallet for customer
   */
  private async disableWallet(astpp_id: number, reason: string, client: any) {
    await client.query(`
      UPDATE customer_wallets SET
        status = 'locked',
        is_locked = true,
        lock_reason = $2,
        locked_by = 'SYSTEM_CDC',
        locked_at = NOW(),
        updated_at = NOW()
      WHERE astpp_id = $1 AND status != 'closed'
    `, [astpp_id, reason]);
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
   * Map ASTPP document type to string
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
   * Map ASTPP gender to enum
   */
  private mapGender(gender: number | undefined): string | null {
    if (!gender) return null;
    
    switch (gender) {
      case 1: return 'male';
      case 2: return 'female';
      default: return 'other';
    }
  }
}

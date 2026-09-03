import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPool, Pool } from 'mysql2/promise';

export interface AstppCustomerRecord {
  accountId: number;
  accountNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  voipNumber: string;
  timezone: string;
  identityDocumentType: number;
  identityDocumentNumber: string;
  applicationStatus: number; // 0=submitted, 1=saved, 2=approved, 3=rejected
  applicationId?: number; // From ASTPP applications.id
  dateOfBirth?: string;
  gender?: string;
}

@Injectable()
export class AstppAdapterService implements OnModuleInit, OnModuleDestroy {
  private mysqlPool: Pool | null = null;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const astppConfig = this.configService.get('astpp');
    try {
      this.mysqlPool = createPool({
        host: astppConfig.host,
        port: astppConfig.port,
        database: astppConfig.database,
        user: astppConfig.user,
        password: astppConfig.password,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
      });
      console.log('[ASTPP ADAPTER] MySQL pool initialized');
    } catch (error) {
      console.warn('[ASTPP ADAPTER] Could not connect to MySQL ASTPP DB on startup. Running in standalone fallback mode.');
    }
  }

  async onModuleDestroy() {
    if (this.mysqlPool) {
      await this.mysqlPool.end();
    }
  }

  /**
   * Lookup customer details from ASTPP MySQL database by account ID or VoIP DID number
   */
  async lookupCustomer(astppAccountId: string | number, voipNumber?: string): Promise<AstppCustomerRecord | null> {
    if (!this.mysqlPool) {
      return null;
    }

    try {
      let resolvedAccountId = astppAccountId;

      // 1. If voipNumber is given without an accountId, resolve it via dids
      if (voipNumber && !astppAccountId) {
        const [didRows] = await this.mysqlPool.query<any[]>(
          'SELECT accountid FROM dids WHERE number = ? LIMIT 1',
          [voipNumber],
        );
        if (Array.isArray(didRows) && didRows.length > 0) {
          resolvedAccountId = didRows[0].accountid;
        }
      }

      // 2. Fetch core account by primary key (instant indexed lookup)
      const [accountRows] = await this.mysqlPool.query<any[]>(
        `SELECT id, number, first_name, last_name, email, telephone_2
         FROM accounts
         WHERE id = ? AND deleted = 0
         LIMIT 1`,
        [resolvedAccountId],
      );

      if (!Array.isArray(accountRows) || accountRows.length === 0) {
        return null;
      }
      const account = accountRows[0];

      // 3. Fetch primary KYC application (indexed on accountid)
      const [appRows] = await this.mysqlPool.query<any[]>(
        `SELECT id, status FROM applications WHERE accountid = ? AND deleted = 0 ORDER BY id DESC LIMIT 1`,
        [account.id],
      );
      const app = Array.isArray(appRows) && appRows.length > 0 ? appRows[0] : null;

      // 4. Fetch applicant details (indexed on accountid)
      const [applicantRows] = await this.mysqlPool.query<any[]>(
        `SELECT identity_document_type, identity_document_number, date_of_birth, gender
         FROM applicant_details
         WHERE accountid = ?
         LIMIT 1`,
        [account.id],
      );
      const applicant = Array.isArray(applicantRows) && applicantRows.length > 0 ? applicantRows[0] : null;

      // 5. Fetch DID voip number if not provided (indexed on accountid)
      let finalVoip = voipNumber || '';
      if (!finalVoip) {
        const [didRows] = await this.mysqlPool.query<any[]>(
          `SELECT number FROM dids WHERE accountid = ? LIMIT 1`,
          [account.id],
        );
        if (Array.isArray(didRows) && didRows.length > 0) {
          finalVoip = didRows[0].number;
        }
      }

      return {
        accountId: account.id,
        accountNumber: account.number,
        firstName: account.first_name || '',
        lastName: account.last_name || '',
        email: account.email || '',
        phoneNumber: account.telephone_2 || account.number || '',
        voipNumber: finalVoip || account.number || '',
        timezone: 'Africa/Nairobi',
        identityDocumentType: applicant?.identity_document_type ?? 0,
        identityDocumentNumber: applicant?.identity_document_number ?? '',
        dateOfBirth: applicant?.date_of_birth ?? undefined,
        gender: applicant?.gender ?? undefined,
        applicationStatus: app?.status ?? 0,
        applicationId: app?.id ?? undefined,
      };
    } catch (error) {
      console.error('[ASTPP ADAPTER] Error querying ASTPP database:', error);
      return null;
    }
  }
}

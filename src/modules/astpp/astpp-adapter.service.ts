import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPool, Pool } from 'mysql2/promise';

export interface AstppCustomerRecord {
  accountId: number;
  accountNumber: string;
  countryId?: number;
  countryCode?: string;
  currencyId?: number;
  accountType?: number;
  createdAt?: string;
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
  applicationNumber?: string;
  approvedAt?: string;
  rejectedAt?: string;
  applicantDetails?: {
    name: string;
    identityDocumentType: number;
    identityDocumentNumber: string;
    dateOfBirth?: string;
    gender?: number;
    nationality?: number;
    physicalAddress?: string;
    passportPhotoUrl?: string;
    documentFrontUrl?: string;
    documentBackUrl?: string;
  };
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
      console.warn('[ASTPP ADAPTER] Could not initialize the MySQL pool; ASTPP-backed registration will be unavailable.');
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
      throw new Error('ASTPP MySQL connection pool is not initialized.');
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
        `SELECT account.id, account.number, account.first_name, account.last_name,
                account.email, account.telephone_2, account.country_id,
                country.phonecode AS country_code, account.currency_id,
                account.type AS account_type, account.creation
         FROM accounts AS account
         LEFT JOIN countrycode AS country ON country.id = account.country_id
         WHERE account.id = ? AND account.deleted = 0
         LIMIT 1`,
        [resolvedAccountId],
      );

      if (!Array.isArray(accountRows) || accountRows.length === 0) {
        return null;
      }
      const account = accountRows[0];

      // 3. Fetch primary KYC application (indexed on accountid)
      const [appRows] = await this.mysqlPool.query<any[]>(
        `SELECT id, applicationid, status, approved_date, rejected_date
         FROM applications WHERE accountid = ? AND deleted = 0 ORDER BY id DESC LIMIT 1`,
        [account.id],
      );
      const app = Array.isArray(appRows) && appRows.length > 0 ? appRows[0] : null;

      // 4. Fetch applicant details (indexed on accountid)
      const [applicantRows] = await this.mysqlPool.query<any[]>(
        `SELECT name, identity_document_type, identity_document_number, date_of_birth,
                gender, nationality, physical_address, id_verification,
                identity_document, identity_document_back
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
        countryId: account.country_id ?? undefined,
        countryCode: account.country_code ?? undefined,
        currencyId: account.currency_id ?? undefined,
        accountType: account.account_type ?? undefined,
        createdAt: account.creation ?? undefined,
        firstName: account.first_name || '',
        lastName: account.last_name || '',
        email: account.email || '',
        phoneNumber: account.number || '',
        voipNumber: finalVoip || account.number || '',
        timezone: 'Africa/Nairobi',
        identityDocumentType: applicant?.identity_document_type ?? 0,
        identityDocumentNumber: applicant?.identity_document_number ?? '',
        applicationStatus: app?.status ?? 0,
        applicationId: app?.id ?? undefined,
        applicationNumber: app?.applicationid ?? undefined,
        approvedAt: app?.approved_date ?? undefined,
        rejectedAt: app?.rejected_date ?? undefined,
        applicantDetails: applicant ? {
          name: applicant.name || `${account.first_name || ''} ${account.last_name || ''}`.trim(),
          identityDocumentType: applicant.identity_document_type ?? 0,
          identityDocumentNumber: applicant.identity_document_number || '',
          dateOfBirth: applicant.date_of_birth ?? undefined,
          gender: applicant.gender ?? undefined,
          nationality: applicant.nationality ?? undefined,
          physicalAddress: applicant.physical_address ?? undefined,
          passportPhotoUrl: applicant.id_verification ?? undefined,
          documentFrontUrl: applicant.identity_document ?? undefined,
          documentBackUrl: applicant.identity_document_back ?? undefined,
        } : undefined,
      };
    } catch (error) {
      console.error('[ASTPP ADAPTER] Error querying ASTPP database:', error);
      throw error;
    }
  }
}

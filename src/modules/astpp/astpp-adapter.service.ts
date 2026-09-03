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
      const sql = `
        SELECT
          a.id AS accountId,
          a.number AS accountNumber,
          a.first_name AS firstName,
          a.last_name AS lastName,
          a.email AS email,
          COALESCE(a.telephone_2, a.number) AS phoneNumber,
          d.number AS voipNumber,
          'Africa/Nairobi' AS timezone,
          ad.identity_document_type AS identityDocumentType,
          ad.identity_document_number AS identityDocumentNumber,
          ad.date_of_birth AS dateOfBirth,
          ad.gender AS gender,
          COALESCE(app.status, 0) AS applicationStatus,
          app.id AS applicationId
        FROM accounts a
        LEFT JOIN applications app ON app.accountid = a.id AND app.deleted = 0
        LEFT JOIN applicant_details ad ON ad.accountid = a.id
        LEFT JOIN dids d ON d.accountid = a.id
        WHERE a.deleted = 0 AND (a.id = ? OR d.number = ?)
        ORDER BY app.creation_date DESC
        LIMIT 1
      `;

      const [rows] = await this.mysqlPool.query(sql, [astppAccountId, voipNumber || '']);
      if (Array.isArray(rows) && rows.length > 0) {
        return rows[0] as AstppCustomerRecord;
      }
      return null;
    } catch (error) {
      console.error('[ASTPP ADAPTER] Error querying ASTPP database:', error);
      return null;
    }
  }
}

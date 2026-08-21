import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool: Pool;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const dbConfig = this.configService.get('database');
    this.pool = new Pool({
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.name,
      user: dbConfig.user,
      password: dbConfig.password,
      ssl: dbConfig.ssl ? { rejectUnauthorized: false } : false,
      min: dbConfig.poolMin,
      max: dbConfig.poolMax,
    });

    try {
      const client = await this.pool.connect();
      console.log('[DATABASE] PostgreSQL connection pool established successfully');
      client.release();
    } catch (error) {
      console.error('[DATABASE] Failed to connect to PostgreSQL:', error);
    }
  }

  async onModuleDestroy() {
    if (this.pool) {
      await this.pool.end();
      console.log('[DATABASE] PostgreSQL connection pool closed');
    }
  }

  async query<T extends QueryResultRow = any>(text: string, params: any[] = []): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  async queryOne<T extends QueryResultRow = any>(text: string, params: any[] = []): Promise<T | null> {
    const res = await this.pool.query<T>(text, params);
    return res.rows.length > 0 ? res.rows[0] : null;
  }

  async getClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

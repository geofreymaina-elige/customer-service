import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as mysql from 'mysql2/promise';

/**
 * ASTPP MySQL Service
 * 
 * Provides read-only connection to ASTPP MySQL database for:
 * - Initial snapshot worker (historical data load)
 * - On-demand wallet KYC sync API
 * 
 * IMPORTANT: This service uses a separate MySQL connection pool
 * from the main PostgreSQL database service.
 */
@Injectable()
export class AstppMysqlService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AstppMysqlService.name);
  private pool: mysql.Pool;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const astppConfig = this.configService.get('astpp');
    
    this.pool = mysql.createPool({
      host: astppConfig.host,
      port: astppConfig.port,
      user: astppConfig.user,
      password: astppConfig.password,
      database: astppConfig.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    });

    this.logger.log(`MySQL ASTPP connection pool initialized: ${astppConfig.host}:${astppConfig.port}/${astppConfig.database}`);
  }

  async onModuleDestroy() {
    if (this.pool) {
      await this.pool.end();
      this.logger.log('MySQL ASTPP connection pool closed');
    }
  }

  /**
   * Execute a query against ASTPP MySQL database
   */
  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const [rows] = await this.pool.execute(sql, params);
    return rows as T[];
  }

  /**
   * Execute a query and return a single row
   */
  async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Execute a query within a transaction
   */
  async transaction<T>(callback: (connection: mysql.PoolConnection) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    
    try {
      await connection.beginTransaction();
      const result = await callback(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Get the connection pool (for advanced usage)
   */
  getPool(): mysql.Pool {
    return this.pool;
  }
}

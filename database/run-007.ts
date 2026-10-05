import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

async function runMigration007() {
  const pool = new Pool({
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    database: process.env.DATABASE_NAME || 'ambia_pay',
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'postgres',
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  console.log('[MIGRATION 007] Connecting to PostgreSQL database...');
  const client = await pool.connect();

  try {
    const filePath = path.join(__dirname, 'migrations', '007_add_sasapay_submission_log.sql');
    console.log('[MIGRATION 007] Running migration 007...');
    
    const sql = fs.readFileSync(filePath, 'utf-8');
    
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    
    console.log('[MIGRATION 007] ✓ Migration 007 completed successfully!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[MIGRATION 007] Migration failed:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration007();

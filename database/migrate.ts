import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

async function runMigrations() {
  const pool = new Pool({
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    database: process.env.DATABASE_NAME || 'ambia_pay',
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'postgres',
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  console.log('[MIGRATION] Connecting to PostgreSQL database...');
  const client = await pool.connect();

  try {
    const migrationFilePath = path.join(__dirname, 'migrations', '001_initial_schema.sql');
    console.log(`[MIGRATION] Reading SQL from ${migrationFilePath}...`);
    const sql = fs.readFileSync(migrationFilePath, 'utf-8');

    console.log('[MIGRATION] Executing migration transaction...');
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('[MIGRATION] Migration 001_initial_schema.sql completed successfully!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[MIGRATION] Migration failed:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();

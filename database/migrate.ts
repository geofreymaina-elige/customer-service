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
    const migrationsDir = path.join(__dirname, 'migrations');
    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort(); // Run migrations in order: 001, 002, 003...

    console.log(`[MIGRATION] Found ${migrationFiles.length} migration file(s)`);

    for (const file of migrationFiles) {
      const filePath = path.join(migrationsDir, file);
      console.log(`[MIGRATION] Running ${file}...`);
      
      const sql = fs.readFileSync(filePath, 'utf-8');
      
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
      
      console.log(`[MIGRATION] ✓ ${file} completed successfully`);
    }

    console.log('[MIGRATION] All migrations completed successfully!');
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

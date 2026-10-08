import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`[CONFIG] ${name} is required to run migrations.`);
  }
  return value;
}

async function runMigrations() {
  const databasePort = Number(requiredEnvironment('DATABASE_PORT'));
  if (!Number.isInteger(databasePort) || databasePort < 1 || databasePort > 65535) {
    throw new Error('[CONFIG] DATABASE_PORT must be an integer between 1 and 65535.');
  }
  const databaseSsl = requiredEnvironment('DATABASE_SSL');
  if (databaseSsl !== 'true' && databaseSsl !== 'false') {
    throw new Error('[CONFIG] DATABASE_SSL must be either true or false.');
  }

  const pool = new Pool({
    host: requiredEnvironment('DATABASE_HOST'),
    port: databasePort,
    database: requiredEnvironment('DATABASE_NAME'),
    user: requiredEnvironment('DATABASE_USER'),
    password: requiredEnvironment('DATABASE_PASSWORD'),
    ssl: databaseSsl === 'true' ? { rejectUnauthorized: true } : false,
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

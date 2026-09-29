/**
 * scripts/backfill-country-code.ts
 *
 * One-off script to populate customers.country_code from ASTPP's countrycode table.
 *
 * Strategy:
 *   1. Load the entire ASTPP countrycode table into an in-memory Map<id, iso>.
 *   2. Fetch all customers that have a country_id but no country_code.
 *   3. UPDATE customers SET country_code = ? WHERE astpp_id = ?.
 *
 * Run once after migration 003:
 *   npx ts-node -e "require('./scripts/backfill-country-code')"
 *   -- or --
 *   npx ts-node scripts/backfill-country-code.ts
 */

import 'reflect-metadata';
import * as dotenv from 'dotenv';
dotenv.config();

import * as mysql from 'mysql2/promise';
import type { PoolClient } from 'pg';
import { Pool } from 'pg';

// ---------------------------------------------------------------------------
// Config (read from .env -- same vars used by the main app)
// ---------------------------------------------------------------------------
const mysqlConfig = {
  host:     process.env.ASTPP_HOST     || 'localhost',
  port:     Number(process.env.ASTPP_PORT || 3306),
  user:     process.env.ASTPP_USER     || 'root',
  password: process.env.ASTPP_PASSWORD || '',
  database: process.env.ASTPP_DATABASE || 'astpp',
};

const pgConfig = {
  host:     process.env.DATABASE_HOST     || 'localhost',
  port:     Number(process.env.DATABASE_PORT || 5432),
  user:     process.env.DATABASE_USER     || 'postgres',
  password: process.env.DATABASE_PASSWORD || '',
  database: process.env.DATABASE_NAME     || 'customer_service',
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
interface CountrycodeRow { id: number; iso: string; }
interface CustomerRow   { astpp_id: number; country_id: number; }

async function main(): Promise<void> {
  console.log('[backfill-country-code] Starting...');

  const mysqlPool = mysql.createPool({ ...mysqlConfig, connectionLimit: 3 });
  const pgPool    = new Pool(pgConfig);

  try {
    // 1. Load country code map from ASTPP: id -> iso (2-letter code)
    const [rows] = await mysqlPool.execute(
      `SELECT id, iso FROM countrycode WHERE iso IS NOT NULL AND iso != ''`
    );

    const countryCodeMap = new Map<number, string>();
    for (const row of rows as CountrycodeRow[]) {
      if (row.id && row.iso) {
        countryCodeMap.set(Number(row.id), String(row.iso).trim());
      }
    }
    console.log(`[backfill-country-code] Loaded ${countryCodeMap.size} country codes from ASTPP`);

    // 2. Fetch all customers with a country_id but missing country_code
    const pgClient: PoolClient = await pgPool.connect();
    try {
      const result = await pgClient.query(
        `SELECT astpp_id, country_id
         FROM customers
         WHERE country_id IS NOT NULL
           AND (country_code IS NULL OR country_code = '')
         ORDER BY astpp_id ASC`
      );

      const customers = result.rows as CustomerRow[];
      console.log(`[backfill-country-code] ${customers.length} customers need country_code populated`);

      let updated = 0;
      let skipped = 0;

      for (const { astpp_id, country_id } of customers) {
        const code = countryCodeMap.get(country_id);
        if (!code) {
          console.warn(`  [SKIP] astpp_id=${astpp_id}: no ISO code found for country_id=${country_id}`);
          skipped++;
          continue;
        }

        await pgClient.query(
          `UPDATE customers SET country_code = $1, updated_at = NOW() WHERE astpp_id = $2`,
          [code, astpp_id]
        );
        updated++;

        if (updated % 500 === 0) {
          console.log(`  [progress] Updated ${updated} customers...`);
        }
      }

      console.log(`[backfill-country-code] Done. Updated=${updated}, Skipped=${skipped}`);
    } finally {
      pgClient.release();
    }
  } finally {
    await mysqlPool.end();
    await pgPool.end();
  }
}

main().catch((err: Error) => {
  console.error('[backfill-country-code] Fatal error:', err);
  process.exit(1);
});

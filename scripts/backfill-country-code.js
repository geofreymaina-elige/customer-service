/**
 * scripts/backfill-country-code.js
 *
 * One-off script to populate customers.country_code from ASTPP countrycode table.
 * Run with: node scripts/backfill-country-code.js
 */

'use strict';

require('dotenv').config();
const mysql = require('mysql2/promise');
const { Pool } = require('pg');

const mysqlConfig = {
  host:     process.env.ASTPP_HOST     || 'localhost',
  port:     Number(process.env.ASTPP_PORT     || 3306),
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

async function main() {
  console.log('[backfill-country-code] Starting...');

  const mysqlPool = mysql.createPool({ ...mysqlConfig, connectionLimit: 3 });
  const pgPool    = new Pool(pgConfig);

  try {
    // 1. Load country code map from ASTPP: id -> iso (2-letter code)
    const [rows] = await mysqlPool.execute(
      `SELECT id, iso FROM countrycode WHERE iso IS NOT NULL AND iso != ''`
    );

    const countryCodeMap = new Map();
    for (const row of rows) {
      if (row.id && row.iso) {
        countryCodeMap.set(Number(row.id), String(row.iso).trim());
      }
    }
    console.log(`[backfill-country-code] Loaded ${countryCodeMap.size} country codes from ASTPP`);

    // 2. Fetch customers with country_id but missing country_code
    const pgClient = await pgPool.connect();
    try {
      const result = await pgClient.query(
        `SELECT astpp_id, country_id
         FROM customers
         WHERE country_id IS NOT NULL
           AND (country_code IS NULL OR country_code = '')
         ORDER BY astpp_id ASC`
      );

      const customers = result.rows;
      console.log(`[backfill-country-code] ${customers.length} customers need country_code populated`);

      let updated = 0;
      let skipped = 0;

      for (const { astpp_id, country_id } of customers) {
        const code = countryCodeMap.get(Number(country_id));
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

main().catch((err) => {
  console.error('[backfill-country-code] Fatal error:', err);
  process.exit(1);
});

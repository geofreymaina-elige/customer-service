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

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`[CONFIG] ${name} is required to run this script.`);
  }
  return value.trim();
}

function requiredPort(name) {
  const port = Number(requiredEnvironment(name));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`[CONFIG] ${name} must be an integer between 1 and 65535.`);
  }
  return port;
}

const databaseSsl = requiredEnvironment('DATABASE_SSL');
if (databaseSsl !== 'true' && databaseSsl !== 'false') {
  throw new Error('[CONFIG] DATABASE_SSL must be either true or false.');
}

const mysqlConfig = {
  host:     requiredEnvironment('ASTPP_HOST'),
  port:     requiredPort('ASTPP_PORT'),
  user:     requiredEnvironment('ASTPP_USER'),
  password: requiredEnvironment('ASTPP_PASSWORD'),
  database: requiredEnvironment('ASTPP_DATABASE'),
};

const pgConfig = {
  host:     requiredEnvironment('DATABASE_HOST'),
  port:     requiredPort('DATABASE_PORT'),
  user:     requiredEnvironment('DATABASE_USER'),
  password: requiredEnvironment('DATABASE_PASSWORD'),
  database: requiredEnvironment('DATABASE_NAME'),
  ssl:      databaseSsl === 'true' ? { rejectUnauthorized: true } : false,
};

async function main() {
  console.log('[backfill-country-code] Starting...');

  const mysqlPool = mysql.createPool({
    ...mysqlConfig,
    connectionLimit: Number(requiredEnvironment('ASTPP_MYSQL_CONNECTION_LIMIT')),
  });
  const pgPool    = new Pool(pgConfig);

  try {
    // 1. Load country code map from ASTPP: id -> phonecode (2-letter code)
    const [rows] = await mysqlPool.execute(
      `SELECT id, phonecode FROM countrycode WHERE phonecode IS NOT NULL AND phonecode != ''`
    );

    const countryCodeMap = new Map();
    for (const row of rows) {
      if (row.id && row.phonecode) {
        countryCodeMap.set(Number(row.id), String(row.phonecode).trim());
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
          console.warn(`  [SKIP] astpp_id=${astpp_id}: no phonecode code found for country_id=${country_id}`);
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

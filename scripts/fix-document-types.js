/**
 * Document Type Verification and Fix Script
 * 
 * Compares ASTPP MySQL document types (READ-ONLY) with PostgreSQL stored types
 * and fixes only the records that are mismatched in PostgreSQL.
 * 
 * IMPORTANT: ASTPP MySQL is READ-ONLY - script never modifies ASTPP data
 * 
 * Usage: node scripts/fix-document-types.js [--dry-run]
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const { Pool } = require('pg');

// Configuration from environment variables
const BATCH_SIZE = parseInt(process.env.FIX_BATCH_SIZE || '100');
const DRY_RUN = process.argv.includes('--dry-run');

// Validate required environment variables
const requiredEnvVars = [
  'ASTPP_MYSQL_HOST',
  'ASTPP_MYSQL_USER',
  'ASTPP_MYSQL_PASSWORD',
  'ASTPP_MYSQL_DATABASE',
  'POSTGRES_HOST',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DATABASE',
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingVars.forEach(varName => console.error(`   - ${varName}`));
  console.error('\nPlease set these in your .env file or environment.');
  process.exit(1);
}

// ASTPP MySQL connection (READ-ONLY)
const astppConfig = {
  host: process.env.ASTPP_MYSQL_HOST,
  port: parseInt(process.env.ASTPP_MYSQL_PORT || '3306'),
  user: process.env.ASTPP_MYSQL_USER,
  password: process.env.ASTPP_MYSQL_PASSWORD,
  database: process.env.ASTPP_MYSQL_DATABASE,
  // READ-ONLY connection settings
  multipleStatements: false,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
};

// PostgreSQL connection (READ-WRITE for fixes)
const pgConfig = {
  host: process.env.POSTGRES_HOST,
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DATABASE,
  max: 10,
};

// Document type mapping: ASTPP number -> PostgreSQL string
function mapAstppDocTypeToString(astppType) {
  switch (Number(astppType)) {
    case 0: return 'NATIONAL_ID';
    case 1: return 'SERVICE_CARD';
    case 2: return 'ALIEN_CARD';
    case 3: return 'PASSPORT';
    default: return 'NATIONAL_ID';
  }
}

// Statistics
const stats = {
  total: 0,
  correct: 0,
  mismatched: 0,
  fixed: 0,
  errors: 0,
  byType: {},
};

async function main() {
  console.log('='.repeat(60));
  console.log('Document Type Verification and Fix Script');
  console.log('='.repeat(60));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE (will fix PostgreSQL mismatches)'}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log('');
  console.log('⚠️  ASTPP MySQL: READ-ONLY (no modifications will be made)');
  console.log('✏️  PostgreSQL: READ-WRITE (will be updated to match ASTPP)');
  console.log('');

  let astppConn;
  let pgPool;

  try {
    // Connect to databases
    console.log('Connecting to ASTPP MySQL (read-only)...');
    astppConn = await mysql.createConnection(astppConfig);
    
    // Verify read-only access by checking if we can run SELECT
    try {
      await astppConn.query('SELECT 1');
      console.log('✓ Connected to ASTPP MySQL (READ-ONLY mode)');
    } catch (error) {
      console.error('✗ Cannot connect to ASTPP MySQL:', error.message);
      throw error;
    }

    console.log('Connecting to PostgreSQL...');
    pgPool = new Pool(pgConfig);
    await pgPool.query('SELECT 1');
    console.log('✓ Connected to PostgreSQL');
    console.log('');

    // Get all customer records with document types from PostgreSQL
    console.log('Fetching records from PostgreSQL...');
    const pgResult = await pgPool.query(`
      SELECT 
        cad.id AS pg_id,
        cad.astpp_id,
        cad.identity_document_type AS pg_doc_type,
        cad.identity_document_number,
        cad.synced_at
      FROM customer_applicant_details cad
      WHERE cad.application_type = 'primary_kyc'
        AND cad.synced_at IS NOT NULL
        AND cad.astpp_id IS NOT NULL
      ORDER BY cad.astpp_id
    `);

    const pgRecords = pgResult.rows;
    console.log(`✓ Found ${pgRecords.length} records in PostgreSQL`);
    console.log('');

    // Process in batches
    const totalBatches = Math.ceil(pgRecords.length / BATCH_SIZE);
    let processedCount = 0;

    for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
      const start = batchNum * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, pgRecords.length);
      const batch = pgRecords.slice(start, end);

      console.log(`Processing batch ${batchNum + 1}/${totalBatches} (records ${start + 1}-${end})...`);

      // Get ASTPP IDs for this batch
      const astppIds = batch.map(r => r.astpp_id);

      // Fetch corresponding records from ASTPP (READ-ONLY - no modifications)
      // This query only SELECTs data, never UPDATEs, INSERTs, or DELETEs
      const [astppRows] = await astppConn.query(`
        SELECT 
          a.id AS astpp_id,
          ad.identity_document_type AS astpp_doc_type,
          ad.identity_document_number
        FROM accounts a
        JOIN applicant_details ad ON ad.accountid = a.id
        WHERE a.id IN (?)
          AND a.type = 9
          AND a.deleted = 0
      `, [astppIds]);

      // Create lookup map
      const astppMap = new Map();
      astppRows.forEach(row => {
        astppMap.set(row.astpp_id, row);
      });

      // Compare and collect mismatches
      const mismatches = [];

      for (const pgRecord of batch) {
        stats.total++;

        const astppRecord = astppMap.get(pgRecord.astpp_id);
        
        if (!astppRecord) {
          console.log(`  ⚠ Warning: ASTPP ID ${pgRecord.astpp_id} not found in ASTPP (deleted or not customer)`);
          continue;
        }

        const correctType = mapAstppDocTypeToString(astppRecord.astpp_doc_type);
        const currentType = pgRecord.pg_doc_type;

        if (correctType !== currentType) {
          stats.mismatched++;
          
          // Track by type
          const key = `${currentType}->${correctType}`;
          stats.byType[key] = (stats.byType[key] || 0) + 1;

          mismatches.push({
            pgId: pgRecord.pg_id,
            astppId: pgRecord.astpp_id,
            currentType,
            correctType,
            docNumber: pgRecord.identity_document_number,
          });

          console.log(`  ❌ Mismatch: ASTPP ${pgRecord.astpp_id} - PG has ${currentType}, should be ${correctType} (doc: ${pgRecord.identity_document_number || 'none'})`);
        } else {
          stats.correct++;
        }
      }

      // Fix mismatches in this batch (ONLY updates PostgreSQL, NEVER touches ASTPP)
      if (mismatches.length > 0 && !DRY_RUN) {
        console.log(`  Fixing ${mismatches.length} mismatched records in PostgreSQL...`);

        const pgClient = await pgPool.connect();
        try {
          await pgClient.query('BEGIN');

          for (const mismatch of mismatches) {
            // UPDATE PostgreSQL ONLY - ASTPP is never modified
            await pgClient.query(`
              UPDATE customer_applicant_details
              SET 
                identity_document_type = $1,
                updated_at = NOW()
              WHERE id = $2
            `, [mismatch.correctType, mismatch.pgId]);

            stats.fixed++;
          }

          await pgClient.query('COMMIT');
          console.log(`  ✓ Fixed ${mismatches.length} records in PostgreSQL`);
        } catch (error) {
          await pgClient.query('ROLLBACK');
          console.error(`  ✗ Error fixing batch: ${error.message}`);
          stats.errors += mismatches.length;
        } finally {
          pgClient.release();
        }
      } else if (mismatches.length > 0 && DRY_RUN) {
        console.log(`  [DRY RUN] Would fix ${mismatches.length} records in PostgreSQL`);
      }

      processedCount = end;
      
      // Progress indicator
      const progress = ((processedCount / pgRecords.length) * 100).toFixed(1);
      console.log(`  Progress: ${processedCount}/${pgRecords.length} (${progress}%)`);
      console.log('');
    }

    // Final statistics
    console.log('='.repeat(60));
    console.log('FINAL STATISTICS');
    console.log('='.repeat(60));
    console.log(`Total records checked:    ${stats.total}`);
    console.log(`Correct matches:          ${stats.correct} (${((stats.correct/stats.total)*100).toFixed(1)}%)`);
    console.log(`Mismatches found:         ${stats.mismatched} (${((stats.mismatched/stats.total)*100).toFixed(1)}%)`);
    
    if (!DRY_RUN) {
      console.log(`Records fixed:            ${stats.fixed}`);
      console.log(`Errors:                   ${stats.errors}`);
    } else {
      console.log(`[DRY RUN] Would fix:      ${stats.mismatched}`);
    }
    
    console.log('');
    console.log('Mismatches by type:');
    Object.entries(stats.byType).forEach(([key, count]) => {
      console.log(`  ${key}: ${count}`);
    });
    console.log('');

    // Verification query
    if (!DRY_RUN && stats.fixed > 0) {
      console.log('Running verification query...');
      const verifyResult = await pgPool.query(`
        SELECT 
          identity_document_type,
          COUNT(*) AS count
        FROM customer_applicant_details
        WHERE application_type = 'primary_kyc'
          AND synced_at IS NOT NULL
        GROUP BY identity_document_type
        ORDER BY identity_document_type
      `);

      console.log('PostgreSQL document type distribution after fix:');
      verifyResult.rows.forEach(row => {
        console.log(`  ${row.identity_document_type}: ${row.count}`);
      });
      console.log('');

      console.log('ASTPP expected distribution:');
      console.log('  NATIONAL_ID: 10,575');
      console.log('  SERVICE_CARD: 1,448');
      console.log('  ALIEN_CARD: 172');
      console.log('  PASSPORT: 1,644');
      console.log('');
    }

    console.log('='.repeat(60));
    if (DRY_RUN) {
      console.log('✓ DRY RUN COMPLETE - No changes made');
      console.log('Run without --dry-run to apply fixes');
    } else {
      console.log('✓ FIX COMPLETE');
    }
    console.log('='.repeat(60));

  } catch (error) {
    console.error('✗ Fatal error:', error);
    process.exit(1);
  } finally {
    // Clean up connections
    if (astppConn) {
      await astppConn.end();
      console.log('✓ Closed ASTPP connection');
    }
    if (pgPool) {
      await pgPool.end();
      console.log('✓ Closed PostgreSQL connection');
    }
  }
}

// Run the script
main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});

'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');

const root = join(__dirname, '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8');

test('CDC account sync applies deleted and reactivated customer lifecycle states', () => {
  const sql = read('src/workers/cdc/cdc-consumer.worker.ts');

  assert.match(sql, /WHEN EXCLUDED\.deleted_at IS NOT NULL THEN 'suspended'/);
  assert.match(sql, /WHEN customers\.deleted_at IS NOT NULL THEN 'active'/);
  assert.match(sql, /status = 'suspended'/);
  assert.match(sql, /Customer replaced by active ASTPP account/);
  assert.match(sql, /status = 'inactive'/);
});

test('snapshot reconciliation includes deleted accounts and flips their lifecycle states', () => {
  const sql = read('src/workers/snapshot/snapshot.worker.ts');

  assert.match(sql, /WHERE type = 9 ORDER BY id ASC/);
  assert.match(sql, /FROM accounts WHERE id = \? AND type = 9/);
  assert.match(sql, /WHEN EXCLUDED\.deleted_at IS NOT NULL THEN 'suspended'/);
  assert.match(sql, /WHEN customers\.deleted_at IS NOT NULL THEN 'active'/);
  assert.match(sql, /Customer deleted in ASTPP/);
  assert.match(sql, /status = 'inactive'/);
});

test('phone-number replacement soft-deletes the old customer and wallet', () => {
  const sql = read('src/modules/onboarding/services/onboarding.service.ts');

  assert.match(sql, /SET deleted_at = COALESCE\(deleted_at, NOW\(\)\),[\s\S]*status = 'suspended'/);
  assert.match(sql, /WHERE astpp_id = ANY\(\$1::bigint\[\]\) AND status != 'closed'/);
});

test('lifecycle migration backfills deleted customers and their wallets', () => {
  const sql = read('database/migrations/004_account_lifecycle_backfill.sql');

  assert.match(sql, /SET status = 'suspended'/);
  assert.match(sql, /WHERE deleted_at IS NOT NULL/);
  assert.match(sql, /SET status = 'inactive'/);
  assert.match(sql, /FROM customers c/);
});

'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { AppConfigService } = require('../dist/src/modules/app-config/services/app-config.service.js');

test('returns app feature flags separately from page layout with only app-facing fields', async () => {
  const flags = [{
    service: 'wallet',
    feature_key: 'topup.mpesa',
    parent_key: 'topup',
    name: 'Top-up via M-Pesa',
    is_enabled: false,
  }];
  const db = {
    queryOne: async () => ({
      id: 1,
      asset_uuid: 'hero-uuid',
      asset_key: 'hero',
      url: 'https://cdn.example.test/hero.jpg',
      alt_text: 'Hero',
      updated_at: new Date('2026-10-01T00:00:00Z'),
    }),
    query: async (sql) => {
      if (sql.includes('FROM feature_flags')) {
        assert.match(sql, /SELECT service, feature_key, parent_key, name, is_enabled/);
        return { rows: flags };
      }
      return { rows: [] };
    },
  };

  const response = await new AppConfigService(db).getAppConfig();

  assert.deepEqual(response.feature_flags, flags);
  assert.equal(response.feature_flags[0].is_enabled, false);
  assert.deepEqual(Object.keys(response.feature_flags[0]), [
    'service',
    'feature_key',
    'parent_key',
    'name',
    'is_enabled',
  ]);
  assert.equal(Object.hasOwn(response.page_layout, 'feature_flags'), false);
});

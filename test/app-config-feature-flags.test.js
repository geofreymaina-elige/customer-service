'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { AppConfigService } = require('../dist/src/modules/app-config/services/app-config.service.js');

test('app config returns feature flags with descriptions and disabled messages only', async () => {
  const flags = [
    {
      service: 'wallet',
      feature_key: 'topup.mpesa',
      parent_key: 'topup',
      name: 'Top-up via M-Pesa',
      description: 'Allows customers to top up using M-Pesa.',
      is_enabled: false,
      message: 'M-Pesa top-ups are temporarily unavailable.',
    },
    {
      service: 'customer',
      feature_key: 'registration',
      parent_key: 'onboarding',
      name: 'Customer Registration',
      description: 'Allows new customers to register.',
      is_enabled: true,
      message: null,
    },
  ];
  const db = {
    query: async (sql) => {
      assert.match(sql, /SELECT service, feature_key, parent_key, name, description, is_enabled/);
      assert.match(sql, /CASE WHEN is_enabled THEN NULL ELSE error_message END AS message/);
      return { rows: flags };
    },
    queryOne: async () => {
      assert.fail('app config should not query banner assets');
    },
  };

  const response = await new AppConfigService(db).getAppConfig();

  assert.deepEqual(response, {
    services: {
      esim: true,
      wallet: false,
      voip: true,
    },
    status: 'success',
    feature_flags: flags,
  });
  assert.equal(Object.hasOwn(response, 'page_layout'), false);
  assert.equal(Object.hasOwn(response, 'layout_version'), false);
  assert.equal(response.feature_flags[0].message, 'M-Pesa top-ups are temporarily unavailable.');
  assert.equal(response.feature_flags[1].message, null);
});

test('banners returns the hero and active feature cards without app config data', async () => {
  const heroAsset = {
    id: 1,
    asset_uuid: 'hero-uuid',
    asset_key: 'hero',
    url: ' https://cdn.example.test/hero.jpg ',
    alt_text: 'Hero',
    updated_at: new Date('2026-10-01T00:00:00Z'),
  };
  const card = {
    card_uuid: 'card-uuid',
    card_slug: 'promo',
    asset_uuid: 'card-asset-uuid',
    asset_key: 'promo',
    url: ' https://cdn.example.test/promo.jpg ',
    title: 'Promotion',
    subtitle: null,
    updated_at: new Date('2026-10-02T00:00:00Z'),
  };
  const db = {
    queryOne: async (sql) => {
      assert.match(sql, /FROM app_assets/);
      return heroAsset;
    },
    query: async (sql, params) => {
      assert.match(sql, /FROM feature_cards fc/);
      assert.deepEqual(params, [heroAsset.id]);
      return { rows: [card] };
    },
  };

  const response = await new AppConfigService(db).getBanners();

  assert.deepEqual(response, {
    status: 'success',
    layout_version: '2026-09-30-v1',
    page_layout: {
      hero_section: {
        asset_uuid: 'hero-uuid',
        asset_key: 'hero',
        updated_at: '2026-10-01T00:00:00.000Z',
        url: 'https://cdn.example.test/hero.jpg',
        alt_text: 'Hero',
      },
      feature_cards: [{
        card_uuid: 'card-uuid',
        card_slug: 'promo',
        asset_uuid: 'card-asset-uuid',
        asset_key: 'promo',
        updated_at: '2026-10-02T00:00:00.000Z',
        url: 'https://cdn.example.test/promo.jpg',
        title: 'Promotion',
        subtitle: '',
      }],
    },
  });
  assert.equal(Object.hasOwn(response, 'services'), false);
  assert.equal(Object.hasOwn(response, 'feature_flags'), false);
});

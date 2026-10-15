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

test('banners promote slot 1 to hero and return slots 2-5 as feature cards', async () => {
  const bannerRows = [
    {
      card_uuid: 'slot-1-card-uuid',
      card_slug: 'banner_slot_1',
      slot: 1,
      title: 'Banner Slot 1',
      subtitle: '',
      asset_uuid: 'slot-1-asset-uuid',
      asset_key: 'banner_slot_1_asset',
      url: ' https://cdn.example.test/banner-1.jpg ',
      alt_text: 'Mt Kenya',
      updated_at: new Date('2026-10-05T14:45:49.125Z'),
    },
    ...[2, 3, 4, 5].map((slot) => ({
      card_uuid: `slot-${slot}-card-uuid`,
      card_slug: `banner_slot_${slot}`,
      slot,
      title: `Banner Slot ${slot}`,
      subtitle: null,
      asset_uuid: `slot-${slot}-asset-uuid`,
      asset_key: `banner_slot_${slot}_asset`,
      url: ` https://cdn.example.test/banner-${slot}.jpg `,
      alt_text: null,
      updated_at: new Date(`2026-10-05T14:4${slot}:00.000Z`),
    })),
  ];
  const db = {
    query: async (sql) => {
      assert.match(sql, /fc\.display_order AS slot/);
      assert.match(sql, /fc\.display_order BETWEEN 1 AND 5/);
      assert.match(sql, /fc\.card_slug LIKE 'banner_slot_%'/);
      assert.match(sql, /aa\.is_active = TRUE/);
      assert.match(sql, /ORDER BY fc\.display_order ASC/);
      return { rows: bannerRows };
    },
  };

  const response = await new AppConfigService(db).getBanners();

  assert.deepEqual(response, {
    status: 'success',
    layout_version: '2026-09-30-v1',
    page_layout: {
      hero_section: {
        card_uuid: 'slot-1-card-uuid',
        card_slug: 'banner_slot_1',
        slot: 1,
        title: 'Banner Slot 1',
        subtitle: '',
        asset_uuid: 'slot-1-asset-uuid',
        asset_key: 'banner_slot_1_asset',
        updated_at: '2026-10-05T14:45:49.125Z',
        url: 'https://cdn.example.test/banner-1.jpg',
        alt_text: 'Mt Kenya',
      },
      feature_cards: bannerRows.slice(1).map((banner) => ({
        ...banner,
        updated_at: banner.updated_at.toISOString(),
        url: banner.url.trim(),
        alt_text: '',
        subtitle: '',
      })),
    },
  });
  assert.equal(Object.hasOwn(response, 'services'), false);
  assert.equal(Object.hasOwn(response, 'feature_flags'), false);
  assert.equal(response.page_layout.feature_cards.some((banner) => banner.slot === 1), false);
});

test('banners fail when the active slot 1 hero banner is missing', async () => {
  const db = {
    query: async () => ({ rows: [] }),
  };

  await assert.rejects(
    new AppConfigService(db).getBanners(),
    { message: 'No active hero asset found' }
  );
});

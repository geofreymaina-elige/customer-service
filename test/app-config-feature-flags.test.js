'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const { AppConfigService } = require('../dist/src/modules/app-config/services/app-config.service.js');
const { AppConfigController } = require('../dist/src/modules/app-config/controllers/app-config.controller.js');
const { OptionalAstppBannerGuard } = require('../dist/src/core/auth/optional-astpp-banner.guard.js');

test('app config has no ASTPP ID and banners pass only validated audience context to the service', async () => {
  const calls = [];
  const service = {
    getAppConfig: async (...args) => {
      calls.push(['app-config', ...args]);
      return { status: 'success' };
    },
    getBanners: async (...args) => {
      calls.push(['banners', ...args]);
      return { status: 'success' };
    },
  };
  const controller = new AppConfigController(service);
  const audience = { astppId: '1862533', fcmToken: 'fcm-registration-token' };

  await controller.getAppConfig();
  await controller.getBanners({ bannerAudience: audience });
  await controller.getBanners({ bannerAudience: undefined });

  assert.deepEqual(calls, [
    ['app-config'],
    ['banners', audience],
    ['banners', undefined],
  ]);
});

test('app config returns the shared config without checking an ASTPP customer', async () => {
  const db = {
    query: async () => ({ rows: [] }),
  };

  const response = await new AppConfigService(db).getAppConfig();

  assert.deepEqual(response, {
    services: {
      esim: true,
      wallet: false,
      voip: true,
    },
    status: 'success',
    feature_flags: [],
  });
});

test('banners use the optional ASTPP authentication guard', () => {
  const guards = Reflect.getMetadata('__guards__', AppConfigController.prototype.getBanners);

  assert.ok(guards.includes(OptionalAstppBannerGuard));
});

test('banner guard falls back to general banners when ASTPP credentials are missing or invalid', async () => {
  const originalTokenKey = process.env.ASTPP_TOKEN_KEY;
  const originalIvKey = process.env.ASTPP_IV_KEY;
  const originalTokenKeyHex = process.env.ASTPP_TOKEN_KEY_HEX;
  const originalIvHex = process.env.ASTPP_IV_HEX;
  process.env.ASTPP_TOKEN_KEY = 'banner-guard-test-token-key';
  process.env.ASTPP_IV_KEY = 'banner-guard-test-iv-key';
  delete process.env.ASTPP_TOKEN_KEY_HEX;
  delete process.env.ASTPP_IV_HEX;

  const astppId = '1862533';
  const tokenKeyHex = crypto.createHash('sha256').update(process.env.ASTPP_TOKEN_KEY).digest('hex');
  const iv = crypto.createHash('sha256').update(process.env.ASTPP_IV_KEY).digest('hex').slice(0, 16);
  const cipher = crypto.createCipheriv(
    'aes-256-cbc',
    Buffer.from(tokenKeyHex.slice(0, 32), 'utf8'),
    Buffer.from(iv, 'utf8')
  );
  const encryptedId = Buffer.concat([
    cipher.update(astppId, 'utf8'),
    cipher.final(),
  ]).toString('base64');
  const token = Buffer.from(encryptedId, 'utf8').toString('base64');

  try {
    for (const headers of [
      {},
      { 'x-astpp-id': astppId },
      { 'x-astpp-id': astppId, 'x-astpp-token': 'invalid-token' },
    ]) {
      const request = { headers, params: {}, query: {}, body: {} };
      const guard = new OptionalAstppBannerGuard({
        queryOne: async () => {
          assert.fail('incomplete or invalid credentials must not query customer identity');
        },
      });

      assert.equal(await guard.canActivate({
        switchToHttp: () => ({ getRequest: () => request }),
      }), true);
      assert.equal(request.bannerAudience, undefined);
    }
  } finally {
    if (originalTokenKey === undefined) delete process.env.ASTPP_TOKEN_KEY;
    else process.env.ASTPP_TOKEN_KEY = originalTokenKey;
    if (originalIvKey === undefined) delete process.env.ASTPP_IV_KEY;
    else process.env.ASTPP_IV_KEY = originalIvKey;
    if (originalTokenKeyHex === undefined) delete process.env.ASTPP_TOKEN_KEY_HEX;
    else process.env.ASTPP_TOKEN_KEY_HEX = originalTokenKeyHex;
    if (originalIvHex === undefined) delete process.env.ASTPP_IV_HEX;
    else process.env.ASTPP_IV_HEX = originalIvHex;
  }
});

test('banner guard exposes ASTPP and FCM identity only after token and customer validation', async () => {
  const originalTokenKey = process.env.ASTPP_TOKEN_KEY;
  const originalIvKey = process.env.ASTPP_IV_KEY;
  const originalTokenKeyHex = process.env.ASTPP_TOKEN_KEY_HEX;
  const originalIvHex = process.env.ASTPP_IV_HEX;
  process.env.ASTPP_TOKEN_KEY = 'banner-guard-test-token-key';
  process.env.ASTPP_IV_KEY = 'banner-guard-test-iv-key';
  delete process.env.ASTPP_TOKEN_KEY_HEX;
  delete process.env.ASTPP_IV_HEX;

  const astppId = '1862533';
  const tokenKeyHex = crypto.createHash('sha256').update(process.env.ASTPP_TOKEN_KEY).digest('hex');
  const iv = crypto.createHash('sha256').update(process.env.ASTPP_IV_KEY).digest('hex').slice(0, 16);
  const cipher = crypto.createCipheriv(
    'aes-256-cbc',
    Buffer.from(tokenKeyHex.slice(0, 32), 'utf8'),
    Buffer.from(iv, 'utf8')
  );
  const encryptedId = Buffer.concat([
    cipher.update(astppId, 'utf8'),
    cipher.final(),
  ]).toString('base64');
  const token = Buffer.from(encryptedId, 'utf8').toString('base64');
  const request = {
    headers: {
      'x-astpp-id': astppId,
      'x-astpp-token': token,
      'x-fcm-token': ' fcm-registration-token ',
    },
    params: {},
    query: {},
    body: {},
  };
  let queryParams;
  const guard = new OptionalAstppBannerGuard({
    queryOne: async (sql, params) => {
      assert.match(sql, /FROM customers WHERE astpp_id = \$1/);
      queryParams = params;
      return { id: 123 };
    },
  });

  try {
    assert.equal(await guard.canActivate({
      switchToHttp: () => ({ getRequest: () => request }),
    }), true);
    assert.deepEqual(queryParams, [astppId]);
    assert.deepEqual(request.bannerAudience, {
      astppId,
      fcmToken: 'fcm-registration-token',
    });
  } finally {
    if (originalTokenKey === undefined) delete process.env.ASTPP_TOKEN_KEY;
    else process.env.ASTPP_TOKEN_KEY = originalTokenKey;
    if (originalIvKey === undefined) delete process.env.ASTPP_IV_KEY;
    else process.env.ASTPP_IV_KEY = originalIvKey;
    if (originalTokenKeyHex === undefined) delete process.env.ASTPP_TOKEN_KEY_HEX;
    else process.env.ASTPP_TOKEN_KEY_HEX = originalTokenKeyHex;
    if (originalIvHex === undefined) delete process.env.ASTPP_IV_HEX;
    else process.env.ASTPP_IV_HEX = originalIvHex;
  }
});

test('banner guard falls back to general banners when the ASTPP account is unknown', async () => {
  const originalTokenKey = process.env.ASTPP_TOKEN_KEY;
  const originalIvKey = process.env.ASTPP_IV_KEY;
  const originalTokenKeyHex = process.env.ASTPP_TOKEN_KEY_HEX;
  const originalIvHex = process.env.ASTPP_IV_HEX;
  process.env.ASTPP_TOKEN_KEY = 'banner-guard-test-token-key';
  process.env.ASTPP_IV_KEY = 'banner-guard-test-iv-key';
  delete process.env.ASTPP_TOKEN_KEY_HEX;
  delete process.env.ASTPP_IV_HEX;

  const astppId = '1862533';
  const tokenKeyHex = crypto.createHash('sha256').update(process.env.ASTPP_TOKEN_KEY).digest('hex');
  const iv = crypto.createHash('sha256').update(process.env.ASTPP_IV_KEY).digest('hex').slice(0, 16);
  const cipher = crypto.createCipheriv(
    'aes-256-cbc',
    Buffer.from(tokenKeyHex.slice(0, 32), 'utf8'),
    Buffer.from(iv, 'utf8')
  );
  const encryptedId = Buffer.concat([
    cipher.update(astppId, 'utf8'),
    cipher.final(),
  ]).toString('base64');
  const token = Buffer.from(encryptedId, 'utf8').toString('base64');
  const request = {
    headers: { 'x-astpp-id': astppId, 'x-astpp-token': token },
    params: {},
    query: {},
    body: {},
  };
  const guard = new OptionalAstppBannerGuard({
    queryOne: async () => null,
  });

  try {
    assert.equal(await guard.canActivate({
      switchToHttp: () => ({ getRequest: () => request }),
    }), true);
    assert.equal(request.bannerAudience, undefined);
  } finally {
    if (originalTokenKey === undefined) delete process.env.ASTPP_TOKEN_KEY;
    else process.env.ASTPP_TOKEN_KEY = originalTokenKey;
    if (originalIvKey === undefined) delete process.env.ASTPP_IV_KEY;
    else process.env.ASTPP_IV_KEY = originalIvKey;
    if (originalTokenKeyHex === undefined) delete process.env.ASTPP_TOKEN_KEY_HEX;
    else process.env.ASTPP_TOKEN_KEY_HEX = originalTokenKeyHex;
    if (originalIvHex === undefined) delete process.env.ASTPP_IV_HEX;
    else process.env.ASTPP_IV_HEX = originalIvHex;
  }
});

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
    queryOne: async () => {
      assert.fail('app config should not query customers or banner assets');
    },
    query: async (sql) => {
      assert.match(sql, /SELECT service, feature_key, parent_key, name, description, is_enabled/);
      assert.match(sql, /CASE WHEN is_enabled THEN NULL ELSE error_message END AS message/);
      return { rows: flags };
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
    queryOne: async () => {
      assert.fail('banner lookup should not query customers');
    },
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

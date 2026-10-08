'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ForbiddenException } = require('@nestjs/common');
const { PinAuthService } = require('../dist/src/modules/auth/services/pin-auth.service.js');

test('does not issue a transaction token when wallet is locked', async () => {
  const queries = [];
  const db = {
    queryOne: async (sql, params) => {
      queries.push({ sql, params });
      if (queries.length === 1) {
        return {
          id: 7,
          uuid: 'customer-uuid',
          astpp_id: 31553,
          status: 'active',
          deleted_at: null,
        };
      }
      return { status: 'locked', is_locked: true };
    },
    query: async () => {
      throw new Error('PIN, activity, or token operations should not be reached.');
    },
  };
  const service = new PinAuthService(
    db,
    { generateTransactionToken: () => { throw new Error('Token must not be issued.'); } },
    { get: (key) => key === 'auth.pin.walletUnavailable' ? 'Configured wallet unavailable message.' : key },
    {},
    {},
  );

  await assert.rejects(
    service.verifyPin({ astpp_id: '31553', pin: '1234' }),
    (error) => {
      assert.ok(error instanceof ForbiddenException);
      assert.equal(error.message, 'Configured wallet unavailable message.');
      return true;
    },
  );
  assert.equal(queries.length, 2);
  assert.match(queries[1].sql, /SELECT status, is_locked/);
});

test('does not issue a transaction token for non-active wallets even if is_locked is false', async () => {
  const db = {
    queryOne: async () => {
      if (!db.customerRead) {
        db.customerRead = true;
        return {
          id: 7,
          uuid: 'customer-uuid',
          astpp_id: 31553,
          status: 'active',
          deleted_at: null,
        };
      }
      return { status: 'frozen', is_locked: false };
    },
    query: async () => {
      throw new Error('PIN, activity, or token operations should not be reached.');
    },
    customerRead: false,
  };
  const service = new PinAuthService(
    db,
    { generateTransactionToken: () => { throw new Error('Token must not be issued.'); } },
    { get: () => 'Configured wallet unavailable message.' },
    {},
    {},
  );

  await assert.rejects(
    service.verifyPin({ astpp_id: '31553', pin: '1234' }),
    (error) => error instanceof ForbiddenException &&
      error.message === 'Configured wallet unavailable message.',
  );
});

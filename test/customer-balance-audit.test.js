'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { WalletService } = require('../dist/src/modules/wallets/services/wallet.service.js');

function createWalletService({ providerResult, providerError, auditPromise }) {
  const calls = [];
  const database = {
    queryOne: async () => ({
      customer_id: 7,
      account_number: 'acct-123',
      currency: 'KES',
      status: 'active',
      country_code: 'KE',
    }),
    query: (...args) => {
      calls.push(args);
      return auditPromise ?? Promise.resolve({ rowCount: 1 });
    },
  };
  const provider = {
    getCustomerDetails: async () => {
      if (providerError) throw providerError;
      return providerResult;
    },
  };

  return {
    service: new WalletService(database, {}, {}, provider, {}),
    calls,
  };
}

test('returns the synchronous provider balance without waiting for audit persistence', async () => {
  let finishAudit;
  const auditPromise = new Promise((resolve) => {
    finishAudit = resolve;
  });
  const { service, calls } = createWalletService({
    providerResult: {
      data: {
        CustomerWallets: [{
          account_number: 'acct-123',
          currency_code: 'KES',
          account_balance_derived: '125.50',
        }],
      },
    },
    auditPromise,
  });

  const result = await service.getBalance(7);

  assert.deepEqual(result, {
    accountNumber: 'acct-123',
    currency: 'KES',
    balance: 125.5,
    status: 'active',
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /INSERT INTO customer_balance_audit/);
  assert.deepEqual(calls[0][1].slice(0, 4), [7, 'acct-123', 'KES', 125.5]);
  assert.equal(calls[0][1][5], 'success');
  assert.ok(calls[0][1][4] instanceof Date);

  finishAudit({ rowCount: 1 });
});

test('writes a failure audit entry and still propagates the provider error', async () => {
  const providerError = new Error('SasaPay unavailable');
  const { service, calls } = createWalletService({ providerError });

  await assert.rejects(service.getBalance(7), providerError);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1].slice(0, 4), [7, 'acct-123', 'KES', null]);
  assert.equal(calls[0][1][5], 'failure');
  assert.ok(calls[0][1][4] instanceof Date);
});

'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const axios = require('axios');
const { NotFoundException } = require('@nestjs/common');
const { AuthGuard } = require('../dist/src/core/auth/auth.guard.js');
const { CustomerController } = require('../dist/src/modules/customers/controllers/customer.controller.js');
const { CustomerService } = require('../dist/src/modules/customers/services/customer.service.js');
const { SasaPayWaasService } = require('../dist/src/modules/onboarding/services/sasapay-waas.service.js');

test('account validation requires the customer JWT guard', () => {
  const guards = Reflect.getMetadata('__guards__', CustomerController.prototype.validateAccount);

  assert.ok(guards.includes(AuthGuard));
  assert.equal(Reflect.getMetadata('__httpCode__', CustomerController.prototype.validateAccount), 200);
});

test('VoIP account validation requires the customer JWT guard', () => {
  const guards = Reflect.getMetadata('__guards__', CustomerController.prototype.validateVoipAccount);

  assert.ok(guards.includes(AuthGuard));
  assert.equal(Reflect.getMetadata('__httpCode__', CustomerController.prototype.validateVoipAccount), 200);
});

test('VoIP account validation looks up the authenticated number and returns the registered customer name', async () => {
  const queries = [];
  const service = new CustomerService(
    {
      queryOne: async (sql, params) => {
        queries.push({ sql, params });
        return {
          voip_number: '254700000001',
          first_name: 'Alex',
          last_name: 'Doe',
        };
      },
    },
    {},
    {},
    {},
  );

  const result = await service.validateVoipAccount(42, '254700000001');

  assert.deepEqual(result, {
    status: true,
    responseCode: '0',
    message: 'Account Validation Results',
    account_details: {
      channel_code: 'LOCAL_VOIP',
      channel_name: 'Ambia VoIP',
      account_number: '254700000001',
      account_name: 'Alex Doe',
      account_type: 1,
    },
  });
  assert.match(queries[0].sql, /WHERE id = \$1 AND voip_number = \$2 AND deleted_at IS NULL/);
  assert.deepEqual(queries[0].params, [42, '254700000001']);
});

test('VoIP account validation rejects numbers that are not registered to the authenticated customer', async () => {
  const service = new CustomerService(
    { queryOne: async () => null },
    {},
    {},
    {},
  );

  await assert.rejects(
    service.validateVoipAccount(42, '254700000001'),
    (error) => error instanceof NotFoundException && error.getStatus() === 404,
  );
});

test('forwards account validation using the configured merchant and redacts logged account numbers', async () => {
  const originalPost = axios.post;
  const providerRequestLogs = [];
  let providerRequest;
  const service = new SasaPayWaasService(
    {
      getOrThrow(key) {
        return {
          'sasapay.baseUrl': 'https://sandbox.sasapay.app',
          'sasapay.clientId': 'client-id',
          'sasapay.clientSecret': 'client-secret',
          'sasapay.merchantCode': 'configured-merchant',
          'sasapay.callbackUrl': 'https://example.test/callback',
        }[key];
      },
    },
    {
      getSystemConfig: () => 'provider-access-token',
    },
    {
      sanitizePayload: (payload) => payload,
      logRequest: (...args) => providerRequestLogs.push(args),
      logResponse: () => {},
      logError: () => {},
    },
  );
  service.logger = { log: () => {}, error: () => {} };
  axios.post = async (...args) => {
    providerRequest = args;
    return {
      status: 200,
      data: {
        status: true,
        responseCode: '0',
        message: 'Account Validation Results',
        account_details: {
          channel_code: '0',
          channel_name: 'SasaPay',
          account_number: '254712345678',
          account_name: 'ALEX DOE',
          account_type: 1,
        },
      },
    };
  };

  try {
    const result = await service.validateAccount({
      channelCode: '0',
      accountNumber: '254712345678',
      accountType: 1,
    });

    assert.equal(providerRequest[0], 'https://sandbox.sasapay.app/api/v2/waas/account-validation/');
    assert.deepEqual(providerRequest[1], {
      merchantCode: 'configured-merchant',
      channelCode: '0',
      accountNumber: '254712345678',
      accountType: 1,
    });
    assert.equal(providerRequest[2].headers.Authorization, 'Bearer provider-access-token');
    assert.equal(result.account_details.account_name, 'ALEX DOE');
    assert.equal(providerRequestLogs[0][3].accountNumber, '[REDACTED]');
  } finally {
    axios.post = originalPost;
  }
});

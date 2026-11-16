'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { NotFoundException, ServiceUnavailableException } = require('@nestjs/common');
const { WalletService } = require('../dist/src/modules/wallets/services/wallet.service.js');
const { WalletController } = require('../dist/src/modules/wallets/controllers/wallet.controller.js');
const { MessageService } = require('../dist/src/core/messages/message.service.js');
const { OnboardingService } = require('../dist/src/modules/onboarding/services/onboarding.service.js');

function createWalletService({ applicationStatus, walletStatus, requiredDocuments = [] }) {
  const database = {
    queryOne: async (sql) => {
      if (sql.includes('FROM customer_wallets')) {
        return walletStatus ? { uuid: 'wallet-id', status: walletStatus } : null;
      }
      if (sql.includes('FROM customer_applications')) {
        return applicationStatus ? { kyc_status: applicationStatus } : null;
      }
      return null;
    },
  };
  const kycService = {
    ensureSystemCase: async () => {},
    getCurrentStatus: async () => ({ requiredDocuments }),
  };

  return new WalletService(database, new MessageService(), {}, {}, kycService);
}

for (const scenario of [
  {
    name: 'pending application',
    applicationStatus: 'pending',
    walletStatus: 'active',
    expectedMessage: 'Pending approval',
  },
  {
    name: 'required KYC documents',
    applicationStatus: 'pending',
    walletStatus: 'locked',
    requiredDocuments: ['identity_document'],
    expectedMessage: 'KYC details required',
  },
  {
    name: 'approved application with active wallet',
    applicationStatus: 'approved',
    walletStatus: 'active',
    expectedMessage: 'Wallet active',
  },
  {
    name: 'approved application with locked wallet',
    applicationStatus: 'approved',
    walletStatus: 'locked',
    expectedMessage: 'Wallet locked',
  },
  {
    name: 'application not started',
    expectedMessage: 'Registration required',
  },
  {
    name: 'rejected application',
    applicationStatus: 'rejected',
    expectedMessage: 'Application rejected',
  },
]) {
  test(`onboarding status message reflects ${scenario.name}`, async () => {
    const service = createWalletService(scenario);

    const result = await service.getWalletOnboardingStatus(7);

    assert.equal(result.message, scenario.expectedMessage);
  });
}

test('onboarding status endpoint returns the summary as a top-level message', async () => {
  const controller = new WalletController({
    getWalletOnboardingStatusByAstppId: async () => ({
      message: 'Wallet active',
      applicationStatus: 'approved',
    }),
  });

  const response = await controller.getWalletOnboardingStatus('31553');

  assert.deepEqual(response, {
    success: true,
    message: 'Wallet active',
    data: { applicationStatus: 'approved' },
  });
});

test('missing local customer returns registration instructions instead of a not-found error', async () => {
  const service = new WalletService(
    { queryOne: async () => null },
    new MessageService(),
    {},
    {},
    {},
  );

  const result = await service.getWalletOnboardingStatusByAstppId('31553');

  assert.deepEqual(result, {
    message: 'Registration required',
    applicationStatus: 'not_started',
    wallet: null,
    application: null,
    requiredDocuments: [],
    nextAction: {
      type: 'start_onboarding',
      method: 'POST',
      endpoint: '/api/v2/auth/sessions/device',
    },
  });
});

function createOnboardingService({ astppCustomer, astppError } = {}) {
  const transactionQueries = [];
  const database = {
    transaction: async (callback) => callback({
      query: async (sql, params = []) => {
        transactionQueries.push({ sql, params });
        if (sql.includes('UPDATE customers') && sql.includes('RETURNING astpp_id')) {
          return { rows: [{ astpp_id: 20528 }] };
        }
        if (sql.includes('INSERT INTO customers')) {
          return {
            rows: [{
              id: 33,
              uuid: 'customer-uuid',
              astpp_id: astppCustomer.accountId,
              phone_number: astppCustomer.accountNumber,
              first_name: astppCustomer.firstName,
              last_name: astppCustomer.lastName,
              status: 'active',
              deleted_at: null,
            }],
          };
        }
        if (sql.includes('INSERT INTO customer_applications')) {
          return { rows: [{ id: 44 }] };
        }
        return { rows: [] };
      },
    }),
    queryOne: async (sql) => {
      if (sql.includes('FROM customer_wallets')) return { id: 55 };
      return null;
    },
    query: async () => ({ rows: [] }),
  };
  const service = new OnboardingService(
    database,
    {
      lookupCustomer: async () => {
        if (astppError) throw astppError;
        return astppCustomer;
      },
    },
    { registerOrVerifyDevice: async () => ({ deviceHash: 'device-hash' }) },
    { generateAppAccessToken: () => 'app-token' },
    new MessageService(),
    { enqueue: async () => 'job-uuid' },
    {},
  );

  return { service, transactionQueries };
}

test('device onboarding rejects a missing ASTPP account without creating a placeholder', async () => {
  const { service } = createOnboardingService();

  await assert.rejects(
    service.onboardUserDevice({ astpp_id: '31553' }),
    (error) => error instanceof NotFoundException && error.getStatus() === 404,
  );
});

test('device onboarding reports ASTPP outages as service unavailable', async () => {
  const { service } = createOnboardingService({ astppError: new Error('connection refused') });

  await assert.rejects(
    service.onboardUserDevice({ astpp_id: '31553' }),
    (error) => error instanceof ServiceUnavailableException && error.getStatus() === 503,
  );
});

test('device onboarding synchronizes the active ASTPP record and retires the old same-phone row', async () => {
  const astppCustomer = {
    accountId: 31553,
    accountNumber: '254700000001',
    firstName: 'Ada',
    lastName: 'Customer',
    email: 'ada@example.test',
    phoneNumber: '254700000001',
    voipNumber: '254700000001',
    timezone: 'Africa/Nairobi',
    identityDocumentType: 1,
    identityDocumentNumber: 'P1234',
    applicationStatus: 2,
    applicationId: 91,
    applicantDetails: {
      name: 'Ada Customer',
      identityDocumentType: 1,
      identityDocumentNumber: 'P1234',
    },
  };
  const { service, transactionQueries } = createOnboardingService({ astppCustomer });

  const result = await service.onboardUserDevice({ astpp_id: '31553' });

  assert.equal(result.user.astppId, 31553);
  assert.equal(result.user.phoneNumber, '254700000001');
  assert.equal(result.otpPending, false);
  assert.ok(transactionQueries.some(({ sql, params }) =>
    sql.includes('UPDATE customers') &&
    sql.includes('RETURNING astpp_id') &&
    params[0] === '254700000001' &&
    params[1] === 31553,
  ));
  const applicationSync = transactionQueries.find(({ sql }) => sql.includes('INSERT INTO customer_applications'));
  assert.equal(applicationSync.params[4], 'approved');
  assert.ok(transactionQueries.some(({ sql }) => sql.includes('INSERT INTO customer_applicant_details')));
});

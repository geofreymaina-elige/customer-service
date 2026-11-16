'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { WalletService } = require('../dist/src/modules/wallets/services/wallet.service.js');
const { WalletController } = require('../dist/src/modules/wallets/controllers/wallet.controller.js');
const { MessageService } = require('../dist/src/core/messages/message.service.js');

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

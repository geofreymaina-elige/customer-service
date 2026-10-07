const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ConflictException } = require('@nestjs/common');
const { OnboardingController } = require('../dist/src/modules/onboarding/controllers/onboarding.controller');
const { OnboardingService } = require('../dist/src/modules/onboarding/services/onboarding.service');
const { SasaPayWaasService } = require('../dist/src/modules/onboarding/services/sasapay-waas.service');

test('SasaPay wallet-limit detection matches the provider code and message', () => {
  const service = Object.create(SasaPayWaasService.prototype);

  assert.equal(service.isWalletLimitExceeded({
    response: {
      data: {
        responseCode: 'SP4000',
        message: 'Maximum number of wallets you can create is 2',
      },
    },
  }), true);
  assert.equal(service.isWalletLimitExceeded({
    responseCode: 'SP4000',
    message: 'Maximum number of wallets you can create is 2',
  }), true);
  assert.equal(service.isWalletLimitExceeded({
    responseCode: 'SP4000',
    message: 'Invalid OTP',
  }), false);
  assert.equal(service.isWalletLimitExceeded({
    responseCode: 'SP4001',
    message: 'Maximum number of wallets you can create is 2',
  }), false);
});

test('local wallet capacity check logs and rejects before onboarding proceeds', async () => {
  const service = Object.create(OnboardingService.prototype);
  const queries = [];
  let limitRecorded = false;
  service.db = {
    queryOne: async (sql) => {
      queries.push(sql);
      return queries.length === 1
        ? { identity_document_type: 'NATIONAL_ID', identity_document_number: '12345678' }
        : { wallet_count: 2 };
    },
  };
  service.recordWalletLimitReached = async (customerId, stage, code) => {
    limitRecorded = customerId === 41 && stage === 'onboarding_initiation' && code === 'LOCAL_WALLET_LIMIT';
  };
  service.messages = { get: () => 'Wallet limit reached.' };

  await assert.rejects(
    service.assertWalletCapacityAvailable(41),
    (error) => error.getStatus() === 409 && error.message === 'Wallet limit reached.',
  );
  assert.equal(queries.length, 2);
  assert.equal(limitRecorded, true);
});

test('wallet-limit activity event sends urgent SMS and push using configured copy', async () => {
  const service = Object.create(OnboardingService.prototype);
  const insertedLogs = [];
  const sentNotifications = [];
  service.db = {
    queryOne: async () => ({ astpp_id: 89459, phone_number: '+254700000000' }),
    query: async (...args) => insertedLogs.push(args),
  };
  service.messages = { get: (key) => `configured:${key}` };
  service.notifications = {
    sendNotification: async (payload) => sentNotifications.push(payload),
  };

  await service.recordWalletLimitReached(41, 'otp_verification');

  assert.equal(insertedLogs.length, 1);
  assert.match(insertedLogs[0][0], /SASAPAY_WALLET_LIMIT_REACHED/);
  assert.deepEqual(sentNotifications[0].channels, ['sms', 'push']);
  assert.equal(sentNotifications[0].priority, 'urgent');
  assert.equal(sentNotifications[0].contact.phoneNumber, '+254700000000');
  assert.equal(sentNotifications[0].title, 'configured:wallets.onboarding.walletLimitReached.title');
  assert.equal(sentNotifications[0].body, 'configured:wallets.onboarding.walletLimitReached.body');
});

test('OTP endpoint returns wallet-limit conflict and does not enqueue persistence', async () => {
  const controller = Object.create(OnboardingController.prototype);
  let limitRecorded = false;
  let jobEnqueued = false;
  controller.db = {
    queryOne: async () => ({
      pg_app_id: 12,
      sasapay_request_id: 'request-123',
      sasapay_account_number: null,
      astpp_id: 89459,
      customer_id: 41,
    }),
  };
  controller.sasapayWaas = {
    confirmPersonalOnboardingByRequestId: async () => ({
      status: false,
      responseCode: 'SP4000',
      message: 'Maximum number of wallets you can create is 2',
      data: {},
    }),
    isWalletLimitExceeded: SasaPayWaasService.prototype.isWalletLimitExceeded,
  };
  controller.onboardingService = {
    recordWalletLimitReached: async (customerId, stage, responseCode) => {
      limitRecorded = customerId === 41 && stage === 'otp_verification' && responseCode === 'SP4000';
    },
  };
  controller.messages = { get: () => 'Wallet limit reached.' };
  controller.writeAuditLog = async () => {};
  controller.jobService = {
    enqueue: async () => {
      jobEnqueued = true;
      return 'job-123';
    },
  };
  controller.logger = { log: () => {} };

  await assert.rejects(
    controller.confirmPersonalOnboarding({ id: 41 }, { otp: '123456' }),
    (error) => error instanceof ConflictException && error.getStatus() === 409,
  );
  assert.equal(limitRecorded, true);
  assert.equal(jobEnqueued, false);
});

'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { SasaPayKycService } = require('../dist/src/modules/onboarding/services/sasapay-kyc.service.js');
const { OnboardingController } = require('../dist/src/modules/onboarding/controllers/onboarding.controller.js');

test('SasaPay rejection callback moves the customer application to pending admin review', async () => {
  const updates = [];
  const controller = Object.create(OnboardingController.prototype);
  controller.verifySasaPayCallback = () => {};
  controller.logger = { log: () => {} };
  controller.db = {
    queryOne: async (sql) => {
      if (sql.includes('FROM customer_applications')) return { id: 21, customer_id: 8 };
      if (sql.includes('FROM customers')) return null;
      throw new Error(`Unexpected query: ${sql}`);
    },
    query: async (sql, params) => {
      updates.push({ sql, params });
      return { rows: [] };
    },
  };
  controller.sasaPayKyc = {
    recordCallbackEvent: async () => ({ processed: true, submissionId: null }),
  };

  await controller.handleSasaPayCallback(
    {
      account_number: '1881181',
      account_status: 'REJECTED',
      payment_reference: 'request-1',
    },
    { socket: {}, ip: '127.0.0.1' },
  );

  assert.ok(updates[0].sql.includes("kyc_status = CASE WHEN $1 = 'REJECTED' THEN 'pending'"));
  assert.deepEqual(updates[0].params, ['REJECTED', 21, null]);
});

test('SasaPay rejection callback does not notify the customer before admin review', async () => {
  let customerNotifications = 0;
  const controller = Object.create(OnboardingController.prototype);
  controller.verifySasaPayCallback = () => {};
  controller.db = {
    queryOne: async (sql) => {
      if (sql.includes('FROM customer_applications')) return { id: 21, customer_id: 8 };
      if (sql.includes('FROM customers')) {
        return { astpp_id: 31553, phone_number: '254700000000', email: 'customer@example.com' };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    query: async () => ({ rows: [] }),
  };
  controller.sasaPayKyc = {
    recordCallbackEvent: async () => ({ processed: true, submissionId: 34 }),
  };
  controller.notifications = {
    sendNotification: async () => { customerNotifications += 1; },
    sendWalletOnboardingNotification: async () => { customerNotifications += 1; },
  };
  controller.logger = { log: () => {} };

  await controller.handleSasaPayCallback(
    { account_number: '1881181', account_status: 'REJECTED' },
    { socket: {}, ip: '127.0.0.1' },
  );

  assert.equal(customerNotifications, 0);
});

test('SasaPay rejection is recorded for admin review without requesting customer documents', async () => {
  const events = [];
  const service = Object.create(SasaPayKycService.prototype);
  service.db = {
    queryOne: async (sql) => {
      if (sql.includes('FROM customer_applications')) return { id: 21 };
      if (sql.includes('FROM customer_applicant_details')) return { id: 34 };
      throw new Error(`Unexpected query: ${sql}`);
    },
    query: async (sql) => {
      events.push(sql);
      return { rows: [] };
    },
  };
  service.sasaPayLogger = { logCallback: () => {} };
  service.logSubmissionEvent = async (eventName) => events.push(eventName);
  service.ensureSystemCase = async () => {
    throw new Error('SasaPay rejection must wait for an admin document decision');
  };

  const result = await service.recordCallbackEvent(
    8,
    'REJECTED',
    'Image is unclear',
    {},
    'request-1',
  );

  assert.equal(result.submissionId, 34);
  assert.ok(events[0].includes("sasapay_submission_status = $1"));
  assert.ok(events[0].includes("review_status = CASE WHEN $1 = 'psp_rejected' THEN 'pending'"));
  assert.ok(events.includes('psp_rejected'));
});

test('SasaPay rejection reopens a replacement request even after a prior approved submission', async () => {
  const queries = [];
  const service = Object.create(SasaPayKycService.prototype);
  service.config = { get: () => true };
  service.db = {
    queryOne: async (sql) => {
      queries.push(sql);
      if (sql.includes('FROM document_policies')) {
        return { id: 5, version: 1, required_documents: ['document_front', 'document_back'] };
      }
      if (sql.includes("sasapay_submission_status = 'psp_approved'")) return { id: 34 };
      if (sql.includes('sasapay_submission_status IN')) return null;
      if (sql.includes('INSERT INTO customer_applicant_details')) return { id: 34 };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  service.getCustomerApplicationAndDocument = async () => ({
    id: 21,
    customer_id: 8,
    astpp_id: 31553,
    identity_document_type: 'national_id',
    images: [],
  });
  service.logSubmissionEvent = async () => {};

  const submissionId = await service.ensureSystemCase(
    8,
    'SasaPay rejected existing KYC images.',
    true,
  );

  assert.equal(submissionId, 34);
  assert.ok(queries.some((sql) => sql.includes('sasapay_submission_status IN')));
  const reopenQuery = queries.find((sql) => sql.includes('INSERT INTO customer_applicant_details'));
  assert.ok(reopenQuery.includes("sasapay_submission_status = 'awaiting_documents'"));
  assert.ok(reopenQuery.includes("images = '[]'::jsonb"));
});

test('admin document decision activates the SasaPay upload request', async () => {
  const updates = [];
  const service = Object.create(SasaPayKycService.prototype);
  service.config = { get: () => true };
  service.db = {
    queryOne: async (sql) => {
      if (sql.includes('SELECT sasapay_account_number')) return { sasapay_account_number: '1881181' };
      if (sql.includes('FROM document_policies')) {
        return { id: 5, version: 1, required_documents: ['document_front', 'document_back'] };
      }
      if (sql.includes("sasapay_submission_status = 'psp_approved'")) return null;
      if (sql.includes('sasapay_submission_status IN')) return null;
      if (sql.includes('INSERT INTO customer_applicant_details')) return { id: 34 };
      throw new Error(`Unexpected query: ${sql}`);
    },
    query: async (sql, params) => {
      updates.push({ sql, params });
      return { rows: [] };
    },
  };
  service.getCustomerApplicationAndDocument = async () => ({
    id: 21,
    customer_id: 8,
    astpp_id: 31553,
    identity_document_type: 'national_id',
    images: [],
  });
  service.logSubmissionEvent = async () => {};
  service.getCurrentStatus = async () => ({
    submissionId: 34,
    status: 'awaiting_documents',
    requiredDocuments: ['document_front', 'document_back', 'selfie'],
  });

  const status = await service.requestReplacementDocuments(
    8,
    'admin-1',
    'SasaPay rejected the previous images.',
  );

  assert.equal(status.status, 'awaiting_documents');
  assert.deepEqual(status.requiredDocuments, ['document_front', 'document_back', 'selfie']);
  assert.ok(updates.some(({ sql }) => sql.includes("review_decision = 'rejected'")));
});

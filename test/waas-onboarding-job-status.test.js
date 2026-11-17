'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { WaasOnboardingJobService } = require('../dist/src/modules/onboarding/services/waas-onboarding-job.service.js');

function createService() {
  const queries = [];
  const service = Object.create(WaasOnboardingJobService.prototype);
  service.db = {
    queryOne: async () => ({ phone_number: '713726384', country_code: '254' }),
    query: async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    },
  };
  service.sasapayWaas = {
    uploadKycDocuments: async () => ({ status: true }),
  };
  service.writeAuditLog = async () => {};
  service.logger = { log: () => {}, warn: () => {} };

  return { queries, service };
}

function makeState(submissionId) {
  return {
    step: 'fetch_images',
    images: {
      front: 'front.jpg',
      back: 'back.jpg',
      selfie: 'selfie.jpg',
      requiredDocuments: ['document_front', 'document_back', 'selfie'],
      submissionId,
    },
  };
}

test('legacy KYC upload moves the SasaPay account to awaiting approval', async () => {
  const { queries, service } = createService();

  await service.step3_UploadKycToSasaPay(
    { customerId: 916 },
    makeState(undefined),
  );

  const applicationUpdate = queries.find(({ sql }) => sql.includes('UPDATE customer_applications'));
  assert.ok(applicationUpdate);
  assert.match(applicationUpdate.sql, /sasapay_account_status = CASE/);
  assert.match(applicationUpdate.sql, /'AWAITING_APPROVAL'/);
  assert.match(applicationUpdate.sql, /kyc_status = CASE/);
});

test('submission KYC upload moves the parent SasaPay account to awaiting approval', async () => {
  const { queries, service } = createService();

  await service.step3_UploadKycToSasaPay(
    { customerId: 916 },
    makeState('submission-1'),
  );

  const accountUpdate = queries.find(({ sql }) =>
    sql.includes('UPDATE customer_applications') && sql.includes("SET sasapay_account_status = 'AWAITING_APPROVAL'"),
  );
  assert.ok(accountUpdate);
  assert.match(accountUpdate.sql, /sasapay_account_status = 'AWAITING_KYC_UPLOAD'/);
});

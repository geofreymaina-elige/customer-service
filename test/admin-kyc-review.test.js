'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { CustomerOperationsService } = require('../dist/src/modules/operations/services/customer-operations.service.js');
const { MessageService } = require('../dist/src/core/messages/message.service.js');

test('admin customer search can filter the SasaPay rejection review queue', async () => {
  const queries = [];
  const service = new CustomerOperationsService(
    {
      queryOne: async (sql, params) => {
        queries.push({ sql, params });
        return { total: '0' };
      },
      query: async (sql, params) => {
        queries.push({ sql, params });
        return { rows: [] };
      },
    },
    new MessageService(),
    { publish: async () => {} },
    {},
  );

  await service.searchCustomers({
    kycStatus: 'pending',
    sasapayAccountStatus: 'REJECTED',
  });

  assert.ok(queries[0].sql.includes('ca.kyc_status = $1'));
  assert.ok(queries[0].sql.includes('ca.sasapay_account_status = $2'));
  assert.ok(queries[1].sql.includes('ca.kyc_status, ca.sasapay_account_status'));
  assert.deepEqual(queries[1].params.slice(0, 2), ['pending', 'REJECTED']);
});

test('admin KYC review requests replacement documents and records the decision', async () => {
  const queries = [];
  const publishedEvents = [];
  const requestedDocuments = [];
  const service = new CustomerOperationsService(
    {
      queryOne: async (sql) => {
        if (sql.includes('FROM customers')) return { id: 8 };
        throw new Error(`Unexpected query: ${sql}`);
      },
      query: async (sql, params) => {
        queries.push({ sql, params });
        return { rows: [] };
      },
    },
    new MessageService(),
    { publish: async (...args) => publishedEvents.push(args) },
    {
      requestReplacementDocuments: async (...args) => {
        requestedDocuments.push(args);
        return {
          status: 'awaiting_documents',
          requiredDocuments: ['document_front', 'selfie'],
        };
      },
    },
  );

  const result = await service.reviewKyc('customer-uuid', {
    decision: 'requires_kyc_upload',
    operatorId: 'admin-1',
    rejectionReason: 'SasaPay rejected the previous images.',
  });

  assert.deepEqual(requestedDocuments, [
    [8, 'admin-1', 'SasaPay rejected the previous images.'],
  ]);
  assert.equal(result.kycStatus, 'requires_kyc_upload');
  assert.deepEqual(result.requiredDocuments, ['document_front', 'selfie']);
  assert.ok(queries.some(({ sql, params }) =>
    sql.includes('UPDATE customer_applications') && params[0] === 'requires_kyc_upload'));
  assert.ok(queries.some(({ params }) => params[1] === 'KYC_DOCUMENTS_REQUESTED'));
  assert.equal(publishedEvents[0][0], 'customer.kyc_documents_required');
});

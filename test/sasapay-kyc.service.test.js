const assert = require('node:assert/strict');
const { test } = require('node:test');
const bcrypt = require('bcrypt');
const { NotFoundException } = require('@nestjs/common');
const { PinAuthService } = require('../dist/src/modules/auth/services/pin-auth.service');
const { SasaPayKycService } = require('../dist/src/modules/onboarding/services/sasapay-kyc.service');
const { WalletService } = require('../dist/src/modules/wallets/services/wallet.service');

function createService({ enabled = true, db = {} } = {}) {
  return new SasaPayKycService(db, {
    get: (key) => key === 'sasapay.kycEnabled' && enabled,
  });
}

test('policy-required document images always include one selfie', () => {
  const service = createService();

  assert.deepEqual(service.withRequiredSelfie(['document_front']), ['document_front', 'selfie']);
  assert.deepEqual(service.withRequiredSelfie(['document_back', 'selfie']), ['document_back', 'selfie']);
  assert.deepEqual(service.withRequiredSelfie([]), []);
});

test('image validation detects supported file signatures and rejects unknown data', () => {
  const service = createService();

  assert.equal(service.detectMimeType(Buffer.from([0xff, 0xd8, 0xff, 0x00])), 'image/jpeg');
  assert.equal(service.detectMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
  assert.equal(service.detectMimeType(Buffer.from('RIFF1234WEBP', 'ascii')), 'image/webp');
  assert.equal(service.detectMimeType(Buffer.from('not an image')), null);
});

test('stored original filenames cannot preserve path traversal components', () => {
  const service = createService();

  assert.equal(service.safeOriginalName('..\\private\\identity.png'), 'identity.png');
});

test('system case creation is disabled unless the feature flag is enabled', async () => {
  let queryCount = 0;
  const service = createService({
    enabled: false,
    db: { queryOne: async () => { queryCount += 1; } },
  });

  assert.equal(await service.ensureSystemCase(17, 'missing documents'), null);
  assert.equal(queryCount, 0);
});

test('signed-reference callback receipts deduplicate submission state changes', async () => {
  let receiptExists = false;
  let submissionUpdates = 0;
  let receiptPayload;
  const db = {
    queryOne: async (query) => {
      if (query.includes('FROM customer_applications WHERE customer_id')) return { id: 11 };
      if (query.includes('s.sasapay_request_id = $2')) return { id: 'submission-1' };
      throw new Error(`Unexpected query: ${query}`);
    },
    transaction: async (callback) => callback({
      query: async (query, params) => {
        if (query.includes('INSERT INTO sasapay_kyc_callback_receipts')) {
          receiptPayload = JSON.parse(params[5]);
          if (receiptExists) return { rowCount: 0, rows: [] };
          receiptExists = true;
          return { rowCount: 1, rows: [{ id: 1 }] };
        }
        if (query.includes('UPDATE sasapay_kyc_submissions')) {
          submissionUpdates += 1;
          assert.equal(params[0], 'psp_approved');
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`Unexpected transaction query: ${query}`);
      },
    }),
  };
  const service = createService({ db });
  const callbackPayload = {
    payment_reference: 'signed-ref',
    account_status: 'APPROVED',
    private_field: 'must-not-be-stored',
  };

  const first = await service.recordCallbackEvent(17, 'APPROVED', undefined, callbackPayload, 'signed-ref');
  const duplicate = await service.recordCallbackEvent(17, 'APPROVED', undefined, callbackPayload, 'signed-ref');

  assert.equal(first.processed, true);
  assert.equal(duplicate.processed, false);
  assert.equal(first.submissionId, 'submission-1');
  assert.equal(submissionUpdates, 1);
  assert.equal('private_field' in receiptPayload, false);
});

test('approved submission and upload job are claimed in one transaction', async () => {
  const statements = [];
  const db = {
    transaction: async (callback) => callback({
      query: async (query, params) => {
        statements.push(query);
        if (query.includes('SELECT s.id, s.customer_application_id')) {
          return { rowCount: 1, rows: [{ id: 'submission-2', customer_application_id: 11, customer_id: 17, astpp_id: 771 }] };
        }
        if (query.includes('INSERT INTO jobs')) {
          const payload = JSON.parse(params[0]);
          assert.equal(payload.submissionId, 'submission-2');
          return { rowCount: 1, rows: [] };
        }
        return { rowCount: 1, rows: [] };
      },
    }),
  };
  const service = createService({ db });

  await service.enqueueApprovedSubmission();

  assert.equal(statements.length, 3);
  assert.match(statements[0], /FOR UPDATE OF s SKIP LOCKED/);
  assert.match(statements[1], /processing_psp_upload/);
  assert.match(statements[2], /INSERT INTO jobs/);
});

test('an already approved submission prevents reopening the same policy case', async () => {
  let queryCount = 0;
  const db = {
    queryOne: async (query) => {
      queryCount += 1;
      if (query.includes('FROM customer_applications ca')) {
        return {
          id: 11,
          customer_id: 17,
          astpp_id: 771,
          identity_document_type: 'NATIONAL_ID',
          identity_document_number: 'ID-1',
          name: 'Test Customer',
          images: [],
        };
      }
      if (query.includes('FROM sasapay_kyc_document_policies')) {
        return { id: 3, version: 1, required_documents: ['document_front', 'selfie'] };
      }
      if (query.includes("s.status = 'psp_approved'")) return { id: 'approved-submission' };
      throw new Error(`Unexpected query: ${query}`);
    },
  };
  const service = createService({ db });

  assert.equal(await service.ensureSystemCase(17, 'missing documents'), null);
  assert.equal(queryCount, 3);
});

test("customers cannot upload another customer's submission images", async () => {
  const service = createService({ db: { queryOne: async () => null } });

  await assert.rejects(
    service.uploadImages(17, 'not-owned', [{ fieldname: 'selfie' }]),
    (error) => error instanceof NotFoundException,
  );
});

test('approved application with no wallet directs customer to onboarding', async () => {
  const db = {
    queryOne: async (query) => {
      if (query.includes('FROM customer_wallets')) return null;
      if (query.includes('FROM customer_applications')) {
        return { id: 11, kyc_status: 'approved', sasapay_account_status: 'ACTIVE' };
      }
      return null;
    },
  };
  const kyc = { ensureSystemCase: async () => null, getCurrentStatus: async () => null };
  const service = new WalletService(db, {}, {}, {}, kyc);

  const result = await service.getWalletOnboardingStatus(17);

  assert.equal(result.applicationStatus, 'approved');
  assert.equal(result.wallet, null);
  assert.deepEqual(result.nextAction, {
    type: 'start_onboarding',
    method: 'POST',
    endpoint: '/api/v2/auth/sessions/device',
  });
  assert.deepEqual(result.requiredDocuments, []);
  assert.equal('nextStep' in result, false);
});

test('active wallet and configured PIN direct customer to transactions', async () => {
  const db = {
    queryOne: async (query) => {
      if (query.includes('FROM customer_wallets')) {
        return { uuid: 'wallet-uuid', account_number: '12345', currency: 'KES', status: 'active' };
      }
      if (query.includes('FROM customer_applications')) {
        return { id: 11, kyc_status: 'approved', sasapay_account_status: 'ACTIVE' };
      }
      if (query.includes('FROM customer_pins')) return { id: 4 };
      if (query.includes('FROM customer_devices')) return { id: 8 };
      return null;
    },
  };
  const kyc = { ensureSystemCase: async () => null, getCurrentStatus: async () => null };
  const service = new WalletService(db, {}, {}, {}, kyc);

  const result = await service.getWalletOnboardingStatus(17);

  assert.deepEqual(result.nextAction, { type: 'make_transaction' });
  assert.equal('hasWallet' in result, false);
  assert.equal('isApproved' in result, false);
  assert.equal('nextStep' in result, false);
  assert.equal('tierLevel' in result.wallet, false);
});

test('incorrect PIN sends urgent redacted notification after persisting attempt count', async () => {
  const hash = await bcrypt.hash('1234', 4);
  let failureCountPersisted = false;
  let attemptPersisted = false;
  let notification;
  const db = {
    queryOne: async (query) => {
      if (query.includes('FROM customers')) {
        return { id: 17, astpp_id: '771', status: 'active', deleted_at: null };
      }
      if (query.includes('FROM customer_pins')) {
        return { id: 6, pin_hash: hash, failed_attempts: 2, locked_until: null, is_permanently_locked: false };
      }
      return null;
    },
    query: async (query) => {
      if (query.includes('UPDATE customer_pins')) failureCountPersisted = true;
      if (query.includes('INSERT INTO customer_auth_attempts')) attemptPersisted = true;
      return { rowCount: 1, rows: [] };
    },
  };
  const messages = {
    get: (key, params = {}) => {
      const templates = {
        'auth.pin.failedNotification.title': 'Incorrect security PIN',
        'auth.pin.failedNotification.body': 'Incorrect PIN; {attemptsRemaining} remaining. {lockWarning}',
        'auth.pin.temporarilyLocked': 'PIN locked for {minutes} minutes.',
      };
      return Object.entries(params).reduce(
        (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
        templates[key] || key,
      );
    },
  };
  const notifications = {
    sendNotification: async (payload) => {
      assert.equal(failureCountPersisted, true);
      assert.equal(attemptPersisted, true);
      notification = payload;
    },
  };
  const service = new PinAuthService(db, {}, messages, {}, notifications);

  await assert.rejects(
    service.verifyPin({ astpp_id: '771', pin: '0000' }),
    /PIN locked for 15 minutes\./,
  );

  assert.equal(notification.priority, 'urgent');
  assert.deepEqual(notification.channels, ['push']);
  assert.equal(notification.context.attemptsRemaining, 2);
  assert.match(notification.body, /temporarily locked for 15 minutes/);
  assert.equal(JSON.stringify(notification).includes('0000'), false);
});
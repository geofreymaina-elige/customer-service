'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { SasaPayLogger } = require('../dist/src/core/logging/sasapay-logger.service.js');
const { SasaPayWaasService } = require('../dist/src/modules/onboarding/services/sasapay-waas.service.js');

test('SasaPay provider response logs redact nested access tokens', () => {
  const sanitizer = new SasaPayLogger();
  const capturedResponses = [];
  const consoleLogs = [];
  const service = Object.create(SasaPayWaasService.prototype);
  service.sasaPayLogger = {
    sanitizePayload: sanitizer.sanitizePayload.bind(sanitizer),
    logResponse: (_operation, _url, _status, response) => capturedResponses.push(response),
  };
  service.logger = { log: (message) => consoleLogs.push(message) };

  service.logProviderResponse(
    'https://sasapay.example.test/api/v2/waas/auth/token/',
    200,
    { data: { access_token: 'sensitive-access-token' } },
  );

  assert.deepEqual(capturedResponses, [{ data: { access_token: '[REDACTED]' } }]);
  assert.equal(consoleLogs.some((message) => message.includes('sensitive-access-token')), false);
  assert.equal(consoleLogs.some((message) => message.includes('[REDACTED]')), true);
});

test('SasaPay error logs redact access tokens in provider response data', () => {
  const logger = new SasaPayLogger();
  const entries = [];
  const consoleErrors = [];
  logger.writeLog = (entry) => entries.push(entry);
  const originalConsoleError = console.error;
  console.error = (...args) => consoleErrors.push(args);

  try {
    const error = Object.assign(new Error('Provider request failed'), {
      response: {
        status: 500,
        data: { details: { access_token: 'sensitive-access-token' } },
      },
    });
    logger.logError('AUTH_TOKEN', error);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(JSON.stringify(entries).includes('sensitive-access-token'), false);
  assert.equal(JSON.stringify(consoleErrors).includes('sensitive-access-token'), false);
  assert.equal(JSON.stringify(entries).includes('[REDACTED]'), true);
});

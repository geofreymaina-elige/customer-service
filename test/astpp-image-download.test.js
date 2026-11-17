'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const axios = require('axios');
const { WaasOnboardingJobService } = require('../dist/src/modules/onboarding/services/waas-onboarding-job.service.js');

require('dotenv').config();

test('real ASTPP KYC image download for the configured customer', {
  skip: process.env.ASTPP_IMAGE_INTEGRATION_TEST !== '1',
}, async () => {
  const { Pool } = require('pg');
  const astppId = Number(process.env.ASTPP_IMAGE_TEST_ASTPP_ID || 557);
  assert.ok(Number.isSafeInteger(astppId) && astppId > 0, 'ASTPP_IMAGE_TEST_ASTPP_ID must be a positive integer');
  const baseUrl = process.env.ASTPP_IMAGES_BASE_URL;
  assert.ok(baseUrl, 'ASTPP_IMAGES_BASE_URL must be set in the environment or .env file');
  // assert.equal(
  //   new URL(baseUrl).origin,
  //   'https://msa-portal.elige-africa.com',
  //   'ASTPP_IMAGES_BASE_URL must point to the real ASTPP image portal',
  // );
  const missingDatabaseSettings = [
    'DATABASE_HOST',
    'DATABASE_PORT',
    'DATABASE_NAME',
    'DATABASE_USER',
    'DATABASE_PASSWORD',
  ].filter((key) => !process.env[key]);
  assert.deepEqual(
    missingDatabaseSettings,
    [],
    `Missing PostgreSQL settings: ${missingDatabaseSettings.join(', ')}`,
  );

  const pool = new Pool({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false,
    connectionTimeoutMillis: 10000,
    max: 1,
  });
  const originalTmpdir = os.tmpdir;
  const isolatedTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'astpp-kyc-integration-'));
  const originalGet = axios.get;
  const imageRoles = ['front', 'back', 'selfie'];
  let requestIndex = 0;

  try {
    os.tmpdir = () => isolatedTempDir;
    axios.get = async (...args) => {
      const role = imageRoles[requestIndex++] || 'unknown';
      const imageUrl = args[0];
      const startedAt = Date.now();
      console.log(`[ASTPP image integration] GET ${imageUrl}`);

      try {
        const response = await originalGet(...args);
        console.log(
          `[ASTPP image integration] ${role} image returned HTTP ${response.status} ` +
          `(${response.headers['content-type'] || 'no content type'}) in ${Date.now() - startedAt}ms`,
        );
        return response;
      } catch (error) {
        const status = error.response?.status || 'no HTTP response';
        console.error(
          `[ASTPP image integration] ${role} image request failed with ${status} ` +
          `after ${Date.now() - startedAt}ms`,
        );
        throw new Error(`ASTPP image endpoint failed for the ${role} image (${status}).`);
      }
    };
    const customer = await pool.query(
      'SELECT id FROM customers WHERE astpp_id = $1 LIMIT 1',
      [astppId],
    );
    assert.ok(customer.rows[0], `No PostgreSQL customer record found for ASTPP ID ${astppId}`);

    const service = new WaasOnboardingJobService(
      { query: (sql, params) => pool.query(sql, params) },
      {},
      {},
      {},
      {
        get: (key) => key === 'astpp.imagesBaseUrl'
          ? baseUrl
          : key === 'sasapay.kycEnabled'
            ? false
            : undefined,
      },
    );
    service.logger = { log: () => {}, warn: () => {}, error: () => {} };

    const result = await service.step2_FetchKycImagesViaHttp(
      { customerId: customer.rows[0].id, astppId, applicationId: null },
      { step: 'fetch_images' },
    );

    assert.equal(result.step, 'upload_kyc');
    assert.ok(result.images?.front && result.images?.back && result.images?.selfie);
    for (const imagePath of [result.images.front, result.images.back, result.images.selfie]) {
      const image = await fs.stat(imagePath);
      assert.ok(image.isFile() && image.size > 0, 'Downloaded KYC image must be a non-empty file');
    }

    console.log(`Successfully downloaded three KYC images for ASTPP ID ${astppId}; file contents were not displayed.`);
  } finally {
    axios.get = originalGet;
    os.tmpdir = originalTmpdir;
    try {
      await pool.end();
    } finally {
      await fs.rm(isolatedTempDir, { recursive: true, force: true });
    }
  }
});

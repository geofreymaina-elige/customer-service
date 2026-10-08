'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validateEnvironment } = require('../dist/src/config/environment.validation.js');

function validEnvironment() {
  return {
    PORT: '5005',
    NODE_ENV: 'production',
    PUBLIC_URL: 'https://service.example.test',
    API_KEY: 'a'.repeat(64),
    ADMIN_API_KEY: 'b'.repeat(64),
    CORS_ALLOWED_ORIGINS: 'https://admin.example.test,https://app.example.test',
    CORS_ALLOW_CREDENTIALS: 'false',
    RATE_LIMIT_TTL: '60',
    RATE_LIMIT_LIMIT: '120',
    DATABASE_HOST: 'database.example.test',
    DATABASE_PORT: '5432',
    DATABASE_NAME: 'customers',
    DATABASE_USER: 'service',
    DATABASE_PASSWORD: 'database-password',
    DATABASE_SSL: 'true',
    DATABASE_POOL_MIN: '2',
    DATABASE_POOL_MAX: '20',
    DATABASE_CONNECTION_TIMEOUT_MS: '5000',
    JWT_SECRET: 'c'.repeat(64),
    JWT_EXPIRATION_SECONDS: '600',
    JWT_APP_ACCESS_EXPIRATION_SECONDS: '86400',
    DEVICE_UUID_SALT: 'd'.repeat(64),
    OTP_SALT: 'e'.repeat(64),
    MAX_PIN_ATTEMPTS: '5',
    TEMPORARY_LOCKOUT_MINUTES: '15',
    ASTPP_HOST: 'astpp.example.test',
    ASTPP_PORT: '3306',
    ASTPP_DATABASE: 'astpp',
    ASTPP_USER: 'service',
    ASTPP_PASSWORD: 'astpp-password',
    ASTPP_BASE_URL: 'https://astpp.example.test',
    ASTPP_TOKEN_KEY_HEX: 'a'.repeat(64),
    ASTPP_IV_HEX: Buffer.from('abcdefghijklmnop').toString('hex'),
    ASTPP_MYSQL_CONNECTION_LIMIT: '10',
    ASTPP_MYSQL_QUEUE_LIMIT: '0',
    ASTPP_MYSQL_KEEP_ALIVE_INITIAL_DELAY_MS: '0',
    ASTPP_MYSQL_KEEP_ALIVE: 'true',
    ASTPP_MYSQL_WAIT_FOR_CONNECTIONS: 'true',
    ASTPP_SSH_HOST: 'astpp.example.test',
    ASTPP_SSH_PORT: '22',
    ASTPP_SSH_USERNAME: 'service',
    ASTPP_SSH_PRIVATE_KEY_PATH: '/keys/astpp',
    ASTPP_IMAGES_PATH: '/srv/astpp/images',
    KAFKA_BROKERS: 'kafka.example.test:9092',
    KAFKA_CLIENT_ID: 'customer-service',
    KAFKA_GROUP_ID: 'customer-service',
    KAFKA_TOPIC_ACCOUNTS: 'accounts',
    KAFKA_TOPIC_APPLICATIONS: 'applications',
    KAFKA_TOPIC_APPLICANT_DETAILS: 'applicants',
    KAFKA_TOPIC_DIDS: 'dids',
    KAFKA_NOTIFICATION_TOPIC: 'notifications',
    SASAPAY_ENABLED: 'true',
    SASAPAY_KYC_ENABLED: 'false',
    SASAPAY_ENVIRONMENT: 'sandbox',
    SASAPAY_CLIENT_ID: 'client-id',
    SASAPAY_CLIENT_SECRET: 'client-secret',
    SASAPAY_MERCHANT_CODE: 'merchant',
    SASAPAY_BASE_URL: 'https://sasapay.example.test',
    SASAPAY_CALLBACK_URL: 'https://service.example.test/callback',
    SASAPAY_CALLBACK_ALLOWED_IPS: '192.0.2.1',
    NOTIFICATION_SERVICE_URL: 'https://notifications.example.test',
    NOTIFICATION_SERVICE_API_KEY: 'n'.repeat(40),
    SENTRY_ENABLED: 'false',
  };
}

function captureConfigurationLogs(callback) {
  const originalInfo = console.info;
  const originalError = console.error;
  const lines = [];
  console.info = (line) => lines.push(line);
  console.error = (line) => lines.push(line);

  try {
    return { result: callback(), lines };
  } catch (error) {
    return { error, lines };
  } finally {
    console.info = originalInfo;
    console.error = originalError;
  }
}

test('accepts complete configuration and logs successful validation', () => {
  const env = validEnvironment();
  const { result, lines } = captureConfigurationLogs(() => validateEnvironment(env));

  assert.equal(result, env);
  assert.ok(lines.some((line) => /^\[CONFIG\] All \d+ startup configuration requirements are met\.$/.test(line)));
  assert.ok(!lines.some((line) => line.includes(env.JWT_SECRET)));
});

test('reports every missing or invalid requirement before rejecting startup', () => {
  const env = validEnvironment();
  env.PORT = 'not-a-port';
  delete env.API_KEY;
  env.DATABASE_POOL_MIN = '30';

  const { error, lines } = captureConfigurationLogs(() => validateEnvironment(env));

  assert.match(error.message, /PORT/);
  assert.match(error.message, /API_KEY/);
  assert.match(error.message, /DATABASE_POOL_MIN must not exceed DATABASE_POOL_MAX/);
  assert.ok(lines.includes('[CONFIG] MISSING/INVALID: PORT'));
  assert.ok(lines.includes('[CONFIG] MISSING/INVALID: API_KEY'));
  assert.ok(lines.includes('[CONFIG] MISSING/INVALID: DATABASE_POOL_MIN must not exceed DATABASE_POOL_MAX'));
  assert.ok(lines.some((line) => line.includes('Startup configuration validation failed:')));
});

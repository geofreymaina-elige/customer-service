const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { loadConfig } = require('../tests/long-run/config');
const { DailyLogger, redact } = require('../tests/long-run/daily-logger');
const { loadMobileRequests, safeGetClass } = require('../tests/long-run/postman-collection');
const { ApiRunner } = require('../tests/long-run/api-runner');
const { redactApplicationLine } = require('../tests/long-run/app-log-tailer');
const { responseSummary } = require('../tests/long-run/api-runner');
const { databaseIdentity, leaderChangeObserved } = require('../tests/long-run/database-monitor');
const { parsePm2List } = require('../tests/long-run/pm2-monitor');
const { ACCOUNT_AGGREGATE_SQL, STRESS_QUERY_TEMPLATES } = require('../tests/long-run/db-stress');

const workspaceRoot = path.resolve(__dirname, '..');

function configForTest(overrides = {}, cwd = workspaceRoot) {
  const keys = new Set([
    ...Object.keys(process.env).filter((key) => key.startsWith('LONGRUN_') || key.startsWith('DATABASE_')),
    ...Object.keys(overrides),
  ]);
  const originalValues = new Map([...keys].map((key) => [key, process.env[key]]));
  const originalCwd = process.cwd();
  for (const key of keys) delete process.env[key];
  for (const [key, value] of Object.entries(overrides)) process.env[key] = String(value);
  process.chdir(cwd);
  try {
    return loadConfig();
  } finally {
    process.chdir(originalCwd);
    for (const [key, value] of originalValues) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('remote API target is opt-in and production requires explicit account confirmation', () => {
  assert.throws(
    () => buildConfig({ LONGRUN_BASE_URL: 'https://staging.example.test' }, workspaceRoot),
    /LONGRUN_ALLOW_REMOTE_API/,
  );
  assert.throws(
    () => buildConfig({
      LONGRUN_BASE_URL: 'https://api.ambiapay.com',
      LONGRUN_ALLOW_REMOTE_API: 'true',
      LONGRUN_ALLOW_PRODUCTION_API: 'true',
      LONGRUN_ASTPP_ID: '31553',
    }, workspaceRoot),
    /LONGRUN_CONFIRM_ASTPP_ID=31553/,
  );
});

test('mutations and stress require explicit safe-target confirmations', () => {
  assert.throws(
    () => buildConfig({ LONGRUN_MUTATION_ALLOWLIST: 'Set the initial PIN' }, workspaceRoot),
    /Arbitrary mutations are disabled/,
  );
  assert.throws(
    () => buildConfig({ LONGRUN_ASTPP_ID: '99999' }, workspaceRoot),
    /restricted to ASTPP account 31553/,
  );
  const foreignAppToken = `header.${Buffer.from(JSON.stringify({ astppId: 99999 })).toString('base64url')}.signature`;
  assert.throws(
    () => buildConfig({
      LONGRUN_BASE_URL: 'https://staging.example.test',
      LONGRUN_ALLOW_REMOTE_API: 'true',
      LONGRUN_APP_ACCESS_TOKEN: foreignAppToken,
    }, workspaceRoot),
    /different ASTPP account/,
  );
  assert.throws(
    () => buildConfig({ LONGRUN_INCLUDE_BALANCE_API: 'true' }, workspaceRoot),
    /LONGRUN_ALLOW_PSP_BALANCE_API/,
  );
  assert.throws(
    () => buildConfig({ LONGRUN_ENABLE_DB_STRESS: 'true' }, workspaceRoot),
    /LONGRUN_TARGET_ENVIRONMENT=staging/,
  );
  assert.throws(
    () => buildConfig({
      LONGRUN_TARGET_ENVIRONMENT: 'staging',
      LONGRUN_ENABLE_DB_STRESS: 'true',
      LONGRUN_CONFIRM_DB_STRESS: 'STAGING_ONLY',
      DATABASE_HOST: '10.0.0.25',
    }, workspaceRoot),
    /local HAProxy write listener/,
  );
  assert.throws(
    () => buildConfig({
      LONGRUN_TARGET_ENVIRONMENT: 'staging',
      LONGRUN_ENABLE_DB_STRESS: 'true',
      LONGRUN_CONFIRM_DB_STRESS: 'STAGING_ONLY',
      DATABASE_HOST: '127.0.0.1',
    }, workspaceRoot),
    /DATABASE_NAME and DATABASE_USER/,
  );
  assert.throws(
    () => buildConfig({
      LONGRUN_ENABLE_PIN_REFRESH: 'true',
      LONGRUN_ENABLE_MUTATING_API_TESTS: 'true',
      LONGRUN_APP_ACCESS_TOKEN: 'app-token',
      LONGRUN_PIN: '1234',
      LONGRUN_DEVICE_IDENTIFIER: 'registered-device',
    }, workspaceRoot),
    /LONGRUN_CONFIRM_PIN_REFRESH_31553/,
  );
});

test('Postman classifier keeps balance periodic and state-changing requests out of the loop', () => {
  const requests = loadMobileRequests(path.join(workspaceRoot, 'postman/Customer_Management_API_v2_postman_collection.json'));
  const balance = requests.find((request) => request.name === 'Get my balance');
  const setPin = requests.find((request) => request.name === 'Set the initial PIN');
  const onboardingStatus = requests.find((request) => request.name === 'Get wallet onboarding status');

  assert.equal(safeGetClass(balance), 'balance');
  assert.equal(safeGetClass(setPin), 'mutation');
  assert.equal(safeGetClass(onboardingStatus), 'status');
  assert.ok(requests.length >= 10);
});

test('daily logger rotates size-bounded files and redacts secret fields', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'long-run-log-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const logger = new DailyLogger(directory, 1024, 14);
  logger.initialize(new Date('2026-10-02T00:00:00.000Z'));

  for (let index = 0; index < 20; index += 1) {
    logger.write('info', 'synthetic_event', { sequence: index, text: 'x'.repeat(250), astppToken: 'do-not-log' }, new Date('2026-10-02T00:00:00.000Z'));
  }
  logger.write('info', 'next_day', {}, new Date('2026-10-03T00:00:00.000Z'));

  const files = fs.readdirSync(directory).sort();
  assert.ok(files.some((file) => file === 'soak-2026-10-02.jsonl'));
  assert.ok(files.some((file) => file.startsWith('soak-2026-10-02.part-')));
  assert.ok(files.includes('soak-2026-10-03.jsonl'));
  assert.equal(fs.readFileSync(path.join(directory, 'soak-2026-10-02.jsonl'), 'utf8').includes('do-not-log'), false);
  assert.equal(JSON.stringify(redact({ pin: '1234' })).includes('1234'), false);
});

test('application log sanitizer removes auth tokens and customer identifiers', () => {
  const line = '[ERROR] X-Astpp-Token: abcdefgh123456789 customer id: 31553 Connection terminated unexpectedly';
  const safe = redactApplicationLine(line);
  assert.equal(safe.includes('abcdefgh123456789'), false);
  assert.equal(safe.includes('31553'), false);
  assert.match(safe, /Connection terminated unexpectedly/);
});

test('API response summary keeps only allowlisted health fields', () => {
  const summary = responseSummary({
    success: true,
    data: {
      applicationStatus: 'approved',
      nextAction: { type: 'make_transaction' },
      customerName: 'must-not-log',
      wallet: { status: 'active', accountNumber: 'must-not-log' },
    },
  });
  assert.deepEqual(summary, {
    success: true,
    code: undefined,
    applicationStatus: 'approved',
    nextAction: 'make_transaction',
    walletStatus: 'active',
  });
  assert.equal(JSON.stringify(summary).includes('must-not-log'), false);
});

test('database sampler detects leader endpoint changes but not a same-node restart alone', () => {
  const previous = databaseIdentity({
    server_address: '10.0.0.1',
    server_port: 5432,
    in_recovery: false,
    postmaster_started_at: '2026-10-02T10:00:00.000Z',
  });
  const promoted = databaseIdentity({
    server_address: '10.0.0.2',
    server_port: 5433,
    in_recovery: false,
    postmaster_started_at: '2026-10-02T10:00:00.000Z',
  });
  const restartedSameLeader = databaseIdentity({
    server_address: '10.0.0.1',
    server_port: 5432,
    in_recovery: false,
    postmaster_started_at: '2026-10-02T11:00:00.000Z',
  });

  assert.equal(leaderChangeObserved(previous, promoted), true);
  assert.equal(leaderChangeObserved(previous, restartedSameLeader), false);
});

test('read-only DB stress spreads across broader customer queries instead of one narrow account aggregate', () => {
  assert.ok(Array.isArray(STRESS_QUERY_TEMPLATES));
  assert.ok(STRESS_QUERY_TEMPLATES.length >= 3);
  assert.ok(STRESS_QUERY_TEMPLATES.some((query) => query.name === 'customer_volume_by_status'));
  assert.ok(STRESS_QUERY_TEMPLATES.some((query) => query.name === 'customer_volume_by_country'));
  assert.ok(STRESS_QUERY_TEMPLATES.some((query) => query.name === 'customer_application_trends'));
  assert.ok(STRESS_QUERY_TEMPLATES.some((query) => query.query.includes('FROM customers')));
  assert.ok(ACCOUNT_AGGREGATE_SQL.includes('WHERE astpp_id = $1'));
});

test('PM2 snapshots include process metrics but exclude process environment secrets', () => {
  const snapshot = parsePm2List(JSON.stringify([{
    name: 'customer-management-service',
    pm_id: 8,
    pid: 1234,
    pm2_env: {
      status: 'online',
      restart_time: 2,
      pm_uptime: Date.now() - 60000,
      env: { DATABASE_PASSWORD: 'should-not-appear' },
    },
    monit: { cpu: 3, memory: 1024 },
  }]), ['customer-management-service']);

  assert.equal(snapshot.length, 1);
  assert.equal(snapshot[0].status, 'online');
  assert.equal(snapshot[0].restartCount, 2);
  assert.equal(snapshot[0].memoryBytes, 1024);
  assert.equal(JSON.stringify(snapshot).includes('should-not-appear'), false);
});

test('balance request is skipped on startup and waits for its configured interval', async () => {
  const config = buildConfig({
    LONGRUN_BASE_URL: 'http://localhost:5005',
    LONGRUN_ASTPP_ID: '31553',
    LONGRUN_ASTPP_TOKEN: 'test-astpp-token',
    LONGRUN_APP_ACCESS_TOKEN: 'test-app-token',
    LONGRUN_TRANSACTION_TOKEN: 'test-transaction-token',
    LONGRUN_INCLUDE_BALANCE_API: 'true',
    LONGRUN_ALLOW_PSP_BALANCE_API: 'true',
  }, workspaceRoot);
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), method: options.method });
    return new Response(JSON.stringify({ success: true, data: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const logger = { info() {}, warn() {}, error() {} };
  try {
    const runner = new ApiRunner(config, logger);
    const firstCycle = Date.now();
    await runner.runCycle(firstCycle);
    assert.equal(calls.some((call) => call.url.includes('/wallets/me/balance')), false);

    await runner.runCycle(firstCycle + config.balanceIntervalMs + 1000);
    assert.equal(calls.filter((call) => call.url.includes('/wallets/me/balance')).length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('balance is disabled by default because its handler calls SasaPay', async () => {
  const config = buildConfig({ LONGRUN_BASE_URL: 'http://localhost:5005' }, workspaceRoot);
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    calls.push(String(url));
    return new Response('{"success":true}', { status: 200 });
  };
  const logger = { info() {}, warn() {}, error() {} };
  try {
    const runner = new ApiRunner(config, logger);
    await runner.runStartupRequests();
    await runner.runCycle(Date.now());
    await runner.runCycle(Date.now() + config.balanceIntervalMs + 1000);
    assert.equal(config.balanceApiEnabled, false);
    assert.equal(calls.some((url) => url.includes('/wallets/me/balance')), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('app and transaction tokens are hydrated from the auth APIs instead of being stored in env', async () => {
  const config = buildConfig({
    LONGRUN_BASE_URL: 'https://api.ambiapay.com',
    LONGRUN_ALLOW_REMOTE_API: 'true',
    LONGRUN_ALLOW_PRODUCTION_API: 'true',
    LONGRUN_CONFIRM_ASTPP_ID: '31553',
    LONGRUN_ASTPP_TOKEN: 'test-astpp-token',
    LONGRUN_PIN: '4920',
    LONGRUN_DEVICE_IDENTIFIER: 'SAM-S23-DEVICE-UUID-10492',
    LONGRUN_DEVICE_MODEL: 'Samsung Galaxy S23',
    LONGRUN_DEVICE_OS: 'Android 14',
    LONGRUN_APP_VERSION: '2.4.1',
    LONGRUN_MOBILE_TYPE: 'android',
  }, workspaceRoot);
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init = {}) => {
    const requestUrl = new URL(url);
    calls.push({ pathname: requestUrl.pathname, headers: init.headers || {} });

    if (requestUrl.pathname === '/api/v2/auth/sessions/device') {
      return new Response(JSON.stringify({ success: true, data: { accessToken: 'fresh-app-access-token' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (requestUrl.pathname === '/api/v2/auth/transaction-tokens') {
      assert.equal(init.headers.Authorization, 'Bearer fresh-app-access-token');
      return new Response(JSON.stringify({ success: true, data: { token: { accessToken: 'fresh-transaction-token', expiresInSeconds: 300 } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, data: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const runner = new ApiRunner(config, { info() {}, warn() {}, error() {} });
    const recovered = await runner.ensureLiveTokens(['appAccessToken', 'transactionToken']);
    assert.equal(recovered, true);
    assert.equal(config.variables.appAccessToken, 'fresh-app-access-token');
    assert.equal(config.variables.transactionToken, 'fresh-transaction-token');
    assert.ok(calls.some((call) => call.pathname === '/api/v2/auth/sessions/device'));
    assert.ok(calls.some((call) => call.pathname === '/api/v2/auth/transaction-tokens'));
  } finally {
    global.fetch = originalFetch;
  }
});

test('transaction token refresh updates memory but never logs the issued token', async () => {
  const config = buildConfig({
    LONGRUN_BASE_URL: 'http://localhost:5005',
    LONGRUN_ENABLE_MUTATING_API_TESTS: 'true',
    LONGRUN_CONFIRM_PIN_REFRESH_31553: 'true',
    LONGRUN_ENABLE_PIN_REFRESH: 'true',
    LONGRUN_APP_ACCESS_TOKEN: 'test-app-access-token',
    LONGRUN_PIN: '1234',
    LONGRUN_DEVICE_IDENTIFIER: 'registered-test-device',
  }, workspaceRoot);
  const records = [];
  const logger = {
    info: (event, fields) => records.push({ level: 'info', event, fields }),
    warn: (event, fields) => records.push({ level: 'warn', event, fields }),
    error: (event, fields) => records.push({ level: 'error', event, fields }),
  };
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer test-app-access-token');
    assert.equal(JSON.parse(options.body).pin, '1234');
    return new Response(JSON.stringify({
      success: true,
      data: { token: { accessToken: 'issued-transaction-secret', expiresInSeconds: 300 } },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const runner = new ApiRunner(config, logger);
    const request = runner.requests.find((item) => safeGetClass(item) === 'token_refresh');
    const result = await runner.execute(request, 'test_refresh');
    assert.equal(result.success, true);
    assert.equal(config.variables.transactionToken, 'issued-transaction-secret');
    assert.equal(JSON.stringify(records).includes('issued-transaction-secret'), false);
    assert.equal(runner.tokenRefreshFailed, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('one-time device sign-in runs only after status confirms an existing wallet', async () => {
  const config = buildConfig({
    LONGRUN_BASE_URL: 'https://api.ambiapay.com',
    LONGRUN_ALLOW_REMOTE_API: 'true',
    LONGRUN_ALLOW_PRODUCTION_API: 'true',
    LONGRUN_ALLOW_PRODUCTION_MUTATIONS: 'true',
    LONGRUN_CONFIRM_ASTPP_ID: '31553',
    LONGRUN_CONFIRM_DEVICE_SIGNIN_31553: 'true',
    LONGRUN_RUN_DEVICE_SIGNIN_ON_START: 'true',
    LONGRUN_ASTPP_ID: '31553',
    LONGRUN_ASTPP_TOKEN: 'test-astpp-token',
    LONGRUN_DEVICE_IDENTIFIER: 'registered-test-device',
  }, workspaceRoot);
  const runner = new ApiRunner(config, { info() {}, warn() {}, error() {} });
  const calls = [];
  runner.execute = async (request, phase) => {
    calls.push({ request, phase });
    return phase === 'device_signin_preflight'
      ? { success: true, statusCode: 200, summary: { walletStatus: 'active' } }
      : { success: true, statusCode: 200, summary: {} };
  };

  await runner.runStartupRequests();

  assert.deepEqual(calls.map((call) => call.phase), [
    'device_signin_preflight',
    'one_shot_existing_wallet_device_signin',
  ]);
  const request = require('../tests/long-run/postman-collection').buildRequest(
    calls[1].request,
    config.baseUrl,
    config.variables,
  );
  assert.equal(JSON.parse(request.body).astpp_id, '31553');
});

test('Kong request IDs and latency headers are recorded with a correlation ID', async () => {
  const config = buildConfig({
    LONGRUN_BASE_URL: 'https://api.ambiapay.com',
    LONGRUN_ALLOW_REMOTE_API: 'true',
    LONGRUN_ALLOW_PRODUCTION_API: 'true',
    LONGRUN_CONFIRM_ASTPP_ID: '31553',
    LONGRUN_ASTPP_ID: '31553',
    LONGRUN_ASTPP_TOKEN: 'test-astpp-token',
  }, workspaceRoot);
  const records = [];
  let requestHeaders;
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    requestHeaders = options.headers;
    return new Response(JSON.stringify({
      success: true,
      data: { wallet: { status: 'active' } },
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-kong-request-id': 'kong-test-id',
        'x-kong-proxy-latency': '4',
        'x-kong-upstream-latency': '23',
      },
    });
  };
  try {
    const runner = new ApiRunner(config, {
      info: (event, fields) => records.push({ event, fields }),
      warn() {},
      error: (event, fields) => records.push({ event, fields }),
    });
    const statusRequest = runner.requests.find((request) => request.name === 'Get wallet onboarding status');
    await runner.execute(statusRequest, 'test_gateway');

    const record = records.find((item) => item.event === 'api_request_completed');
    assert.equal(requestHeaders['X-Correlation-ID'], record.fields.correlationId);
    assert.equal(record.fields.targetHost, 'api.ambiapay.com');
    assert.equal(record.fields.kongRequestId, 'kong-test-id');
    assert.equal(record.fields.kongProxyLatencyMs, '4');
    assert.equal(record.fields.kongUpstreamLatencyMs, '23');
  } finally {
    global.fetch = originalFetch;
  }
});

test('synthetic DB aggregation is filtered to ASTPP account 31553', () => {
  assert.match(ACCOUNT_AGGREGATE_SQL, /WHERE\s+astpp_id\s*=\s*\$1/i);
});
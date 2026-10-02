const path = require('node:path');

function integer(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function validateBearerAccount(token, label, expectedAstppId, requireClaim) {
  if (!token) return;
  const parts = String(token).split('.');
  if (parts.length !== 3) {
    if (requireClaim) throw new Error(`${label} must be a JWT containing the locked ASTPP account claim.`);
    return;
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error(`${label} is not a valid JWT payload.`);
  }
  const accountClaim = payload.astppId ?? payload.astpp_id;
  if (accountClaim !== undefined && String(accountClaim) !== expectedAstppId) {
    throw new Error(`${label} belongs to a different ASTPP account; this worker is locked to ${expectedAstppId}.`);
  }
  if (requireClaim && accountClaim === undefined) {
    throw new Error(`${label} does not contain an ASTPP account claim.`);
  }
}

function buildConfig(overrides = {}, cwd = process.cwd()) {
  const keys = new Set([
    ...Object.keys(process.env).filter((key) => key.startsWith('LONGRUN_') || key.startsWith('DATABASE_')),
    ...Object.keys(overrides),
  ]);
  const originalValues = new Map([...keys].map((key) => [key, process.env[key]]));
  const originalCwd = process.cwd();

  for (const key of keys) delete process.env[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) process.env[key] = String(value);
  }

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

function loadConfig() {
  const env = process.env;
  const cwd = process.cwd();
  const allowedAstppId = '31553';
  const configuredAstppId = env.LONGRUN_ASTPP_ID;
  if (configuredAstppId && String(configuredAstppId) !== allowedAstppId) {
    throw new Error(`This soak worker is restricted to ASTPP account ${allowedAstppId}.`);
  }

  const variables = {
    baseUrl: env.LONGRUN_BASE_URL || 'http://localhost:5005',
    astppId: allowedAstppId,
    astppToken: env.LONGRUN_ASTPP_TOKEN,
    appAccessToken: env.LONGRUN_APP_ACCESS_TOKEN,
    transactionToken: env.LONGRUN_TRANSACTION_TOKEN,
    deviceIdentifier: env.LONGRUN_DEVICE_IDENTIFIER,
    deviceModel: env.LONGRUN_DEVICE_MODEL || 'Long-Run Soak Test Device',
    deviceOs: env.LONGRUN_DEVICE_OS || 'Android 14',
    appVersion: env.LONGRUN_APP_VERSION || '2.4.1',
    mobileType: env.LONGRUN_MOBILE_TYPE || 'android',
    pin: env.LONGRUN_PIN,
  };
  const baseUrl = String(variables.baseUrl).replace(/\/+$/, '');
  const parsedBaseUrl = new URL(baseUrl);
  const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(parsedBaseUrl.hostname);
  const isProductionApi = parsedBaseUrl.hostname.toLowerCase() === 'api.ambiapay.com';
  validateBearerAccount(variables.appAccessToken, 'App access token', allowedAstppId, !isLoopback && !!variables.appAccessToken);
  validateBearerAccount(variables.transactionToken, 'Transaction token', allowedAstppId, !isLoopback && !!variables.transactionToken);

  if (!isLoopback && env.LONGRUN_ALLOW_REMOTE_API !== 'true') {
    throw new Error('Remote API targets require LONGRUN_ALLOW_REMOTE_API=true.');
  }
  if (isProductionApi) {
    if (env.LONGRUN_ALLOW_PRODUCTION_API !== 'true') {
      throw new Error('Production API runs require LONGRUN_ALLOW_PRODUCTION_API=true.');
    }
    if (env.LONGRUN_CONFIRM_ASTPP_ID !== allowedAstppId) {
      throw new Error(`Production API runs require LONGRUN_CONFIRM_ASTPP_ID=${allowedAstppId}.`);
    }
  }
  if (env.LONGRUN_MUTATION_ALLOWLIST) {
    throw new Error('Arbitrary mutations are disabled; only the guarded transaction-token refresh is supported.');
  }

  const deviceSignInOnStart = env.LONGRUN_RUN_DEVICE_SIGNIN_ON_START === 'true';
  const pinRefreshEnabled = env.LONGRUN_ENABLE_PIN_REFRESH === 'true';
  if (deviceSignInOnStart) {
    if (env.LONGRUN_CONFIRM_DEVICE_SIGNIN_31553 !== 'true') {
      throw new Error('Device sign-in probe requires LONGRUN_CONFIRM_DEVICE_SIGNIN_31553=true.');
    }
    if (!variables.astppToken || !variables.deviceIdentifier) {
      throw new Error('Device sign-in probe requires the ASTPP token and registered device identifier.');
    }
    if (isProductionApi && env.LONGRUN_ALLOW_PRODUCTION_MUTATIONS !== 'true') {
      throw new Error('Production device sign-in requires LONGRUN_ALLOW_PRODUCTION_MUTATIONS=true.');
    }
  }

  if (pinRefreshEnabled) {
    if (env.LONGRUN_ENABLE_MUTATING_API_TESTS !== 'true' || env.LONGRUN_CONFIRM_PIN_REFRESH_31553 !== 'true') {
      throw new Error('PIN refresh requires mutating API opt-in and LONGRUN_CONFIRM_PIN_REFRESH_31553=true.');
    }
    if ((!variables.appAccessToken && !deviceSignInOnStart) || !variables.pin || !variables.deviceIdentifier) {
      throw new Error('PIN refresh requires a sign-in flow or app-access token, a PIN, and a registered device.');
    }
    if (isProductionApi && env.LONGRUN_ALLOW_PRODUCTION_MUTATIONS !== 'true') {
      throw new Error('Production PIN refresh requires LONGRUN_ALLOW_PRODUCTION_MUTATIONS=true.');
    }
  }

  const balanceApiEnabled = env.LONGRUN_INCLUDE_BALANCE_API === 'true';
  if (balanceApiEnabled && env.LONGRUN_ALLOW_PSP_BALANCE_API !== 'true') {
    throw new Error('The balance endpoint calls SasaPay; require LONGRUN_ALLOW_PSP_BALANCE_API=true.');
  }

  const dbStressEnabled = env.LONGRUN_ENABLE_DB_STRESS === 'true';
  const databaseHost = env.DATABASE_HOST || '127.0.0.1';
  if (dbStressEnabled) {
    if (env.LONGRUN_TARGET_ENVIRONMENT !== 'staging') {
      throw new Error('DB stress is staging-only; set LONGRUN_TARGET_ENVIRONMENT=staging.');
    }
    if (env.LONGRUN_CONFIRM_DB_STRESS !== 'STAGING_ONLY') {
      throw new Error('Confirm bounded staging DB stress with LONGRUN_CONFIRM_DB_STRESS=STAGING_ONLY.');
    }
    if (!['127.0.0.1', 'localhost', '::1'].includes(databaseHost)) {
      throw new Error('DB stress must connect through the local HAProxy write listener.');
    }
    if (!env.DATABASE_NAME || !env.DATABASE_USER) {
      throw new Error('DB stress requires DATABASE_NAME and DATABASE_USER.');
    }
    if (isProductionApi) throw new Error('DB stress is blocked when the API target is production.');
  }

  return {
    cwd,
    baseUrl,
    variables,
    collectionPath: path.resolve(cwd, env.LONGRUN_POSTMAN_COLLECTION || 'postman/Customer_Management_API_v2_postman_collection.json'),
    logDirectory: path.resolve(cwd, env.LONGRUN_LOG_DIRECTORY || 'logs/long-run'),
    appLogPaths: String(env.LONGRUN_APP_LOG_PATHS || '')
      .split(',').map((value) => value.trim()).filter(Boolean).map((value) => path.resolve(cwd, value)),
    pm2ProcessNames: String(env.LONGRUN_PM2_PROCESS_NAMES || '')
      .split(',').map((value) => value.trim()).filter(Boolean),
    logMaxBytes: integer(env.LONGRUN_LOG_MAX_BYTES, 10 * 1024 * 1024, 256 * 1024, 100 * 1024 * 1024),
    logRetentionDays: integer(env.LONGRUN_LOG_RETENTION_DAYS, 14, 1, 365),
    requestTimeoutMs: integer(env.LONGRUN_REQUEST_TIMEOUT_MS, 15000, 1000, 120000),
    cycleMinMs: integer(env.LONGRUN_CYCLE_MIN_SECONDS, 30, 5, 3600) * 1000,
    cycleMaxMs: integer(env.LONGRUN_CYCLE_MAX_SECONDS, 90, 5, 3600) * 1000,
    walletIntervalMs: integer(env.LONGRUN_WALLET_INTERVAL_MINUTES, 5, 1, 1440) * 60 * 1000,
    sessionsIntervalMs: integer(env.LONGRUN_SESSIONS_INTERVAL_MINUTES, 10, 1, 1440) * 60 * 1000,
    appConfigIntervalMs: integer(env.LONGRUN_APP_CONFIG_INTERVAL_MINUTES, 30, 1, 1440) * 60 * 1000,
    balanceIntervalMs: integer(env.LONGRUN_BALANCE_INTERVAL_MINUTES, 30, 1, 1440) * 60 * 1000,
    dbSampleIntervalMs: integer(env.LONGRUN_DB_SAMPLE_INTERVAL_SECONDS, 30, 5, 3600) * 1000,
    durationHours: integer(env.LONGRUN_DURATION_HOURS, 0, 0, 24 * 365),
    nodeName: env.LONGRUN_NODE_NAME || require('node:os').hostname(),
    targetEnvironment: env.LONGRUN_TARGET_ENVIRONMENT || 'unspecified',
    pinRefreshEnabled,
    deviceSignInOnStart,
    balanceApiEnabled,
    initialTransactionTokenTtlSeconds: integer(env.LONGRUN_TRANSACTION_TOKEN_TTL_SECONDS, 300, 60, 86400),
    dbStressEnabled,
    dbStressParallelism: integer(env.LONGRUN_DB_STRESS_PARALLELISM, 2, 1, 4),
    dbStressWindowMs: integer(env.LONGRUN_DB_STRESS_WINDOW_SECONDS, 20, 5, 30) * 1000,
    dbStressIntervalMinMs: integer(env.LONGRUN_DB_STRESS_INTERVAL_MINUTES, 15, 5, 1440) * 60 * 1000,
    dbStressIntervalMaxMs: integer(env.LONGRUN_DB_STRESS_INTERVAL_MAX_MINUTES, 45, 5, 1440) * 60 * 1000,
    database: {
      host: databaseHost,
      port: integer(env.DATABASE_PORT, 5432, 1, 65535),
      database: env.DATABASE_NAME,
      user: env.DATABASE_USER,
      password: env.DATABASE_PASSWORD,
      ssl: env.DATABASE_SSL === 'true',
    },
  };
}

global.buildConfig = buildConfig;
global.loadConfig = loadConfig;

module.exports = { buildConfig, loadConfig };

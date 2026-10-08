import { isIP } from 'node:net';

type Environment = Record<string, string | undefined>;

interface ValidationResult {
  name: string;
  valid: boolean;
}

const requiredVariables = [
  'PORT',
  'NODE_ENV',
  'PUBLIC_URL',
  'API_KEY',
  'ADMIN_API_KEY',
  'CORS_ALLOWED_ORIGINS',
  'CORS_ALLOW_CREDENTIALS',
  'RATE_LIMIT_TTL',
  'RATE_LIMIT_LIMIT',
  'DATABASE_HOST',
  'DATABASE_PORT',
  'DATABASE_NAME',
  'DATABASE_USER',
  'DATABASE_PASSWORD',
  'DATABASE_SSL',
  'DATABASE_POOL_MIN',
  'DATABASE_POOL_MAX',
  'DATABASE_CONNECTION_TIMEOUT_MS',
  'JWT_SECRET',
  'JWT_EXPIRATION_SECONDS',
  'JWT_APP_ACCESS_EXPIRATION_SECONDS',
  'DEVICE_UUID_SALT',
  'OTP_SALT',
  'MAX_PIN_ATTEMPTS',
  'TEMPORARY_LOCKOUT_MINUTES',
  'ASTPP_HOST',
  'ASTPP_PORT',
  'ASTPP_DATABASE',
  'ASTPP_USER',
  'ASTPP_PASSWORD',
  'ASTPP_BASE_URL',
  'ASTPP_MYSQL_CONNECTION_LIMIT',
  'ASTPP_MYSQL_QUEUE_LIMIT',
  'ASTPP_MYSQL_KEEP_ALIVE_INITIAL_DELAY_MS',
  'ASTPP_MYSQL_KEEP_ALIVE',
  'ASTPP_MYSQL_WAIT_FOR_CONNECTIONS',
  'ASTPP_SSH_HOST',
  'ASTPP_SSH_PORT',
  'ASTPP_SSH_USERNAME',
  'ASTPP_IMAGES_PATH',
  'KAFKA_BROKERS',
  'KAFKA_CLIENT_ID',
  'KAFKA_GROUP_ID',
  'KAFKA_TOPIC_ACCOUNTS',
  'KAFKA_TOPIC_APPLICATIONS',
  'KAFKA_TOPIC_APPLICANT_DETAILS',
  'KAFKA_TOPIC_DIDS',
  'KAFKA_NOTIFICATION_TOPIC',
  'SASAPAY_ENABLED',
  'SASAPAY_KYC_ENABLED',
  'SASAPAY_ENVIRONMENT',
  'SASAPAY_CLIENT_ID',
  'SASAPAY_CLIENT_SECRET',
  'SASAPAY_MERCHANT_CODE',
  'SASAPAY_BASE_URL',
  'SASAPAY_CALLBACK_URL',
  'SASAPAY_CALLBACK_ALLOWED_IPS',
  'SENTRY_ENABLED',
] as const;

const numericRules: Record<string, { min: number; max: number }> = {
  PORT: { min: 1, max: 65535 },
  DATABASE_PORT: { min: 1, max: 65535 },
  DATABASE_POOL_MIN: { min: 0, max: Number.MAX_SAFE_INTEGER },
  DATABASE_POOL_MAX: { min: 1, max: Number.MAX_SAFE_INTEGER },
  DATABASE_CONNECTION_TIMEOUT_MS: { min: 1, max: Number.MAX_SAFE_INTEGER },
  JWT_EXPIRATION_SECONDS: { min: 1, max: Number.MAX_SAFE_INTEGER },
  JWT_APP_ACCESS_EXPIRATION_SECONDS: { min: 1, max: Number.MAX_SAFE_INTEGER },
  MAX_PIN_ATTEMPTS: { min: 1, max: Number.MAX_SAFE_INTEGER },
  TEMPORARY_LOCKOUT_MINUTES: { min: 1, max: Number.MAX_SAFE_INTEGER },
  ASTPP_PORT: { min: 1, max: 65535 },
  ASTPP_SSH_PORT: { min: 1, max: 65535 },
  ASTPP_MYSQL_CONNECTION_LIMIT: { min: 1, max: Number.MAX_SAFE_INTEGER },
  ASTPP_MYSQL_QUEUE_LIMIT: { min: 0, max: Number.MAX_SAFE_INTEGER },
  ASTPP_MYSQL_KEEP_ALIVE_INITIAL_DELAY_MS: { min: 0, max: Number.MAX_SAFE_INTEGER },
  RATE_LIMIT_TTL: { min: 1, max: Number.MAX_SAFE_INTEGER },
  RATE_LIMIT_LIMIT: { min: 1, max: Number.MAX_SAFE_INTEGER },
};

function nonEmpty(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function isValidUrl(value: string | undefined): boolean {
  if (!nonEmpty(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password;
  } catch {
    return false;
  }
}

function validateValue(env: Environment, name: string, value: string | undefined): boolean {
  if (!nonEmpty(value)) return false;

  const numericRule = numericRules[name];
  if (numericRule) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= numericRule.min && parsed <= numericRule.max;
  }

  if ([
    'DATABASE_SSL',
    'CORS_ALLOW_CREDENTIALS',
    'SASAPAY_ENABLED',
    'SASAPAY_KYC_ENABLED',
    'ASTPP_MYSQL_KEEP_ALIVE',
    'ASTPP_MYSQL_WAIT_FOR_CONNECTIONS',
    'SENTRY_ENABLED',
  ].includes(name)) {
    return value === 'true' || value === 'false';
  }

  if (['PUBLIC_URL', 'ASTPP_BASE_URL', 'SASAPAY_BASE_URL', 'SASAPAY_CALLBACK_URL'].includes(name)) {
    return isValidUrl(value) && (env.NODE_ENV !== 'production' || value.startsWith('https://'));
  }

  if (['JWT_SECRET', 'API_KEY', 'ADMIN_API_KEY', 'DEVICE_UUID_SALT', 'OTP_SALT'].includes(name)) {
    return value.trim().length >= 32;
  }

  if (name === 'ASTPP_IMAGES_PATH') {
    return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
  }

  if (name === 'CORS_ALLOWED_ORIGINS') {
    const origins = value.split(',').map((origin) => origin.trim());
    return origins.length > 0 && origins.every((origin) => {
      if (!origin || origin.includes('*')) return false;
      try {
        const url = new URL(origin);
        return (url.protocol === 'https:' || (env.NODE_ENV !== 'production' && url.protocol === 'http:')) &&
          url.origin === origin;
      } catch {
        return false;
      }
    });
  }

  if (name === 'KAFKA_BROKERS') {
    return value.split(',').every((broker) => broker.trim().length > 0);
  }

  if (name === 'SASAPAY_CALLBACK_ALLOWED_IPS') {
    return value.split(',').every((ip) => isIP(ip.trim()) !== 0);
  }

  return true;
}

function validateAlternative(
  env: Environment,
  label: string,
  names: readonly string[],
  validator: (name: string, value: string) => boolean,
  results: ValidationResult[],
): void {
  const selected = names.find((name) => nonEmpty(env[name]));
  const selectedValue = selected ? env[selected] : undefined;
  const valid = selected !== undefined &&
    nonEmpty(selectedValue) &&
    validator(selected, selectedValue);
  results.push({ name: `${label} (${names.join(' or ')})`, valid });
}

export function validateEnvironment(env: Environment): Environment {
  const results: ValidationResult[] = requiredVariables.map((name) => ({
    name,
    valid: validateValue(env, name, env[name]),
  }));

  validateAlternative(
    env,
    'ASTPP token encryption key',
    ['ASTPP_TOKEN_KEY_HEX', 'ASTPP_TOKEN_KEY'],
    (name, value) => name === 'ASTPP_TOKEN_KEY_HEX'
      ? /^[\da-f]{32,}$/i.test(value) && value.length % 2 === 0
      : value.trim().length >= 32,
    results,
  );
  validateAlternative(
    env,
    'ASTPP token IV',
    ['ASTPP_IV_DERIVED', 'ASTPP_IV_HEX', 'ASTPP_IV_KEY'],
    (name, value) => {
      if (name === 'ASTPP_IV_HEX') {
        return /^[\da-f]{32,}$/i.test(value) && value.length % 2 === 0 &&
          Buffer.from(value, 'hex').toString('utf8').length >= 16;
      }
      return name === 'ASTPP_IV_DERIVED'
        ? value.length >= 16
        : value.trim().length >= 32;
    },
    results,
  );
  validateAlternative(
    env,
    'ASTPP SSH private key',
    ['ASTPP_SSH_PRIVATE_KEY', 'ASTPP_SSH_PRIVATE_KEY_PATH'],
    (_name, value) => value.trim().length > 0,
    results,
  );

  const poolMin = Number(env.DATABASE_POOL_MIN);
  const poolMax = Number(env.DATABASE_POOL_MAX);
  results.push({
    name: 'DATABASE_POOL_MIN must not exceed DATABASE_POOL_MAX',
    valid: Number.isInteger(poolMin) && Number.isInteger(poolMax) && poolMin <= poolMax,
  });

  const invalid = results.filter((result) => !result.valid);
  for (const result of results) {
    console.info(`[CONFIG] ${result.valid ? 'OK' : 'MISSING/INVALID'}: ${result.name}`);
  }

  if (invalid.length > 0) {
    console.error(`[CONFIG] Startup configuration validation failed: ${invalid.length} requirement(s) not met.`);
    throw new Error(`Invalid startup configuration: ${invalid.map((result) => result.name).join(', ')}`);
  }

  console.info(`[CONFIG] All ${results.length} startup configuration requirements are met.`);
  return env;
}

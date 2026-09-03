export default () => ({
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  database: {
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    name: process.env.DATABASE_NAME || 'ambia_pay',
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'postgres',
    ssl: process.env.DATABASE_SSL === 'true',
    poolMin: parseInt(process.env.DATABASE_POOL_MIN || '2', 10),
    poolMax: parseInt(process.env.DATABASE_POOL_MAX || '20', 10),
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'super_secret_production_ready_jwt_key_ambia_pay_2026_min_32_chars',
    expiresInSeconds: parseInt(process.env.JWT_EXPIRATION_SECONDS || '900', 10), // 15 mins
  },
  security: {
    deviceUuidSalt: process.env.DEVICE_UUID_SALT || 'AMBIA_DEVICE_SALT_SECURE_2026_X99',
    otpSalt: process.env.OTP_SALT || 'AMBIA_OTP_SALT_SECURE_2026_V1',
    maxPinAttempts: 5,
    temporaryLockoutMinutes: 15,
  },
  astpp: {
    host: process.env.ASTPP_HOST || 'localhost',
    port: parseInt(process.env.ASTPP_PORT || '3306', 10),
    database: process.env.ASTPP_DATABASE || 'astpp',
    user: process.env.ASTPP_USER || 'root',
    password: process.env.ASTPP_PASSWORD || '',
    tokenKeyHex: process.env.ASTPP_TOKEN_KEY_HEX || '',
    ivHex: process.env.ASTPP_IV_HEX || '',
  },
  kafka: {
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    clientId: process.env.KAFKA_CLIENT_ID || 'ambia-pay-cdc-consumer',
    groupId: process.env.KAFKA_GROUP_ID || 'ambia-pay-customer-sync',
    topics: {
      accounts: process.env.KAFKA_TOPIC_ACCOUNTS || 'mysql.astpp.accounts',
      applications: process.env.KAFKA_TOPIC_APPLICATIONS || 'mysql.astpp.applications',
      applicantDetails: process.env.KAFKA_TOPIC_APPLICANT_DETAILS || 'mysql.astpp.applicant_details',
      dids: process.env.KAFKA_TOPIC_DIDS || 'mysql.astpp.dids',
    },
  },
  sasapay: {
    enabled: process.env.SASAPAY_ENABLED === 'true',
    environment: process.env.SASAPAY_ENVIRONMENT || 'sandbox',
    clientId: process.env.SASAPAY_CLIENT_ID || '',
    clientSecret: process.env.SASAPAY_CLIENT_SECRET || '',
    merchantCode: process.env.SASAPAY_MERCHANT_CODE || '',
    baseUrl: process.env.SASAPAY_BASE_URL || 'https://sandbox.sasapay.app',
    callbackUrl: process.env.SASAPAY_CALLBACK_URL || 'https://api.yourdomain.com/api/v1/callbacks/sasapay/onboarding',
  },
  notification: {
    url: process.env.NOTIFICATION_SERVICE_URL || '',
    apiKey: process.env.NOTIFICATION_SERVICE_API_KEY || '',
  },
});

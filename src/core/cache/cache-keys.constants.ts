/**
 * Centralized Cache Key Constants
 * 
 * Benefits:
 * - Consistent naming across services
 * - Easy to find all cache keys in one place
 * - Type-safe key generation
 * - Easy migration to Redis (keys remain the same)
 */

export const CacheKeys = {
  // System Configuration (TTL: 30-300 seconds)
  SYSTEM_CONFIG: (key: string) => `config:${key}`,
  MAINTENANCE_MODE: 'config:maintenance_mode',
  MAINTENANCE_MESSAGE: 'config:maintenance_message',
  
  // Customer Status (TTL: 60 seconds)
  CUSTOMER_STATUS: (customerId: number) => `customer:${customerId}:status`,
  CUSTOMER_LOCKED: (customerId: number) => `customer:${customerId}:locked`,
  CUSTOMER_DELETED: (customerId: number) => `customer:${customerId}:deleted`,
  
  // Device Status (TTL: 60 seconds)
  DEVICE_ACTIVE: (deviceHash: string) => `device:${deviceHash}:active`,
  
  // JWT Blacklist (TTL: 60 seconds)
  JWT_BLACKLISTED: (customerId: number, deviceHash: string) => 
    `jwt:blacklist:${customerId}:${deviceHash}`,
  JWT_BLACKLISTED_CUSTOMER: (customerId: number) => `jwt:blacklist:${customerId}:*`,
  
  // Wallet Status (TTL: 60 seconds)
  WALLET_STATUS: (customerId: number) => `wallet:${customerId}:status`,
  WALLET_LOCKED: (customerId: number) => `wallet:${customerId}:locked`,
  
  // PIN Status (TTL: 300 seconds)
  PIN_LOCKED: (customerId: number) => `pin:${customerId}:locked`,
  PIN_FAILED_ATTEMPTS: (customerId: number) => `pin:${customerId}:failed_attempts`,
  
  // KYC Application (TTL: 60 seconds)
  KYC_STATUS: (customerId: number, applicationType: string) => 
    `kyc:${customerId}:${applicationType}:status`,
  
  // Rate Limiting (TTL: varies)
  RATE_LIMIT: (endpoint: string, identifier: string) => `rate_limit:${endpoint}:${identifier}`,
  
  // Feature Flags (TTL: 300 seconds)
  FEATURE_FLAG: (flag: string) => `feature:${flag}`,
} as const;

/**
 * Default TTL values (in seconds)
 */
export const CacheTTL = {
  SYSTEM_CONFIG: 30,
  MAINTENANCE_MODE: 30,
  CUSTOMER_STATUS: 60,
  DEVICE_STATUS: 60,
  JWT_BLACKLIST: 60,
  WALLET_STATUS: 60,
  PIN_STATUS: 300,
  KYC_STATUS: 60,
  FEATURE_FLAG: 300,
  RATE_LIMIT: 60,
} as const;

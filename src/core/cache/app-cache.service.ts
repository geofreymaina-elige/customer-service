import { Injectable } from '@nestjs/common';
import { CacheService } from './cache.service';
import { CacheKeys, CacheTTL } from './cache-keys.constants';

/**
 * Application-level Cache Service
 * 
 * Provides high-level caching methods for common use cases.
 * Encapsulates cache key generation and TTL management.
 * 
 * Usage in services:
 * ```typescript
 * constructor(private readonly appCache: AppCacheService) {}
 * 
 * async checkCustomerStatus(customerId: number) {
 *   return this.appCache.getCustomerStatus(customerId);
 * }
 * ```
 */
@Injectable()
export class AppCacheService {
  constructor(private readonly cache: CacheService) {}

  // ============================================================================
  // System Configuration
  // ============================================================================

  /**
   * Check if maintenance mode is enabled (cached)
   */
  async isMaintenanceModeEnabled(): Promise<boolean> {
    return this.cache.get<boolean>(CacheKeys.MAINTENANCE_MODE) ?? false;
  }

  /**
   * Set maintenance mode status
   */
  setMaintenanceMode(enabled: boolean, message?: string): void {
    this.cache.set(CacheKeys.MAINTENANCE_MODE, enabled, CacheTTL.MAINTENANCE_MODE);
    if (message) {
      this.cache.set(CacheKeys.MAINTENANCE_MESSAGE, message, CacheTTL.MAINTENANCE_MODE);
    }
  }

  /**
   * Get maintenance message
   */
  getMaintenanceMessage(): string {
    return this.cache.get<string>(CacheKeys.MAINTENANCE_MESSAGE) 
      ?? 'System maintenance in progress. Please try again later.';
  }

  /**
   * Get system config value (generic)
   */
  getSystemConfig<T>(key: string): T | null {
    return this.cache.get<T>(CacheKeys.SYSTEM_CONFIG(key));
  }

  /**
   * Set system config value (generic)
   */
  setSystemConfig<T>(key: string, value: T, ttlSeconds?: number): void {
    this.cache.set(CacheKeys.SYSTEM_CONFIG(key), value, ttlSeconds ?? CacheTTL.SYSTEM_CONFIG);
  }

  // ============================================================================
  // Customer Status
  // ============================================================================

  /**
   * Get customer status (active, suspended, closed)
   */
  getCustomerStatus(customerId: number): string | null {
    return this.cache.get<string>(CacheKeys.CUSTOMER_STATUS(customerId));
  }

  /**
   * Set customer status
   */
  setCustomerStatus(customerId: number, status: string): void {
    this.cache.set(CacheKeys.CUSTOMER_STATUS(customerId), status, CacheTTL.CUSTOMER_STATUS);
  }

  /**
   * Check if customer is locked by admin
   */
  isCustomerLocked(customerId: number): boolean {
    return this.cache.get<boolean>(CacheKeys.CUSTOMER_LOCKED(customerId)) ?? false;
  }

  /**
   * Set customer lock status
   */
  setCustomerLocked(customerId: number, locked: boolean): void {
    this.cache.set(CacheKeys.CUSTOMER_LOCKED(customerId), locked, CacheTTL.CUSTOMER_STATUS);
  }

  /**
   * Check if customer is soft-deleted
   */
  isCustomerDeleted(customerId: number): boolean {
    return this.cache.get<boolean>(CacheKeys.CUSTOMER_DELETED(customerId)) ?? false;
  }

  /**
   * Set customer deleted status
   */
  setCustomerDeleted(customerId: number, deleted: boolean): void {
    this.cache.set(CacheKeys.CUSTOMER_DELETED(customerId), deleted, CacheTTL.CUSTOMER_STATUS);
  }

  /**
   * Invalidate all customer-related cache
   */
  invalidateCustomer(customerId: number): void {
    this.cache.delete(CacheKeys.CUSTOMER_STATUS(customerId));
    this.cache.delete(CacheKeys.CUSTOMER_LOCKED(customerId));
    this.cache.delete(CacheKeys.CUSTOMER_DELETED(customerId));
    this.cache.delete(CacheKeys.WALLET_STATUS(customerId));
    this.cache.delete(CacheKeys.WALLET_LOCKED(customerId));
  }

  // ============================================================================
  // Device Status
  // ============================================================================

  /**
   * Check if device is active
   */
  isDeviceActive(deviceHash: string): boolean | null {
    return this.cache.get<boolean>(CacheKeys.DEVICE_ACTIVE(deviceHash));
  }

  /**
   * Set device active status
   */
  setDeviceActive(deviceHash: string, active: boolean): void {
    this.cache.set(CacheKeys.DEVICE_ACTIVE(deviceHash), active, CacheTTL.DEVICE_STATUS);
  }

  /**
   * Invalidate device cache
   */
  invalidateDevice(deviceHash: string): void {
    this.cache.delete(CacheKeys.DEVICE_ACTIVE(deviceHash));
  }

  // ============================================================================
  // JWT Blacklist
  // ============================================================================

  /**
   * Check if JWT is blacklisted
   */
  isJwtBlacklisted(customerId: number, deviceHash: string): boolean {
    // Check specific device blacklist
    const deviceBlacklisted = this.cache.get<boolean>(
      CacheKeys.JWT_BLACKLISTED(customerId, deviceHash)
    );
    if (deviceBlacklisted === true) return true;

    // Check customer-wide blacklist (all devices)
    const customerBlacklisted = this.cache.get<boolean>(
      CacheKeys.JWT_BLACKLISTED(customerId, '*')
    );
    return customerBlacklisted === true;
  }

  /**
   * Blacklist JWT for specific customer + device
   */
  blacklistJwt(customerId: number, deviceHash: string, allDevices: boolean = false): void {
    if (allDevices) {
      // Blacklist all devices for this customer
      this.cache.set(
        CacheKeys.JWT_BLACKLISTED(customerId, '*'),
        true,
        CacheTTL.JWT_BLACKLIST
      );
    } else {
      // Blacklist specific device
      this.cache.set(
        CacheKeys.JWT_BLACKLISTED(customerId, deviceHash),
        true,
        CacheTTL.JWT_BLACKLIST
      );
    }
  }

  /**
   * Invalidate JWT blacklist cache for customer
   */
  invalidateJwtBlacklist(customerId: number): void {
    this.cache.deletePattern(`jwt:blacklist:${customerId}:`);
  }

  // ============================================================================
  // Wallet Status
  // ============================================================================

  /**
   * Get wallet status
   */
  getWalletStatus(customerId: number): string | null {
    return this.cache.get<string>(CacheKeys.WALLET_STATUS(customerId));
  }

  /**
   * Set wallet status
   */
  setWalletStatus(customerId: number, status: string): void {
    this.cache.set(CacheKeys.WALLET_STATUS(customerId), status, CacheTTL.WALLET_STATUS);
  }

  /**
   * Check if wallet is locked
   */
  isWalletLocked(customerId: number): boolean | null {
    return this.cache.get<boolean>(CacheKeys.WALLET_LOCKED(customerId));
  }

  /**
   * Set wallet lock status
   */
  setWalletLocked(customerId: number, locked: boolean): void {
    this.cache.set(CacheKeys.WALLET_LOCKED(customerId), locked, CacheTTL.WALLET_STATUS);
  }

  // ============================================================================
  // PIN Status
  // ============================================================================

  /**
   * Check if PIN is locked
   */
  isPinLocked(customerId: number): boolean | null {
    return this.cache.get<boolean>(CacheKeys.PIN_LOCKED(customerId));
  }

  /**
   * Set PIN lock status
   */
  setPinLocked(customerId: number, locked: boolean): void {
    this.cache.set(CacheKeys.PIN_LOCKED(customerId), locked, CacheTTL.PIN_STATUS);
  }

  /**
   * Get PIN failed attempts count
   */
  getPinFailedAttempts(customerId: number): number {
    return this.cache.get<number>(CacheKeys.PIN_FAILED_ATTEMPTS(customerId)) ?? 0;
  }

  /**
   * Set PIN failed attempts count
   */
  setPinFailedAttempts(customerId: number, attempts: number): void {
    this.cache.set(CacheKeys.PIN_FAILED_ATTEMPTS(customerId), attempts, CacheTTL.PIN_STATUS);
  }

  /**
   * Invalidate PIN cache
   */
  invalidatePin(customerId: number): void {
    this.cache.delete(CacheKeys.PIN_LOCKED(customerId));
    this.cache.delete(CacheKeys.PIN_FAILED_ATTEMPTS(customerId));
  }

  // ============================================================================
  // KYC Status
  // ============================================================================

  /**
   * Get KYC application status
   */
  getKycStatus(customerId: number, applicationType: 'primary_kyc' | 'wallet_kyc'): string | null {
    return this.cache.get<string>(CacheKeys.KYC_STATUS(customerId, applicationType));
  }

  /**
   * Set KYC application status
   */
  setKycStatus(customerId: number, applicationType: 'primary_kyc' | 'wallet_kyc', status: string): void {
    this.cache.set(CacheKeys.KYC_STATUS(customerId, applicationType), status, CacheTTL.KYC_STATUS);
  }

  /**
   * Invalidate KYC cache
   */
  invalidateKyc(customerId: number): void {
    this.cache.deletePattern(`kyc:${customerId}:`);
  }

  // ============================================================================
  // Feature Flags
  // ============================================================================

  /**
   * Check if feature is enabled
   */
  isFeatureEnabled(flag: string): boolean {
    return this.cache.get<boolean>(CacheKeys.FEATURE_FLAG(flag)) ?? true;
  }

  /**
   * Set feature flag
   */
  setFeatureFlag(flag: string, enabled: boolean): void {
    this.cache.set(CacheKeys.FEATURE_FLAG(flag), enabled, CacheTTL.FEATURE_FLAG);
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Get cache statistics
   */
  getStats() {
    return this.cache.getStats();
  }

  /**
   * Get cache hit rate
   */
  getHitRate(): number {
    return this.cache.getHitRate();
  }

  /**
   * Clear all cache (use with caution)
   */
  clearAll(): void {
    this.cache.clear();
  }
}

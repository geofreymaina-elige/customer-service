import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';

interface CacheEntry<T> {
  value: T;
  expiresAt: number; // Unix timestamp in milliseconds
}

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  evictions: number;
  size: number;
}

/**
 * Centralized In-Memory Cache Service
 * 
 * Features:
 * - TTL support for automatic expiration
 * - Namespace support for logical separation
 * - Cache statistics for monitoring
 * - Periodic cleanup of expired entries
 * - Easy migration path to Redis
 * 
 * Usage:
 * - Development/Testing: Uses in-memory Map (current)
 * - Production: Can be swapped with Redis implementation
 */
@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly cache = new Map<string, CacheEntry<any>>();
  private cleanupInterval: NodeJS.Timeout | null = null;
  
  // Cache statistics
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    evictions: 0,
    size: 0,
  };

  // Configuration
  private readonly CLEANUP_INTERVAL_MS = 60_000; // Run cleanup every 60 seconds
  private readonly MAX_CACHE_SIZE = 10_000; // Prevent memory overflow
  private readonly DEFAULT_TTL_SECONDS = 60; // Default TTL: 60 seconds

  onModuleInit() {
    this.logger.log('In-Memory Cache Service initialized');
    this.startCleanupJob();
  }

  onModuleDestroy() {
    this.stopCleanupJob();
    this.clear();
    this.logger.log('In-Memory Cache Service destroyed');
  }

  /**
   * Get value from cache
   * @param key Cache key
   * @returns Cached value or null if not found/expired
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.misses++;
      this.stats.evictions++;
      return null;
    }

    this.stats.hits++;
    return entry.value as T;
  }

  /**
   * Set value in cache with TTL
   * @param key Cache key
   * @param value Value to cache
   * @param ttlSeconds Time to live in seconds (default: 60)
   */
  set<T>(key: string, value: T, ttlSeconds: number = this.DEFAULT_TTL_SECONDS): void {
    // Prevent cache from growing too large
    if (this.cache.size >= this.MAX_CACHE_SIZE && !this.cache.has(key)) {
      this.logger.warn(`Cache size limit reached (${this.MAX_CACHE_SIZE}). Skipping set for key: ${key}`);
      return;
    }

    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.cache.set(key, { value, expiresAt });
    this.stats.sets++;
    this.stats.size = this.cache.size;
  }

  /**
   * Delete value from cache
   * @param key Cache key
   * @returns true if deleted, false if not found
   */
  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.stats.deletes++;
      this.stats.size = this.cache.size;
    }
    return deleted;
  }

  /**
   * Check if key exists in cache (and not expired)
   * @param key Cache key
   * @returns true if exists and not expired
   */
  has(key: string): boolean {
    return this.get(key) !== null;
  }

  /**
   * Get or set pattern - fetch from cache or compute and cache
   * @param key Cache key
   * @param fetchFn Function to compute value if not cached
   * @param ttlSeconds TTL in seconds
   * @returns Cached or freshly computed value
   */
  async getOrSet<T>(
    key: string,
    fetchFn: () => Promise<T> | T,
    ttlSeconds: number = this.DEFAULT_TTL_SECONDS
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const value = await fetchFn();
    this.set(key, value, ttlSeconds);
    return value;
  }

  /**
   * Delete all keys matching a pattern
   * @param pattern String to match (simple includes match, not regex)
   * @returns Number of keys deleted
   */
  deletePattern(pattern: string): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
        count++;
      }
    }
    this.stats.deletes += count;
    this.stats.size = this.cache.size;
    return count;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.stats.deletes += size;
    this.stats.size = 0;
    this.logger.log(`Cache cleared: ${size} entries removed`);
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return {
      ...this.stats,
      size: this.cache.size,
    };
  }

  /**
   * Get cache hit rate
   */
  getHitRate(): number {
    const total = this.stats.hits + this.stats.misses;
    return total === 0 ? 0 : (this.stats.hits / total) * 100;
  }

  /**
   * Reset cache statistics (but keep cached data)
   */
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      size: this.cache.size,
    };
  }

  /**
   * Get all keys in cache (for debugging)
   */
  getKeys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Namespaced cache operations
   */
  namespace(namespace: string) {
    return {
      get: <T>(key: string): T | null => this.get(`${namespace}:${key}`),
      set: <T>(key: string, value: T, ttlSeconds?: number) =>
        this.set(`${namespace}:${key}`, value, ttlSeconds),
      delete: (key: string): boolean => this.delete(`${namespace}:${key}`),
      has: (key: string): boolean => this.has(`${namespace}:${key}`),
      getOrSet: <T>(key: string, fetchFn: () => Promise<T> | T, ttlSeconds?: number) =>
        this.getOrSet(`${namespace}:${key}`, fetchFn, ttlSeconds),
      clear: (): number => this.deletePattern(`${namespace}:`),
    };
  }

  /**
   * Start periodic cleanup job to remove expired entries
   */
  private startCleanupJob(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpired();
    }, this.CLEANUP_INTERVAL_MS);
  }

  /**
   * Stop cleanup job
   */
  private stopCleanupJob(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Remove expired entries from cache
   */
  private cleanupExpired(): void {
    const now = Date.now();
    let evicted = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        evicted++;
      }
    }

    if (evicted > 0) {
      this.stats.evictions += evicted;
      this.stats.size = this.cache.size;
      this.logger.debug(`Cleanup: ${evicted} expired entries removed`);
    }
  }
}

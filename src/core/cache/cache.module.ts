import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service';
import { AppCacheService } from './app-cache.service';

/**
 * Global Cache Module
 * 
 * This module is marked as @Global() so CacheService and AppCacheService 
 * are available throughout the application without needing to import 
 * the module in every feature module.
 * 
 * Services:
 * - CacheService: Low-level cache operations (get, set, delete)
 * - AppCacheService: High-level application-specific caching patterns
 * 
 * Migration Path to Redis:
 * 1. Install redis/ioredis package
 * 2. Create RedisCacheService implementing same interface as CacheService
 * 3. Conditionally provide based on environment:
 *    providers: [
 *      {
 *        provide: CacheService,
 *        useClass: process.env.REDIS_URL ? RedisCacheService : CacheService
 *      },
 *      AppCacheService
 *    ]
 */
@Global()
@Module({
  providers: [CacheService, AppCacheService],
  exports: [CacheService, AppCacheService],
})
export class CacheModule {}

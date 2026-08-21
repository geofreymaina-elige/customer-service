# Cache Service Documentation

## Overview

The Cache Service provides an in-memory caching layer for the Customer Management Microservice. It's designed to be easily migrated to Redis when needed.

**Current Implementation:** In-memory Map-based cache
**Future Migration:** Redis-backed cache (same interface)

---

## Architecture

### Services

1. **CacheService** (`cache.service.ts`)
   - Low-level cache operations (get, set, delete, has)
   - TTL support with automatic expiration
   - Periodic cleanup of expired entries
   - Cache statistics and monitoring
   - Namespace support

2. **AppCacheService** (`app-cache.service.ts`)
   - High-level application-specific methods
   - Encapsulates cache key generation
   - Provides domain-specific operations (customer, wallet, JWT, etc.)
   - Recommended for use in feature modules

3. **Cache Keys** (`cache-keys.constants.ts`)
   - Centralized cache key definitions
   - Consistent naming across the application
   - Type-safe key generation functions

---

## Usage Examples

### Basic Usage (Low-level)

```typescript
import { Injectable } from '@nestjs/common';
import { CacheService } from '../core/cache/cache.service';

@Injectable()
export class MyService {
  constructor(private readonly cache: CacheService) {}

  async getData(id: number): Promise<any> {
    // Try to get from cache
    const cached = this.cache.get<any>(`my_data:${id}`);
    if (cached) {
      return cached;
    }

    // Fetch from database
    const data = await this.database.query('SELECT * FROM my_table WHERE id = $1', [id]);

    // Cache for 60 seconds
    this.cache.set(`my_data:${id}`, data, 60);

    return data;
  }
}
```

### Application-level Usage (Recommended)

```typescript
import { Injectable } from '@nestjs/common';
import { AppCacheService } from '../core/cache/app-cache.service';

@Injectable()
export class CustomerService {
  constructor(private readonly appCache: AppCacheService) {}

  async getCustomerStatus(customerId: number): Promise<string> {
    // Check cache first
    const cached = this.appCache.getCustomerStatus(customerId);
    if (cached) {
      return cached;
    }

    // Fetch from database
    const customer = await this.db.queryOne(
      'SELECT status FROM customers WHERE id = $1',
      [customerId]
    );

    // Cache the result
    this.appCache.setCustomerStatus(customerId, customer.status);

    return customer.status;
  }

  async lockCustomer(customerId: number): Promise<void> {
    // Update database
    await this.db.query(
      'UPDATE customers SET status = $1 WHERE id = $2',
      ['suspended', customerId]
    );

    // Invalidate cache so next read fetches fresh data
    this.appCache.invalidateCustomer(customerId);
  }
}
```

### Get-or-Set Pattern

```typescript
import { CacheService } from '../core/cache/cache.service';

async fetchUserProfile(userId: number) {
  return this.cache.getOrSet(
    `user:${userId}:profile`,
    async () => {
      // This function only runs if cache misses
      return await this.db.queryOne('SELECT * FROM users WHERE id = $1', [userId]);
    },
    300 // Cache for 5 minutes
  );
}
```

### Namespace Pattern

```typescript
// Create a namespaced cache for a specific module
const walletCache = this.cache.namespace('wallet');

// All keys will be prefixed with "wallet:"
walletCache.set('123', { balance: 100 }); // Stores as "wallet:123"
walletCache.get('123'); // Retrieves "wallet:123"
walletCache.clear(); // Clears all "wallet:*" keys
```

---

## Common Use Cases

### 1. Customer Status Check (Middleware)

```typescript
import { AppCacheService } from '../core/cache/app-cache.service';

@Injectable()
export class StatusCheckMiddleware {
  constructor(private readonly appCache: AppCacheService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const customerId = req.user.id;

    // Fast cache check (1-2ms)
    const status = this.appCache.getCustomerStatus(customerId);
    
    if (status === 'suspended' || status === 'closed') {
      return res.status(403).json({
        success: false,
        message: 'Account suspended. Contact support.'
      });
    }

    // Check if admin locked
    if (this.appCache.isCustomerLocked(customerId)) {
      return res.status(403).json({
        success: false,
        message: 'Account locked by administrator. Contact support.'
      });
    }

    next();
  }
}
```

### 2. JWT Blacklist Check

```typescript
import { AppCacheService } from '../core/cache/app-cache.service';

async validateJwt(customerId: number, deviceHash: string): Promise<boolean> {
  // Check cache first (fast)
  if (this.appCache.isJwtBlacklisted(customerId, deviceHash)) {
    return false;
  }

  // Cache miss: query database
  const blacklisted = await this.db.queryOne(
    'SELECT 1 FROM jwt_blacklist WHERE customer_id = $1 AND (device_hash IS NULL OR device_hash = $2) AND expires_at > NOW()',
    [customerId, deviceHash]
  );

  if (blacklisted) {
    // Cache the result
    this.appCache.blacklistJwt(customerId, deviceHash);
    return false;
  }

  return true;
}
```

### 3. Maintenance Mode Check

```typescript
import { AppCacheService } from '../core/cache/app-cache.service';

@Injectable()
export class MaintenanceMiddleware {
  constructor(private readonly appCache: AppCacheService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    // Skip maintenance check for health endpoint
    if (req.path === '/health') {
      return next();
    }

    // Fast cache check (cached for 30 seconds)
    if (await this.appCache.isMaintenanceModeEnabled()) {
      const message = this.appCache.getMaintenanceMessage();
      return res.status(503).json({
        success: false,
        message,
        statusCode: 503
      });
    }

    next();
  }
}
```

### 4. Feature Flags

```typescript
import { AppCacheService } from '../core/cache/app-cache.service';

async onboardUserDevice(dto: OnboardUserDeviceDto) {
  // Check if onboarding is enabled
  if (!this.appCache.isFeatureEnabled('onboarding_enabled')) {
    throw new BadRequestException('New customer onboarding is temporarily disabled');
  }

  // Check if wallet KYC is enabled
  if (!this.appCache.isFeatureEnabled('wallet_kyc_enabled')) {
    // Skip wallet KYC flow
  }

  // Proceed with onboarding...
}
```

---

## Cache Invalidation Strategies

### Strategy 1: Time-based (TTL)
Best for: Data that changes infrequently and can tolerate slight staleness.

```typescript
// Cache for 5 minutes
this.cache.set('user:123:profile', userProfile, 300);
```

### Strategy 2: Event-based (Explicit Invalidation)
Best for: Critical data that must be immediately consistent.

```typescript
// When data changes, invalidate cache
async updateCustomerStatus(customerId: number, newStatus: string) {
  await this.db.query('UPDATE customers SET status = $1 WHERE id = $2', [newStatus, customerId]);
  
  // Force next read to fetch from database
  this.appCache.invalidateCustomer(customerId);
}
```

### Strategy 3: Write-through
Best for: Frequently read data that changes often.

```typescript
async updateCustomerStatus(customerId: number, newStatus: string) {
  await this.db.query('UPDATE customers SET status = $1 WHERE id = $2', [newStatus, customerId]);
  
  // Update cache immediately (no database read needed next time)
  this.appCache.setCustomerStatus(customerId, newStatus);
}
```

---

## Monitoring & Debugging

### Get Cache Statistics

```typescript
import { AppCacheService } from '../core/cache/app-cache.service';

async getCacheHealth() {
  const stats = this.appCache.getStats();
  const hitRate = this.appCache.getHitRate();

  return {
    hits: stats.hits,
    misses: stats.misses,
    size: stats.size,
    hitRate: `${hitRate.toFixed(2)}%`,
    evictions: stats.evictions,
  };
}
```

**Example Response:**
```json
{
  "hits": 8523,
  "misses": 1247,
  "size": 342,
  "hitRate": "87.23%",
  "evictions": 89
}
```

### View All Cache Keys (Debugging)

```typescript
import { CacheService } from '../core/cache/cache.service';

constructor(private readonly cache: CacheService) {}

getAllCacheKeys() {
  return this.cache.getKeys();
}
```

---

## Performance Characteristics

| Operation | In-Memory (Current) | Redis (Future) |
|-----------|---------------------|----------------|
| Get (hit) | ~1-2ms | ~2-5ms |
| Get (miss) | ~1ms | ~2ms |
| Set | ~1ms | ~2-3ms |
| Delete | ~1ms | ~2ms |
| Pattern Delete | ~10-50ms | ~10-100ms |

**Memory Usage:**
- Current: ~10-50MB depending on cache size
- Limit: 10,000 entries (configurable in `cache.service.ts`)

---

## Migration to Redis

When ready to migrate to Redis for production:

### Step 1: Install Redis Package

```bash
npm install ioredis @types/ioredis
```

### Step 2: Create Redis Cache Service

```typescript
// src/core/cache/redis-cache.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisCacheService {
  private readonly client: Redis;

  constructor(private readonly config: ConfigService) {
    this.client = new Redis({
      host: this.config.get('REDIS_HOST', 'localhost'),
      port: this.config.get('REDIS_PORT', 6379),
      password: this.config.get('REDIS_PASSWORD'),
      db: this.config.get('REDIS_DB', 0),
    });
  }

  async get<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    return value ? JSON.parse(value) : null;
  }

  async set<T>(key: string, value: T, ttlSeconds: number = 60): Promise<void> {
    await this.client.setex(key, ttlSeconds, JSON.stringify(value));
  }

  async delete(key: string): Promise<boolean> {
    const result = await this.client.del(key);
    return result > 0;
  }

  async has(key: string): Promise<boolean> {
    const exists = await this.client.exists(key);
    return exists === 1;
  }

  // Implement other methods...
}
```

### Step 3: Update Cache Module

```typescript
// src/core/cache/cache.module.ts
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from './cache.service';
import { RedisCacheService } from './redis-cache.service';
import { AppCacheService } from './app-cache.service';

@Global()
@Module({
  providers: [
    {
      provide: CacheService,
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL');
        return redisUrl ? new RedisCacheService(config) : new CacheService();
      },
      inject: [ConfigService],
    },
    AppCacheService,
  ],
  exports: [CacheService, AppCacheService],
})
export class CacheModule {}
```

### Step 4: Update Environment Variables

```bash
# .env
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_password
REDIS_DB=0
```

**No code changes needed in feature modules!** The same `AppCacheService` methods work with both implementations.

---

## Best Practices

1. **Always set TTL** - Never cache data indefinitely
2. **Use AppCacheService** - Higher-level methods are safer and more maintainable
3. **Invalidate on write** - Ensure cache consistency when data changes
4. **Monitor hit rate** - Aim for >80% hit rate for frequently accessed data
5. **Use namespaces** - Keep related cache keys organized
6. **Avoid large values** - Cache metadata, not entire objects if possible
7. **Test with cache disabled** - Ensure application works without cache

---

## Testing

### Unit Tests with Mock Cache

```typescript
import { Test } from '@nestjs/testing';
import { AppCacheService } from '../core/cache/app-cache.service';

describe('CustomerService', () => {
  let service: CustomerService;
  let cacheService: AppCacheService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        CustomerService,
        {
          provide: AppCacheService,
          useValue: {
            getCustomerStatus: jest.fn(),
            setCustomerStatus: jest.fn(),
            invalidateCustomer: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<CustomerService>(CustomerService);
    cacheService = module.get<AppCacheService>(AppCacheService);
  });

  it('should use cached customer status', async () => {
    jest.spyOn(cacheService, 'getCustomerStatus').mockReturnValue('active');
    
    const status = await service.getCustomerStatus(123);
    
    expect(status).toBe('active');
    expect(cacheService.getCustomerStatus).toHaveBeenCalledWith(123);
  });
});
```

---

## Troubleshooting

### Issue: Cache not working

**Check:**
1. Is `CacheModule` imported in `app.module.ts`?
2. Is service injecting `AppCacheService` or `CacheService`?
3. Are keys unique and not conflicting?

### Issue: Memory usage high

**Solution:**
1. Lower `MAX_CACHE_SIZE` in `cache.service.ts`
2. Reduce TTL values
3. Use more aggressive cleanup intervals

### Issue: Stale data

**Solution:**
1. Reduce TTL for that data type
2. Add explicit invalidation on data updates
3. Use write-through caching strategy

---

## Contact & Support

For questions or issues with the cache service, contact the backend team or open an issue in the project repository.

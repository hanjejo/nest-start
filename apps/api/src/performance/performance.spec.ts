import {
  CatalogCacheAdapter,
  catalogCacheKey,
  catalogVersion,
} from './catalog-cache.adapter';
import { DEFAULT_REDIS_OPERATION_TIMEOUT_MS } from './performance.config';
import { FixedWindowRateLimiter } from './fixed-window-rate-limiter';
import { InMemoryPerformanceAdapter } from './in-memory-performance.adapter';
import {
  FixedWindowCounter,
  PerformanceHealth,
  PerformanceStorePort,
} from './performance.types';
import { ResilientPerformanceStore } from './resilient-performance.store';

const config = {
  catalogCacheTtlSeconds: 30,
  rateLimitWindowSeconds: 60,
  rateLimitLimit: 100,
  redisConnectTimeoutMs: 10,
  redisOperationTimeoutMs: DEFAULT_REDIS_OPERATION_TIMEOUT_MS,
  redisRetryCooldownMs: 1,
};

const projection = {
  storeId: 'store-a',
  products: [
    {
      id: 'product-a',
      name: 'Espresso',
      createdAt: new Date('2026-08-02T12:00:00.000Z'),
    },
  ],
};

class FailingPerformanceStore implements PerformanceStorePort {
  async get(): Promise<string | null> {
    throw new Error('Redis unavailable');
  }

  async set(): Promise<void> {
    throw new Error('Redis unavailable');
  }

  async setIfAbsent(): Promise<boolean> {
    throw new Error('Redis unavailable');
  }

  async delete(): Promise<void> {
    throw new Error('Redis unavailable');
  }

  async increment(): Promise<number> {
    throw new Error('Redis unavailable');
  }

  async incrementFixedWindow(): Promise<FixedWindowCounter> {
    throw new Error('Redis unavailable');
  }

  async health(): Promise<PerformanceHealth> {
    return { status: 'unavailable', mode: 'redis' };
  }

  async close(): Promise<void> {
    return undefined;
  }
}

describe('Redis performance layer', () => {
  it('scopes catalog keys by Store ID, version, and generation', () => {
    const first = catalogCacheKey('store-a', 'version-1');
    const otherStore = catalogCacheKey('store-b', 'version-1');
    const otherVersion = catalogCacheKey('store-a', 'version-2');
    const invalidated = catalogCacheKey('store-a', 'version-1', 1);

    expect(new Set([first, otherStore, otherVersion, invalidated]).size).toBe(
      4,
    );
    expect(first).toContain('store-a');
    expect(first).toContain('version-1');
  });

  it('serializes projections and distinguishes cache misses from hits', async () => {
    const store = new InMemoryPerformanceAdapter();
    const cache = new CatalogCacheAdapter(store, config);
    const version = catalogVersion(new Date('2026-08-02T12:00:00.000Z'));

    expect(await cache.get('store-a', version)).toBeNull();
    await cache.set('store-a', version, projection);

    const cached = await cache.get('store-a', version);
    expect(cached).toEqual({
      storeId: 'store-a',
      products: [
        {
          id: 'product-a',
          name: 'Espresso',
          createdAt: '2026-08-02T12:00:00.000Z',
        },
      ],
    });
    expect(await cache.get('store-b', version)).toBeNull();
  });

  it('makes invalidated entries unreachable immediately', async () => {
    const store = new InMemoryPerformanceAdapter();
    const cache = new CatalogCacheAdapter(store, config);

    await cache.set('store-a', 'version-1', projection);
    expect(await cache.get('store-a', 'version-1')).not.toBeNull();

    await cache.invalidate('store-a');

    expect(await cache.get('store-a', 'version-1')).toBeNull();
  });

  it('expires repeated fixed-window rate-limit calls', async () => {
    let now = 0;
    const store = new InMemoryPerformanceAdapter({ now: () => now });
    const limiter = new FixedWindowRateLimiter(store);

    expect(await limiter.consume('user-a', 2, 1)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
    expect(await limiter.consume('user-a', 2, 1)).toMatchObject({
      allowed: true,
      remaining: 0,
    });
    expect(await limiter.consume('user-a', 2, 1)).toMatchObject({
      allowed: false,
      remaining: 0,
    });

    now = 1_000;
    expect(await limiter.consume('user-a', 2, 1)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
  });

  it('falls back to memory when the Redis adapter is unavailable', async () => {
    const store = new ResilientPerformanceStore(
      new FailingPerformanceStore(),
      new InMemoryPerformanceAdapter(),
      config,
    );
    const cache = new CatalogCacheAdapter(store, config);

    await cache.set('store-a', 'version-1', projection);

    expect(await cache.get('store-a', 'version-1')).toEqual({
      storeId: 'store-a',
      products: [
        {
          id: 'product-a',
          name: 'Espresso',
          createdAt: '2026-08-02T12:00:00.000Z',
        },
      ],
    });
    expect(await store.health()).toEqual({
      status: 'unavailable',
      mode: 'memory',
    });
  });
});

import {
  Global,
  Inject,
  Injectable,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import {
  CATALOG_CACHE,
  PERFORMANCE_CONFIG,
  PERFORMANCE_STORE,
  RATE_LIMITER,
} from './performance.constants';
import { loadPerformanceConfig, PerformanceConfig } from './performance.config';
import { CatalogCacheAdapter } from './catalog-cache.adapter';
import { FixedWindowRateLimiter } from './fixed-window-rate-limiter';
import { InMemoryPerformanceAdapter } from './in-memory-performance.adapter';
import { PerformanceStorePort } from './performance.types';
import { RedisPerformanceAdapter } from './redis-performance.adapter';
import { RateLimitGuard } from './rate-limit.guard';
import { ResilientPerformanceStore } from './resilient-performance.store';
import { MetricsService } from '../observability/metrics.service';

export function createPerformanceStore(
  config: PerformanceConfig = loadPerformanceConfig(),
  metrics?: MetricsService,
): PerformanceStorePort {
  const fallback = new InMemoryPerformanceAdapter();
  const primary = config.redisUrl
    ? new RedisPerformanceAdapter({
        url: config.redisUrl,
        connectTimeoutMs: config.redisConnectTimeoutMs,
        operationTimeoutMs: config.redisOperationTimeoutMs,
      })
    : undefined;

  return new ResilientPerformanceStore(primary, fallback, config, metrics);
}

@Injectable()
class PerformanceLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(PERFORMANCE_STORE)
    private readonly performanceStore: PerformanceStorePort,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.performanceStore.close();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: PERFORMANCE_CONFIG,
      useFactory: loadPerformanceConfig,
    },
    {
      provide: PERFORMANCE_STORE,
      useFactory: createPerformanceStore,
      inject: [PERFORMANCE_CONFIG, MetricsService],
    },
    {
      provide: CATALOG_CACHE,
      useClass: CatalogCacheAdapter,
    },
    {
      provide: RATE_LIMITER,
      useClass: FixedWindowRateLimiter,
    },
    RateLimitGuard,
    PerformanceLifecycle,
  ],
  exports: [
    PERFORMANCE_CONFIG,
    PERFORMANCE_STORE,
    CATALOG_CACHE,
    RATE_LIMITER,
    RateLimitGuard,
  ],
})
export class PerformanceModule {}

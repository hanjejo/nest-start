import { randomUUID } from 'node:crypto';
import { PerformanceConfig } from './performance.config';
import {
  FixedWindowCounter,
  PerformanceHealth,
  PerformanceStorePort,
} from './performance.types';
import { MetricsService } from '../observability/metrics.service';

export class ResilientPerformanceStore implements PerformanceStorePort {
  private unavailableUntil = 0;
  private primaryNamespace = 'shared';

  constructor(
    private readonly primary: PerformanceStorePort | undefined,
    private readonly fallback: PerformanceStorePort,
    private readonly config: Pick<
      PerformanceConfig,
      'redisOperationTimeoutMs' | 'redisRetryCooldownMs'
    >,
    private readonly metrics?: MetricsService,
  ) {}

  async get(key: string): Promise<string | null> {
    return this.execute(
      (store) => store.get(this.primaryKey(key)),
      () => this.fallback.get(key),
    );
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.execute(
      (store) => store.set(this.primaryKey(key), value, ttlSeconds),
      () => this.fallback.set(key, value, ttlSeconds),
    );
  }

  async setIfAbsent(
    key: string,
    value: string,
    ttlSeconds?: number,
  ): Promise<boolean> {
    return this.execute(
      (store) => store.setIfAbsent(this.primaryKey(key), value, ttlSeconds),
      () => this.fallback.setIfAbsent(key, value, ttlSeconds),
    );
  }

  async delete(key: string): Promise<void> {
    await this.execute(
      (store) => store.delete(this.primaryKey(key)),
      () => this.fallback.delete(key),
    );
  }

  async increment(key: string): Promise<number> {
    return this.execute(
      (store) => store.increment(this.primaryKey(key)),
      () => this.fallback.increment(key),
    );
  }

  async incrementFixedWindow(
    key: string,
    windowSeconds: number,
  ): Promise<FixedWindowCounter> {
    return this.execute(
      (store) =>
        store.incrementFixedWindow(this.primaryKey(key), windowSeconds),
      () => this.fallback.incrementFixedWindow(key, windowSeconds),
    );
  }

  async health(): Promise<PerformanceHealth> {
    const primary = this.primary;
    if (!primary) {
      this.metrics?.setRedisHealth('disabled');
      return { status: 'disabled', mode: 'memory' };
    }
    if (Date.now() < this.unavailableUntil) {
      this.metrics?.setRedisHealth('degraded');
      return { status: 'unavailable', mode: 'memory' };
    }

    try {
      const health = await this.withTimeout(() => primary.health());
      if (health.status === 'up') {
        this.metrics?.setRedisHealth('up');
        return { status: 'up', mode: 'redis' };
      }
    } catch {
      // Fall through to the documented degraded response.
    }
    this.markUnavailable();
    this.metrics?.setRedisHealth('degraded');
    return { status: 'unavailable', mode: 'memory' };
  }

  async close(): Promise<void> {
    await this.primary?.close().catch(() => undefined);
    await this.fallback.close();
  }

  private async execute<T>(
    operation: (store: PerformanceStorePort) => Promise<T>,
    fallbackOperation: () => Promise<T>,
  ): Promise<T> {
    const primary = this.primary;
    if (!primary || Date.now() < this.unavailableUntil) {
      this.metrics?.recordRedisFallback();
      return fallbackOperation();
    }

    try {
      const result = await this.withTimeout(() => operation(primary));
      this.metrics?.recordRedisHit();
      return result;
    } catch {
      this.markUnavailable();
      this.metrics?.recordRedisError();
      this.metrics?.recordRedisFallback();
      return fallbackOperation();
    }
  }

  private async withTimeout<T>(operation: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error('Performance store operation timed out'));
      }, this.config.redisOperationTimeoutMs);
    });

    try {
      return await Promise.race([operation(), timeout]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  private markUnavailable(): void {
    this.unavailableUntil = Date.now() + this.config.redisRetryCooldownMs;
    this.primaryNamespace = `fallback:${randomUUID()}`;
  }

  private primaryKey(key: string): string {
    return `${this.primaryNamespace}:${key}`;
  }
}

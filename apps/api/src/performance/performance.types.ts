export type PerformanceHealth = Readonly<{
  status: 'up' | 'unavailable' | 'disabled';
  mode: 'redis' | 'memory';
}>;

export type FixedWindowCounter = Readonly<{
  count: number;
  resetAt: number;
}>;

export type RateLimitDecision = Readonly<{
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}>;

export interface PerformanceStorePort {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  setIfAbsent(
    key: string,
    value: string,
    ttlSeconds?: number,
  ): Promise<boolean>;
  delete(key: string): Promise<void>;
  increment(key: string): Promise<number>;
  incrementFixedWindow(
    key: string,
    windowSeconds: number,
  ): Promise<FixedWindowCounter>;
  health(): Promise<PerformanceHealth>;
  close(): Promise<void>;
}

export interface CatalogBrowseProjection {
  storeId: string;
  products: Array<Record<string, unknown>>;
}

export interface CatalogCachePort {
  get(
    storeId: string,
    catalogVersion: string,
  ): Promise<CatalogBrowseProjection | null>;
  set(
    storeId: string,
    catalogVersion: string,
    projection: CatalogBrowseProjection,
  ): Promise<void>;
  invalidate(storeId: string): Promise<void>;
}

export interface RateLimitPort {
  consume(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitDecision>;
}

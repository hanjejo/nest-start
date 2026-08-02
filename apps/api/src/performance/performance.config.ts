export const DEFAULT_CATALOG_CACHE_TTL_SECONDS = 30;
export const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 60;
export const DEFAULT_RATE_LIMIT_LIMIT = 100;
export const DEFAULT_REDIS_CONNECT_TIMEOUT_MS = 250;
export const DEFAULT_REDIS_OPERATION_TIMEOUT_MS = 500;
export const DEFAULT_REDIS_RETRY_COOLDOWN_MS = 5_000;

export type PerformanceConfig = Readonly<{
  redisUrl?: string;
  catalogCacheTtlSeconds: number;
  rateLimitWindowSeconds: number;
  rateLimitLimit: number;
  redisConnectTimeoutMs: number;
  redisOperationTimeoutMs: number;
  redisRetryCooldownMs: number;
}>;

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadPerformanceConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PerformanceConfig {
  return {
    redisUrl: environment.REDIS_URL?.trim() || undefined,
    catalogCacheTtlSeconds: positiveInteger(
      environment.CATALOG_CACHE_TTL_SECONDS,
      DEFAULT_CATALOG_CACHE_TTL_SECONDS,
    ),
    rateLimitWindowSeconds: positiveInteger(
      environment.RATE_LIMIT_WINDOW_SECONDS,
      DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
    ),
    rateLimitLimit: positiveInteger(
      environment.RATE_LIMIT_LIMIT,
      DEFAULT_RATE_LIMIT_LIMIT,
    ),
    redisConnectTimeoutMs: positiveInteger(
      environment.REDIS_CONNECT_TIMEOUT_MS,
      DEFAULT_REDIS_CONNECT_TIMEOUT_MS,
    ),
    redisOperationTimeoutMs: positiveInteger(
      environment.REDIS_OPERATION_TIMEOUT_MS,
      DEFAULT_REDIS_OPERATION_TIMEOUT_MS,
    ),
    redisRetryCooldownMs: positiveInteger(
      environment.REDIS_RETRY_COOLDOWN_MS,
      DEFAULT_REDIS_RETRY_COOLDOWN_MS,
    ),
  };
}

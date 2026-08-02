import { Inject, Injectable } from '@nestjs/common';
import { PERFORMANCE_STORE } from './performance.constants';
import {
  PerformanceStorePort,
  RateLimitDecision,
  RateLimitPort,
} from './performance.types';

@Injectable()
export class FixedWindowRateLimiter implements RateLimitPort {
  constructor(
    @Inject(PERFORMANCE_STORE)
    private readonly store: PerformanceStorePort,
  ) {}

  async consume(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitDecision> {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error('Rate-limit limit must be a positive integer');
    }
    if (!Number.isInteger(windowSeconds) || windowSeconds <= 0) {
      throw new Error('Rate-limit window must be a positive integer');
    }

    const counter = await this.store.incrementFixedWindow(
      `rate-limit:${key}`,
      windowSeconds,
    );
    return {
      allowed: counter.count <= limit,
      limit,
      remaining: Math.max(0, limit - counter.count),
      resetAt: counter.resetAt,
    };
  }
}

import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Reflector } from '@nestjs/core';
import {
  PERFORMANCE_CONFIG,
  RATE_LIMITER,
  RATE_LIMIT_OPTIONS,
} from './performance.constants';
import { PerformanceConfig } from './performance.config';
import { RateLimitOptions } from './rate-limit.decorator';
import { RateLimitDecision, RateLimitPort } from './performance.types';

type RateLimitedRequest = Request & {
  user?: {
    sub?: string;
  };
};

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(RATE_LIMITER) private readonly rateLimiter: RateLimitPort,
    @Inject(PERFORMANCE_CONFIG)
    private readonly config: PerformanceConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const configured = this.reflector.getAllAndOverride<
      RateLimitOptions | undefined
    >(RATE_LIMIT_OPTIONS, [context.getHandler(), context.getClass()]);
    if (!configured) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RateLimitedRequest>();
    const identity = this.identity(request);
    const key = `${configured.key}:${identity}`;
    const limit = configured.limit ?? this.config.rateLimitLimit;
    const windowSeconds =
      configured.windowSeconds ?? this.config.rateLimitWindowSeconds;

    let decision: RateLimitDecision;
    try {
      decision = await this.rateLimiter.consume(key, limit, windowSeconds);
      const response = context.switchToHttp().getResponse<Response>();
      response.setHeader('X-RateLimit-Limit', String(decision.limit));
      response.setHeader('X-RateLimit-Remaining', String(decision.remaining));
      response.setHeader(
        'X-RateLimit-Reset',
        String(Math.ceil(decision.resetAt / 1_000)),
      );

      if (!decision.allowed) {
        throw new HttpException(
          'Rate limit exceeded',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      return true;
    } catch (error) {
      if (
        error instanceof HttpException &&
        error.getStatus() === HttpStatus.TOO_MANY_REQUESTS
      ) {
        throw error;
      }
      // Redis is non-authoritative; an unavailable limiter fails open.
      return true;
    }
  }

  private identity(request: RateLimitedRequest): string {
    const userId = request.user?.sub;
    if (userId) {
      return `user:${userId}`;
    }
    return `ip:${request.ip ?? request.socket.remoteAddress ?? 'unknown'}`;
  }
}

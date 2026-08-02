import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { normalizeMetricRoute, MetricsService } from './metrics.service';

type RoutedRequest = Request & {
  route?: {
    path?: string | string[];
  };
};

function routeFor(request: RoutedRequest): string {
  const path = request.route?.path;
  const route = Array.isArray(path) ? path[0] : path;
  return normalizeMetricRoute(route);
}

@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();
    response.once('finish', () => {
      const durationMilliseconds =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      this.metrics.observeHttp(
        request.method,
        routeFor(request as RoutedRequest),
        response.statusCode,
        durationMilliseconds,
      );
    });
    next();
  }
}

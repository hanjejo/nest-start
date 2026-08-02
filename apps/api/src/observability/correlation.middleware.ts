import type { NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import {
  correlationIdFromHeader,
  CORRELATION_ID_HEADER,
  generateCorrelationId,
  runWithCorrelationContext,
} from './correlation-context';

type CorrelationRequest = Request & {
  correlationId?: string;
};

export class CorrelationMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const correlatedRequest = request as CorrelationRequest;
    const correlationId =
      correlatedRequest.correlationId ??
      correlationIdFromHeader(request.headers[CORRELATION_ID_HEADER]) ??
      generateCorrelationId();
    correlatedRequest.correlationId = correlationId;
    response.setHeader(CORRELATION_ID_HEADER, correlationId);

    return runWithCorrelationContext(
      {
        correlationId,
        causationId: null,
      },
      () => next(),
    );
  }
}

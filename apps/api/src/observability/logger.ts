import { isSpanContextValid, trace } from '@opentelemetry/api';
import type { IncomingMessage, ServerResponse } from 'node:http';
import pino from 'pino';
import type { LoggerOptions } from 'pino';
import type { Options as PinoHttpOptions } from 'pino-http';
import {
  correlationIdFromHeader,
  CORRELATION_ID_HEADER,
  generateCorrelationId,
  getCorrelationContext,
} from './correlation-context';
import { loadObservabilityConfig } from './observability.config';

type CorrelatedRequest = IncomingMessage & {
  correlationId?: string;
  route?: {
    path?: string | string[];
  };
};

export type LogContextFields = Readonly<{
  traceId: string | null;
  spanId: string | null;
  correlationId: string | null;
  causationId: string | null;
}>;

const REDACTED = '[REDACTED]';

export const REDACT_PATHS = [
  'authorization',
  'cookie',
  'cookies',
  'headers.authorization',
  'headers.cookie',
  'headers["set-cookie"]',
  'headers["x-api-key"]',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'req.headers["x-api-key"]',
  'password',
  'passwordHash',
  'refreshToken',
  'accessToken',
  'idToken',
  'token',
  'secret',
  'apiKey',
  'clientSecret',
  'databaseUrl',
  'connectionString',
  'paymentMethod',
  'cardNumber',
  'cardExpiry',
  'cvv',
  'cvc',
  'securityCode',
  'pan',
  'iban',
  'bankAccount',
  'routingNumber',
  'email',
  'phone',
  'address',
  'addressSnapshot',
  'deliveryAddress',
  'billingAddress',
  'name',
  'userId',
  'customerId',
  'orderId',
  'storeId',
  'productId',
  'paymentIntentId',
  'deliveryId',
  'settlementId',
  'body.password',
  'body.email',
  'body.phone',
  'body.address',
  'body.name',
  'req.body.password',
  'req.body.email',
  'req.body.phone',
  'req.body.address',
  'req.body.name',
  'payload.email',
  'payload.phone',
  'payload.address',
  'payload.name',
  '*.password',
  '*.passwordHash',
  '*.refreshToken',
  '*.accessToken',
  '*.idToken',
  '*.token',
  '*.secret',
  '*.apiKey',
  '*.clientSecret',
  '*.cardNumber',
  '*.cardExpiry',
  '*.cvv',
  '*.cvc',
  '*.securityCode',
  '*.pan',
  '*.iban',
  '*.bankAccount',
  '*.routingNumber',
  '*.address',
  '*.addressSnapshot',
  '*.deliveryAddress',
  '*.billingAddress',
] as const;

function requestFrom(value: unknown): CorrelatedRequest {
  return value as CorrelatedRequest;
}

function routeName(request: CorrelatedRequest): string {
  const path = request.route?.path;
  const value = Array.isArray(path) ? path[0] : path;
  if (typeof value !== 'string' || !value.trim()) {
    return 'unknown';
  }

  return value
    .replace(/[?].*$/, '')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
    .slice(0, 96);
}

export function getActiveTraceFields(): Pick<
  LogContextFields,
  'traceId' | 'spanId'
> {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext || !isSpanContextValid(spanContext)) {
    return {
      traceId: null,
      spanId: null,
    };
  }

  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
  };
}

export function getLogContextFields(
  requestCorrelationId?: string,
): LogContextFields {
  const context = getCorrelationContext();
  const traceFields = getActiveTraceFields();
  return {
    ...traceFields,
    correlationId: requestCorrelationId ?? context?.correlationId ?? null,
    causationId: context?.causationId ?? null,
  };
}

function createRequestId(request: IncomingMessage): string {
  const correlatedRequest = requestFrom(request);
  const headerValue = correlatedRequest.headers?.[CORRELATION_ID_HEADER];
  const correlationId =
    correlationIdFromHeader(headerValue) ?? generateCorrelationId();
  correlatedRequest.correlationId = correlationId;
  return correlationId;
}

function serializeRequest(request: IncomingMessage) {
  const correlatedRequest = requestFrom(request);
  return {
    method: correlatedRequest.method,
    route: routeName(correlatedRequest),
    correlationId: correlatedRequest.correlationId ?? null,
  };
}

function serializeResponse(response: ServerResponse) {
  return {
    statusCode: response.statusCode,
  };
}

export function createPinoLoggerOptions(): LoggerOptions {
  const config = loadObservabilityConfig();
  return {
    level:
      process.env.PINO_LOG_LEVEL ??
      (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
    base: {
      service: config.serviceName,
      version: config.serviceVersion,
    },
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    mixin: () => getLogContextFields(),
    redact: {
      paths: [...REDACT_PATHS],
      censor: REDACTED,
    },
    serializers: {
      req: serializeRequest,
      res: serializeResponse,
    },
  };
}

export function createPinoHttpOptions(): PinoHttpOptions {
  const loggerOptions = createPinoLoggerOptions();
  return {
    ...loggerOptions,
    genReqId: (request) => createRequestId(request),
    customProps: (request) => {
      const correlatedRequest = requestFrom(request);
      return getLogContextFields(correlatedRequest.correlationId);
    },
  };
}

export function createPinoLogger(
  destination?: pino.DestinationStream,
): pino.Logger {
  return pino(createPinoLoggerOptions(), destination);
}

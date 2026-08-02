import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export const CORRELATION_ID_HEADER = 'x-correlation-id';
export const MAX_CORRELATION_ID_LENGTH = 128;

const SAFE_CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type CorrelationContext = Readonly<{
  correlationId: string;
  causationId: string | null;
}>;

const correlationStorage = new AsyncLocalStorage<CorrelationContext>();

export function generateCorrelationId(): string {
  return randomUUID();
}

export function isValidCorrelationId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_CORRELATION_ID_LENGTH &&
    SAFE_CORRELATION_ID.test(value)
  );
}

export function normalizeCorrelationId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return isValidCorrelationId(normalized) ? normalized : undefined;
}

export function correlationIdFromHeader(value: unknown): string | undefined {
  return normalizeCorrelationId(Array.isArray(value) ? undefined : value);
}

export function getCorrelationContext(): CorrelationContext | undefined {
  return correlationStorage.getStore();
}

export function getCorrelationId(): string | undefined {
  return getCorrelationContext()?.correlationId;
}

export function runWithCorrelationContext<T>(
  context: CorrelationContext,
  callback: () => T,
): T {
  return correlationStorage.run(context, callback);
}

export function withCorrelationContext(
  correlationId: string,
  causationId: string | null = null,
): CorrelationContext {
  if (!isValidCorrelationId(correlationId)) {
    throw new TypeError('Correlation ID must be a bounded safe identifier');
  }

  return {
    correlationId,
    causationId,
  };
}

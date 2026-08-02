import { randomUUID } from 'node:crypto';
import {
  generateCorrelationId,
  getCorrelationContext,
  normalizeCorrelationId,
} from '../observability/correlation-context';

export type IntegrationEventPayload = Record<string, unknown>;

export type IntegrationEventEnvelope<
  TPayload extends IntegrationEventPayload = IntegrationEventPayload,
> = Readonly<{
  eventId: string;
  idempotencyKey: string;
  eventType: string;
  eventVersion: number;
  occurredAt: string;
  producer: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number | null;
  correlationId: string;
  causationId: string | null;
  payload: Readonly<TPayload>;
}>;

export type NewIntegrationEvent<
  TPayload extends IntegrationEventPayload = IntegrationEventPayload,
> = Omit<
  IntegrationEventEnvelope<TPayload>,
  'eventId' | 'idempotencyKey' | 'occurredAt' | 'causationId' | 'correlationId'
> & {
  eventId?: string;
  idempotencyKey?: string;
  occurredAt?: Date | string;
  correlationId?: string;
  causationId?: string | null;
};

function freeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  for (const nestedValue of Object.values(value)) {
    freeze(nestedValue);
  }

  return Object.freeze(value);
}

function normalizeTimestamp(value: Date | string | undefined): string {
  const timestamp =
    value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(timestamp.getTime())) {
    throw new TypeError(
      'Integration event occurredAt must be a valid timestamp',
    );
  }
  return timestamp.toISOString();
}

function requiredText(value: string | undefined, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`Integration event ${field} is required`);
  }
  return value;
}

function resolveCorrelationId(value: string | undefined): string {
  if (value !== undefined) {
    const normalized = normalizeCorrelationId(value);
    if (!normalized) {
      throw new TypeError(
        'Integration event correlationId must be a bounded safe identifier',
      );
    }
    return normalized;
  }

  return getCorrelationContext()?.correlationId ?? generateCorrelationId();
}

export function createIntegrationEvent<
  TPayload extends IntegrationEventPayload,
>(input: NewIntegrationEvent<TPayload>): IntegrationEventEnvelope<TPayload> {
  if (!Number.isSafeInteger(input.eventVersion) || input.eventVersion < 1) {
    throw new TypeError(
      'Integration event eventVersion must be a positive integer',
    );
  }
  if (
    input.aggregateVersion !== null &&
    input.aggregateVersion !== undefined &&
    (!Number.isSafeInteger(input.aggregateVersion) ||
      input.aggregateVersion < 1)
  ) {
    throw new TypeError(
      'Integration event aggregateVersion must be a positive integer or null',
    );
  }

  const eventId = input.eventId ?? randomUUID();
  const idempotencyKey = input.idempotencyKey ?? eventId;
  const envelope = {
    eventId: requiredText(eventId, 'eventId'),
    idempotencyKey: requiredText(idempotencyKey, 'idempotencyKey'),
    eventType: requiredText(input.eventType, 'eventType'),
    eventVersion: input.eventVersion,
    occurredAt: normalizeTimestamp(input.occurredAt),
    producer: requiredText(input.producer, 'producer'),
    aggregateType: requiredText(input.aggregateType, 'aggregateType'),
    aggregateId: requiredText(input.aggregateId, 'aggregateId'),
    aggregateVersion: input.aggregateVersion ?? null,
    correlationId: resolveCorrelationId(input.correlationId),
    causationId:
      input.causationId === undefined
        ? (getCorrelationContext()?.causationId ?? null)
        : input.causationId,
    payload: input.payload,
  } satisfies IntegrationEventEnvelope<TPayload>;

  if (
    typeof envelope.payload !== 'object' ||
    envelope.payload === null ||
    Array.isArray(envelope.payload)
  ) {
    throw new TypeError('Integration event payload must be an object');
  }

  return freeze(envelope);
}

export function eventToJson(event: IntegrationEventEnvelope): string {
  return JSON.stringify(event);
}

export function eventFromJson(value: string): IntegrationEventEnvelope {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('Integration event must be a JSON object');
  }

  const event = parsed as Partial<IntegrationEventEnvelope>;
  return createIntegrationEvent({
    eventId: event.eventId,
    idempotencyKey: event.idempotencyKey,
    eventType: event.eventType ?? '',
    eventVersion: event.eventVersion ?? 0,
    occurredAt: event.occurredAt,
    producer: event.producer ?? '',
    aggregateType: event.aggregateType ?? '',
    aggregateId: event.aggregateId ?? '',
    aggregateVersion: event.aggregateVersion,
    correlationId: event.correlationId ?? '',
    causationId: event.causationId,
    payload: event.payload as IntegrationEventPayload,
  });
}

import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DRIZZLE, DrizzleDB } from '../db/drizzle.module';
import {
  deadLetterEvents,
  outboxEvents,
  OutboxEvent,
  OutboxStatus,
} from '../db/schema';
import {
  IntegrationEventEnvelope,
  NewIntegrationEvent,
  createIntegrationEvent,
} from './integration-event';
import {
  DEFAULT_RETRY_POLICY,
  RetryPolicy,
  retryDelayMs,
} from './messaging.constants';
import { safeFailureReason } from './failure';
import { MetricsService } from '../observability/metrics.service';

export type DrizzleTransaction = Parameters<
  Parameters<DrizzleDB['transaction']>[0]
>[0];

export type OutboxWork<T> = (tx: DrizzleTransaction) => Promise<T>;

export type PublishFailureResult = Readonly<{
  attempts: number;
  deadLettered: boolean;
  nextAttemptAt: Date | null;
  reason: string;
}>;

function eventValues(event: IntegrationEventEnvelope) {
  return {
    eventId: event.eventId,
    idempotencyKey: event.idempotencyKey,
    eventType: event.eventType,
    eventVersion: event.eventVersion,
    occurredAt: new Date(event.occurredAt),
    producer: event.producer,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    aggregateVersion: event.aggregateVersion,
    correlationId: event.correlationId,
    causationId: event.causationId,
    payload: event.payload,
  };
}

@Injectable()
export class OutboxService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  createEvent<TPayload extends Record<string, unknown>>(
    input: NewIntegrationEvent<TPayload>,
  ): IntegrationEventEnvelope<TPayload> {
    return createIntegrationEvent(input);
  }

  transaction<T>(work: OutboxWork<T>): Promise<T> {
    return this.db.transaction(work);
  }

  async enqueue(
    tx: DrizzleTransaction,
    event: IntegrationEventEnvelope,
  ): Promise<OutboxEvent> {
    const [inserted] = await tx
      .insert(outboxEvents)
      .values(eventValues(event))
      .onConflictDoNothing({ target: outboxEvents.idempotencyKey })
      .returning();

    if (inserted) {
      return inserted;
    }

    const [existing] = await tx
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.idempotencyKey, event.idempotencyKey))
      .limit(1);
    if (!existing) {
      throw new Error('Outbox event disappeared after an idempotency conflict');
    }
    if (
      existing.eventId !== event.eventId ||
      existing.eventType !== event.eventType ||
      existing.eventVersion !== event.eventVersion ||
      JSON.stringify(existing.payload) !== JSON.stringify(event.payload)
    ) {
      throw new Error(
        `Outbox idempotency key ${event.idempotencyKey} was reused for a different event`,
      );
    }
    return existing;
  }

  async pending(limit = 100, now = new Date()): Promise<OutboxEvent[]> {
    const events = await this.db
      .select()
      .from(outboxEvents)
      .where(
        or(
          eq(outboxEvents.status, 'PENDING'),
          and(
            eq(outboxEvents.status, 'FAILED'),
            or(
              isNull(outboxEvents.nextAttemptAt),
              lte(outboxEvents.nextAttemptAt, now),
            ),
          ),
        ),
      )
      .orderBy(asc(outboxEvents.createdAt), asc(outboxEvents.eventId))
      .limit(limit);
    const oldest = events[0]?.createdAt;
    this.metrics?.setOutboxBacklog(
      events.length,
      oldest ? Math.max(0, now.getTime() - oldest.getTime()) / 1_000 : 0,
    );
    return events;
  }

  async markPublished(
    eventId: string,
    publishedAt = new Date(),
  ): Promise<void> {
    await this.db
      .update(outboxEvents)
      .set({
        status: 'PUBLISHED',
        attempts: sql`${outboxEvents.attempts} + 1`,
        publishedAt,
        nextAttemptAt: null,
        lastError: null,
        updatedAt: publishedAt,
      })
      .where(eq(outboxEvents.eventId, eventId));
  }

  async recordPublishFailure(
    eventId: string,
    error: unknown,
    policy: RetryPolicy = DEFAULT_RETRY_POLICY,
    failedAt = new Date(),
  ): Promise<PublishFailureResult> {
    const reason = safeFailureReason(error);
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.eventId, eventId))
        .limit(1);
      if (!current) {
        throw new Error(`Outbox event ${eventId} was not found`);
      }

      const attempts = current.attempts + 1;
      const deadLettered = attempts >= policy.maxAttempts;
      const nextAttemptAt = deadLettered
        ? null
        : new Date(failedAt.getTime() + retryDelayMs(attempts, policy));
      const status: OutboxStatus = deadLettered ? 'DEAD_LETTERED' : 'FAILED';
      this.metrics?.recordOutboxPublishFailure();
      if (deadLettered) {
        this.metrics?.recordOutboxDeadLettered();
      }

      await tx
        .update(outboxEvents)
        .set({
          status,
          attempts,
          nextAttemptAt,
          lastError: reason,
          updatedAt: failedAt,
        })
        .where(eq(outboxEvents.eventId, eventId));

      if (deadLettered) {
        await this.insertDeadLetter(tx, current, attempts, reason, failedAt);
      }

      return {
        attempts,
        deadLettered,
        nextAttemptAt,
        reason,
      };
    });
  }

  private async insertDeadLetter(
    tx: DrizzleTransaction,
    event: OutboxEvent,
    attempts: number,
    reason: string,
    failedAt: Date,
  ): Promise<void> {
    const [existing] = await tx
      .select({ id: deadLetterEvents.id })
      .from(deadLetterEvents)
      .where(
        and(
          eq(deadLetterEvents.source, 'OUTBOX'),
          eq(deadLetterEvents.eventId, event.eventId),
          isNull(deadLetterEvents.consumerName),
        ),
      )
      .limit(1);
    if (existing) {
      return;
    }

    await tx.insert(deadLetterEvents).values({
      id: randomUUID(),
      source: 'OUTBOX',
      consumerName: null,
      eventId: event.eventId,
      idempotencyKey: event.idempotencyKey,
      eventType: event.eventType,
      eventVersion: event.eventVersion,
      occurredAt: event.occurredAt,
      producer: event.producer,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      aggregateVersion: event.aggregateVersion,
      correlationId: event.correlationId,
      causationId: event.causationId,
      payload: event.payload,
      attempts,
      reason,
      failedAt,
    });
  }
}

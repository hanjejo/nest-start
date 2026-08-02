import { Inject, Injectable } from '@nestjs/common';
import { and, eq, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DRIZZLE, DrizzleDB } from '../db/drizzle.module';
import { deadLetterEvents, inboxEvents } from '../db/schema';
import { safeFailureReason } from './failure';
import {
  DEFAULT_RETRY_POLICY,
  INTEGRATION_EVENT_TRANSPORT,
  RetryPolicy,
  retryDelayMs,
} from './messaging.constants';
import { IntegrationEventEnvelope } from './integration-event';
import {
  IntegrationEventDelivery,
  IntegrationEventTransport,
} from './messaging.transport';
import { DrizzleTransaction } from './outbox.service';

export type InboxEffectResult = Readonly<{
  afterCommit?: () => Promise<void>;
}>;

export type InboxEffect = (
  event: IntegrationEventEnvelope,
  tx: DrizzleTransaction,
) => Promise<void | InboxEffectResult>;

export type InboxProcessingResult = Readonly<{
  status: 'PROCESSED' | 'DUPLICATE' | 'RETRY' | 'DEAD_LETTERED';
  attempts: number;
  delayMs: number | null;
  reason: string | null;
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
export class InboxService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Inject(INTEGRATION_EVENT_TRANSPORT)
    private readonly transport: IntegrationEventTransport,
  ) {}

  async process(
    event: IntegrationEventEnvelope,
    consumerName: string,
    effect: InboxEffect,
    policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  ): Promise<InboxProcessingResult> {
    const normalizedConsumerName = this.normalizeConsumerName(consumerName);
    let attempts = 0;
    let duplicate = false;
    let inboxEventId: string | undefined;
    let afterCommit: (() => Promise<void>) | undefined;

    try {
      await this.db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(inboxEvents)
          .where(
            and(
              eq(inboxEvents.consumerName, normalizedConsumerName),
              or(
                eq(inboxEvents.eventId, event.eventId),
                eq(inboxEvents.idempotencyKey, event.idempotencyKey),
              ),
            ),
          )
          .limit(1);

        if (existing?.status === 'PROCESSED') {
          attempts = existing.attempts;
          duplicate = true;
          return;
        }
        if (existing?.status === 'DEAD_LETTERED') {
          attempts = existing.attempts;
          duplicate = true;
          return;
        }

        attempts = (existing?.attempts ?? 0) + 1;
        if (existing) {
          inboxEventId = existing.id;
          await tx
            .update(inboxEvents)
            .set({
              status: 'PROCESSING',
              attempts,
              nextAttemptAt: null,
              lastError: null,
              updatedAt: new Date(),
            })
            .where(eq(inboxEvents.id, existing.id));
        } else {
          inboxEventId = randomUUID();
          await tx.insert(inboxEvents).values({
            id: inboxEventId,
            consumerName: normalizedConsumerName,
            ...eventValues(event),
            status: 'PROCESSING',
            attempts,
            receivedAt: new Date(),
          });
        }

        const effectResult = await effect(event, tx);
        if (effectResult) {
          afterCommit = effectResult.afterCommit;
        }

        const processedAt = new Date();
        if (!inboxEventId) {
          throw new Error('Inbox event identity was not recorded');
        }
        await tx
          .update(inboxEvents)
          .set({
            status: 'PROCESSED',
            processedAt,
            nextAttemptAt: null,
            lastError: null,
            updatedAt: processedAt,
          })
          .where(eq(inboxEvents.id, inboxEventId));
      });
    } catch (error) {
      try {
        return await this.recordFailure(
          event,
          normalizedConsumerName,
          error,
          policy,
        );
      } catch {
        throw error;
      }
    }

    if (afterCommit) {
      try {
        await afterCommit();
      } catch (error) {
        return this.recordFailure(
          event,
          normalizedConsumerName,
          error,
          policy,
          true,
        );
      }
    }

    const [existing] = await this.db
      .select({ status: inboxEvents.status, attempts: inboxEvents.attempts })
      .from(inboxEvents)
      .where(
        and(
          eq(inboxEvents.consumerName, normalizedConsumerName),
          or(
            eq(inboxEvents.eventId, event.eventId),
            eq(inboxEvents.idempotencyKey, event.idempotencyKey),
          ),
        ),
      )
      .limit(1);

    if (existing?.status === 'DEAD_LETTERED') {
      return {
        status: 'DEAD_LETTERED',
        attempts: existing.attempts,
        delayMs: null,
        reason: null,
      };
    }
    if (existing?.status === 'PROCESSED') {
      return {
        status: duplicate ? 'DUPLICATE' : 'PROCESSED',
        attempts: existing.attempts,
        delayMs: null,
        reason: null,
      };
    }

    return {
      status: 'PROCESSED',
      attempts,
      delayMs: null,
      reason: null,
    };
  }

  async processDelivery(
    delivery: IntegrationEventDelivery,
    consumerName: string,
    effect: InboxEffect,
    policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  ): Promise<InboxProcessingResult> {
    const result = await this.process(
      delivery.envelope,
      consumerName,
      effect,
      policy,
    );

    if (result.status === 'RETRY') {
      await this.transport.retry(
        delivery,
        result.delayMs ?? retryDelayMs(result.attempts, policy),
        result.attempts,
      );
      await this.transport.acknowledge(delivery);
      return result;
    }

    if (result.status === 'DEAD_LETTERED') {
      await this.transport.deadLetter(
        delivery,
        result.reason ?? 'Integration event retry limit exceeded',
      );
      await this.transport.acknowledge(delivery);
      return result;
    }

    await this.transport.acknowledge(delivery);
    return result;
  }

  private async recordFailure(
    event: IntegrationEventEnvelope,
    consumerName: string,
    error: unknown,
    policy: RetryPolicy,
    retryProcessed = false,
  ): Promise<InboxProcessingResult> {
    const reason = safeFailureReason(error);
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(inboxEvents)
        .where(
          and(
            eq(inboxEvents.consumerName, consumerName),
            or(
              eq(inboxEvents.eventId, event.eventId),
              eq(inboxEvents.idempotencyKey, event.idempotencyKey),
            ),
          ),
        )
        .limit(1);

      if (existing?.status === 'PROCESSED' && !retryProcessed) {
        return {
          status: 'DUPLICATE',
          attempts: existing.attempts,
          delayMs: null,
          reason: null,
        };
      }

      const attempts = (existing?.attempts ?? 0) + 1;
      const deadLettered = attempts >= policy.maxAttempts;
      const delayMs = deadLettered ? null : retryDelayMs(attempts, policy);
      const nextAttemptAt = deadLettered
        ? null
        : new Date(Date.now() + delayMs);
      const status = deadLettered ? 'DEAD_LETTERED' : 'FAILED';

      if (existing) {
        await tx
          .update(inboxEvents)
          .set({
            status,
            attempts,
            nextAttemptAt,
            lastError: reason,
            updatedAt: new Date(),
          })
          .where(eq(inboxEvents.id, existing.id));
      } else {
        await tx.insert(inboxEvents).values({
          id: randomUUID(),
          consumerName,
          ...eventValues(event),
          status,
          attempts,
          nextAttemptAt,
          lastError: reason,
          receivedAt: new Date(),
        });
      }

      if (deadLettered) {
        await this.insertDeadLetter(tx, event, consumerName, attempts, reason);
      }

      return {
        status: deadLettered ? 'DEAD_LETTERED' : 'RETRY',
        attempts,
        delayMs,
        reason,
      };
    });
  }

  private async insertDeadLetter(
    tx: DrizzleTransaction,
    event: IntegrationEventEnvelope,
    consumerName: string,
    attempts: number,
    reason: string,
  ): Promise<void> {
    const [existing] = await tx
      .select({ id: deadLetterEvents.id })
      .from(deadLetterEvents)
      .where(
        and(
          eq(deadLetterEvents.source, 'INBOX'),
          eq(deadLetterEvents.consumerName, consumerName),
          eq(deadLetterEvents.eventId, event.eventId),
        ),
      )
      .limit(1);
    if (existing) {
      return;
    }

    await tx.insert(deadLetterEvents).values({
      id: randomUUID(),
      source: 'INBOX',
      consumerName,
      ...eventValues(event),
      attempts,
      reason,
    });
  }

  private normalizeConsumerName(value: string): string {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      throw new TypeError('Inbox consumer name is required');
    }
    return normalized;
  }
}

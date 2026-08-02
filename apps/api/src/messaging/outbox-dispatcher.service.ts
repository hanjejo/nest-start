import { Inject, Injectable, Optional } from '@nestjs/common';
import { OutboxEvent } from '../db/schema';
import {
  IntegrationEventEnvelope,
  createIntegrationEvent,
} from './integration-event';
import {
  DEFAULT_RETRY_POLICY,
  INTEGRATION_EVENT_TRANSPORT,
  RetryPolicy,
} from './messaging.constants';
import { IntegrationEventTransport } from './messaging.transport';
import { OutboxService } from './outbox.service';
import {
  runWithCorrelationContext,
  withCorrelationContext,
} from '../observability/correlation-context';
import { MetricsService } from '../observability/metrics.service';

export type OutboxDispatchResult = Readonly<{
  attempted: number;
  published: number;
  failed: number;
  deadLettered: number;
}>;

function toEnvelope(event: OutboxEvent): IntegrationEventEnvelope {
  return createIntegrationEvent({
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
  });
}

@Injectable()
export class OutboxDispatcher {
  constructor(
    private readonly outboxService: OutboxService,
    @Inject(INTEGRATION_EVENT_TRANSPORT)
    private readonly transport: IntegrationEventTransport,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async dispatch(
    limit = 100,
    policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  ): Promise<OutboxDispatchResult> {
    const events = await this.outboxService.pending(limit);
    let published = 0;
    let failed = 0;
    let deadLettered = 0;

    for (const event of events) {
      try {
        const envelope = toEnvelope(event);
        await runWithCorrelationContext(
          withCorrelationContext(
            envelope.correlationId,
            envelope.causationId,
          ),
          async () => {
            await this.transport.publish(envelope);
            await this.outboxService.markPublished(event.eventId);
          },
        );
        this.metrics?.recordOutboxPublished();
        published += 1;
      } catch (error) {
        failed += 1;
        const failure = await this.outboxService.recordPublishFailure(
          event.eventId,
          error,
          policy,
        );
        if (failure.deadLettered) {
          deadLettered += 1;
        }
      }
    }

    return {
      attempted: events.length,
      published,
      failed,
      deadLettered,
    };
  }
}

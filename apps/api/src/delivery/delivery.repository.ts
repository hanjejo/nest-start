import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  Delivery,
  DeliveryAttempt,
  DeliveryStatus,
  deliveryAttempts,
  deliveryCallbacks,
  deliveries,
} from '../db/schema';
import { DRIZZLE, DrizzleDB } from '../db/drizzle.module';
import {
  AddressSnapshot,
  addressSnapshotsEqual,
  normalizeAddressSnapshot,
} from '../messaging/address-snapshot';
import {
  IntegrationEventEnvelope,
  createIntegrationEvent,
} from '../messaging/integration-event';
import { DrizzleTransaction, OutboxService } from '../messaging/outbox.service';
import {
  DELIVERY_WORKFLOW_MAX_ATTEMPTS,
  DeliveryWorkflowInput,
  deliveryAttemptIdempotencyKey,
} from './delivery-workflow.types';
import { DeliveryProviderOutcome } from './delivery-provider';

type DeliveryOrderConfirmedPayload = Readonly<{
  orderId: string;
  storeId: string;
  customerId: string;
  addressSnapshot: AddressSnapshot;
}>;

type DeliveryOrderReadyPayload = Readonly<{
  orderId: string;
  storeId: string;
}>;

export type DeliveryAttemptWithDelivery = Readonly<{
  delivery: Delivery;
  attempt: DeliveryAttempt;
}>;

export type DeliveryOutcomeApplication = Readonly<{
  delivery: Delivery;
  terminal: boolean;
  retryable: boolean;
  eventId: string | null;
}>;

export type DeliveryView = Readonly<{
  id: string;
  orderId: string;
  storeId: string;
  status: DeliveryStatus;
  addressSnapshot: AddressSnapshot;
  aggregateVersion: number;
  currentAttemptNumber: number;
  workflowGeneration: number;
  lastFailureReason: string | null;
  lastFailureRetryable: boolean;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}>;

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function requiredUuid(value: unknown, field: string): string {
  if (!isUuid(value)) {
    throw new Error(`Delivery event has an invalid ${field}`);
  }
  return value;
}

function deliveryOrderConfirmedPayload(
  value: Record<string, unknown>,
): DeliveryOrderConfirmedPayload {
  const addressSnapshot = normalizeAddressSnapshot(value.addressSnapshot);
  if (!addressSnapshot) {
    throw new Error('OrderConfirmed event has no address snapshot');
  }
  return {
    orderId: requiredUuid(value.orderId, 'order ID'),
    storeId: requiredUuid(value.storeId, 'store ID'),
    customerId: requiredUuid(value.customerId, 'customer ID'),
    addressSnapshot,
  };
}

function deliveryOrderReadyPayload(
  value: Record<string, unknown>,
): DeliveryOrderReadyPayload {
  return {
    orderId: requiredUuid(value.orderId, 'order ID'),
    storeId: requiredUuid(value.storeId, 'store ID'),
  };
}

function callbackMatches(
  existing: {
    deliveryId: string;
    deliveryAttemptId: string;
    outcome: string;
    providerReference: string | null;
    failureReason: string | null;
    retryable: boolean;
  },
  deliveryId: string,
  attemptId: string,
  outcome: DeliveryProviderOutcome,
): boolean {
  return (
    existing.deliveryId === deliveryId &&
    existing.deliveryAttemptId === attemptId &&
    existing.outcome === outcome.kind &&
    existing.providerReference === outcome.providerReference &&
    existing.failureReason ===
      (outcome.kind === 'SUCCEEDED' ? null : outcome.failureReason) &&
    existing.retryable ===
      (outcome.kind === 'SUCCEEDED' ? false : outcome.retryable)
  );
}

@Injectable()
export class DeliveryRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly outboxService: OutboxService,
  ) {}

  async createFromOrderConfirmed(
    event: IntegrationEventEnvelope,
    tx: DrizzleTransaction,
  ): Promise<Delivery> {
    const payload = deliveryOrderConfirmedPayload(event.payload);
    const now = new Date();
    const id = randomUUID();

    await tx
      .insert(deliveries)
      .values({
        id,
        orderId: payload.orderId,
        storeId: payload.storeId,
        customerId: payload.customerId,
        addressSnapshot: payload.addressSnapshot,
        status: 'REQUESTED',
        aggregateVersion: 1,
        currentAttemptNumber: 0,
        workflowGeneration: 1,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: deliveries.orderId });

    const [delivery] = await tx
      .select()
      .from(deliveries)
      .where(eq(deliveries.orderId, payload.orderId))
      .limit(1);
    if (!delivery) {
      throw new Error('Delivery was not created');
    }
    if (
      delivery.storeId !== payload.storeId ||
      delivery.customerId !== payload.customerId ||
      !addressSnapshotsEqual(delivery.addressSnapshot, payload.addressSnapshot)
    ) {
      throw new ConflictException(
        `Delivery for Order ${payload.orderId} does not match OrderConfirmed`,
      );
    }

    await this.outboxService.enqueue(
      tx,
      createIntegrationEvent({
        eventId: `delivery-created:${delivery.id}`,
        idempotencyKey: `delivery-created:${delivery.id}`,
        eventType: 'DeliveryCreated',
        eventVersion: 1,
        occurredAt: now,
        producer: 'Delivery',
        aggregateType: 'Delivery',
        aggregateId: delivery.id,
        aggregateVersion: delivery.aggregateVersion,
        correlationId: event.correlationId,
        causationId: event.eventId,
        payload: {
          deliveryId: delivery.id,
          orderId: delivery.orderId,
          storeId: delivery.storeId,
          addressSnapshot: delivery.addressSnapshot,
        },
      }),
    );

    return delivery;
  }

  async prepareForOrderReady(
    event: IntegrationEventEnvelope,
    tx: DrizzleTransaction,
  ): Promise<DeliveryWorkflowInput | undefined> {
    const payload = deliveryOrderReadyPayload(event.payload);
    const [current] = await tx
      .select()
      .from(deliveries)
      .where(eq(deliveries.orderId, payload.orderId))
      .limit(1);
    if (!current) {
      throw new Error(`Delivery for Order ${payload.orderId} was not found`);
    }
    if (current.storeId !== payload.storeId) {
      throw new Error(
        'OrderReadyForDelivery store scope does not match Delivery',
      );
    }
    if (current.status === 'DELIVERED' || current.status === 'FAILED') {
      return undefined;
    }

    let delivery = current;
    if (current.status === 'REQUESTED') {
      const readyAt = new Date();
      const [updated] = await tx
        .update(deliveries)
        .set({
          status: 'READY',
          aggregateVersion: sql`${deliveries.aggregateVersion} + 1`,
          updatedAt: readyAt,
        })
        .where(
          and(
            eq(deliveries.id, current.id),
            eq(deliveries.status, 'REQUESTED'),
          ),
        )
        .returning();
      delivery = updated ?? current;
    }

    return {
      deliveryId: delivery.id,
      workflowGeneration: delivery.workflowGeneration,
      correlationId: event.correlationId,
      causationId: event.eventId,
    };
  }

  async getDelivery(deliveryId: string): Promise<Delivery | undefined> {
    const [delivery] = await this.db
      .select()
      .from(deliveries)
      .where(eq(deliveries.id, deliveryId))
      .limit(1);
    return delivery;
  }

  async getDeliveryByOrder(orderId: string): Promise<Delivery | undefined> {
    const [delivery] = await this.db
      .select()
      .from(deliveries)
      .where(eq(deliveries.orderId, orderId))
      .limit(1);
    return delivery;
  }

  async getView(deliveryId: string): Promise<DeliveryView | undefined> {
    const delivery = await this.getDelivery(deliveryId);
    return delivery ? this.deliveryView(delivery) : undefined;
  }

  async getViewByOrder(orderId: string): Promise<DeliveryView | undefined> {
    const delivery = await this.getDeliveryByOrder(orderId);
    return delivery ? this.deliveryView(delivery) : undefined;
  }

  async listViewsForStore(storeId: string): Promise<DeliveryView[]> {
    const rows = await this.db
      .select()
      .from(deliveries)
      .where(eq(deliveries.storeId, storeId))
      .orderBy(asc(deliveries.createdAt), asc(deliveries.id));
    return rows.map((delivery) => this.deliveryView(delivery));
  }

  async ensureAttempt(
    input: DeliveryWorkflowInput,
    attemptNumber: number,
  ): Promise<DeliveryAttemptWithDelivery | undefined> {
    return this.outboxService.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(deliveries)
        .where(eq(deliveries.id, input.deliveryId))
        .limit(1);
      if (!current) {
        throw new NotFoundException('Delivery not found');
      }
      if (
        current.workflowGeneration !== input.workflowGeneration ||
        current.status === 'DELIVERED' ||
        current.status === 'FAILED'
      ) {
        return undefined;
      }

      const [existing] = await tx
        .select()
        .from(deliveryAttempts)
        .where(
          and(
            eq(deliveryAttempts.deliveryId, input.deliveryId),
            eq(deliveryAttempts.workflowGeneration, input.workflowGeneration),
            eq(deliveryAttempts.attemptNumber, attemptNumber),
          ),
        )
        .limit(1);
      if (existing) {
        return { delivery: current, attempt: existing };
      }

      const now = new Date();
      const idempotencyKey = deliveryAttemptIdempotencyKey(
        input.deliveryId,
        input.workflowGeneration,
        attemptNumber,
      );
      await tx
        .insert(deliveryAttempts)
        .values({
          id: randomUUID(),
          deliveryId: input.deliveryId,
          workflowGeneration: input.workflowGeneration,
          attemptNumber,
          providerIdempotencyKey: idempotencyKey,
          status: 'PENDING',
          requestedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({
          target: [
            deliveryAttempts.deliveryId,
            deliveryAttempts.workflowGeneration,
            deliveryAttempts.attemptNumber,
          ],
        });

      const [attempt] = await tx
        .select()
        .from(deliveryAttempts)
        .where(
          and(
            eq(deliveryAttempts.deliveryId, input.deliveryId),
            eq(deliveryAttempts.workflowGeneration, input.workflowGeneration),
            eq(deliveryAttempts.attemptNumber, attemptNumber),
          ),
        )
        .limit(1);
      if (!attempt) {
        throw new Error('Delivery Attempt was not created');
      }

      const [updated] = await tx
        .update(deliveries)
        .set({
          currentAttemptNumber: attemptNumber,
          aggregateVersion: sql`${deliveries.aggregateVersion} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(deliveries.id, input.deliveryId),
            eq(deliveries.workflowGeneration, input.workflowGeneration),
            inArray(deliveries.status, ['READY', 'IN_TRANSIT']),
          ),
        )
        .returning();

      return {
        delivery: updated ?? current,
        attempt,
      };
    });
  }

  async applyProviderOutcome(
    input: DeliveryWorkflowInput,
    attemptId: string,
    attemptNumber: number,
    outcome: DeliveryProviderOutcome,
  ): Promise<DeliveryOutcomeApplication> {
    return this.outboxService.transaction(async (tx) => {
      const [delivery] = await tx
        .select()
        .from(deliveries)
        .where(eq(deliveries.id, input.deliveryId))
        .limit(1);
      if (!delivery) {
        throw new NotFoundException('Delivery not found');
      }

      const [attempt] = await tx
        .select()
        .from(deliveryAttempts)
        .where(eq(deliveryAttempts.id, attemptId))
        .limit(1);
      if (
        !attempt ||
        attempt.deliveryId !== delivery.id ||
        attempt.workflowGeneration !== input.workflowGeneration ||
        attempt.attemptNumber !== attemptNumber
      ) {
        throw new ConflictException(
          'Delivery Attempt does not belong to Delivery',
        );
      }

      const [existingCallback] = await tx
        .select()
        .from(deliveryCallbacks)
        .where(eq(deliveryCallbacks.callbackId, outcome.callbackId))
        .limit(1);
      if (existingCallback) {
        if (
          !callbackMatches(existingCallback, delivery.id, attempt.id, outcome)
        ) {
          throw new ConflictException('Delivery callback identity was reused');
        }
        return this.existingOutcome(delivery, existingCallback, attemptNumber);
      }

      const receivedAt = new Date();
      const [callback] = await tx
        .insert(deliveryCallbacks)
        .values({
          id: randomUUID(),
          deliveryId: delivery.id,
          deliveryAttemptId: attempt.id,
          callbackId: outcome.callbackId,
          outcome: outcome.kind,
          providerReference: outcome.providerReference,
          failureReason:
            outcome.kind === 'SUCCEEDED' ? null : outcome.failureReason,
          retryable: outcome.kind === 'SUCCEEDED' ? false : outcome.retryable,
          receivedAt,
          createdAt: receivedAt,
        })
        .onConflictDoNothing({ target: deliveryCallbacks.callbackId })
        .returning();

      if (!callback) {
        const [concurrentCallback] = await tx
          .select()
          .from(deliveryCallbacks)
          .where(eq(deliveryCallbacks.callbackId, outcome.callbackId))
          .limit(1);
        if (
          !concurrentCallback ||
          !callbackMatches(concurrentCallback, delivery.id, attempt.id, outcome)
        ) {
          throw new ConflictException('Delivery callback identity was reused');
        }
        return this.existingOutcome(
          delivery,
          concurrentCallback,
          attemptNumber,
        );
      }

      if (attempt.status !== 'PENDING') {
        return {
          delivery,
          terminal:
            delivery.status === 'DELIVERED' || delivery.status === 'FAILED',
          retryable: false,
          eventId: null,
        };
      }

      await tx
        .update(deliveryAttempts)
        .set({
          status: outcome.kind === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED',
          providerReference: outcome.providerReference,
          failureReason:
            outcome.kind === 'SUCCEEDED' ? null : outcome.failureReason,
          retryable: outcome.kind === 'SUCCEEDED' ? false : outcome.retryable,
          completedAt: receivedAt,
          updatedAt: receivedAt,
        })
        .where(eq(deliveryAttempts.id, attempt.id));

      if (delivery.status === 'DELIVERED' || delivery.status === 'FAILED') {
        return {
          delivery,
          terminal: true,
          retryable: false,
          eventId: null,
        };
      }

      if (outcome.kind === 'SUCCEEDED') {
        return this.completeDelivery(
          tx,
          delivery,
          input,
          outcome.providerReference,
          outcome.callbackId,
          receivedAt,
        );
      }

      const shouldRetry =
        outcome.retryable && attemptNumber < DELIVERY_WORKFLOW_MAX_ATTEMPTS;
      if (shouldRetry) {
        const [updated] = await tx
          .update(deliveries)
          .set({
            status: 'READY',
            aggregateVersion: sql`${deliveries.aggregateVersion} + 1`,
            lastFailureReason: outcome.failureReason,
            lastFailureRetryable: true,
            updatedAt: receivedAt,
          })
          .where(
            and(
              eq(deliveries.id, delivery.id),
              inArray(deliveries.status, ['READY', 'IN_TRANSIT']),
            ),
          )
          .returning();

        return {
          delivery: updated ?? delivery,
          terminal: false,
          retryable: true,
          eventId: null,
        };
      }

      const [updated] = await tx
        .update(deliveries)
        .set({
          status: 'FAILED',
          aggregateVersion: sql`${deliveries.aggregateVersion} + 1`,
          lastFailureReason: outcome.failureReason,
          lastFailureRetryable: outcome.retryable,
          updatedAt: receivedAt,
        })
        .where(
          and(
            eq(deliveries.id, delivery.id),
            inArray(deliveries.status, ['READY', 'IN_TRANSIT']),
          ),
        )
        .returning();
      const finalDelivery = updated ?? delivery;
      const eventId = `delivery-failed:${delivery.id}:generation:${input.workflowGeneration}`;
      await this.outboxService.enqueue(
        tx,
        createIntegrationEvent({
          eventId,
          idempotencyKey: eventId,
          eventType: 'DeliveryFailed',
          eventVersion: 1,
          occurredAt: receivedAt,
          producer: 'Delivery',
          aggregateType: 'Delivery',
          aggregateId: delivery.id,
          aggregateVersion: finalDelivery.aggregateVersion,
          correlationId: input.correlationId,
          causationId: outcome.callbackId,
          payload: {
            deliveryId: delivery.id,
            orderId: delivery.orderId,
            storeId: delivery.storeId,
            reason: outcome.failureReason,
            retryable: outcome.retryable,
          },
        }),
      );
      return {
        delivery: finalDelivery,
        terminal: true,
        retryable: outcome.retryable,
        eventId,
      };
    });
  }

  async prepareRetry(
    deliveryId: string,
    correlationId: string,
  ): Promise<{
    delivery: Delivery;
    workflowInput: DeliveryWorkflowInput;
  }> {
    return this.outboxService.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(deliveries)
        .where(eq(deliveries.id, deliveryId))
        .limit(1);
      if (!current) {
        throw new NotFoundException('Delivery not found');
      }
      if (current.status !== 'FAILED' || !current.lastFailureRetryable) {
        throw new ConflictException('Delivery is not retryable');
      }

      const now = new Date();
      const [updated] = await tx
        .update(deliveries)
        .set({
          status: 'READY',
          workflowGeneration: sql`${deliveries.workflowGeneration} + 1`,
          currentAttemptNumber: 0,
          aggregateVersion: sql`${deliveries.aggregateVersion} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(deliveries.id, deliveryId),
            eq(deliveries.status, 'FAILED'),
            eq(deliveries.lastFailureRetryable, true),
          ),
        )
        .returning();
      if (!updated) {
        throw new ConflictException('Delivery retry is already in progress');
      }

      return {
        delivery: updated,
        workflowInput: {
          deliveryId: updated.id,
          workflowGeneration: updated.workflowGeneration,
          correlationId,
          causationId: null,
        },
      };
    });
  }

  private async completeDelivery(
    tx: DrizzleTransaction,
    delivery: Delivery,
    input: DeliveryWorkflowInput,
    providerReference: string,
    causationId: string,
    occurredAt: Date,
  ): Promise<DeliveryOutcomeApplication> {
    let current = delivery;
    if (current.status !== 'IN_TRANSIT') {
      const [inTransit] = await tx
        .update(deliveries)
        .set({
          status: 'IN_TRANSIT',
          aggregateVersion: sql`${deliveries.aggregateVersion} + 1`,
          providerReference,
          lastFailureReason: null,
          lastFailureRetryable: false,
          startedAt: occurredAt,
          updatedAt: occurredAt,
        })
        .where(
          and(
            eq(deliveries.id, delivery.id),
            inArray(deliveries.status, ['REQUESTED', 'READY']),
          ),
        )
        .returning();
      current = inTransit ?? current;

      await this.outboxService.enqueue(
        tx,
        createIntegrationEvent({
          eventId: `delivery-started:${delivery.id}`,
          idempotencyKey: `delivery-started:${delivery.id}`,
          eventType: 'DeliveryStarted',
          eventVersion: 1,
          occurredAt,
          producer: 'Delivery',
          aggregateType: 'Delivery',
          aggregateId: delivery.id,
          aggregateVersion: current.aggregateVersion,
          correlationId: input.correlationId,
          causationId,
          payload: {
            deliveryId: delivery.id,
            orderId: delivery.orderId,
            storeId: delivery.storeId,
            startedAt: occurredAt.toISOString(),
          },
        }),
      );
    }

    const [delivered] = await tx
      .update(deliveries)
      .set({
        status: 'DELIVERED',
        aggregateVersion: sql`${deliveries.aggregateVersion} + 1`,
        providerReference,
        lastFailureReason: null,
        lastFailureRetryable: false,
        completedAt: occurredAt,
        updatedAt: occurredAt,
      })
      .where(
        and(
          eq(deliveries.id, delivery.id),
          eq(deliveries.status, 'IN_TRANSIT'),
        ),
      )
      .returning();
    const finalDelivery = delivered ?? current;
    const eventId = `delivery-completed:${delivery.id}`;
    await this.outboxService.enqueue(
      tx,
      createIntegrationEvent({
        eventId,
        idempotencyKey: eventId,
        eventType: 'DeliveryCompleted',
        eventVersion: 1,
        occurredAt,
        producer: 'Delivery',
        aggregateType: 'Delivery',
        aggregateId: delivery.id,
        aggregateVersion: finalDelivery.aggregateVersion,
        correlationId: input.correlationId,
        causationId,
        payload: {
          deliveryId: delivery.id,
          orderId: delivery.orderId,
          storeId: delivery.storeId,
          completedAt: occurredAt.toISOString(),
        },
      }),
    );

    return {
      delivery: finalDelivery,
      terminal: true,
      retryable: false,
      eventId,
    };
  }

  private existingOutcome(
    delivery: Delivery,
    callback: {
      outcome: string;
      retryable: boolean;
    },
    attemptNumber: number,
  ): DeliveryOutcomeApplication {
    const retryable =
      callback.outcome === 'FAILED' &&
      callback.retryable &&
      delivery.status !== 'DELIVERED' &&
      delivery.status !== 'FAILED' &&
      attemptNumber < DELIVERY_WORKFLOW_MAX_ATTEMPTS;
    return {
      delivery,
      terminal: !retryable,
      retryable,
      eventId: null,
    };
  }

  private deliveryView(delivery: Delivery): DeliveryView {
    return {
      id: delivery.id,
      orderId: delivery.orderId,
      storeId: delivery.storeId,
      status: delivery.status,
      addressSnapshot: delivery.addressSnapshot,
      aggregateVersion: delivery.aggregateVersion,
      currentAttemptNumber: delivery.currentAttemptNumber,
      workflowGeneration: delivery.workflowGeneration,
      lastFailureReason: delivery.lastFailureReason,
      lastFailureRetryable: delivery.lastFailureRetryable,
      createdAt: delivery.createdAt,
      updatedAt: delivery.updatedAt,
      startedAt: delivery.startedAt,
      completedAt: delivery.completedAt,
    };
  }
}

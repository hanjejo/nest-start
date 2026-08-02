import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  PaymentAttempt,
  PaymentCallbackOutcome,
  PaymentIntent,
  paymentAttempts,
  paymentCallbacks,
  paymentIntents,
} from '../db/schema';
import { DRIZZLE, DrizzleDB } from '../db/drizzle.module';
import {
  IntegrationEventEnvelope,
  createIntegrationEvent,
} from '../messaging/integration-event';
import { OutboxService, DrizzleTransaction } from '../messaging/outbox.service';
import {
  PAYMENT_INTENT_EXPIRY_MS,
  PAYMENT_WORKFLOW_MAX_ATTEMPTS,
  PaymentWorkflowInput,
  paymentAttemptIdempotencyKey,
} from './payment-workflow.types';
import { PaymentProviderOutcome } from './payment-provider';

type PaymentOrderPlacedPayload = Readonly<{
  orderId: string;
  storeId: string;
  customerId: string;
  orderAmount: number;
  currency: string;
}>;

export type PaymentAttemptWithIntent = Readonly<{
  intent: PaymentIntent;
  attempt: PaymentAttempt;
}>;

export type PaymentOutcomeApplication = Readonly<{
  intent: PaymentIntent;
  terminal: boolean;
  retryable: boolean;
  eventId: string | null;
}>;

export type PaymentView = Readonly<{
  id: string;
  orderId: string;
  customerId: string;
  storeId: string;
  amountMinor: number;
  currency: string;
  status: PaymentIntent['status'];
  aggregateVersion: number;
  currentAttemptNumber: number;
  workflowGeneration: number;
  expiresAt: Date;
  providerReference: string | null;
  lastFailureReason: string | null;
  lastFailureRetryable: boolean;
  createdAt: Date;
  updatedAt: Date;
  attempts: ReadonlyArray<{
    id: string;
    attemptNumber: number;
    status: PaymentAttempt['status'];
    providerReference: string | null;
    failureReason: string | null;
    retryable: boolean;
    requestedAt: Date;
    completedAt: Date | null;
  }>;
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
    throw new Error(`OrderPlaced payload has an invalid ${field}`);
  }
  return value;
}

function requiredAmount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('OrderPlaced payload has an invalid order amount');
  }
  return value;
}

function requiredCurrency(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) {
    throw new Error('OrderPlaced payload has an invalid currency');
  }
  return value;
}

function paymentOrderPlacedPayload(
  value: Record<string, unknown>,
): PaymentOrderPlacedPayload {
  return {
    orderId: requiredUuid(value.orderId, 'order ID'),
    storeId: requiredUuid(value.storeId, 'store ID'),
    customerId: requiredUuid(value.customerId, 'customer ID'),
    orderAmount: requiredAmount(value.orderAmount),
    currency: requiredCurrency(value.currency),
  };
}

function attemptStatusFor(
  outcome: PaymentProviderOutcome,
): PaymentAttempt['status'] {
  return outcome.kind === 'TIMED_OUT' ? 'TIMED_OUT' : outcome.kind;
}

@Injectable()
export class PaymentRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly outboxService: OutboxService,
  ) {}

  async createFromOrderPlaced(
    event: IntegrationEventEnvelope,
    tx: DrizzleTransaction,
  ): Promise<PaymentIntent> {
    const payload = paymentOrderPlacedPayload(event.payload);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PAYMENT_INTENT_EXPIRY_MS);

    await tx
      .insert(paymentIntents)
      .values({
        id: randomUUID(),
        orderId: payload.orderId,
        customerId: payload.customerId,
        storeId: payload.storeId,
        amountMinor: payload.orderAmount,
        currency: payload.currency,
        status: 'PENDING',
        aggregateVersion: 1,
        currentAttemptNumber: 0,
        workflowGeneration: 1,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: paymentIntents.orderId });

    const [intent] = await tx
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.orderId, payload.orderId))
      .limit(1);

    if (!intent) {
      throw new Error('Payment Intent was not created');
    }
    if (
      intent.customerId !== payload.customerId ||
      intent.storeId !== payload.storeId ||
      intent.amountMinor !== payload.orderAmount ||
      intent.currency !== payload.currency
    ) {
      throw new ConflictException(
        `Payment Intent for Order ${payload.orderId} does not match OrderPlaced`,
      );
    }
    return intent;
  }

  async getIntent(paymentIntentId: string): Promise<PaymentIntent | undefined> {
    const [intent] = await this.db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, paymentIntentId))
      .limit(1);
    return intent;
  }

  async getIntentByOrder(orderId: string): Promise<PaymentIntent | undefined> {
    const [intent] = await this.db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.orderId, orderId))
      .limit(1);
    return intent;
  }

  async getAttempt(attemptId: string): Promise<PaymentAttempt | undefined> {
    const [attempt] = await this.db
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, attemptId))
      .limit(1);
    return attempt;
  }

  async getView(paymentIntentId: string): Promise<PaymentView | undefined> {
    const intent = await this.getIntent(paymentIntentId);
    if (!intent) {
      return undefined;
    }
    const attempts = await this.db
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.paymentIntentId, paymentIntentId))
      .orderBy(asc(paymentAttempts.attemptNumber));

    return {
      id: intent.id,
      orderId: intent.orderId,
      customerId: intent.customerId,
      storeId: intent.storeId,
      amountMinor: intent.amountMinor,
      currency: intent.currency,
      status: intent.status,
      aggregateVersion: intent.aggregateVersion,
      currentAttemptNumber: intent.currentAttemptNumber,
      workflowGeneration: intent.workflowGeneration,
      expiresAt: intent.expiresAt,
      providerReference: intent.providerReference,
      lastFailureReason: intent.lastFailureReason,
      lastFailureRetryable: intent.lastFailureRetryable,
      createdAt: intent.createdAt,
      updatedAt: intent.updatedAt,
      attempts: attempts.map((attempt) => ({
        id: attempt.id,
        attemptNumber: attempt.attemptNumber,
        status: attempt.status,
        providerReference: attempt.providerReference,
        failureReason: attempt.failureReason,
        retryable: attempt.retryable,
        requestedAt: attempt.requestedAt,
        completedAt: attempt.completedAt,
      })),
    };
  }

  async ensureAttempt(
    input: PaymentWorkflowInput,
    attemptNumber: number,
  ): Promise<PaymentAttemptWithIntent | undefined> {
    return this.outboxService.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(paymentIntents)
        .where(eq(paymentIntents.id, input.paymentIntentId))
        .limit(1);
      if (!current) {
        throw new NotFoundException('Payment Intent not found');
      }
      if (
        current.workflowGeneration !== input.workflowGeneration ||
        current.status !== 'PENDING'
      ) {
        return undefined;
      }

      const [existing] = await tx
        .select()
        .from(paymentAttempts)
        .where(
          and(
            eq(paymentAttempts.paymentIntentId, input.paymentIntentId),
            eq(paymentAttempts.workflowGeneration, input.workflowGeneration),
            eq(paymentAttempts.attemptNumber, attemptNumber),
          ),
        )
        .limit(1);
      if (existing) {
        return { intent: current, attempt: existing };
      }

      const now = new Date();
      const idempotencyKey = paymentAttemptIdempotencyKey(
        input.paymentIntentId,
        input.workflowGeneration,
        attemptNumber,
      );
      await tx
        .insert(paymentAttempts)
        .values({
          id: randomUUID(),
          paymentIntentId: input.paymentIntentId,
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
            paymentAttempts.paymentIntentId,
            paymentAttempts.workflowGeneration,
            paymentAttempts.attemptNumber,
          ],
        });

      const [attempt] = await tx
        .select()
        .from(paymentAttempts)
        .where(
          and(
            eq(paymentAttempts.paymentIntentId, input.paymentIntentId),
            eq(paymentAttempts.workflowGeneration, input.workflowGeneration),
            eq(paymentAttempts.attemptNumber, attemptNumber),
          ),
        )
        .limit(1);
      if (!attempt) {
        throw new Error('Payment Attempt was not created');
      }

      const [updated] = await tx
        .update(paymentIntents)
        .set({
          currentAttemptNumber: attemptNumber,
          aggregateVersion: sql`${paymentIntents.aggregateVersion} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(paymentIntents.id, input.paymentIntentId),
            eq(paymentIntents.status, 'PENDING'),
            eq(paymentIntents.workflowGeneration, input.workflowGeneration),
          ),
        )
        .returning();

      return {
        intent: updated ?? current,
        attempt,
      };
    });
  }

  async applyProviderOutcome(
    input: PaymentWorkflowInput,
    attemptId: string,
    attemptNumber: number,
    outcome: PaymentProviderOutcome,
  ): Promise<PaymentOutcomeApplication> {
    return this.outboxService.transaction(async (tx) => {
      const [intent] = await tx
        .select()
        .from(paymentIntents)
        .where(eq(paymentIntents.id, input.paymentIntentId))
        .limit(1);
      if (!intent) {
        throw new NotFoundException('Payment Intent not found');
      }

      const [attempt] = await tx
        .select()
        .from(paymentAttempts)
        .where(eq(paymentAttempts.id, attemptId))
        .limit(1);
      if (
        !attempt ||
        attempt.paymentIntentId !== intent.id ||
        attempt.workflowGeneration !== input.workflowGeneration ||
        attempt.attemptNumber !== attemptNumber
      ) {
        throw new ConflictException(
          'Payment Attempt does not belong to Intent',
        );
      }

      const [existingCallback] = await tx
        .select()
        .from(paymentCallbacks)
        .where(eq(paymentCallbacks.callbackId, outcome.callbackId))
        .limit(1);
      if (existingCallback) {
        if (
          existingCallback.paymentIntentId !== intent.id ||
          existingCallback.paymentAttemptId !== attempt.id ||
          existingCallback.outcome !== outcome.kind ||
          existingCallback.providerReference !== outcome.providerReference ||
          existingCallback.failureReason !==
            (outcome.kind === 'SUCCEEDED' ? null : outcome.failureReason) ||
          existingCallback.retryable !==
            (outcome.kind === 'SUCCEEDED' ? false : outcome.retryable)
        ) {
          throw new ConflictException('Provider callback identity was reused');
        }
        return this.existingOutcome(intent, existingCallback, attemptNumber);
      }

      const receivedAt = new Date();
      const [callback] = await tx
        .insert(paymentCallbacks)
        .values({
          id: randomUUID(),
          paymentIntentId: intent.id,
          paymentAttemptId: attempt.id,
          callbackId: outcome.callbackId,
          outcome: outcome.kind,
          providerReference: outcome.providerReference,
          failureReason:
            outcome.kind === 'SUCCEEDED' ? null : outcome.failureReason,
          retryable: outcome.kind === 'SUCCEEDED' ? false : outcome.retryable,
          receivedAt,
          createdAt: receivedAt,
        })
        .onConflictDoNothing({ target: paymentCallbacks.callbackId })
        .returning();

      if (!callback) {
        const [concurrentCallback] = await tx
          .select()
          .from(paymentCallbacks)
          .where(eq(paymentCallbacks.callbackId, outcome.callbackId))
          .limit(1);
        if (!concurrentCallback) {
          throw new Error(
            'Provider callback disappeared after idempotency conflict',
          );
        }
        if (
          concurrentCallback.outcome !== outcome.kind ||
          concurrentCallback.providerReference !== outcome.providerReference ||
          concurrentCallback.failureReason !==
            (outcome.kind === 'SUCCEEDED' ? null : outcome.failureReason) ||
          concurrentCallback.retryable !==
            (outcome.kind === 'SUCCEEDED' ? false : outcome.retryable)
        ) {
          throw new ConflictException('Provider callback identity was reused');
        }
        return this.existingOutcome(intent, concurrentCallback, attemptNumber);
      }

      if (attempt.status !== 'PENDING') {
        return {
          intent,
          terminal:
            intent.status === 'SUCCEEDED' ||
            intent.status === 'FAILED' ||
            intent.status === 'EXPIRED',
          retryable: false,
          eventId: null,
        };
      }

      await tx
        .update(paymentAttempts)
        .set({
          status: attemptStatusFor(outcome),
          providerReference: outcome.providerReference,
          failureReason:
            outcome.kind === 'SUCCEEDED' ? null : outcome.failureReason,
          retryable: outcome.kind === 'SUCCEEDED' ? false : outcome.retryable,
          completedAt: receivedAt,
          updatedAt: receivedAt,
        })
        .where(eq(paymentAttempts.id, attempt.id));

      if (intent.status !== 'PENDING') {
        return {
          intent,
          terminal: true,
          retryable: false,
          eventId: null,
        };
      }

      if (outcome.kind === 'SUCCEEDED') {
        if (intent.expiresAt.getTime() <= receivedAt.getTime()) {
          const finalIntent = await this.expireIntentInTransaction(
            tx,
            intent,
            input,
            receivedAt,
            'PAYMENT_EXPIRED',
            outcome.callbackId,
          );
          const eventId = `payment-expired:${intent.id}`;
          return {
            intent: finalIntent,
            terminal: true,
            retryable: false,
            eventId:
              finalIntent.status === 'EXPIRED' && intent.status === 'PENDING'
                ? eventId
                : null,
          };
        }

        const [updated] = await tx
          .update(paymentIntents)
          .set({
            status: 'SUCCEEDED',
            aggregateVersion: sql`${paymentIntents.aggregateVersion} + 1`,
            providerReference: outcome.providerReference,
            lastFailureReason: null,
            lastFailureRetryable: false,
            updatedAt: receivedAt,
          })
          .where(
            and(
              eq(paymentIntents.id, intent.id),
              eq(paymentIntents.status, 'PENDING'),
            ),
          )
          .returning();
        const finalIntent = updated ?? intent;
        const eventId = `payment-succeeded:${intent.id}`;
        await this.outboxService.enqueue(
          tx,
          createIntegrationEvent({
            eventId,
            idempotencyKey: eventId,
            eventType: 'PaymentSucceeded',
            eventVersion: 1,
            occurredAt: receivedAt,
            producer: 'Payment',
            aggregateType: 'PaymentIntent',
            aggregateId: intent.id,
            aggregateVersion: finalIntent.aggregateVersion,
            correlationId: input.correlationId,
            causationId: outcome.callbackId,
            payload: {
              paymentIntentId: intent.id,
              orderId: intent.orderId,
              storeId: intent.storeId,
              amount: intent.amountMinor,
              currency: intent.currency,
              providerReference: outcome.providerReference,
            },
          }),
        );
        return {
          intent: finalIntent,
          terminal: true,
          retryable: false,
          eventId,
        };
      }

      if (
        outcome.kind === 'TIMED_OUT' ||
        intent.expiresAt.getTime() <= receivedAt.getTime()
      ) {
        const finalIntent = await this.expireIntentInTransaction(
          tx,
          intent,
          input,
          receivedAt,
          outcome.kind === 'TIMED_OUT'
            ? outcome.failureReason
            : 'PAYMENT_EXPIRED',
          outcome.callbackId,
        );
        const eventId = `payment-expired:${intent.id}`;
        return {
          intent: finalIntent,
          terminal: true,
          retryable: false,
          eventId:
            finalIntent.status === 'EXPIRED' && intent.status === 'PENDING'
              ? eventId
              : null,
        };
      }

      const shouldRetry =
        outcome.retryable && attemptNumber < PAYMENT_WORKFLOW_MAX_ATTEMPTS;
      if (shouldRetry) {
        const [updated] = await tx
          .update(paymentIntents)
          .set({
            status: 'PENDING',
            aggregateVersion: sql`${paymentIntents.aggregateVersion} + 1`,
            lastFailureReason: outcome.failureReason,
            lastFailureRetryable: true,
            updatedAt: receivedAt,
          })
          .where(
            and(
              eq(paymentIntents.id, intent.id),
              eq(paymentIntents.status, 'PENDING'),
            ),
          )
          .returning();
        return {
          intent: updated ?? intent,
          terminal: false,
          retryable: true,
          eventId: null,
        };
      }

      const [updated] = await tx
        .update(paymentIntents)
        .set({
          status: 'FAILED',
          aggregateVersion: sql`${paymentIntents.aggregateVersion} + 1`,
          lastFailureReason: outcome.failureReason,
          lastFailureRetryable: outcome.retryable,
          updatedAt: receivedAt,
        })
        .where(
          and(
            eq(paymentIntents.id, intent.id),
            eq(paymentIntents.status, 'PENDING'),
          ),
        )
        .returning();
      const eventId = `payment-failed:${intent.id}:generation:${input.workflowGeneration}`;
      const finalIntent = updated ?? intent;
      await this.outboxService.enqueue(
        tx,
        createIntegrationEvent({
          eventId,
          idempotencyKey: eventId,
          eventType: 'PaymentFailed',
          eventVersion: 1,
          occurredAt: receivedAt,
          producer: 'Payment',
          aggregateType: 'PaymentIntent',
          aggregateId: intent.id,
          aggregateVersion: finalIntent.aggregateVersion,
          correlationId: input.correlationId,
          causationId: outcome.callbackId,
          payload: {
            paymentIntentId: intent.id,
            orderId: intent.orderId,
            storeId: intent.storeId,
            amount: intent.amountMinor,
            currency: intent.currency,
            reason: outcome.failureReason,
            retryable: outcome.retryable,
          },
        }),
      );
      return {
        intent: finalIntent,
        terminal: true,
        retryable: outcome.retryable,
        eventId,
      };
    });
  }

  async expireIfDue(input: PaymentWorkflowInput): Promise<PaymentIntent> {
    return this.outboxService.transaction(async (tx) => {
      const [intent] = await tx
        .select()
        .from(paymentIntents)
        .where(eq(paymentIntents.id, input.paymentIntentId))
        .limit(1);
      if (!intent) {
        throw new NotFoundException('Payment Intent not found');
      }
      if (
        intent.status !== 'PENDING' ||
        intent.expiresAt.getTime() > Date.now()
      ) {
        return intent;
      }

      const now = new Date();
      return this.expireIntentInTransaction(
        tx,
        intent,
        input,
        now,
        'PAYMENT_EXPIRED',
        input.causationId,
      );
    });
  }

  async prepareRetry(
    paymentIntentId: string,
    correlationId: string,
  ): Promise<{ intent: PaymentIntent; workflowInput: PaymentWorkflowInput }> {
    return this.outboxService.transaction(async (tx) => {
      const [intent] = await tx
        .select()
        .from(paymentIntents)
        .where(eq(paymentIntents.id, paymentIntentId))
        .limit(1);
      if (!intent) {
        throw new NotFoundException('Payment Intent not found');
      }
      if (intent.status !== 'FAILED' || !intent.lastFailureRetryable) {
        throw new ConflictException('Payment Intent is not retryable');
      }
      if (intent.expiresAt.getTime() <= Date.now()) {
        throw new ConflictException('Payment Intent has expired');
      }

      const now = new Date();
      const [updated] = await tx
        .update(paymentIntents)
        .set({
          status: 'PENDING',
          workflowGeneration: sql`${paymentIntents.workflowGeneration} + 1`,
          currentAttemptNumber: 0,
          aggregateVersion: sql`${paymentIntents.aggregateVersion} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(paymentIntents.id, paymentIntentId),
            eq(paymentIntents.status, 'FAILED'),
            eq(paymentIntents.lastFailureRetryable, true),
          ),
        )
        .returning();
      if (!updated) {
        const [latest] = await tx
          .select()
          .from(paymentIntents)
          .where(eq(paymentIntents.id, paymentIntentId))
          .limit(1);
        throw new ConflictException(
          latest?.status === 'PENDING'
            ? 'Payment retry is already in progress'
            : 'Payment Intent is not retryable',
        );
      }
      const finalIntent = updated;
      return {
        intent: finalIntent,
        workflowInput: {
          paymentIntentId: finalIntent.id,
          workflowGeneration: finalIntent.workflowGeneration,
          correlationId,
          causationId: null,
        },
      };
    });
  }

  private async expireIntentInTransaction(
    tx: DrizzleTransaction,
    intent: PaymentIntent,
    input: PaymentWorkflowInput,
    occurredAt: Date,
    reason: string,
    causationId: string | null,
  ): Promise<PaymentIntent> {
    const [updated] = await tx
      .update(paymentIntents)
      .set({
        status: 'EXPIRED',
        aggregateVersion: sql`${paymentIntents.aggregateVersion} + 1`,
        lastFailureReason: reason,
        lastFailureRetryable: false,
        updatedAt: occurredAt,
      })
      .where(
        and(
          eq(paymentIntents.id, intent.id),
          eq(paymentIntents.status, 'PENDING'),
        ),
      )
      .returning();
    if (!updated) {
      const [current] = await tx
        .select()
        .from(paymentIntents)
        .where(eq(paymentIntents.id, intent.id))
        .limit(1);
      return current ?? intent;
    }

    const eventId = `payment-expired:${intent.id}`;
    await this.outboxService.enqueue(
      tx,
      createIntegrationEvent({
        eventId,
        idempotencyKey: eventId,
        eventType: 'PaymentExpired',
        eventVersion: 1,
        occurredAt,
        producer: 'Payment',
        aggregateType: 'PaymentIntent',
        aggregateId: intent.id,
        aggregateVersion: updated.aggregateVersion,
        correlationId: input.correlationId,
        causationId,
        payload: {
          paymentIntentId: intent.id,
          orderId: intent.orderId,
          storeId: intent.storeId,
          expiredAt: occurredAt.toISOString(),
        },
      }),
    );
    return updated;
  }

  private existingOutcome(
    intent: PaymentIntent,
    callback: {
      outcome: PaymentCallbackOutcome;
      retryable: boolean;
    },
    attemptNumber: number,
  ): PaymentOutcomeApplication {
    const retryable =
      callback.outcome === 'FAILED' &&
      callback.retryable &&
      intent.status === 'PENDING' &&
      attemptNumber < PAYMENT_WORKFLOW_MAX_ATTEMPTS;
    return {
      intent,
      terminal: !retryable,
      retryable,
      eventId: null,
    };
  }
}

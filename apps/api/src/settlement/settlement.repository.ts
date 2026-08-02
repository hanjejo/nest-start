import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  Settlement,
  SettlementLedgerEntry,
  SettlementOrderFact,
  SettlementPaymentFact,
  SettlementRefundFact,
  settlementCancellationFacts,
  settlementLedgerEntries,
  settlementOrderFacts,
  settlementPaymentFacts,
  settlementRefundFacts,
  settlements,
} from '../db/schema';
import { DRIZZLE, DrizzleDB } from '../db/drizzle.module';
import { IntegrationEventEnvelope } from '../messaging/integration-event';
import { DrizzleTransaction, OutboxService } from '../messaging/outbox.service';
import {
  calculateSettlement,
  configuredSettlementFeeBasisPoints,
  MAX_SETTLEMENT_MINOR_AMOUNT,
  SettlementCalculation,
} from './settlement.calculator';
import { SettlementWorkflowInput } from './settlement-workflow.types';

type CompletedOrderPayload = Readonly<{
  orderId: string;
  storeId: string;
  orderAmount: number;
  currency: string;
  completedAt: Date;
  adjustmentAmountMinor?: number;
}>;

type PaymentSucceededPayload = Readonly<{
  paymentIntentId: string;
  orderId: string;
  storeId: string;
  amount: number;
  currency: string;
  providerReference: string;
}>;

type PaymentRefundedPayload = Readonly<{
  paymentIntentId: string;
  orderId: string;
  storeId: string;
  refundAmount: number;
  currency: string;
  providerReference: string;
}>;

type OrderCancelledPayload = Readonly<{
  orderId: string;
  storeId: string;
  reason: string;
  refundRequired: boolean;
}>;

export type SettlementProjectionResult = Readonly<{
  workflowInput: SettlementWorkflowInput | null;
}>;

export type SettlementWorkflowFacts = Readonly<{
  settlement: Settlement;
  orderFact: SettlementOrderFact;
  paymentFact: SettlementPaymentFact;
  refunds: readonly SettlementRefundFact[];
  calculation: SettlementCalculation;
}>;

export type SettlementView = Readonly<{
  id: string;
  orderId: string;
  storeId: string;
  status: Settlement['status'];
  currency: string;
  feeBasisPoints: number;
  grossAmountMinor: number | null;
  paymentAmountMinor: number | null;
  feeAmountMinor: number;
  refundAmountMinor: number;
  adjustmentAmountMinor: number;
  payableAmountMinor: number;
  aggregateVersion: number;
  workflowGeneration: number;
  eligibleAt: Date | null;
  recordedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  ledgerEntries: readonly {
    id: string;
    entryType: SettlementLedgerEntry['entryType'];
    amountMinor: number;
    currency: string;
    idempotencyKey: string;
    sourceEventId: string | null;
    details: Record<string, unknown>;
    occurredAt: Date;
    createdAt: Date;
  }[];
}>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

function requiredUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error(`Settlement event has an invalid ${field}`);
  }
  return value;
}

function requiredAmount(
  value: unknown,
  field: string,
  allowZero = true,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    (allowZero ? value < 0 : value <= 0) ||
    value > MAX_SETTLEMENT_MINOR_AMOUNT
  ) {
    throw new Error(`Settlement event has an invalid ${field}`);
  }
  return value;
}

function optionalSignedAmount(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < -MAX_SETTLEMENT_MINOR_AMOUNT ||
    value > MAX_SETTLEMENT_MINOR_AMOUNT
  ) {
    throw new Error(`Settlement event has an invalid ${field}`);
  }
  return value;
}

function requiredCurrency(value: unknown): string {
  if (typeof value !== 'string' || !CURRENCY_PATTERN.test(value)) {
    throw new Error('Settlement event has an invalid currency');
  }
  return value;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Settlement event has an invalid ${field}`);
  }
  return value;
}

function requiredDate(value: unknown, field: string): Date {
  if (typeof value !== 'string' && !(value instanceof Date)) {
    throw new Error(`Settlement event has an invalid ${field}`);
  }
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Settlement event has an invalid ${field}`);
  }
  return date;
}

function completedOrderPayload(
  value: Record<string, unknown>,
): CompletedOrderPayload {
  if (value.status !== undefined && value.status !== 'COMPLETED') {
    throw new Error('OrderCompleted event does not contain a completed order');
  }
  return {
    orderId: requiredUuid(value.orderId, 'order ID'),
    storeId: requiredUuid(value.storeId, 'store ID'),
    orderAmount: requiredAmount(value.orderAmount, 'order amount'),
    currency: requiredCurrency(value.currency),
    completedAt: requiredDate(value.completedAt, 'completedAt'),
    adjustmentAmountMinor: optionalSignedAmount(
      value.adjustmentAmountMinor,
      'adjustment amount',
    ),
  };
}

function paymentSucceededPayload(
  value: Record<string, unknown>,
): PaymentSucceededPayload {
  return {
    paymentIntentId: requiredUuid(value.paymentIntentId, 'payment intent ID'),
    orderId: requiredUuid(value.orderId, 'order ID'),
    storeId: requiredUuid(value.storeId, 'store ID'),
    amount: requiredAmount(value.amount, 'payment amount'),
    currency: requiredCurrency(value.currency),
    providerReference: requiredText(
      value.providerReference,
      'provider reference',
    ),
  };
}

function paymentRefundedPayload(
  value: Record<string, unknown>,
): PaymentRefundedPayload {
  return {
    paymentIntentId: requiredUuid(value.paymentIntentId, 'payment intent ID'),
    orderId: requiredUuid(value.orderId, 'order ID'),
    storeId: requiredUuid(value.storeId, 'store ID'),
    refundAmount: requiredAmount(value.refundAmount, 'refund amount', false),
    currency: requiredCurrency(value.currency),
    providerReference: requiredText(
      value.providerReference,
      'provider reference',
    ),
  };
}

function orderCancelledPayload(
  value: Record<string, unknown>,
): OrderCancelledPayload {
  if (typeof value.refundRequired !== 'boolean') {
    throw new Error('OrderCancelled event has an invalid refundRequired flag');
  }
  return {
    orderId: requiredUuid(value.orderId, 'order ID'),
    storeId: requiredUuid(value.storeId, 'store ID'),
    reason: requiredText(value.reason, 'cancellation reason'),
    refundRequired: value.refundRequired,
  };
}

function datesEqual(left: Date, right: Date): boolean {
  return left.getTime() === right.getTime();
}

function assertSameFact(matches: boolean, message: string): asserts matches {
  if (!matches) {
    throw new ConflictException(message);
  }
}

@Injectable()
export class SettlementRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly outboxService: OutboxService,
  ) {}

  async projectEvent(
    event: IntegrationEventEnvelope,
    tx: DrizzleTransaction,
  ): Promise<SettlementProjectionResult> {
    switch (event.eventType) {
      case 'PaymentSucceeded':
        return this.projectPaymentSucceeded(event, tx);
      case 'OrderCompleted':
        return this.projectOrderCompleted(event, tx);
      case 'PaymentRefunded':
        return this.projectPaymentRefunded(event, tx);
      case 'OrderCancelled':
        return this.projectOrderCancelled(event, tx);
      default:
        throw new Error(`Unsupported Settlement event ${event.eventType}`);
    }
  }

  async getSettlement(settlementId: string): Promise<Settlement | undefined> {
    const [settlement] = await this.db
      .select()
      .from(settlements)
      .where(eq(settlements.id, settlementId))
      .limit(1);
    return settlement;
  }

  async getSettlementByOrder(orderId: string): Promise<Settlement | undefined> {
    const [settlement] = await this.db
      .select()
      .from(settlements)
      .where(eq(settlements.orderId, orderId))
      .limit(1);
    return settlement;
  }

  async getView(settlementId: string): Promise<SettlementView | undefined> {
    const settlement = await this.getSettlement(settlementId);
    return settlement ? this.toView(settlement) : undefined;
  }

  async getViewByOrder(orderId: string): Promise<SettlementView | undefined> {
    const settlement = await this.getSettlementByOrder(orderId);
    return settlement ? this.toView(settlement) : undefined;
  }

  async listViewsForStore(storeId: string): Promise<SettlementView[]> {
    const settlementRows = await this.db
      .select()
      .from(settlements)
      .where(eq(settlements.storeId, storeId))
      .orderBy(asc(settlements.createdAt), asc(settlements.id));
    return Promise.all(
      settlementRows.map((settlement) => this.toView(settlement)),
    );
  }

  async getWorkflowFacts(
    settlementId: string,
  ): Promise<SettlementWorkflowFacts | undefined> {
    const settlement = await this.getSettlement(settlementId);
    if (!settlement) {
      return undefined;
    }
    const [orderFact] = await this.db
      .select()
      .from(settlementOrderFacts)
      .where(eq(settlementOrderFacts.orderId, settlement.orderId))
      .limit(1);
    const [paymentFact] = await this.db
      .select()
      .from(settlementPaymentFacts)
      .where(eq(settlementPaymentFacts.orderId, settlement.orderId))
      .limit(1);
    if (!orderFact || !paymentFact) {
      return undefined;
    }
    const refundRows = await this.db
      .select()
      .from(settlementRefundFacts)
      .where(eq(settlementRefundFacts.orderId, settlement.orderId))
      .orderBy(
        asc(settlementRefundFacts.occurredAt),
        asc(settlementRefundFacts.id),
      );
    return {
      settlement,
      orderFact,
      paymentFact,
      refunds: refundRows,
      calculation: this.calculation(
        settlement,
        orderFact,
        paymentFact,
        refundRows,
      ),
    };
  }

  async recordSettlement(input: SettlementWorkflowInput): Promise<Settlement> {
    return this.outboxService.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(settlements)
        .where(eq(settlements.id, input.settlementId))
        .limit(1);
      if (!current) {
        throw new NotFoundException('Settlement not found');
      }
      if (current.status === 'RECORDED') {
        return current;
      }

      const [cancelled] = await tx
        .select({ orderId: settlementCancellationFacts.orderId })
        .from(settlementCancellationFacts)
        .where(eq(settlementCancellationFacts.orderId, current.orderId))
        .limit(1);
      if (cancelled) {
        return current;
      }

      const facts = await this.getWorkflowFactsInTransaction(tx, current);
      if (!facts) {
        return current;
      }

      const now = new Date();
      const [eligible] = await tx
        .update(settlements)
        .set({
          status: 'ELIGIBLE',
          grossAmountMinor: facts.calculation.grossAmountMinor,
          paymentAmountMinor: facts.paymentFact.amountMinor,
          feeAmountMinor: facts.calculation.feeAmountMinor,
          refundAmountMinor: facts.calculation.refundAmountMinor,
          adjustmentAmountMinor: facts.calculation.adjustmentAmountMinor,
          payableAmountMinor: facts.calculation.payableAmountMinor,
          eligibleAt: current.eligibleAt ?? now,
          correlationId: input.correlationId,
          causationId: input.causationId,
          lastError: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(settlements.id, current.id),
            inArray(settlements.status, ['PENDING', 'ELIGIBLE']),
          ),
        )
        .returning();
      if (!eligible) {
        const [latest] = await tx
          .select()
          .from(settlements)
          .where(eq(settlements.id, current.id))
          .limit(1);
        return latest ?? current;
      }

      await this.insertLedgerEntries(
        tx,
        eligible,
        facts,
        input.causationId,
        now,
      );

      const [recorded] = await tx
        .update(settlements)
        .set({
          status: 'RECORDED',
          aggregateVersion: sql`${settlements.aggregateVersion} + 1`,
          recordedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(settlements.id, eligible.id),
            eq(settlements.status, 'ELIGIBLE'),
          ),
        )
        .returning();
      if (!recorded) {
        const [latest] = await tx
          .select()
          .from(settlements)
          .where(eq(settlements.id, eligible.id))
          .limit(1);
        return latest ?? eligible;
      }

      await this.outboxService.enqueue(
        tx,
        this.settlementRecordedEvent(recorded, input, now),
      );
      return recorded;
    });
  }

  private async projectPaymentSucceeded(
    event: IntegrationEventEnvelope,
    tx: DrizzleTransaction,
  ): Promise<SettlementProjectionResult> {
    const payload = paymentSucceededPayload(event.payload);
    const now = new Date();
    await tx
      .insert(settlementPaymentFacts)
      .values({
        paymentIntentId: payload.paymentIntentId,
        orderId: payload.orderId,
        storeId: payload.storeId,
        amountMinor: payload.amount,
        currency: payload.currency,
        providerReference: payload.providerReference,
        eventId: event.eventId,
        idempotencyKey: event.idempotencyKey,
        aggregateVersion: event.aggregateVersion,
        succeededAt: new Date(event.occurredAt),
        snapshot: event.payload,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: settlementPaymentFacts.paymentIntentId });

    const [paymentFact] = await tx
      .select()
      .from(settlementPaymentFacts)
      .where(
        eq(settlementPaymentFacts.paymentIntentId, payload.paymentIntentId),
      )
      .limit(1);
    if (!paymentFact) {
      throw new Error('Settlement Payment fact was not projected');
    }
    assertSameFact(
      paymentFact.orderId === payload.orderId &&
        paymentFact.storeId === payload.storeId &&
        paymentFact.amountMinor === payload.amount &&
        paymentFact.currency === payload.currency &&
        paymentFact.providerReference === payload.providerReference,
      `PaymentSucceeded fact for ${payload.paymentIntentId} was reused with different data`,
    );

    const settlement = await this.ensureSettlement(
      tx,
      payload.orderId,
      payload.storeId,
      payload.currency,
      event,
    );
    return this.evaluateEligibility(tx, settlement, event);
  }

  private async projectOrderCompleted(
    event: IntegrationEventEnvelope,
    tx: DrizzleTransaction,
  ): Promise<SettlementProjectionResult> {
    const payload = completedOrderPayload(event.payload);
    const now = new Date();
    await tx
      .insert(settlementOrderFacts)
      .values({
        orderId: payload.orderId,
        storeId: payload.storeId,
        amountMinor: payload.orderAmount,
        currency: payload.currency,
        status: 'COMPLETED',
        completedAt: payload.completedAt,
        eventId: event.eventId,
        idempotencyKey: event.idempotencyKey,
        aggregateVersion: event.aggregateVersion,
        snapshot: event.payload,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: settlementOrderFacts.orderId });

    const [orderFact] = await tx
      .select()
      .from(settlementOrderFacts)
      .where(eq(settlementOrderFacts.orderId, payload.orderId))
      .limit(1);
    if (!orderFact) {
      throw new Error('Settlement Order fact was not projected');
    }
    assertSameFact(
      orderFact.storeId === payload.storeId &&
        orderFact.amountMinor === payload.orderAmount &&
        orderFact.currency === payload.currency &&
        orderFact.status === 'COMPLETED' &&
        datesEqual(orderFact.completedAt, payload.completedAt),
      `OrderCompleted fact for ${payload.orderId} was reused with different data`,
    );

    const settlement = await this.ensureSettlement(
      tx,
      payload.orderId,
      payload.storeId,
      payload.currency,
      event,
      payload.adjustmentAmountMinor,
    );
    return this.evaluateEligibility(tx, settlement, event);
  }

  private async projectPaymentRefunded(
    event: IntegrationEventEnvelope,
    tx: DrizzleTransaction,
  ): Promise<SettlementProjectionResult> {
    const payload = paymentRefundedPayload(event.payload);
    const now = new Date();
    await tx
      .insert(settlementRefundFacts)
      .values({
        id: randomUUID(),
        paymentIntentId: payload.paymentIntentId,
        orderId: payload.orderId,
        storeId: payload.storeId,
        refundAmountMinor: payload.refundAmount,
        currency: payload.currency,
        providerReference: payload.providerReference,
        eventId: event.eventId,
        idempotencyKey: event.idempotencyKey,
        occurredAt: new Date(event.occurredAt),
        snapshot: event.payload,
        createdAt: now,
      })
      .onConflictDoNothing({ target: settlementRefundFacts.eventId });

    const [refundFact] = await tx
      .select()
      .from(settlementRefundFacts)
      .where(eq(settlementRefundFacts.eventId, event.eventId))
      .limit(1);
    if (!refundFact) {
      throw new Error('Settlement Refund fact was not projected');
    }
    assertSameFact(
      refundFact.paymentIntentId === payload.paymentIntentId &&
        refundFact.orderId === payload.orderId &&
        refundFact.storeId === payload.storeId &&
        refundFact.refundAmountMinor === payload.refundAmount &&
        refundFact.currency === payload.currency &&
        refundFact.providerReference === payload.providerReference,
      `PaymentRefunded event ${event.eventId} was reused with different data`,
    );

    const settlement = await this.getSettlementInTransaction(
      tx,
      payload.orderId,
    );
    if (!settlement) {
      return { workflowInput: null };
    }
    assertSameFact(
      settlement.storeId === payload.storeId &&
        settlement.currency === payload.currency,
      `PaymentRefunded store or currency does not match Settlement ${settlement.id}`,
    );
    if (settlement.status === 'RECORDED') {
      await this.appendRecordedRefund(tx, settlement, refundFact, event, now);
      return { workflowInput: null };
    }
    return this.evaluateEligibility(tx, settlement, event);
  }

  private async projectOrderCancelled(
    event: IntegrationEventEnvelope,
    tx: DrizzleTransaction,
  ): Promise<SettlementProjectionResult> {
    const payload = orderCancelledPayload(event.payload);
    const now = new Date();
    await tx
      .insert(settlementCancellationFacts)
      .values({
        orderId: payload.orderId,
        storeId: payload.storeId,
        reason: payload.reason,
        refundRequired: payload.refundRequired,
        eventId: event.eventId,
        idempotencyKey: event.idempotencyKey,
        occurredAt: new Date(event.occurredAt),
        snapshot: event.payload,
        createdAt: now,
      })
      .onConflictDoNothing({ target: settlementCancellationFacts.orderId });

    const [cancellation] = await tx
      .select()
      .from(settlementCancellationFacts)
      .where(eq(settlementCancellationFacts.orderId, payload.orderId))
      .limit(1);
    if (!cancellation) {
      throw new Error('Settlement Cancellation fact was not projected');
    }
    assertSameFact(
      cancellation.storeId === payload.storeId &&
        cancellation.reason === payload.reason &&
        cancellation.refundRequired === payload.refundRequired,
      `OrderCancelled fact for ${payload.orderId} was reused with different data`,
    );

    const settlement = await this.getSettlementInTransaction(
      tx,
      payload.orderId,
    );
    if (!settlement || settlement.status === 'RECORDED') {
      return { workflowInput: null };
    }
    await tx
      .update(settlements)
      .set({
        status: 'PENDING',
        eligibleAt: null,
        lastError: 'Order was cancelled before settlement recording',
        updatedAt: now,
      })
      .where(
        and(
          eq(settlements.id, settlement.id),
          inArray(settlements.status, ['PENDING', 'ELIGIBLE']),
        ),
      );
    return { workflowInput: null };
  }

  private async ensureSettlement(
    tx: DrizzleTransaction,
    orderId: string,
    storeId: string,
    currency: string,
    event: IntegrationEventEnvelope,
    adjustmentAmountMinor?: number,
  ): Promise<Settlement> {
    const [existing] = await tx
      .select()
      .from(settlements)
      .where(eq(settlements.orderId, orderId))
      .limit(1);
    if (existing) {
      this.assertSettlementScope(existing, storeId, currency);
      if (
        adjustmentAmountMinor !== undefined &&
        existing.adjustmentAmountMinor !== 0 &&
        existing.adjustmentAmountMinor !== adjustmentAmountMinor
      ) {
        throw new ConflictException(
          `Settlement adjustment for Order ${orderId} was reused with different data`,
        );
      }
      if (
        adjustmentAmountMinor !== undefined &&
        existing.adjustmentAmountMinor === 0 &&
        adjustmentAmountMinor !== 0
      ) {
        const [updated] = await tx
          .update(settlements)
          .set({
            adjustmentAmountMinor,
            updatedAt: new Date(),
          })
          .where(eq(settlements.id, existing.id))
          .returning();
        return updated ?? existing;
      }
      return existing;
    }

    const now = new Date();
    await tx
      .insert(settlements)
      .values({
        id: randomUUID(),
        orderId,
        storeId,
        currency,
        feeBasisPoints: configuredSettlementFeeBasisPoints(),
        adjustmentAmountMinor: adjustmentAmountMinor ?? 0,
        status: 'PENDING',
        correlationId: event.correlationId,
        causationId: event.eventId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: settlements.orderId });
    const [settlement] = await tx
      .select()
      .from(settlements)
      .where(eq(settlements.orderId, orderId))
      .limit(1);
    if (!settlement) {
      throw new Error(`Settlement for Order ${orderId} was not created`);
    }
    this.assertSettlementScope(settlement, storeId, currency);
    return settlement;
  }

  private async evaluateEligibility(
    tx: DrizzleTransaction,
    settlement: Settlement,
    event: IntegrationEventEnvelope,
  ): Promise<SettlementProjectionResult> {
    if (settlement.status === 'RECORDED') {
      return { workflowInput: null };
    }

    const [cancelled] = await tx
      .select({ orderId: settlementCancellationFacts.orderId })
      .from(settlementCancellationFacts)
      .where(eq(settlementCancellationFacts.orderId, settlement.orderId))
      .limit(1);
    if (cancelled) {
      return { workflowInput: null };
    }

    const facts = await this.getWorkflowFactsInTransaction(tx, settlement);
    if (!facts) {
      return { workflowInput: null };
    }
    const now = new Date();
    const values = {
      status: 'ELIGIBLE' as const,
      grossAmountMinor: facts.calculation.grossAmountMinor,
      paymentAmountMinor: facts.paymentFact.amountMinor,
      feeAmountMinor: facts.calculation.feeAmountMinor,
      refundAmountMinor: facts.calculation.refundAmountMinor,
      adjustmentAmountMinor: facts.calculation.adjustmentAmountMinor,
      payableAmountMinor: facts.calculation.payableAmountMinor,
      eligibleAt: settlement.eligibleAt ?? now,
      correlationId: event.correlationId,
      causationId: event.eventId,
      lastError: null,
      updatedAt: now,
    };
    const changed =
      settlement.status !== 'ELIGIBLE' ||
      settlement.grossAmountMinor !== values.grossAmountMinor ||
      settlement.paymentAmountMinor !== values.paymentAmountMinor ||
      settlement.feeAmountMinor !== values.feeAmountMinor ||
      settlement.refundAmountMinor !== values.refundAmountMinor ||
      settlement.adjustmentAmountMinor !== values.adjustmentAmountMinor ||
      settlement.payableAmountMinor !== values.payableAmountMinor;
    let current = settlement;
    if (changed) {
      const [updated] = await tx
        .update(settlements)
        .set({
          ...values,
          aggregateVersion: sql`${settlements.aggregateVersion} + 1`,
        })
        .where(
          and(
            eq(settlements.id, settlement.id),
            inArray(settlements.status, ['PENDING', 'ELIGIBLE']),
          ),
        )
        .returning();
      current = updated ?? settlement;
    }

    return {
      workflowInput: {
        settlementId: current.id,
        workflowGeneration: current.workflowGeneration,
        correlationId: current.correlationId,
        causationId: current.causationId,
      },
    };
  }

  private async getWorkflowFactsInTransaction(
    tx: DrizzleTransaction,
    settlement: Settlement,
  ): Promise<SettlementWorkflowFacts | undefined> {
    const [orderFact] = await tx
      .select()
      .from(settlementOrderFacts)
      .where(eq(settlementOrderFacts.orderId, settlement.orderId))
      .limit(1);
    const [paymentFact] = await tx
      .select()
      .from(settlementPaymentFacts)
      .where(eq(settlementPaymentFacts.orderId, settlement.orderId))
      .limit(1);
    if (!orderFact || !paymentFact) {
      return undefined;
    }
    assertSameFact(
      orderFact.storeId === settlement.storeId &&
        paymentFact.storeId === settlement.storeId &&
        orderFact.currency === settlement.currency &&
        paymentFact.currency === settlement.currency &&
        paymentFact.amountMinor === orderFact.amountMinor,
      `Settlement facts for Order ${settlement.orderId} do not agree`,
    );
    const refundRows = await tx
      .select()
      .from(settlementRefundFacts)
      .where(eq(settlementRefundFacts.orderId, settlement.orderId))
      .orderBy(
        asc(settlementRefundFacts.occurredAt),
        asc(settlementRefundFacts.id),
      );
    return {
      settlement,
      orderFact,
      paymentFact,
      refunds: refundRows,
      calculation: this.calculation(
        settlement,
        orderFact,
        paymentFact,
        refundRows,
      ),
    };
  }

  private calculation(
    settlement: Settlement,
    orderFact: SettlementOrderFact,
    paymentFact: SettlementPaymentFact,
    refunds: readonly SettlementRefundFact[],
  ): SettlementCalculation {
    assertSameFact(
      paymentFact.amountMinor === orderFact.amountMinor,
      `Payment amount does not match Order ${orderFact.orderId}`,
    );
    return calculateSettlement({
      grossAmountMinor: orderFact.amountMinor,
      feeBasisPoints: settlement.feeBasisPoints,
      refunds: refunds.map((refund) => refund.refundAmountMinor),
      adjustmentAmountMinor: settlement.adjustmentAmountMinor,
    });
  }

  private async insertLedgerEntries(
    tx: DrizzleTransaction,
    settlement: Settlement,
    facts: SettlementWorkflowFacts,
    sourceEventId: string | null,
    occurredAt: Date,
  ): Promise<void> {
    const entries: Array<{
      entryType: 'GROSS' | 'FEE' | 'REFUND' | 'ADJUSTMENT';
      amountMinor: number;
      idempotencyKey: string;
      sourceEventId: string | null;
      details: Record<string, unknown>;
      occurredAt: Date;
    }> = [
      {
        entryType: 'GROSS',
        amountMinor: facts.calculation.grossAmountMinor,
        idempotencyKey: `settlement:${settlement.id}:gross`,
        sourceEventId: facts.orderFact.eventId,
        details: {
          orderId: settlement.orderId,
          orderAmountMinor: facts.calculation.grossAmountMinor,
        },
        occurredAt: facts.orderFact.completedAt,
      },
      {
        entryType: 'FEE',
        amountMinor: -facts.calculation.feeAmountMinor,
        idempotencyKey: `settlement:${settlement.id}:fee`,
        sourceEventId,
        details: {
          feeBasisPoints: facts.calculation.feeBasisPoints,
          feeAmountMinor: facts.calculation.feeAmountMinor,
          policy: 'gross-floor-basis-points-v1',
        },
        occurredAt,
      },
    ];
    for (const refund of facts.refunds) {
      entries.push({
        entryType: 'REFUND',
        amountMinor: -refund.refundAmountMinor,
        idempotencyKey: `settlement:${settlement.id}:refund:${refund.eventId}`,
        sourceEventId: refund.eventId,
        details: {
          paymentIntentId: refund.paymentIntentId,
          providerReference: refund.providerReference,
          refundAmountMinor: refund.refundAmountMinor,
        },
        occurredAt: refund.occurredAt,
      });
    }
    if (facts.calculation.adjustmentAmountMinor !== 0) {
      entries.push({
        entryType: 'ADJUSTMENT',
        amountMinor: facts.calculation.adjustmentAmountMinor,
        idempotencyKey: `settlement:${settlement.id}:adjustment:v1`,
        sourceEventId,
        details: {
          adjustmentAmountMinor: facts.calculation.adjustmentAmountMinor,
          policy: 'v1-internal-adjustment',
        },
        occurredAt,
      });
    }

    for (const entry of entries) {
      await tx
        .insert(settlementLedgerEntries)
        .values({
          id: randomUUID(),
          settlementId: settlement.id,
          orderId: settlement.orderId,
          storeId: settlement.storeId,
          entryType: entry.entryType,
          amountMinor: entry.amountMinor,
          currency: settlement.currency,
          idempotencyKey: entry.idempotencyKey,
          sourceEventId: entry.sourceEventId,
          details: entry.details,
          occurredAt: entry.occurredAt,
        })
        .onConflictDoNothing({
          target: settlementLedgerEntries.idempotencyKey,
        });
      const [stored] = await tx
        .select({
          amountMinor: settlementLedgerEntries.amountMinor,
          entryType: settlementLedgerEntries.entryType,
          settlementId: settlementLedgerEntries.settlementId,
        })
        .from(settlementLedgerEntries)
        .where(eq(settlementLedgerEntries.idempotencyKey, entry.idempotencyKey))
        .limit(1);
      if (!stored) {
        throw new Error('Settlement Ledger Entry was not created');
      }
      assertSameFact(
        stored.settlementId === settlement.id &&
          stored.entryType === entry.entryType &&
          stored.amountMinor === entry.amountMinor,
        `Settlement ledger idempotency key ${entry.idempotencyKey} was reused`,
      );
    }
  }

  private async appendRecordedRefund(
    tx: DrizzleTransaction,
    settlement: Settlement,
    refund: SettlementRefundFact,
    event: IntegrationEventEnvelope,
    occurredAt: Date,
  ): Promise<void> {
    const [paymentFact] = await tx
      .select()
      .from(settlementPaymentFacts)
      .where(eq(settlementPaymentFacts.paymentIntentId, refund.paymentIntentId))
      .limit(1);
    if (!paymentFact || paymentFact.orderId !== settlement.orderId) {
      throw new ConflictException(
        `PaymentRefunded does not match Settlement ${settlement.id}`,
      );
    }
    const calculation = calculateSettlement({
      grossAmountMinor: settlement.grossAmountMinor ?? 0,
      feeBasisPoints: settlement.feeBasisPoints,
      refundAmountMinor:
        settlement.refundAmountMinor + refund.refundAmountMinor,
      adjustmentAmountMinor: settlement.adjustmentAmountMinor,
    });
    const [inserted] = await tx
      .insert(settlementLedgerEntries)
      .values({
        id: randomUUID(),
        settlementId: settlement.id,
        orderId: settlement.orderId,
        storeId: settlement.storeId,
        entryType: 'REFUND',
        amountMinor: -refund.refundAmountMinor,
        currency: settlement.currency,
        idempotencyKey: `settlement:${settlement.id}:refund:${refund.eventId}`,
        sourceEventId: event.eventId,
        details: {
          paymentIntentId: refund.paymentIntentId,
          providerReference: refund.providerReference,
          refundAmountMinor: refund.refundAmountMinor,
        },
        occurredAt,
      })
      .onConflictDoNothing({
        target: settlementLedgerEntries.idempotencyKey,
      })
      .returning({ id: settlementLedgerEntries.id });
    if (!inserted) {
      return;
    }
    await tx
      .update(settlements)
      .set({
        refundAmountMinor: calculation.refundAmountMinor,
        payableAmountMinor: calculation.payableAmountMinor,
        aggregateVersion: sql`${settlements.aggregateVersion} + 1`,
        updatedAt: occurredAt,
      })
      .where(
        and(
          eq(settlements.id, settlement.id),
          eq(settlements.status, 'RECORDED'),
        ),
      );
  }

  private settlementRecordedEvent(
    settlement: Settlement,
    input: SettlementWorkflowInput,
    occurredAt: Date,
  ) {
    return this.outboxService.createEvent({
      eventId: `settlement-recorded:${settlement.id}`,
      idempotencyKey: `settlement-recorded:${settlement.id}`,
      eventType: 'SettlementRecorded',
      eventVersion: 1,
      occurredAt,
      producer: 'Settlement',
      aggregateType: 'Settlement',
      aggregateId: settlement.id,
      aggregateVersion: settlement.aggregateVersion,
      correlationId: settlement.correlationId || input.correlationId,
      causationId: input.causationId,
      payload: {
        settlementId: settlement.id,
        orderId: settlement.orderId,
        storeId: settlement.storeId,
        payableAmount: settlement.payableAmountMinor,
        currency: settlement.currency,
        grossAmount: settlement.grossAmountMinor,
        feeAmount: settlement.feeAmountMinor,
        refundAmount: settlement.refundAmountMinor,
        adjustmentAmount: settlement.adjustmentAmountMinor,
      },
    });
  }

  private async getSettlementInTransaction(
    tx: DrizzleTransaction,
    orderId: string,
  ): Promise<Settlement | undefined> {
    const [settlement] = await tx
      .select()
      .from(settlements)
      .where(eq(settlements.orderId, orderId))
      .limit(1);
    return settlement;
  }

  private assertSettlementScope(
    settlement: Settlement,
    storeId: string,
    currency: string,
  ): void {
    assertSameFact(
      settlement.storeId === storeId && settlement.currency === currency,
      `Settlement scope does not match Order ${settlement.orderId}`,
    );
  }

  private async toView(settlement: Settlement): Promise<SettlementView> {
    const ledgerRows = await this.db
      .select()
      .from(settlementLedgerEntries)
      .where(eq(settlementLedgerEntries.settlementId, settlement.id))
      .orderBy(
        asc(settlementLedgerEntries.createdAt),
        asc(settlementLedgerEntries.id),
      );
    return {
      id: settlement.id,
      orderId: settlement.orderId,
      storeId: settlement.storeId,
      status: settlement.status,
      currency: settlement.currency,
      feeBasisPoints: settlement.feeBasisPoints,
      grossAmountMinor: settlement.grossAmountMinor,
      paymentAmountMinor: settlement.paymentAmountMinor,
      feeAmountMinor: settlement.feeAmountMinor,
      refundAmountMinor: settlement.refundAmountMinor,
      adjustmentAmountMinor: settlement.adjustmentAmountMinor,
      payableAmountMinor: settlement.payableAmountMinor,
      aggregateVersion: settlement.aggregateVersion,
      workflowGeneration: settlement.workflowGeneration,
      eligibleAt: settlement.eligibleAt,
      recordedAt: settlement.recordedAt,
      createdAt: settlement.createdAt,
      updatedAt: settlement.updatedAt,
      ledgerEntries: ledgerRows.map((entry) => ({
        id: entry.id,
        entryType: entry.entryType,
        amountMinor: entry.amountMinor,
        currency: entry.currency,
        idempotencyKey: entry.idempotencyKey,
        sourceEventId: entry.sourceEventId,
        details: entry.details,
        occurredAt: entry.occurredAt,
        createdAt: entry.createdAt,
      })),
    };
  }
}

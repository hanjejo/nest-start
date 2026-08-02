import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { and, eq } from 'drizzle-orm';
import { newDb } from 'pg-mem';
import request from 'supertest';
import { AppModule } from '../src/app/app.module';
import { DATABASE_POOL, DRIZZLE, DrizzleDB } from '../src/db/drizzle.module';
import {
  inboxEvents,
  outboxEvents,
  settlementCancellationFacts,
  settlementLedgerEntries,
  settlementOrderFacts,
  settlements,
} from '../src/db/schema';
import { OutboxService } from '../src/messaging/outbox.service';
import {
  createIntegrationEvent,
  IntegrationEventEnvelope,
} from '../src/messaging/integration-event';
import { INTEGRATION_EVENT_TRANSPORT } from '../src/messaging/messaging.constants';
import { IntegrationEventTransport } from '../src/messaging/messaging.transport';
import { SettlementRepository } from '../src/settlement/settlement.repository';
import { SettlementWorkflowEngine } from '../src/settlement/settlement-workflow.engine';
import { SettlementWorkflowRuntimeService } from '../src/settlement/settlement-workflow-runtime';

type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    name: string;
  };
};

type Scenario = {
  platform: AuthResponse;
  operatorA: AuthResponse;
  adminA: AuthResponse;
  operatorB: AuthResponse;
  storeA: string;
  storeB: string;
};

const BOOTSTRAP_TOKEN = 'settlement-test-bootstrap-token';
const STORE_A_ID = '90000000-0000-4000-8000-000000000001';
const STORE_B_ID = '90000000-0000-4000-8000-000000000002';
const ORDER_ID = '90000000-0000-4000-8000-000000000101';
const PAYMENT_INTENT_ID = '90000000-0000-4000-8000-000000000201';
const AUTH_ORDER_ID = '90000000-0000-4000-8000-000000000102';
const AUTH_PAYMENT_INTENT_ID = '90000000-0000-4000-8000-000000000202';
const OCCURRED_AT = '2026-08-02T13:00:00.000Z';

function createMemoryPool() {
  const database = newDb();
  const { Pool } = database.adapters.createPg();
  const pool = new Pool();
  const query = pool.query.bind(pool);

  pool.query = (queryConfig: unknown, ...args: unknown[]) => {
    if (typeof queryConfig === 'object' && queryConfig !== null) {
      const sanitizedQuery = { ...(queryConfig as Record<string, unknown>) };
      const rowMode = sanitizedQuery.rowMode;
      delete sanitizedQuery.types;
      delete sanitizedQuery.rowMode;
      const result = query(sanitizedQuery, ...args);
      if (rowMode !== 'array') {
        return result;
      }
      return result.then((response: { rows: Record<string, unknown>[] }) => ({
        ...response,
        rows: response.rows.map((row) => Object.values(row)),
      }));
    }
    return query(queryConfig, ...args);
  };

  return pool;
}

function event(
  eventType:
    | 'OrderCompleted'
    | 'OrderCancelled'
    | 'PaymentSucceeded'
    | 'PaymentRefunded',
  aggregateId: string,
  payload: Record<string, unknown>,
  eventId: string,
): IntegrationEventEnvelope {
  return createIntegrationEvent({
    eventId,
    idempotencyKey: eventId,
    eventType,
    eventVersion: 1,
    occurredAt: OCCURRED_AT,
    producer: eventType.startsWith('Payment') ? 'Payment' : 'Ordering',
    aggregateType: eventType.startsWith('Payment') ? 'PaymentIntent' : 'Order',
    aggregateId,
    aggregateVersion: 1,
    correlationId: `correlation:${eventId}`,
    causationId: null,
    payload,
  });
}

function paymentSucceeded(
  orderId = ORDER_ID,
  paymentIntentId = PAYMENT_INTENT_ID,
  storeId = STORE_A_ID,
  amount = 10_001,
  eventId = `payment-succeeded:${paymentIntentId}`,
): IntegrationEventEnvelope {
  return event(
    'PaymentSucceeded',
    paymentIntentId,
    {
      paymentIntentId,
      orderId,
      storeId,
      amount,
      currency: 'USD',
      providerReference: `fake-charge:${paymentIntentId}`,
    },
    eventId,
  );
}

function orderCompleted(
  orderId = ORDER_ID,
  storeId = STORE_A_ID,
  amount = 10_001,
  eventId = `order-completed:${orderId}`,
  extra: Record<string, unknown> = {},
): IntegrationEventEnvelope {
  return event(
    'OrderCompleted',
    orderId,
    {
      orderId,
      storeId,
      orderAmount: amount,
      currency: 'USD',
      completedAt: OCCURRED_AT,
      ...extra,
    },
    eventId,
  );
}

function paymentRefunded(
  eventId = 'payment-refunded:one',
): IntegrationEventEnvelope {
  return event(
    'PaymentRefunded',
    PAYMENT_INTENT_ID,
    {
      paymentIntentId: PAYMENT_INTENT_ID,
      orderId: ORDER_ID,
      storeId: STORE_A_ID,
      refundAmount: 100,
      currency: 'USD',
      providerReference: 'fake-refund:one',
    },
    eventId,
  );
}

function orderCancelled(
  orderId = ORDER_ID,
  eventId = `order-cancelled:${orderId}`,
): IntegrationEventEnvelope {
  return event(
    'OrderCancelled',
    orderId,
    {
      orderId,
      storeId: STORE_A_ID,
      reason: 'CUSTOMER_REQUESTED',
      refundRequired: true,
    },
    eventId,
  );
}

describe('SettlementWorkflow (e2e)', () => {
  let app: INestApplication | undefined;
  let emailCounter = 0;
  const previousEnvironment = new Map<string, string | undefined>();
  const environmentKeys = [
    'RBAC_BOOTSTRAP_TOKEN',
    'RBAC_BOOTSTRAP_ENABLED',
    'PAYMENT_WORKFLOW_RUNTIME',
    'DELIVERY_WORKFLOW_RUNTIME',
    'SETTLEMENT_WORKFLOW_RUNTIME',
    'RABBITMQ_URL',
  ];

  function httpServer() {
    if (!app) {
      throw new Error('Settlement test application is not initialized');
    }
    return app.getHttpServer();
  }

  function database(): DrizzleDB {
    if (!app) {
      throw new Error('Settlement test application is not initialized');
    }
    return app.get<DrizzleDB>(DRIZZLE);
  }

  async function deliver(
    integrationEvent: IntegrationEventEnvelope,
  ): Promise<{ status: string; attempts: number }> {
    if (!app) {
      throw new Error('Settlement test application is not initialized');
    }
    const databaseBefore = await database()
      .select({
        status: inboxEvents.status,
        attempts: inboxEvents.attempts,
      })
      .from(inboxEvents)
      .where(
        and(
          eq(inboxEvents.consumerName, 'settlement.integration'),
          eq(inboxEvents.eventId, integrationEvent.eventId),
        ),
      )
      .limit(1);
    const transport = app.get<IntegrationEventTransport>(
      INTEGRATION_EVENT_TRANSPORT,
    );
    await transport.publish(integrationEvent);
    const [databaseAfter] = await database()
      .select({
        status: inboxEvents.status,
        attempts: inboxEvents.attempts,
      })
      .from(inboxEvents)
      .where(
        and(
          eq(inboxEvents.consumerName, 'settlement.integration'),
          eq(inboxEvents.eventId, integrationEvent.eventId),
        ),
      )
      .limit(1);
    if (!databaseAfter) {
      throw new Error('Settlement Inbox record was not created');
    }
    return {
      status:
        databaseBefore[0]?.status === 'PROCESSED' &&
        databaseAfter.status === 'PROCESSED'
          ? 'DUPLICATE'
          : databaseAfter.status === 'PROCESSED'
            ? 'PROCESSED'
            : databaseAfter.status === 'DEAD_LETTERED'
              ? 'DEAD_LETTERED'
              : 'RETRY',
      attempts: databaseAfter.attempts,
    };
  }

  async function register(role: string): Promise<AuthResponse> {
    const response = await request(httpServer())
      .post('/api/auth/register')
      .send({
        email: `${role}-${++emailCounter}@example.com`,
        password: 'correct horse battery staple',
        name: role,
      })
      .expect(201);
    return response.body as AuthResponse;
  }

  async function assign(
    platform: AuthResponse,
    userId: string,
    role: string,
    storeId: string,
  ): Promise<void> {
    await request(httpServer())
      .post('/api/rbac/assignments')
      .set('Authorization', `Bearer ${platform.accessToken}`)
      .send({ userId, role, storeId })
      .expect(201);
  }

  async function createScenario(): Promise<Scenario> {
    const platform = await register('platform');
    await request(httpServer())
      .post('/api/rbac/bootstrap')
      .set('x-rbac-bootstrap-token', BOOTSTRAP_TOKEN)
      .send({ userId: platform.user.id })
      .expect(201);
    await request(httpServer())
      .post('/api/rbac/stores')
      .set('Authorization', `Bearer ${platform.accessToken}`)
      .send({ id: STORE_A_ID, name: 'Settlement Store A' })
      .expect(201);
    await request(httpServer())
      .post('/api/rbac/stores')
      .set('Authorization', `Bearer ${platform.accessToken}`)
      .send({ id: STORE_B_ID, name: 'Settlement Store B' })
      .expect(201);

    const operatorA = await register('operator-a');
    const adminA = await register('admin-a');
    const operatorB = await register('operator-b');
    await assign(platform, operatorA.user.id, 'store-operator', STORE_A_ID);
    await assign(platform, adminA.user.id, 'store-admin', STORE_A_ID);
    await assign(platform, operatorB.user.id, 'store-operator', STORE_B_ID);
    return {
      platform,
      operatorA,
      adminA,
      operatorB,
      storeA: STORE_A_ID,
      storeB: STORE_B_ID,
    };
  }

  beforeEach(async () => {
    for (const key of environmentKeys) {
      previousEnvironment.set(key, process.env[key]);
    }
    process.env.RBAC_BOOTSTRAP_TOKEN = BOOTSTRAP_TOKEN;
    process.env.RBAC_BOOTSTRAP_ENABLED = 'true';
    process.env.PAYMENT_WORKFLOW_RUNTIME = 'local';
    process.env.DELIVERY_WORKFLOW_RUNTIME = 'local';
    process.env.SETTLEMENT_WORKFLOW_RUNTIME = 'local';
    delete process.env.RABBITMQ_URL;
    emailCounter = 0;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DATABASE_POOL)
      .useValue(createMemoryPool())
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    for (const key of environmentKeys) {
      const value = previousEnvironment.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('projects out-of-order completion/payment/refund facts and records exactly one settlement', async () => {
    expect(app?.get(SettlementWorkflowRuntimeService).runtimeMode).toBe(
      'local',
    );

    expect((await deliver(paymentSucceeded())).status).toBe('PROCESSED');
    const [pending] = await database()
      .select()
      .from(settlements)
      .where(eq(settlements.orderId, ORDER_ID));
    expect(pending).toMatchObject({ status: 'PENDING', orderId: ORDER_ID });

    expect((await deliver(paymentRefunded())).status).toBe('PROCESSED');
    const completed = orderCompleted(ORDER_ID, STORE_A_ID, 10_001, undefined, {
      adjustmentAmountMinor: 50,
    });
    expect((await deliver(completed)).status).toBe('PROCESSED');

    const [settlement] = await database()
      .select()
      .from(settlements)
      .where(eq(settlements.orderId, ORDER_ID));
    expect(settlement).toMatchObject({
      orderId: ORDER_ID,
      storeId: STORE_A_ID,
      status: 'RECORDED',
      grossAmountMinor: 10_001,
      paymentAmountMinor: 10_001,
      feeBasisPoints: 250,
      feeAmountMinor: 250,
      refundAmountMinor: 100,
      adjustmentAmountMinor: 50,
      payableAmountMinor: 9_701,
    });

    const ledger = await database()
      .select()
      .from(settlementLedgerEntries)
      .where(eq(settlementLedgerEntries.settlementId, settlement.id));
    expect(ledger.map((entry) => entry.entryType)).toEqual([
      'GROSS',
      'FEE',
      'REFUND',
      'ADJUSTMENT',
    ]);
    expect(ledger.map((entry) => entry.amountMinor)).toEqual([
      10_001, -250, -100, 50,
    ]);

    const [recordedEvent] = await database()
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.eventType, 'SettlementRecorded'),
          eq(outboxEvents.aggregateId, settlement.id),
        ),
      );
    expect(recordedEvent).toMatchObject({
      eventType: 'SettlementRecorded',
      producer: 'Settlement',
      payload: {
        settlementId: settlement.id,
        orderId: ORDER_ID,
        storeId: STORE_A_ID,
        payableAmount: 9_701,
        currency: 'USD',
      },
    });

    expect((await deliver(paymentSucceeded())).status).toBe('DUPLICATE');
    expect((await deliver(completed)).status).toBe('DUPLICATE');
    expect((await deliver(paymentRefunded())).status).toBe('DUPLICATE');
    expect(
      await database()
        .select()
        .from(settlements)
        .where(eq(settlements.orderId, ORDER_ID)),
    ).toHaveLength(1);
    expect(
      await database()
        .select()
        .from(settlementLedgerEntries)
        .where(eq(settlementLedgerEntries.settlementId, settlement.id)),
    ).toHaveLength(4);
    expect(
      await database()
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.eventType, 'SettlementRecorded')),
    ).toHaveLength(1);
    expect(
      await database()
        .select()
        .from(inboxEvents)
        .where(eq(inboxEvents.consumerName, 'settlement.integration')),
    ).toHaveLength(3);
  });

  it('does not settle malformed non-completed or cancelled orders', async () => {
    const malformed = await deliver(
      orderCompleted(
        ORDER_ID,
        STORE_A_ID,
        10_001,
        'order-completed:non-completed',
        { status: 'PREPARING' },
      ),
    );
    expect(malformed.status).toBe('RETRY');
    expect(
      await database()
        .select()
        .from(settlementOrderFacts)
        .where(eq(settlementOrderFacts.orderId, ORDER_ID)),
    ).toHaveLength(0);

    expect((await deliver(orderCancelled())).status).toBe('PROCESSED');
    expect((await deliver(paymentSucceeded())).status).toBe('PROCESSED');
    expect(
      await database()
        .select()
        .from(settlements)
        .where(eq(settlements.orderId, ORDER_ID)),
    ).toMatchObject([expect.objectContaining({ status: 'PENDING' })]);
    expect(
      await database()
        .select()
        .from(settlementCancellationFacts)
        .where(eq(settlementCancellationFacts.orderId, ORDER_ID)),
    ).toHaveLength(1);

    expect(
      await database()
        .select()
        .from(settlementLedgerEntries)
        .where(eq(settlementLedgerEntries.orderId, ORDER_ID)),
    ).toHaveLength(0);
    expect(
      await database()
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.eventType, 'SettlementRecorded')),
    ).toHaveLength(0);
  });

  it('appends a post-record refund once without rewriting prior ledger entries', async () => {
    await deliver(paymentSucceeded());
    await deliver(orderCompleted());
    const [settlement] = await database()
      .select()
      .from(settlements)
      .where(eq(settlements.orderId, ORDER_ID));
    const beforeRefund = await database()
      .select()
      .from(settlementLedgerEntries)
      .where(eq(settlementLedgerEntries.settlementId, settlement.id));
    expect(beforeRefund).toHaveLength(2);

    const refund = paymentRefunded('payment-refunded:after-record');
    expect((await deliver(refund)).status).toBe('PROCESSED');
    const [updated] = await database()
      .select()
      .from(settlements)
      .where(eq(settlements.id, settlement.id));
    expect(updated).toMatchObject({
      status: 'RECORDED',
      refundAmountMinor: 100,
      payableAmountMinor: 9_651,
    });
    const afterRefund = await database()
      .select()
      .from(settlementLedgerEntries)
      .where(eq(settlementLedgerEntries.settlementId, settlement.id));
    expect(afterRefund).toHaveLength(3);
    expect((await deliver(refund)).status).toBe('DUPLICATE');
    expect(
      await database()
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.eventType, 'SettlementRecorded')),
    ).toHaveLength(1);
  });

  it('reruns an interrupted workflow and records one ledger and event', async () => {
    const repository = app?.get(SettlementRepository);
    const outbox = app?.get(OutboxService);
    const engine = app?.get(SettlementWorkflowEngine);
    if (!repository || !outbox || !engine) {
      throw new Error('Settlement workflow dependencies are unavailable');
    }

    const payment = paymentSucceeded(
      ORDER_ID,
      PAYMENT_INTENT_ID,
      STORE_A_ID,
      10_001,
      'payment-succeeded:interrupted',
    );
    const completed = orderCompleted(
      ORDER_ID,
      STORE_A_ID,
      10_001,
      'order-completed:interrupted',
    );
    let workflowInput:
      | {
          settlementId: string;
          workflowGeneration: number;
          correlationId: string;
          causationId: string | null;
        }
      | undefined;
    await outbox.transaction(async (tx) => {
      const first = await repository.projectEvent(completed, tx);
      const second = await repository.projectEvent(payment, tx);
      workflowInput = second.workflowInput ?? first.workflowInput ?? undefined;
    });
    if (!workflowInput) {
      throw new Error('Settlement workflow input was not projected');
    }

    let interrupted = false;
    const interruptingStep = async <T>(
      name: string,
      work: () => Promise<T>,
    ): Promise<T> => {
      if (name === 'record-settlement-ledger' && !interrupted) {
        interrupted = true;
        throw new Error('simulated process interruption');
      }
      return work();
    };
    await expect(engine.run(workflowInput, interruptingStep)).rejects.toThrow(
      'simulated process interruption',
    );
    expect(
      await database()
        .select()
        .from(settlementLedgerEntries)
        .where(eq(settlementLedgerEntries.orderId, ORDER_ID)),
    ).toHaveLength(0);

    const resumed = await engine.run(workflowInput);
    expect(resumed).toMatchObject({
      settlementId: workflowInput.settlementId,
      status: 'RECORDED',
      payableAmountMinor: 9_751,
    });
    const replayed = await engine.run(workflowInput);
    expect(replayed.status).toBe('RECORDED');
    expect(
      await database()
        .select()
        .from(settlementLedgerEntries)
        .where(eq(settlementLedgerEntries.orderId, ORDER_ID)),
    ).toHaveLength(2);
    expect(
      await database()
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.eventType, 'SettlementRecorded')),
    ).toHaveLength(1);
  });

  it('allows assigned store operators/admins and platform admins only', async () => {
    const scenario = await createScenario();
    await deliver(
      paymentSucceeded(
        AUTH_ORDER_ID,
        AUTH_PAYMENT_INTENT_ID,
        scenario.storeA,
        1_000,
        'payment-succeeded:auth',
      ),
    );
    await deliver(
      orderCompleted(
        AUTH_ORDER_ID,
        scenario.storeA,
        1_000,
        'order-completed:auth',
      ),
    );
    const [settlement] = await database()
      .select()
      .from(settlements)
      .where(eq(settlements.orderId, AUTH_ORDER_ID));

    await request(httpServer())
      .get(`/api/settlements/${settlement.id}`)
      .set('Authorization', `Bearer ${scenario.operatorA.accessToken}`)
      .expect(200);
    await request(httpServer())
      .get(`/api/settlements/${settlement.id}`)
      .set('Authorization', `Bearer ${scenario.adminA.accessToken}`)
      .expect(200);
    await request(httpServer())
      .get(`/api/settlements/${settlement.id}`)
      .set('Authorization', `Bearer ${scenario.operatorB.accessToken}`)
      .expect(403);
    await request(httpServer())
      .get(`/api/settlements/${settlement.id}`)
      .set('Authorization', `Bearer ${scenario.platform.accessToken}`)
      .expect(200);

    await request(httpServer())
      .get(`/api/orders/${AUTH_ORDER_ID}/settlement`)
      .set('Authorization', `Bearer ${scenario.adminA.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: settlement.id,
          orderId: AUTH_ORDER_ID,
          storeId: scenario.storeA,
          payableAmountMinor: 975,
        });
      });
    await request(httpServer())
      .get(`/api/stores/${scenario.storeA}/settlements`)
      .set('Authorization', `Bearer ${scenario.operatorA.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(1);
        expect(body[0].id).toBe(settlement.id);
      });
    await request(httpServer())
      .get(`/api/stores/${scenario.storeB}/settlements`)
      .set('Authorization', `Bearer ${scenario.operatorA.accessToken}`)
      .expect(403);
    await request(httpServer())
      .get(`/api/stores/${scenario.storeB}/settlements`)
      .set('Authorization', `Bearer ${scenario.platform.accessToken}`)
      .expect(200)
      .expect([]);
  });
});

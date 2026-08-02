import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { and, eq } from 'drizzle-orm';
import { newDb } from 'pg-mem';
import request from 'supertest';
import { AppModule } from '../src/app/app.module';
import { DATABASE_POOL, DRIZZLE, DrizzleDB } from '../src/db/drizzle.module';
import {
  inboxEvents,
  orders,
  outboxEvents,
  paymentAttempts,
  paymentCallbacks,
  paymentIntents,
} from '../src/db/schema';
import { createIntegrationEvent } from '../src/messaging/integration-event';
import { OutboxDispatcher } from '../src/messaging/outbox-dispatcher.service';
import { OutboxService } from '../src/messaging/outbox.service';
import { FakePaymentProvider } from '../src/payment/fake-payment-provider';
import { PaymentRepository } from '../src/payment/payment.repository';
import { PaymentService } from '../src/payment/payment.service';
import { PaymentWorkflowEngine } from '../src/payment/payment-workflow.engine';
import { PaymentWorkflowInput } from '../src/payment/payment-workflow.types';

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
  customer: AuthResponse;
  otherCustomer: AuthResponse;
  operator: AuthResponse;
  storeId: string;
  productId: string;
};

const BOOTSTRAP_TOKEN = 'payment-test-bootstrap-token';
const STORE_ID = '70000000-0000-4000-8000-000000000001';
const OTHER_STORE_ID = '70000000-0000-4000-8000-000000000002';

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

describe('PaymentWorkflow (e2e)', () => {
  let app: INestApplication | undefined;
  let emailCounter = 0;
  let previousBootstrapToken: string | undefined;
  let previousBootstrapEnabled: string | undefined;
  let previousWorkflowRuntime: string | undefined;
  let previousRabbitUrl: string | undefined;

  function httpServer() {
    if (!app) {
      throw new Error('Payment test application is not initialized');
    }
    return app.getHttpServer();
  }

  function database(): DrizzleDB {
    if (!app) {
      throw new Error('Payment test application is not initialized');
    }
    return app.get<DrizzleDB>(DRIZZLE);
  }

  function nextEmail(role: string): string {
    emailCounter += 1;
    return `${role}-${emailCounter}@example.com`;
  }

  async function register(role: string): Promise<AuthResponse> {
    const response = await request(httpServer())
      .post('/api/auth/register')
      .send({
        email: nextEmail(role),
        password: 'correct horse battery staple',
        name: role,
      })
      .expect(201);
    return response.body as AuthResponse;
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
      .send({ id: STORE_ID, name: 'Payment Store A' })
      .expect(201);
    await request(httpServer())
      .post('/api/rbac/stores')
      .set('Authorization', `Bearer ${platform.accessToken}`)
      .send({ id: OTHER_STORE_ID, name: 'Payment Store B' })
      .expect(201);

    const customer = await register('customer');
    const otherCustomer = await register('other-customer');
    const operator = await register('operator');
    await request(httpServer())
      .post('/api/rbac/assignments')
      .set('Authorization', `Bearer ${platform.accessToken}`)
      .send({
        userId: operator.user.id,
        role: 'store-operator',
        storeId: STORE_ID,
      })
      .expect(201);

    await request(httpServer())
      .patch(`/api/stores/${STORE_ID}/operations`)
      .set('Authorization', `Bearer ${platform.accessToken}`)
      .send({
        status: 'OPEN',
        operatingHours: Object.fromEntries(
          [
            'sunday',
            'monday',
            'tuesday',
            'wednesday',
            'thursday',
            'friday',
            'saturday',
          ].map((day) => [day, [{ open: '00:00', close: '24:00' }]]),
        ),
        policies: { acceptingOrders: true },
      })
      .expect(200);

    const product = await request(httpServer())
      .post(`/api/stores/${STORE_ID}/catalog/products`)
      .set('Authorization', `Bearer ${platform.accessToken}`)
      .send({
        name: 'Workflow Espresso',
        lifecycle: 'PUBLISHED',
        menuVisible: true,
        priceMinor: 450,
        currency: 'USD',
      })
      .expect(201);

    return {
      platform,
      customer,
      otherCustomer,
      operator,
      storeId: STORE_ID,
      productId: product.body.id as string,
    };
  }

  async function placeOrder(scenario: Scenario): Promise<string> {
    const response = await request(httpServer())
      .post('/api/orders')
      .set('Authorization', `Bearer ${scenario.customer.accessToken}`)
      .send({
        storeId: scenario.storeId,
        items: [{ productId: scenario.productId, quantity: 1 }],
      })
      .expect(201);
    return response.body.id as string;
  }

  async function dispatch(): Promise<void> {
    if (!app) {
      throw new Error('Payment test application is not initialized');
    }
    await app.get(OutboxDispatcher).dispatch();
  }

  beforeEach(async () => {
    previousBootstrapToken = process.env.RBAC_BOOTSTRAP_TOKEN;
    previousBootstrapEnabled = process.env.RBAC_BOOTSTRAP_ENABLED;
    previousWorkflowRuntime = process.env.PAYMENT_WORKFLOW_RUNTIME;
    previousRabbitUrl = process.env.RABBITMQ_URL;
    process.env.RBAC_BOOTSTRAP_TOKEN = BOOTSTRAP_TOKEN;
    process.env.RBAC_BOOTSTRAP_ENABLED = 'true';
    process.env.PAYMENT_WORKFLOW_RUNTIME = 'local';
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
    app.get(FakePaymentProvider).reset();
    app.get(FakePaymentProvider).setBehavior('success');
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;

    if (previousBootstrapToken === undefined) {
      delete process.env.RBAC_BOOTSTRAP_TOKEN;
    } else {
      process.env.RBAC_BOOTSTRAP_TOKEN = previousBootstrapToken;
    }
    if (previousBootstrapEnabled === undefined) {
      delete process.env.RBAC_BOOTSTRAP_ENABLED;
    } else {
      process.env.RBAC_BOOTSTRAP_ENABLED = previousBootstrapEnabled;
    }
    if (previousWorkflowRuntime === undefined) {
      delete process.env.PAYMENT_WORKFLOW_RUNTIME;
    } else {
      process.env.PAYMENT_WORKFLOW_RUNTIME = previousWorkflowRuntime;
    }
    if (previousRabbitUrl === undefined) {
      delete process.env.RABBITMQ_URL;
    } else {
      process.env.RABBITMQ_URL = previousRabbitUrl;
    }
  });

  it('creates one intent, confirms through events, and keeps provider idempotency', async () => {
    const scenario = await createScenario();
    const orderId = await placeOrder(scenario);
    const provider = app?.get(FakePaymentProvider);
    if (!provider) {
      throw new Error('Fake provider is unavailable');
    }

    await dispatch();
    const [intent] = await database()
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.orderId, orderId));
    expect(intent).toMatchObject({
      orderId,
      customerId: scenario.customer.user.id,
      storeId: scenario.storeId,
      amountMinor: 450,
      currency: 'USD',
      status: 'SUCCEEDED',
      currentAttemptNumber: 1,
    });

    const paymentStatus = await request(httpServer())
      .get(`/api/payments/${intent.id}`)
      .set('Authorization', `Bearer ${scenario.customer.accessToken}`)
      .expect(200);
    expect(paymentStatus.body).toMatchObject({
      id: intent.id,
      status: 'SUCCEEDED',
      attempts: [
        {
          attemptNumber: 1,
          status: 'SUCCEEDED',
          providerReference: expect.stringMatching(/^fake-charge-/),
        },
      ],
    });

    await dispatch();
    const [order] = await database()
      .select()
      .from(orders)
      .where(eq(orders.id, orderId));
    expect(order.status).toBe('CONFIRMED');

    const providerRequest = provider.requests[0];
    expect(providerRequest).toBeDefined();
    await provider.charge(providerRequest);
    await provider.charge(providerRequest);
    expect(provider.chargeCount(providerRequest.idempotencyKey)).toBe(1);

    const [attempt] = await database()
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.paymentIntentId, intent.id));
    const outcome = provider.outcomeFor(providerRequest.idempotencyKey);
    if (!attempt || !outcome) {
      throw new Error('Payment attempt outcome is unavailable');
    }
    const paymentService = app?.get(PaymentService);
    if (!paymentService) {
      throw new Error('Payment service is unavailable');
    }
    await paymentService.recordProviderCallback({
      paymentIntentId: intent.id,
      attemptId: attempt.id,
      attemptNumber: attempt.attemptNumber,
      workflowGeneration: intent.workflowGeneration,
      correlationId: 'duplicate-callback-test',
      causationId: null,
      outcome,
    });
    await paymentService.recordProviderCallback({
      paymentIntentId: intent.id,
      attemptId: attempt.id,
      attemptNumber: attempt.attemptNumber,
      workflowGeneration: intent.workflowGeneration,
      correlationId: 'duplicate-callback-test',
      causationId: null,
      outcome,
    });

    const successEvents = await database()
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.eventType, 'PaymentSucceeded'),
          eq(outboxEvents.aggregateId, intent.id),
        ),
      );
    expect(successEvents).toHaveLength(1);
    expect(
      await database()
        .select()
        .from(paymentCallbacks)
        .where(eq(paymentCallbacks.paymentIntentId, intent.id)),
    ).toHaveLength(1);

    await request(httpServer())
      .get(`/api/payments/${intent.id}`)
      .set('Authorization', `Bearer ${scenario.otherCustomer.accessToken}`)
      .expect(403);
    await request(httpServer())
      .get(`/api/payments/${intent.id}`)
      .set('Authorization', `Bearer ${scenario.operator.accessToken}`)
      .expect(200);
  });

  it('retries retryable provider failures without duplicating the intent', async () => {
    const scenario = await createScenario();
    const provider = app?.get(FakePaymentProvider);
    if (!provider) {
      throw new Error('Fake provider is unavailable');
    }
    provider.setBehavior('retryable-failure');
    const orderId = await placeOrder(scenario);

    await dispatch();
    const [failedIntent] = await database()
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.orderId, orderId));
    expect(failedIntent).toMatchObject({
      status: 'FAILED',
      lastFailureRetryable: true,
      currentAttemptNumber: 3,
      workflowGeneration: 1,
    });
    expect(
      await database()
        .select()
        .from(paymentIntents)
        .where(eq(paymentIntents.orderId, orderId)),
    ).toHaveLength(1);
    expect(provider.chargeCount()).toBe(3);

    await dispatch();
    const [awaitingOrder] = await database()
      .select()
      .from(orders)
      .where(eq(orders.id, orderId));
    expect(awaitingOrder.status).toBe('AWAITING_PAYMENT');

    provider.setBehavior('success');
    const retried = await request(httpServer())
      .post(`/api/payments/${failedIntent.id}/attempts`)
      .set('Authorization', `Bearer ${scenario.customer.accessToken}`)
      .expect(202);
    expect(retried.body).toMatchObject({
      id: failedIntent.id,
      status: 'SUCCEEDED',
      workflowGeneration: 2,
      currentAttemptNumber: 1,
    });
    expect(
      await database()
        .select()
        .from(paymentAttempts)
        .where(eq(paymentAttempts.paymentIntentId, failedIntent.id)),
    ).toHaveLength(4);

    await dispatch();
    const [confirmedOrder] = await database()
      .select()
      .from(orders)
      .where(eq(orders.id, orderId));
    expect(confirmedOrder.status).toBe('CONFIRMED');
  });

  it('cancels on non-retryable failure and rejects a later attempt', async () => {
    const scenario = await createScenario();
    const provider = app?.get(FakePaymentProvider);
    if (!provider) {
      throw new Error('Fake provider is unavailable');
    }
    provider.setBehavior('non-retryable-failure');
    const orderId = await placeOrder(scenario);

    await dispatch();
    const [intent] = await database()
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.orderId, orderId));
    expect(intent.status).toBe('FAILED');
    expect(intent.lastFailureRetryable).toBe(false);
    await dispatch();

    const [order] = await database()
      .select()
      .from(orders)
      .where(eq(orders.id, orderId));
    expect(order.status).toBe('CANCELLED');
    await request(httpServer())
      .post(`/api/payments/${intent.id}/attempts`)
      .set('Authorization', `Bearer ${scenario.customer.accessToken}`)
      .expect(409);
  });

  it('expires timed-out intents and never charges twice for the timeout key', async () => {
    const scenario = await createScenario();
    const provider = app?.get(FakePaymentProvider);
    if (!provider) {
      throw new Error('Fake provider is unavailable');
    }
    provider.setBehavior('timeout');
    const orderId = await placeOrder(scenario);

    await dispatch();
    const [intent] = await database()
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.orderId, orderId));
    expect(intent.status).toBe('EXPIRED');
    expect(provider.chargeCount()).toBe(0);
    const timeoutRequest = provider.requests[0];
    await provider.charge(timeoutRequest);
    expect(provider.chargeCount(timeoutRequest.idempotencyKey)).toBe(0);

    await dispatch();
    const [order] = await database()
      .select()
      .from(orders)
      .where(eq(orders.id, orderId));
    expect(order.status).toBe('CANCELLED');
    await request(httpServer())
      .post(`/api/payments/${intent.id}/attempts`)
      .set('Authorization', `Bearer ${scenario.customer.accessToken}`)
      .expect(409);
    expect(
      await database()
        .select()
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.eventType, 'PaymentExpired'),
            eq(outboxEvents.aggregateId, intent.id),
          ),
        ),
    ).toHaveLength(1);
  });

  it('resumes after an interruption after the provider call', async () => {
    const scenario = await createScenario();
    const orderId = await placeOrder(scenario);
    const [placed] = await database()
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.eventType, 'OrderPlaced'),
          eq(outboxEvents.aggregateId, orderId),
        ),
      );
    if (!placed) {
      throw new Error('OrderPlaced event is unavailable');
    }

    const placedEvent = createIntegrationEvent({
      eventId: placed.eventId,
      idempotencyKey: placed.idempotencyKey,
      eventType: placed.eventType,
      eventVersion: placed.eventVersion,
      occurredAt: placed.occurredAt,
      producer: placed.producer,
      aggregateType: placed.aggregateType,
      aggregateId: placed.aggregateId,
      aggregateVersion: placed.aggregateVersion,
      correlationId: placed.correlationId,
      causationId: placed.causationId,
      payload: placed.payload,
    });
    const outbox = app?.get(OutboxService);
    const repository = app?.get(PaymentRepository);
    const engine = app?.get(PaymentWorkflowEngine);
    const provider = app?.get(FakePaymentProvider);
    if (!outbox || !repository || !engine || !provider) {
      throw new Error('Payment workflow dependencies are unavailable');
    }
    const intent = await outbox.transaction((tx) =>
      repository.createFromOrderPlaced(placedEvent, tx),
    );
    const input: PaymentWorkflowInput = {
      paymentIntentId: intent.id,
      workflowGeneration: intent.workflowGeneration,
      correlationId: placed.correlationId,
      causationId: placed.eventId,
    };

    let interrupted = false;
    const interruptingStep = async <T>(
      name: string,
      work: () => Promise<T>,
    ): Promise<T> => {
      if (name.startsWith('record-payment-callback') && !interrupted) {
        interrupted = true;
        throw new Error('simulated process interruption');
      }
      return work();
    };
    await expect(engine.run(input, interruptingStep)).rejects.toThrow(
      'simulated process interruption',
    );

    const resumed = await engine.run(input);
    expect(resumed.status).toBe('SUCCEEDED');
    expect(provider.chargeCount()).toBe(1);
    expect(
      await database()
        .select()
        .from(paymentCallbacks)
        .where(eq(paymentCallbacks.paymentIntentId, intent.id)),
    ).toHaveLength(1);
    expect(
      await database()
        .select()
        .from(inboxEvents)
        .where(eq(inboxEvents.eventType, 'OrderPlaced')),
    ).toHaveLength(0);

    await dispatch();
    const [order] = await database()
      .select()
      .from(orders)
      .where(eq(orders.id, orderId));
    expect(order.status).toBe('CONFIRMED');
  });
});

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { and, eq } from 'drizzle-orm';
import { newDb } from 'pg-mem';
import request from 'supertest';
import { AppModule } from '../src/app/app.module';
import { DATABASE_POOL, DRIZZLE, DrizzleDB } from '../src/db/drizzle.module';
import {
  deliveryAttempts,
  deliveryCallbacks,
  deliveries,
  orders,
  outboxEvents,
} from '../src/db/schema';
import { DeliveryRepository } from '../src/delivery/delivery.repository';
import { DeliveryWorkflowEngine } from '../src/delivery/delivery-workflow.engine';
import { DeliveryWorkflowRuntimeService } from '../src/delivery/delivery-workflow-runtime';
import { DeliveryWorkflowInput } from '../src/delivery/delivery-workflow.types';
import { FakeDeliveryProvider } from '../src/delivery/fake-delivery-provider';
import { createIntegrationEvent } from '../src/messaging/integration-event';
import { INTEGRATION_EVENT_TRANSPORT } from '../src/messaging/messaging.constants';
import { IntegrationEventTransport } from '../src/messaging/messaging.transport';
import { OutboxDispatcher } from '../src/messaging/outbox-dispatcher.service';

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
  operatorA: AuthResponse;
  operatorB: AuthResponse;
  adminA: AuthResponse;
  storeA: string;
  storeB: string;
  productId: string;
};

const BOOTSTRAP_TOKEN = 'delivery-test-bootstrap-token';
const STORE_A_ID = '80000000-0000-4000-8000-000000000001';
const STORE_B_ID = '80000000-0000-4000-8000-000000000002';
const ADDRESS = {
  recipientName: 'Delivery Customer',
  line1: '1 Coffee Lane',
  line2: 'Unit 4',
  city: 'Brewtown',
  state: 'CA',
  postalCode: '90210',
  country: 'US',
};

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

describe('DeliveryWorkflow (e2e)', () => {
  let app: INestApplication | undefined;
  let emailCounter = 0;
  let previousBootstrapToken: string | undefined;
  let previousBootstrapEnabled: string | undefined;
  let previousPaymentRuntime: string | undefined;
  let previousDeliveryRuntime: string | undefined;
  let previousRabbitUrl: string | undefined;

  function httpServer() {
    if (!app) {
      throw new Error('Delivery test application is not initialized');
    }
    return app.getHttpServer();
  }

  function database(): DrizzleDB {
    if (!app) {
      throw new Error('Delivery test application is not initialized');
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
      .send({ id: STORE_A_ID, name: 'Delivery Store A' })
      .expect(201);
    await request(httpServer())
      .post('/api/rbac/stores')
      .set('Authorization', `Bearer ${platform.accessToken}`)
      .send({ id: STORE_B_ID, name: 'Delivery Store B' })
      .expect(201);

    const customer = await register('customer');
    const otherCustomer = await register('other-customer');
    const operatorA = await register('operator-a');
    const operatorB = await register('operator-b');
    const adminA = await register('admin-a');
    await assign(platform, operatorA.user.id, 'store-operator', STORE_A_ID);
    await assign(platform, operatorB.user.id, 'store-operator', STORE_B_ID);
    await assign(platform, adminA.user.id, 'store-admin', STORE_A_ID);

    const alwaysOpen = Object.fromEntries(
      [
        'sunday',
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
      ].map((day) => [day, [{ open: '00:00', close: '24:00' }]]),
    );
    for (const storeId of [STORE_A_ID, STORE_B_ID]) {
      await request(httpServer())
        .patch(`/api/stores/${storeId}/operations`)
        .set('Authorization', `Bearer ${platform.accessToken}`)
        .send({
          status: 'OPEN',
          operatingHours: alwaysOpen,
          policies: { acceptingOrders: true },
        })
        .expect(200);
    }

    const product = await request(httpServer())
      .post(`/api/stores/${STORE_A_ID}/catalog/products`)
      .set('Authorization', `Bearer ${adminA.accessToken}`)
      .send({
        name: 'Delivery Espresso',
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
      operatorA,
      operatorB,
      adminA,
      storeA: STORE_A_ID,
      storeB: STORE_B_ID,
      productId: product.body.id as string,
    };
  }

  async function placeOrder(
    scenario: Scenario,
    address: Record<string, unknown> = ADDRESS,
  ): Promise<string> {
    const response = await request(httpServer())
      .post('/api/orders')
      .set('Authorization', `Bearer ${scenario.customer.accessToken}`)
      .send({
        storeId: scenario.storeA,
        items: [{ productId: scenario.productId, quantity: 1 }],
        address,
      })
      .expect(201);
    return response.body.id as string;
  }

  async function dispatch(): Promise<void> {
    if (!app) {
      throw new Error('Delivery test application is not initialized');
    }
    await app.get(OutboxDispatcher).dispatch();
  }

  async function createRequestedDelivery(
    scenario: Scenario,
  ): Promise<{ orderId: string; deliveryId: string }> {
    const orderId = await placeOrder(scenario);
    await dispatch();
    await dispatch();
    await dispatch();
    const [delivery] = await database()
      .select()
      .from(deliveries)
      .where(eq(deliveries.orderId, orderId));
    if (!delivery) {
      throw new Error('Delivery was not created');
    }
    expect(delivery.status).toBe('REQUESTED');
    return { orderId, deliveryId: delivery.id };
  }

  async function readyOrder(
    scenario: Scenario,
    orderId: string,
  ): Promise<void> {
    await request(httpServer())
      .post(`/api/orders/${orderId}/preparation/start`)
      .set('Authorization', `Bearer ${scenario.operatorA.accessToken}`)
      .expect(200);
    await dispatch();
    await request(httpServer())
      .post(`/api/orders/${orderId}/preparation/ready`)
      .set('Authorization', `Bearer ${scenario.operatorA.accessToken}`)
      .expect(200);
  }

  beforeEach(async () => {
    previousBootstrapToken = process.env.RBAC_BOOTSTRAP_TOKEN;
    previousBootstrapEnabled = process.env.RBAC_BOOTSTRAP_ENABLED;
    previousPaymentRuntime = process.env.PAYMENT_WORKFLOW_RUNTIME;
    previousDeliveryRuntime = process.env.DELIVERY_WORKFLOW_RUNTIME;
    previousRabbitUrl = process.env.RABBITMQ_URL;
    process.env.RBAC_BOOTSTRAP_TOKEN = BOOTSTRAP_TOKEN;
    process.env.RBAC_BOOTSTRAP_ENABLED = 'true';
    process.env.PAYMENT_WORKFLOW_RUNTIME = 'local';
    process.env.DELIVERY_WORKFLOW_RUNTIME = 'local';
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
    app.get(FakeDeliveryProvider).reset();
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
    if (previousPaymentRuntime === undefined) {
      delete process.env.PAYMENT_WORKFLOW_RUNTIME;
    } else {
      process.env.PAYMENT_WORKFLOW_RUNTIME = previousPaymentRuntime;
    }
    if (previousDeliveryRuntime === undefined) {
      delete process.env.DELIVERY_WORKFLOW_RUNTIME;
    } else {
      process.env.DELIVERY_WORKFLOW_RUNTIME = previousDeliveryRuntime;
    }
    if (previousRabbitUrl === undefined) {
      delete process.env.RABBITMQ_URL;
    } else {
      process.env.RABBITMQ_URL = previousRabbitUrl;
    }
  });

  it('creates one requested delivery and freezes the address snapshot', async () => {
    const scenario = await createScenario();
    expect(app?.get(DeliveryWorkflowRuntimeService).runtimeMode).toBe('local');
    const { orderId, deliveryId } = await createRequestedDelivery(scenario);

    const rows = await database()
      .select()
      .from(deliveries)
      .where(eq(deliveries.orderId, orderId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: deliveryId,
      orderId,
      storeId: scenario.storeA,
      customerId: scenario.customer.user.id,
      status: 'REQUESTED',
      addressSnapshot: ADDRESS,
    });

    const [confirmed] = await database()
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.eventType, 'OrderConfirmed'),
          eq(outboxEvents.aggregateId, orderId),
        ),
      );
    expect(confirmed?.payload).toMatchObject({
      addressSnapshot: ADDRESS,
    });
    const transport = app?.get<IntegrationEventTransport>(
      INTEGRATION_EVENT_TRANSPORT,
    );
    if (!confirmed || !transport) {
      throw new Error('OrderConfirmed delivery is unavailable');
    }
    await transport.publish(
      createIntegrationEvent({
        eventId: confirmed.eventId,
        idempotencyKey: confirmed.idempotencyKey,
        eventType: confirmed.eventType,
        eventVersion: confirmed.eventVersion,
        occurredAt: confirmed.occurredAt,
        producer: confirmed.producer,
        aggregateType: confirmed.aggregateType,
        aggregateId: confirmed.aggregateId,
        aggregateVersion: confirmed.aggregateVersion,
        correlationId: confirmed.correlationId,
        causationId: confirmed.causationId,
        payload: confirmed.payload,
      }),
    );
    expect(
      await database()
        .select()
        .from(deliveries)
        .where(eq(deliveries.orderId, orderId)),
    ).toHaveLength(1);

    const updatedAddress = {
      ...ADDRESS,
      line1: '2 Changed Lane',
    };
    await request(httpServer())
      .post('/api/orders')
      .set('Authorization', `Bearer ${scenario.customer.accessToken}`)
      .send({
        storeId: scenario.storeA,
        items: [{ productId: scenario.productId, quantity: 1 }],
        address: updatedAddress,
      })
      .expect(201);
    const [original] = await database()
      .select()
      .from(deliveries)
      .where(eq(deliveries.id, deliveryId));
    expect(original.addressSnapshot).toEqual(ADDRESS);
  });

  it('enforces customer ownership and store-scoped delivery visibility', async () => {
    const scenario = await createScenario();
    const { orderId, deliveryId } = await createRequestedDelivery(scenario);

    await request(httpServer())
      .get(`/api/orders/${orderId}/delivery`)
      .set('Authorization', `Bearer ${scenario.customer.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: deliveryId,
          orderId,
          status: 'REQUESTED',
          addressSnapshot: ADDRESS,
        });
      });

    const crossCustomer = await request(httpServer())
      .get(`/api/deliveries/${deliveryId}`)
      .set('Authorization', `Bearer ${scenario.otherCustomer.accessToken}`)
      .expect(403);
    expect(crossCustomer.body).not.toHaveProperty('addressSnapshot');

    await request(httpServer())
      .get(`/api/deliveries/${deliveryId}`)
      .set('Authorization', `Bearer ${scenario.operatorA.accessToken}`)
      .expect(200);
    await request(httpServer())
      .get(`/api/deliveries/${deliveryId}`)
      .set('Authorization', `Bearer ${scenario.operatorB.accessToken}`)
      .expect(403);
    await request(httpServer())
      .get(`/api/stores/${scenario.storeA}/deliveries`)
      .set('Authorization', `Bearer ${scenario.adminA.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(1);
        expect(body[0]).toMatchObject({ id: deliveryId });
      });
    await request(httpServer())
      .get(`/api/stores/${scenario.storeB}/deliveries`)
      .set('Authorization', `Bearer ${scenario.operatorA.accessToken}`)
      .expect(403);
    await request(httpServer())
      .get(`/api/deliveries/${deliveryId}`)
      .set('Authorization', `Bearer ${scenario.platform.accessToken}`)
      .expect(200);
  });

  it('starts simulated progress and advances Delivery and Ordering through events', async () => {
    const scenario = await createScenario();
    const provider = app?.get(FakeDeliveryProvider);
    if (!provider) {
      throw new Error('Fake delivery provider is unavailable');
    }
    const { orderId, deliveryId } = await createRequestedDelivery(scenario);

    await readyOrder(scenario, orderId);
    const [readyOrderRow] = await database()
      .select()
      .from(orders)
      .where(eq(orders.id, orderId));
    expect(readyOrderRow.status).toBe('READY_FOR_DELIVERY');

    await dispatch();
    const [delivered] = await database()
      .select()
      .from(deliveries)
      .where(eq(deliveries.id, deliveryId));
    expect(delivered.status).toBe('DELIVERED');
    expect(provider.deliveryCount()).toBe(1);

    const [beforeOrdering] = await database()
      .select()
      .from(orders)
      .where(eq(orders.id, orderId));
    expect(beforeOrdering.status).toBe('READY_FOR_DELIVERY');

    await dispatch();
    const [completedOrder] = await database()
      .select()
      .from(orders)
      .where(eq(orders.id, orderId));
    expect(completedOrder.status).toBe('COMPLETED');
    expect(
      await database()
        .select()
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.aggregateId, deliveryId),
            eq(outboxEvents.eventType, 'DeliveryStarted'),
          ),
        ),
    ).toHaveLength(1);
    expect(
      await database()
        .select()
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.aggregateId, deliveryId),
            eq(outboxEvents.eventType, 'DeliveryCompleted'),
          ),
        ),
    ).toHaveLength(1);
  });

  it('retries retryable provider failures without a second Delivery', async () => {
    const scenario = await createScenario();
    const provider = app?.get(FakeDeliveryProvider);
    if (!provider) {
      throw new Error('Fake delivery provider is unavailable');
    }
    provider.setBehavior('retryable-failure');
    const { orderId, deliveryId } = await createRequestedDelivery(scenario);
    await readyOrder(scenario, orderId);
    await dispatch();

    const [failed] = await database()
      .select()
      .from(deliveries)
      .where(eq(deliveries.id, deliveryId));
    expect(failed).toMatchObject({
      status: 'FAILED',
      currentAttemptNumber: 3,
      workflowGeneration: 1,
      lastFailureRetryable: true,
    });
    expect(provider.deliveryCount()).toBe(3);
    expect(
      await database()
        .select()
        .from(deliveries)
        .where(eq(deliveries.orderId, orderId)),
    ).toHaveLength(1);

    await request(httpServer())
      .post(`/api/deliveries/${deliveryId}/retry`)
      .set('Authorization', `Bearer ${scenario.customer.accessToken}`)
      .expect(403);
    await request(httpServer())
      .post(`/api/deliveries/${deliveryId}/retry`)
      .set('Authorization', `Bearer ${scenario.operatorB.accessToken}`)
      .expect(403);

    provider.setBehavior('success');
    await request(httpServer())
      .post(`/api/deliveries/${deliveryId}/retry`)
      .set('Authorization', `Bearer ${scenario.operatorA.accessToken}`)
      .expect(202)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: deliveryId,
          status: 'DELIVERED',
          workflowGeneration: 2,
        });
      });
    expect(provider.deliveryCount()).toBe(4);
    await dispatch();
    const [completedOrder] = await database()
      .select()
      .from(orders)
      .where(eq(orders.id, orderId));
    expect(completedOrder.status).toBe('COMPLETED');
    expect(
      await database()
        .select()
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.eventType, 'DeliveryCompleted'),
            eq(outboxEvents.aggregateId, deliveryId),
          ),
        ),
    ).toHaveLength(1);
  });

  it('keeps non-retryable failures terminal and rejects manual retry', async () => {
    const scenario = await createScenario();
    const provider = app?.get(FakeDeliveryProvider);
    if (!provider) {
      throw new Error('Fake delivery provider is unavailable');
    }
    provider.setBehavior('non-retryable-failure');
    const { orderId, deliveryId } = await createRequestedDelivery(scenario);
    await readyOrder(scenario, orderId);
    await dispatch();

    const [failed] = await database()
      .select()
      .from(deliveries)
      .where(eq(deliveries.id, deliveryId));
    expect(failed).toMatchObject({
      status: 'FAILED',
      currentAttemptNumber: 1,
      lastFailureRetryable: false,
    });
    await request(httpServer())
      .post(`/api/deliveries/${deliveryId}/retry`)
      .set('Authorization', `Bearer ${scenario.operatorA.accessToken}`)
      .expect(409);
    expect(provider.deliveryCount()).toBe(1);
    expect(
      await database()
        .select()
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.eventType, 'DeliveryFailed'),
            eq(outboxEvents.aggregateId, deliveryId),
          ),
        ),
    ).toHaveLength(1);
  });

  it('deduplicates events and callbacks and resumes an interrupted workflow', async () => {
    const scenario = await createScenario();
    const provider = app?.get(FakeDeliveryProvider);
    const engine = app?.get(DeliveryWorkflowEngine);
    const repository = app?.get(DeliveryRepository);
    const transport = app?.get<IntegrationEventTransport>(
      INTEGRATION_EVENT_TRANSPORT,
    );
    if (!provider || !engine || !repository || !transport) {
      throw new Error('Delivery workflow dependencies are unavailable');
    }

    const first = await createRequestedDelivery(scenario);
    await readyOrder(scenario, first.orderId);
    await dispatch();
    const [readyEventRow] = await database()
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.eventType, 'OrderReadyForDelivery'),
          eq(outboxEvents.aggregateId, first.orderId),
        ),
      );
    if (!readyEventRow) {
      throw new Error('OrderReadyForDelivery event is unavailable');
    }
    const readyEvent = createIntegrationEvent({
      eventId: readyEventRow.eventId,
      idempotencyKey: readyEventRow.idempotencyKey,
      eventType: readyEventRow.eventType,
      eventVersion: readyEventRow.eventVersion,
      occurredAt: readyEventRow.occurredAt,
      producer: readyEventRow.producer,
      aggregateType: readyEventRow.aggregateType,
      aggregateId: readyEventRow.aggregateId,
      aggregateVersion: readyEventRow.aggregateVersion,
      correlationId: readyEventRow.correlationId,
      causationId: readyEventRow.causationId,
      payload: readyEventRow.payload,
    });
    await transport.publish(readyEvent);
    expect(provider.deliveryCount()).toBe(1);

    const [firstDelivery] = await database()
      .select()
      .from(deliveries)
      .where(eq(deliveries.id, first.deliveryId));
    const [firstAttempt] = await database()
      .select()
      .from(deliveryAttempts)
      .where(eq(deliveryAttempts.deliveryId, first.deliveryId));
    if (!firstAttempt) {
      throw new Error('Delivery attempt is unavailable');
    }
    const firstOutcome = provider.outcomeFor(
      firstAttempt.providerIdempotencyKey,
    );
    if (!firstOutcome) {
      throw new Error('Delivery provider outcome is unavailable');
    }
    const firstInput: DeliveryWorkflowInput = {
      deliveryId: first.deliveryId,
      workflowGeneration: firstDelivery.workflowGeneration,
      correlationId: 'duplicate-callback-test',
      causationId: null,
    };
    await repository.applyProviderOutcome(
      firstInput,
      firstAttempt.id,
      firstAttempt.attemptNumber,
      firstOutcome,
    );
    expect(
      await database()
        .select()
        .from(deliveryCallbacks)
        .where(eq(deliveryCallbacks.deliveryId, first.deliveryId)),
    ).toHaveLength(1);

    const second = await createRequestedDelivery(scenario);
    await readyOrder(scenario, second.orderId);
    await database()
      .update(deliveries)
      .set({ status: 'READY' })
      .where(eq(deliveries.id, second.deliveryId));
    const [secondDelivery] = await database()
      .select()
      .from(deliveries)
      .where(eq(deliveries.id, second.deliveryId));
    let interrupted = false;
    const interruptingStep = async <T>(
      name: string,
      work: () => Promise<T>,
    ): Promise<T> => {
      if (name.startsWith('record-delivery-callback') && !interrupted) {
        interrupted = true;
        throw new Error('simulated process interruption');
      }
      return work();
    };
    const secondInput: DeliveryWorkflowInput = {
      deliveryId: second.deliveryId,
      workflowGeneration: secondDelivery.workflowGeneration,
      correlationId: 'interruption-test',
      causationId: null,
    };
    await expect(engine.run(secondInput, interruptingStep)).rejects.toThrow(
      'simulated process interruption',
    );
    const resumed = await engine.run(secondInput);
    expect(resumed.status).toBe('DELIVERED');

    const [secondAttempt] = await database()
      .select()
      .from(deliveryAttempts)
      .where(eq(deliveryAttempts.deliveryId, second.deliveryId));
    expect(provider.deliveryCount(secondAttempt.providerIdempotencyKey)).toBe(
      1,
    );
    expect(
      await database()
        .select()
        .from(deliveryCallbacks)
        .where(eq(deliveryCallbacks.deliveryId, second.deliveryId)),
    ).toHaveLength(1);
    expect(
      await database()
        .select()
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.eventType, 'DeliveryCompleted'),
            eq(outboxEvents.aggregateId, second.deliveryId),
          ),
        ),
    ).toHaveLength(1);
  });
});

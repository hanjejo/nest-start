import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { and, eq } from 'drizzle-orm';
import { newDb } from 'pg-mem';
import request from 'supertest';
import { AppModule } from '../src/app/app.module';
import { DATABASE_POOL, DRIZZLE, DrizzleDB } from '../src/db/drizzle.module';
import { outboxEvents } from '../src/db/schema';
import { OrderingService } from '../src/ordering/ordering.service';

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
  adminA: AuthResponse;
  adminB: AuthResponse;
  storeA: string;
  storeB: string;
};

const BOOTSTRAP_TOKEN = 'order-test-bootstrap-token';
const STORE_A_ID = '30000000-0000-4000-8000-000000000001';
const STORE_B_ID = '30000000-0000-4000-8000-000000000002';
const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

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

function alwaysOpenHours() {
  return Object.fromEntries(
    WEEKDAYS.map((day) => [day, [{ open: '00:00', close: '24:00' }]]),
  );
}

function closedHours() {
  return Object.fromEntries(WEEKDAYS.map((day) => [day, []]));
}

describe('Single-store order (e2e)', () => {
  let app: INestApplication | undefined;
  let emailCounter = 0;
  let previousBootstrapToken: string | undefined;
  let previousBootstrapEnabled: string | undefined;

  function httpServer() {
    if (!app) {
      throw new Error('Test application is not initialized');
    }
    return app.getHttpServer();
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

  async function bootstrap(platform: AuthResponse): Promise<void> {
    await request(httpServer())
      .post('/api/rbac/bootstrap')
      .set('x-rbac-bootstrap-token', BOOTSTRAP_TOKEN)
      .send({ userId: platform.user.id })
      .expect(201);
  }

  async function createStore(
    platform: AuthResponse,
    storeId: string,
    name: string,
  ): Promise<void> {
    await request(httpServer())
      .post('/api/rbac/stores')
      .set('Authorization', `Bearer ${platform.accessToken}`)
      .send({ id: storeId, name })
      .expect(201);
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

  async function updateOperations(
    accessToken: string,
    storeId: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    await request(httpServer())
      .patch(`/api/stores/${storeId}/operations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(body)
      .expect(200);
  }

  async function createProduct(
    accessToken: string,
    storeId: string,
    body: Record<string, unknown>,
  ) {
    return request(httpServer())
      .post(`/api/stores/${storeId}/catalog/products`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(body)
      .expect(201);
  }

  async function createScenario(): Promise<Scenario> {
    const platform = await register('platform');
    await bootstrap(platform);
    await createStore(platform, STORE_A_ID, 'Order Store A');
    await createStore(platform, STORE_B_ID, 'Order Store B');

    const customer = await register('customer');
    const otherCustomer = await register('other-customer');
    const operatorA = await register('operator');
    const adminA = await register('admin-a');
    const adminB = await register('admin-b');
    await assign(platform, operatorA.user.id, 'store-operator', STORE_A_ID);
    await assign(platform, adminA.user.id, 'store-admin', STORE_A_ID);
    await assign(platform, adminB.user.id, 'store-admin', STORE_B_ID);

    await updateOperations(platform.accessToken, STORE_A_ID, {
      status: 'OPEN',
      operatingHours: alwaysOpenHours(),
      policies: { acceptingOrders: true },
    });
    await updateOperations(platform.accessToken, STORE_B_ID, {
      status: 'OPEN',
      operatingHours: alwaysOpenHours(),
      policies: { acceptingOrders: true },
    });

    return {
      platform,
      customer,
      otherCustomer,
      operatorA,
      adminA,
      adminB,
      storeA: STORE_A_ID,
      storeB: STORE_B_ID,
    };
  }

  beforeEach(async () => {
    previousBootstrapToken = process.env.RBAC_BOOTSTRAP_TOKEN;
    previousBootstrapEnabled = process.env.RBAC_BOOTSTRAP_ENABLED;
    process.env.RBAC_BOOTSTRAP_TOKEN = BOOTSTRAP_TOKEN;
    process.env.RBAC_BOOTSTRAP_ENABLED = 'true';
    emailCounter = 0;

    const pool = createMemoryPool();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DATABASE_POOL)
      .useValue(pool)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
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
  });

  it('creates one-store orders with authoritative immutable snapshots', async () => {
    const scenario = await createScenario();
    const visibleA = await createProduct(
      scenario.adminA.accessToken,
      scenario.storeA,
      {
        name: 'Snapshot Espresso',
        description: 'Original catalog description.',
        lifecycle: 'PUBLISHED',
        menuVisible: true,
        priceMinor: 450,
        currency: 'USD',
      },
    );
    const hiddenA = await createProduct(
      scenario.adminA.accessToken,
      scenario.storeA,
      {
        name: 'Hidden Espresso',
        priceMinor: 700,
      },
    );
    const visibleB = await createProduct(
      scenario.adminB.accessToken,
      scenario.storeB,
      {
        name: 'Store B Espresso',
        lifecycle: 'PUBLISHED',
        menuVisible: true,
        priceMinor: 800,
      },
    );

    const created = await request(httpServer())
      .post('/api/orders')
      .set('Authorization', `Bearer ${scenario.customer.accessToken}`)
      .send({
        storeId: scenario.storeA,
        items: [
          {
            productId: visibleA.body.id,
            quantity: 2,
            unitAmountMinor: 1,
            currency: 'EUR',
          },
        ],
      })
      .expect(201);

    if (!app) {
      throw new Error('Test application is not initialized');
    }
    const [placedEvent] = await app
      .get<DrizzleDB>(DRIZZLE)
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, created.body.id));
    expect(placedEvent).toMatchObject({
      eventType: 'OrderPlaced',
      eventVersion: 1,
      producer: 'Ordering',
      aggregateType: 'Order',
      aggregateId: created.body.id,
      status: 'PENDING',
      payload: {
        orderId: created.body.id,
        storeId: scenario.storeA,
        customerId: scenario.customer.user.id,
        orderAmount: 900,
        currency: 'USD',
      },
    });

    expect(created.body).toMatchObject({
      customerId: scenario.customer.user.id,
      storeId: scenario.storeA,
      status: 'AWAITING_PAYMENT',
      currency: 'USD',
      totalAmountMinor: 900,
      items: [
        {
          productId: visibleA.body.id,
          productName: 'Snapshot Espresso',
          unitAmountMinor: 450,
          currency: 'USD',
          quantity: 2,
          lineAmountMinor: 900,
        },
      ],
    });

    await request(httpServer())
      .patch(
        `/api/stores/${scenario.storeA}/catalog/products/${visibleA.body.id}`,
      )
      .set('Authorization', `Bearer ${scenario.adminA.accessToken}`)
      .send({
        name: 'Renamed Espresso',
        priceMinor: 999,
      })
      .expect(200);

    await request(httpServer())
      .get(`/api/orders/${created.body.id}`)
      .set('Authorization', `Bearer ${scenario.customer.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items[0]).toMatchObject({
          productName: 'Snapshot Espresso',
          unitAmountMinor: 450,
          currency: 'USD',
          lineAmountMinor: 900,
        });
        expect(body.totalAmountMinor).toBe(900);
      });

    await request(httpServer())
      .post('/api/orders')
      .set('Authorization', `Bearer ${scenario.customer.accessToken}`)
      .send({
        storeId: scenario.storeA,
        items: [{ productId: hiddenA.body.id, quantity: 1 }],
      })
      .expect(400);

    await updateOperations(scenario.platform.accessToken, scenario.storeA, {
      acceptingOrders: false,
    });
    await request(httpServer())
      .post('/api/orders')
      .set('Authorization', `Bearer ${scenario.customer.accessToken}`)
      .send({
        storeId: scenario.storeA,
        items: [{ productId: visibleA.body.id, quantity: 1 }],
      })
      .expect(400);
    await updateOperations(scenario.platform.accessToken, scenario.storeA, {
      acceptingOrders: true,
      status: 'CLOSED',
    });
    await request(httpServer())
      .post('/api/orders')
      .set('Authorization', `Bearer ${scenario.customer.accessToken}`)
      .send({
        storeId: scenario.storeA,
        items: [{ productId: visibleA.body.id, quantity: 1 }],
      })
      .expect(400);
    await updateOperations(scenario.platform.accessToken, scenario.storeA, {
      status: 'OPEN',
      operatingHours: closedHours(),
    });
    await request(httpServer())
      .post('/api/orders')
      .set('Authorization', `Bearer ${scenario.customer.accessToken}`)
      .send({
        storeId: scenario.storeA,
        items: [{ productId: visibleA.body.id, quantity: 1 }],
      })
      .expect(400);
    await updateOperations(scenario.platform.accessToken, scenario.storeA, {
      acceptingOrders: true,
      operatingHours: alwaysOpenHours(),
    });

    await request(httpServer())
      .post('/api/orders')
      .set('Authorization', `Bearer ${scenario.customer.accessToken}`)
      .send({
        storeId: scenario.storeA,
        items: [
          { productId: visibleA.body.id, quantity: 1 },
          { productId: visibleB.body.id, quantity: 1 },
        ],
      })
      .expect(400);
  });

  it('enforces customer ownership and store-scoped/global visibility', async () => {
    const scenario = await createScenario();
    const productA = await createProduct(
      scenario.adminA.accessToken,
      scenario.storeA,
      {
        name: 'Store A Coffee',
        lifecycle: 'PUBLISHED',
        menuVisible: true,
        priceMinor: 500,
      },
    );
    const productB = await createProduct(
      scenario.adminB.accessToken,
      scenario.storeB,
      {
        name: 'Store B Coffee',
        lifecycle: 'PUBLISHED',
        menuVisible: true,
        priceMinor: 600,
      },
    );

    const orderA = await request(httpServer())
      .post('/api/orders')
      .set('Authorization', `Bearer ${scenario.customer.accessToken}`)
      .send({
        storeId: scenario.storeA,
        items: [{ productId: productA.body.id, quantity: 1 }],
      })
      .expect(201);
    const orderB = await request(httpServer())
      .post('/api/orders')
      .set('Authorization', `Bearer ${scenario.otherCustomer.accessToken}`)
      .send({
        storeId: scenario.storeB,
        items: [{ productId: productB.body.id, quantity: 1 }],
      })
      .expect(201);

    await request(httpServer())
      .get('/api/orders')
      .set('Authorization', `Bearer ${scenario.customer.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(1);
        expect(body[0].id).toBe(orderA.body.id);
      });
    await request(httpServer())
      .get('/api/orders')
      .set('Authorization', `Bearer ${scenario.otherCustomer.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(1);
        expect(body[0].id).toBe(orderB.body.id);
      });

    const crossCustomer = await request(httpServer())
      .get(`/api/orders/${orderB.body.id}`)
      .set('Authorization', `Bearer ${scenario.customer.accessToken}`)
      .expect(403);
    expect(crossCustomer.body).toMatchObject({
      statusCode: 403,
      message: 'Access denied',
    });
    expect(crossCustomer.body).not.toHaveProperty('items');

    await request(httpServer())
      .get(`/api/stores/${scenario.storeA}/orders`)
      .set('Authorization', `Bearer ${scenario.operatorA.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(1);
        expect(body[0].id).toBe(orderA.body.id);
      });
    await request(httpServer())
      .get(`/api/stores/${scenario.storeB}/orders`)
      .set('Authorization', `Bearer ${scenario.operatorA.accessToken}`)
      .expect(403);
    await request(httpServer())
      .get(`/api/stores/${scenario.storeB}/orders`)
      .set('Authorization', `Bearer ${scenario.adminA.accessToken}`)
      .expect(403);
    await request(httpServer())
      .get(`/api/stores/${scenario.storeB}/orders`)
      .set('Authorization', `Bearer ${scenario.adminB.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(1);
        expect(body[0].id).toBe(orderB.body.id);
      });

    await request(httpServer())
      .get('/api/orders')
      .set('Authorization', `Bearer ${scenario.platform.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(2);
        expect(body.map((order: { id: string }) => order.id)).toEqual(
          expect.arrayContaining([orderA.body.id, orderB.body.id]),
        );
      });
    await request(httpServer())
      .get(`/api/orders?storeId=${scenario.storeA}`)
      .set('Authorization', `Bearer ${scenario.platform.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(1);
        expect(body[0].storeId).toBe(scenario.storeA);
      });
  });

  it('cancels idempotently before preparation and retains state afterward', async () => {
    const scenario = await createScenario();
    const productA = await createProduct(
      scenario.adminA.accessToken,
      scenario.storeA,
      {
        name: 'Cancellation Coffee',
        lifecycle: 'PUBLISHED',
        menuVisible: true,
        priceMinor: 500,
      },
    );

    const operatorOrder = await request(httpServer())
      .post('/api/orders')
      .set('Authorization', `Bearer ${scenario.customer.accessToken}`)
      .send({
        storeId: scenario.storeA,
        items: [{ productId: productA.body.id, quantity: 1 }],
      })
      .expect(201);
    await request(httpServer())
      .post(`/api/orders/${operatorOrder.body.id}/cancel`)
      .set('Authorization', `Bearer ${scenario.adminA.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('CANCELLED');
      });
    if (!app) {
      throw new Error('Test application is not initialized');
    }
    const [cancelledEvent] = await app
      .get<DrizzleDB>(DRIZZLE)
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.aggregateId, operatorOrder.body.id),
          eq(outboxEvents.eventType, 'OrderCancelled'),
        ),
      );
    expect(cancelledEvent).toMatchObject({
      eventType: 'OrderCancelled',
      eventVersion: 1,
      producer: 'Ordering',
      aggregateType: 'Order',
      aggregateId: operatorOrder.body.id,
      payload: {
        orderId: operatorOrder.body.id,
        storeId: scenario.storeA,
        reason: 'CUSTOMER_REQUESTED',
        refundRequired: false,
      },
    });
    await request(httpServer())
      .post(`/api/orders/${operatorOrder.body.id}/cancel`)
      .set('Authorization', `Bearer ${scenario.operatorA.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('CANCELLED');
      });

    const customerOrder = await request(httpServer())
      .post('/api/orders')
      .set('Authorization', `Bearer ${scenario.otherCustomer.accessToken}`)
      .send({
        storeId: scenario.storeA,
        items: [{ productId: productA.body.id, quantity: 1 }],
      })
      .expect(201);
    await request(httpServer())
      .post(`/api/orders/${customerOrder.body.id}/cancel`)
      .set('Authorization', `Bearer ${scenario.otherCustomer.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('CANCELLED');
      });

    const preparingOrder = await request(httpServer())
      .post('/api/orders')
      .set('Authorization', `Bearer ${scenario.customer.accessToken}`)
      .send({
        storeId: scenario.storeA,
        items: [{ productId: productA.body.id, quantity: 1 }],
      })
      .expect(201);
    if (!app) {
      throw new Error('Test application is not initialized');
    }
    await app
      .get(OrderingService)
      .transitionToPreparingForTest(preparingOrder.body.id);

    await request(httpServer())
      .post(`/api/orders/${preparingOrder.body.id}/cancel`)
      .set('Authorization', `Bearer ${scenario.customer.accessToken}`)
      .expect(400)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          statusCode: 400,
          message: 'Order cannot be cancelled after preparation begins',
        });
      });
    await request(httpServer())
      .post(`/api/orders/${preparingOrder.body.id}/cancel`)
      .set('Authorization', `Bearer ${scenario.operatorA.accessToken}`)
      .expect(400);
    await request(httpServer())
      .get(`/api/orders/${preparingOrder.body.id}`)
      .set('Authorization', `Bearer ${scenario.customer.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('PREPARING');
        expect(body.cancelledAt).toBeNull();
      });
  });
});

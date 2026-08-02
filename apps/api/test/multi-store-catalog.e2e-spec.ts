import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { newDb } from 'pg-mem';
import request from 'supertest';
import { AppModule } from '../src/app/app.module';
import { DATABASE_POOL } from '../src/db/drizzle.module';

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

const BOOTSTRAP_TOKEN = 'catalog-test-bootstrap-token';
const STORE_A_ID = '20000000-0000-4000-8000-000000000001';
const STORE_B_ID = '20000000-0000-4000-8000-000000000002';
const MISSING_STORE_ID = '20000000-0000-4000-8000-000000000099';

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

describe('Multi-store catalog (e2e)', () => {
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

  async function bootstrap(platform: AuthResponse) {
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
  ) {
    return request(httpServer())
      .post('/api/rbac/stores')
      .set('Authorization', `Bearer ${platform.accessToken}`)
      .send({ id: storeId, name })
      .expect(201);
  }

  async function assignStoreAdmin(
    platform: AuthResponse,
    userId: string,
    storeId: string,
  ) {
    return request(httpServer())
      .post('/api/rbac/assignments')
      .set('Authorization', `Bearer ${platform.accessToken}`)
      .send({ userId, role: 'store-admin', storeId })
      .expect(201);
  }

  async function updateOperations(
    accessToken: string,
    storeId: string,
    body: Record<string, unknown>,
  ) {
    return request(httpServer())
      .patch(`/api/stores/${storeId}/operations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(body)
      .expect(200);
  }

  beforeEach(async () => {
    previousBootstrapToken = process.env.RBAC_BOOTSTRAP_TOKEN;
    previousBootstrapEnabled = process.env.RBAC_BOOTSTRAP_ENABLED;
    process.env.RBAC_BOOTSTRAP_TOKEN = BOOTSTRAP_TOKEN;
    process.env.RBAC_BOOTSTRAP_ENABLED = 'true';

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

  it('filters customer browse by store orderability and product visibility', async () => {
    const platform = await register('platform');
    await bootstrap(platform);
    await createStore(platform, STORE_A_ID, 'Catalog Store A');
    await createStore(platform, STORE_B_ID, 'Catalog Store B');
    const administrator = await register('administrator');
    const customer = await register('customer');
    await assignStoreAdmin(platform, administrator.user.id, STORE_A_ID);

    await updateOperations(administrator.accessToken, STORE_A_ID, {
      status: 'OPEN',
      operatingHours: alwaysOpenHours(),
      policies: { acceptingOrders: true },
    });

    const visible = await request(httpServer())
      .post(`/api/stores/${STORE_A_ID}/catalog/products`)
      .set('Authorization', `Bearer ${administrator.accessToken}`)
      .send({
        name: 'Visible Espresso',
        description: 'A published menu item.',
        priceMinor: 450,
        currency: 'usd',
      })
      .expect(201);
    expect(visible.body).toMatchObject({
      storeId: STORE_A_ID,
      name: 'Visible Espresso',
      priceMinor: 450,
      currency: 'USD',
      lifecycle: 'DRAFT',
      menuVisible: false,
    });

    const hidden = await request(httpServer())
      .post(`/api/stores/${STORE_A_ID}/catalog/products`)
      .set('Authorization', `Bearer ${administrator.accessToken}`)
      .send({
        name: 'Hidden Latte',
        priceMinor: 500,
        lifecycle: 'PUBLISHED',
        menuVisible: false,
      })
      .expect(201);
    await request(httpServer())
      .post(`/api/stores/${STORE_A_ID}/catalog/products`)
      .set('Authorization', `Bearer ${administrator.accessToken}`)
      .send({
        name: 'Published Without Price',
        lifecycle: 'PUBLISHED',
        menuVisible: true,
      })
      .expect(201);
    const unpublished = await request(httpServer())
      .post(`/api/stores/${STORE_A_ID}/catalog/products`)
      .set('Authorization', `Bearer ${administrator.accessToken}`)
      .send({
        name: 'Unpublished Cappuccino',
        priceMinor: 525,
        lifecycle: 'PUBLISHED',
        menuVisible: true,
      })
      .expect(201);
    const archived = await request(httpServer())
      .post(`/api/stores/${STORE_A_ID}/catalog/products`)
      .set('Authorization', `Bearer ${administrator.accessToken}`)
      .send({
        name: 'Archived Mocha',
        priceMinor: 550,
      })
      .expect(201);

    await request(httpServer())
      .patch(`/api/stores/${STORE_A_ID}/catalog/products/${visible.body.id}`)
      .set('Authorization', `Bearer ${administrator.accessToken}`)
      .send({ lifecycle: 'PUBLISHED', menuVisible: true })
      .expect(200);
    await request(httpServer())
      .patch(`/api/stores/${STORE_A_ID}/catalog/products/${archived.body.id}`)
      .set('Authorization', `Bearer ${administrator.accessToken}`)
      .send({ lifecycle: 'PUBLISHED', menuVisible: true })
      .expect(200);
    await request(httpServer())
      .patch(`/api/stores/${STORE_A_ID}/catalog/products/${archived.body.id}`)
      .set('Authorization', `Bearer ${administrator.accessToken}`)
      .send({ lifecycle: 'ARCHIVED' })
      .expect(200);
    await request(httpServer())
      .patch(
        `/api/stores/${STORE_A_ID}/catalog/products/${unpublished.body.id}`,
      )
      .set('Authorization', `Bearer ${administrator.accessToken}`)
      .send({ lifecycle: 'UNPUBLISHED' })
      .expect(200);

    const browse = await request(httpServer())
      .get(`/api/stores/${STORE_A_ID}/catalog`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(200);
    expect(browse.body).toMatchObject({ storeId: STORE_A_ID });
    expect(browse.body.products).toEqual([
      expect.objectContaining({
        id: visible.body.id,
        storeId: STORE_A_ID,
        name: 'Visible Espresso',
        priceMinor: 450,
      }),
    ]);
    expect(
      browse.body.products.some(
        (product: { id: string }) => product.id === hidden.body.id,
      ),
    ).toBe(false);

    await updateOperations(administrator.accessToken, STORE_A_ID, {
      acceptingOrders: false,
    });
    await request(httpServer())
      .get(`/api/stores/${STORE_A_ID}/catalog`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(200)
      .expect({ storeId: STORE_A_ID, products: [] });

    await updateOperations(administrator.accessToken, STORE_A_ID, {
      status: 'CLOSED',
      acceptingOrders: true,
    });
    await request(httpServer())
      .get(`/api/stores/${STORE_A_ID}/catalog`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect({ storeId: STORE_A_ID, products: [] });

    await updateOperations(administrator.accessToken, STORE_A_ID, {
      status: 'OPEN',
      operatingHours: alwaysOpenHours(),
    });
    await updateOperations(administrator.accessToken, STORE_A_ID, {
      status: 'SUSPENDED',
    });
    await request(httpServer())
      .get(`/api/stores/${STORE_A_ID}/catalog`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect({ storeId: STORE_A_ID, products: [] });

    await updateOperations(administrator.accessToken, STORE_A_ID, {
      status: 'OPEN',
      operatingHours: closedHours(),
    });
    await request(httpServer())
      .get(`/api/stores/${STORE_A_ID}/catalog`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect({ storeId: STORE_A_ID, products: [] });

    await updateOperations(administrator.accessToken, STORE_A_ID, {
      operatingHours: alwaysOpenHours(),
    });
    await request(httpServer())
      .get(`/api/stores/${STORE_A_ID}/catalog`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.products).toHaveLength(1);
        expect(body.products[0].storeId).toBe(STORE_A_ID);
      });

    await request(httpServer())
      .get(`/api/stores/${STORE_B_ID}/catalog`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect({ storeId: STORE_B_ID, products: [] });
  });

  it('enforces store-admin scope, preserves price history, and gives platform admins global access', async () => {
    const platform = await register('platform');
    await bootstrap(platform);
    await createStore(platform, STORE_A_ID, 'Management Store A');
    await createStore(platform, STORE_B_ID, 'Management Store B');
    const administrator = await register('administrator');
    const customer = await register('customer');
    await assignStoreAdmin(platform, administrator.user.id, STORE_A_ID);

    const created = await request(httpServer())
      .post(`/api/stores/${STORE_A_ID}/catalog/products`)
      .set('Authorization', `Bearer ${administrator.accessToken}`)
      .send({ name: 'Managed Coffee', priceMinor: 600 })
      .expect(201);

    await request(httpServer())
      .post(
        `/api/stores/${STORE_A_ID}/catalog/products/${created.body.id}/prices`,
      )
      .set('Authorization', `Bearer ${administrator.accessToken}`)
      .send({ amountMinor: 700, currency: 'EUR' })
      .expect(201);

    const history = await request(httpServer())
      .get(
        `/api/stores/${STORE_A_ID}/catalog/products/${created.body.id}/prices`,
      )
      .set('Authorization', `Bearer ${administrator.accessToken}`)
      .expect(200);
    expect(history.body).toMatchObject({
      storeId: STORE_A_ID,
      productId: created.body.id,
    });
    expect(history.body.prices).toHaveLength(2);
    expect(history.body.prices[0]).toMatchObject({
      amountMinor: 700,
      currency: 'EUR',
      effectiveTo: null,
    });
    expect(history.body.prices[1].effectiveTo).not.toBeNull();

    await request(httpServer())
      .post(`/api/stores/${STORE_B_ID}/catalog/products`)
      .set('Authorization', `Bearer ${administrator.accessToken}`)
      .send({ name: 'Cross Store Product', priceMinor: 100 })
      .expect(403)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          statusCode: 403,
          message: 'Access denied',
        });
      });
    await request(httpServer())
      .patch(`/api/stores/${STORE_B_ID}/operations`)
      .set('Authorization', `Bearer ${administrator.accessToken}`)
      .send({ status: 'OPEN' })
      .expect(403)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          statusCode: 403,
          message: 'Access denied',
        });
      });

    await request(httpServer())
      .get(`/api/stores/${STORE_A_ID}/catalog/products/${MISSING_STORE_ID}`)
      .set('Authorization', `Bearer ${administrator.accessToken}`)
      .expect(404);
    await request(httpServer())
      .post(`/api/stores/${MISSING_STORE_ID}/catalog/products`)
      .set('Authorization', `Bearer ${platform.accessToken}`)
      .send({ name: 'Missing Store Product', priceMinor: 100 })
      .expect(404);
    await request(httpServer())
      .get(`/api/stores/${MISSING_STORE_ID}/catalog`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(404);
    await request(httpServer())
      .post(`/api/stores/${STORE_A_ID}/catalog/products`)
      .set('Authorization', `Bearer ${administrator.accessToken}`)
      .send({ name: 'Invalid Price', priceMinor: -1 })
      .expect(400);
    await request(httpServer())
      .patch(`/api/stores/${STORE_A_ID}/operations`)
      .set('Authorization', `Bearer ${administrator.accessToken}`)
      .send({ status: 'NOT_A_STORE_STATUS' })
      .expect(400);

    await request(httpServer())
      .post(`/api/stores/${STORE_B_ID}/catalog/products`)
      .set('Authorization', `Bearer ${platform.accessToken}`)
      .send({ name: 'Platform Product', priceMinor: 800 })
      .expect(201)
      .expect(({ body }) => {
        expect(body.storeId).toBe(STORE_B_ID);
      });
    await updateOperations(platform.accessToken, STORE_B_ID, {
      status: 'OPEN',
      operatingHours: alwaysOpenHours(),
    });
    await request(httpServer())
      .get(`/api/stores/${STORE_B_ID}/catalog/products`)
      .set('Authorization', `Bearer ${platform.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.storeId).toBe(STORE_B_ID);
        expect(body.products).toHaveLength(1);
      });

    await request(httpServer())
      .get(`/api/stores/${STORE_A_ID}/operations`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(403);
  });
});

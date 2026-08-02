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

const BOOTSTRAP_TOKEN = 'rbac-test-bootstrap-token';
const STORE_A_ID = '10000000-0000-4000-8000-000000000001';
const STORE_B_ID = '10000000-0000-4000-8000-000000000002';

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

describe('Store-scoped RBAC (e2e)', () => {
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

  async function register(role = 'user'): Promise<AuthResponse> {
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
    accessToken: string,
    id: string,
    name: string,
  ): Promise<void> {
    await request(httpServer())
      .post('/api/rbac/stores')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ id, name })
      .expect(201);
  }

  async function assign(
    accessToken: string,
    userId: string,
    role: string,
    storeId?: string,
  ) {
    return request(httpServer())
      .post('/api/rbac/assignments')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ userId, role, ...(storeId ? { storeId } : {}) })
      .expect(201);
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

  it('bootstraps the first platform admin and protects the catalog and assignments', async () => {
    const platform = await register('platform-admin');
    await bootstrap(platform);

    const roles = await request(httpServer())
      .get('/api/rbac/roles')
      .set('Authorization', `Bearer ${platform.accessToken}`)
      .expect(200);
    expect(roles.body.map((role: { name: string }) => role.name)).toEqual([
      'customer',
      'platform-admin',
      'store-admin',
      'store-operator',
    ]);

    const permissions = await request(httpServer())
      .get('/api/rbac/permissions')
      .set('Authorization', `Bearer ${platform.accessToken}`)
      .expect(200);
    expect(
      permissions.body.map((permission: { key: string }) => permission.key),
    ).toEqual([
      'catalog.manage',
      'catalog.read',
      'order.cancel.own',
      'order.cancel.store',
      'order.create',
      'order.read.own',
      'order.read.store',
      'payment.attempt.own',
      'payment.read.own',
      'payment.read.store',
      'rbac.assignment.read',
      'rbac.assignment.write',
      'rbac.catalog.read',
      'rbac.catalog.write',
      'store.directory.read',
      'store.operations.manage',
      'store.scope.manage',
      'store.scope.read',
    ]);

    const customRole = await request(httpServer())
      .post('/api/rbac/roles')
      .set('Authorization', `Bearer ${platform.accessToken}`)
      .send({
        name: 'report-reader',
        description: 'Read reporting data.',
        assignmentScope: 'GLOBAL',
      })
      .expect(201);
    const customPermission = await request(httpServer())
      .post('/api/rbac/permissions')
      .set('Authorization', `Bearer ${platform.accessToken}`)
      .send({
        key: 'report.read',
        description: 'Read reporting data.',
        scope: 'GLOBAL',
      })
      .expect(201);

    await request(httpServer())
      .post('/api/rbac/role-permissions')
      .set('Authorization', `Bearer ${platform.accessToken}`)
      .send({
        role: customRole.body.name,
        permission: customPermission.body.key,
      })
      .expect(201);

    const operator = await register('store-operator');
    await createStore(platform.accessToken, STORE_A_ID, 'Store A');
    await assign(
      platform.accessToken,
      operator.user.id,
      'store-operator',
      STORE_A_ID,
    );

    const assignments = await request(httpServer())
      .get(`/api/rbac/assignments?userId=${operator.user.id}`)
      .set('Authorization', `Bearer ${platform.accessToken}`)
      .expect(200);
    expect(assignments.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: operator.user.id,
          role: expect.objectContaining({ name: 'store-operator' }),
          store: { id: STORE_A_ID, name: 'Store A' },
        }),
      ]),
    );

    const queriedRoles = await request(httpServer())
      .get('/api/rbac/roles')
      .set('Authorization', `Bearer ${platform.accessToken}`)
      .expect(200);
    expect(
      queriedRoles.body
        .find((role: { name: string }) => role.name === 'report-reader')
        .permissions.map((permission: { key: string }) => permission.key),
    ).toEqual(['report.read']);

    await request(httpServer())
      .post('/api/rbac/bootstrap')
      .set('x-rbac-bootstrap-token', BOOTSTRAP_TOKEN)
      .send({ userId: operator.user.id })
      .expect(409);
  });

  it('returns consistent 401 responses for missing and invalid bearer credentials', async () => {
    const platform = await register('platform-admin');
    await bootstrap(platform);
    await createStore(platform.accessToken, STORE_A_ID, 'Store A');

    const missing = await request(httpServer())
      .get(`/api/stores/${STORE_A_ID}/workspace`)
      .expect(401);
    const invalid = await request(httpServer())
      .get(`/api/stores/${STORE_A_ID}/workspace`)
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);

    expect(missing.body).toMatchObject({
      statusCode: 401,
      message: 'Authentication required',
    });
    expect(invalid.body).toEqual(missing.body);
  });

  it('enforces every v1 role and store boundaries while keeping platform access global', async () => {
    const platform = await register('platform-admin');
    await bootstrap(platform);
    await createStore(platform.accessToken, STORE_A_ID, 'Store A');
    await createStore(platform.accessToken, STORE_B_ID, 'Store B');

    const operator = await register('store-operator');
    const administrator = await register('store-admin');
    const customer = await register('customer');
    await assign(
      platform.accessToken,
      operator.user.id,
      'store-operator',
      STORE_A_ID,
    );
    await assign(
      platform.accessToken,
      administrator.user.id,
      'store-admin',
      STORE_A_ID,
    );

    await request(httpServer())
      .get(`/api/stores/${STORE_A_ID}/workspace`)
      .set('Authorization', `Bearer ${operator.accessToken}`)
      .expect(200);
    await request(httpServer())
      .get(`/api/stores/${STORE_B_ID}/workspace`)
      .set('Authorization', `Bearer ${operator.accessToken}`)
      .expect(403);

    await request(httpServer())
      .get(`/api/stores/${STORE_A_ID}/workspace`)
      .set('Authorization', `Bearer ${administrator.accessToken}`)
      .expect(200);
    await request(httpServer())
      .get(`/api/stores/${STORE_B_ID}/workspace`)
      .set('Authorization', `Bearer ${administrator.accessToken}`)
      .expect(403);

    const customerDenied = await request(httpServer())
      .get(`/api/stores/${STORE_A_ID}/workspace`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(403);
    expect(customerDenied.body).toMatchObject({
      statusCode: 403,
      message: 'Access denied',
    });

    await request(httpServer())
      .get(`/api/stores/${STORE_A_ID}/workspace`)
      .set('Authorization', `Bearer ${platform.accessToken}`)
      .expect(200);
    await request(httpServer())
      .get(`/api/stores/${STORE_B_ID}/workspace`)
      .set('Authorization', `Bearer ${platform.accessToken}`)
      .expect(200);

    const customerCatalogAttempt = await request(httpServer())
      .get('/api/rbac/roles')
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(403);
    expect(customerCatalogAttempt.body).toMatchObject({
      statusCode: 403,
      message: 'Access denied',
    });

    await request(httpServer())
      .post('/api/rbac/role-permissions')
      .set('Authorization', `Bearer ${platform.accessToken}`)
      .send({
        role: 'customer',
        permission: 'store.scope.read',
      })
      .expect(400);
  });

  it('rejects malformed role scope assignments and supports idempotent assignment creation', async () => {
    const platform = await register('platform-admin');
    await bootstrap(platform);
    await createStore(platform.accessToken, STORE_A_ID, 'Store A');
    const operator = await register('store-operator');

    await request(httpServer())
      .post('/api/rbac/assignments')
      .set('Authorization', `Bearer ${platform.accessToken}`)
      .send({ userId: operator.user.id, role: 'store-operator' })
      .expect(400);
    await request(httpServer())
      .post('/api/rbac/assignments')
      .set('Authorization', `Bearer ${platform.accessToken}`)
      .send({
        userId: operator.user.id,
        role: 'customer',
        storeId: STORE_A_ID,
      })
      .expect(400);

    const first = await assign(
      platform.accessToken,
      operator.user.id,
      'store-operator',
      STORE_A_ID,
    );
    const second = await assign(
      platform.accessToken,
      operator.user.id,
      'store-operator',
      STORE_A_ID,
    );
    expect(second.body.id).toBe(first.body.id);
  });
});

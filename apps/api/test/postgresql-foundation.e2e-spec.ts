import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { newDb } from 'pg-mem';
import request from 'supertest';
import { AppModule } from '../src/app/app.module';
import { DATABASE_POOL } from '../src/db/drizzle.module';
import { PERFORMANCE_STORE } from '../src/performance/performance.constants';

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

describe('PostgreSQL foundation (e2e)', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('starts with a clean database, applies migrations, and reports healthy', async () => {
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

    await request(app.getHttpServer())
      .post('/api/user')
      .send({ name: 'Ada', email: 'ada@example.com' })
      .expect(201);

    await request(app.getHttpServer())
      .get('/api/user')
      .expect(200)
      .expect((response) => {
        expect(response.body).toHaveLength(1);
        expect(response.body[0]).toMatchObject({
          name: 'Ada',
          email: 'ada@example.com',
        });
      });

    await request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect({
        status: 'degraded',
        application: { status: 'up' },
        database: { status: 'up' },
        redis: { status: 'disabled', mode: 'memory' },
      });
  });

  it('reports an unavailable database without exposing connection details', async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousConnectionTimeout =
      process.env.DATABASE_CONNECTION_TIMEOUT_MS;
    process.env.DATABASE_URL =
      'postgresql://health-user:health-password@127.0.0.1:1/coffee_order';
    process.env.DATABASE_CONNECTION_TIMEOUT_MS = '100';

    try {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      app.setGlobalPrefix('api');
      await app.init();

      const response = await request(app.getHttpServer())
        .get('/api/health')
        .expect(503);

      expect(response.body).toEqual({
        status: 'error',
        application: { status: 'up' },
        database: { status: 'down' },
        redis: { status: 'disabled', mode: 'memory' },
      });
      expect(JSON.stringify(response.body)).not.toContain('health-password');
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }

      if (previousConnectionTimeout === undefined) {
        delete process.env.DATABASE_CONNECTION_TIMEOUT_MS;
      } else {
        process.env.DATABASE_CONNECTION_TIMEOUT_MS = previousConnectionTimeout;
      }
    }
  });

  it('fails open when a configured Redis endpoint is unavailable', async () => {
    const previousRedisUrl = process.env.REDIS_URL;
    const previousRedisConnectTimeout = process.env.REDIS_CONNECT_TIMEOUT_MS;
    const previousRedisOperationTimeout =
      process.env.REDIS_OPERATION_TIMEOUT_MS;
    process.env.REDIS_URL = 'redis://127.0.0.1:1';
    process.env.REDIS_CONNECT_TIMEOUT_MS = '50';
    process.env.REDIS_OPERATION_TIMEOUT_MS = '100';

    try {
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

      await request(app.getHttpServer())
        .get('/api/health')
        .expect(200)
        .expect({
          status: 'degraded',
          application: { status: 'up' },
          database: { status: 'up' },
          redis: { status: 'unavailable', mode: 'memory' },
        });
    } finally {
      if (previousRedisUrl === undefined) {
        delete process.env.REDIS_URL;
      } else {
        process.env.REDIS_URL = previousRedisUrl;
      }
      if (previousRedisConnectTimeout === undefined) {
        delete process.env.REDIS_CONNECT_TIMEOUT_MS;
      } else {
        process.env.REDIS_CONNECT_TIMEOUT_MS = previousRedisConnectTimeout;
      }
      if (previousRedisOperationTimeout === undefined) {
        delete process.env.REDIS_OPERATION_TIMEOUT_MS;
      } else {
        process.env.REDIS_OPERATION_TIMEOUT_MS = previousRedisOperationTimeout;
      }
    }
  });

  it('reports Redis degradation without marking PostgreSQL unhealthy', async () => {
    const pool = createMemoryPool();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DATABASE_POOL)
      .useValue(pool)
      .overrideProvider(PERFORMANCE_STORE)
      .useValue({
        health: async () => {
          throw new Error('Redis unavailable');
        },
        close: async () => undefined,
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    await request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect({
        status: 'degraded',
        application: { status: 'up' },
        database: { status: 'up' },
        redis: { status: 'unavailable', mode: 'memory' },
      });
  });

  it('reports an available Redis adapter independently from PostgreSQL', async () => {
    const pool = createMemoryPool();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DATABASE_POOL)
      .useValue(pool)
      .overrideProvider(PERFORMANCE_STORE)
      .useValue({
        health: async () => ({ status: 'up', mode: 'redis' }),
        close: async () => undefined,
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    await request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect({
        status: 'ok',
        application: { status: 'up' },
        database: { status: 'up' },
        redis: { status: 'up', mode: 'redis' },
      });
  });
});

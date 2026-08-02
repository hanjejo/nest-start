import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createHash } from 'node:crypto';
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

function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

describe('Authentication sessions (e2e)', () => {
  let app: INestApplication | undefined;
  let pool: ReturnType<typeof createMemoryPool>;
  let emailCounter = 0;

  async function startApp() {
    pool = createMemoryPool();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DATABASE_POOL)
      .useValue(pool)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  }

  function httpServer() {
    if (!app) {
      throw new Error('Test application is not initialized');
    }
    return app.getHttpServer();
  }

  function nextEmail(): string {
    emailCounter += 1;
    return `customer-${emailCounter}@example.com`;
  }

  async function register(
    email = nextEmail(),
    password = 'correct horse battery staple',
  ): Promise<AuthResponse> {
    const response = await request(httpServer())
      .post('/api/auth/register')
      .send({ email, password, name: 'Coffee Customer' })
      .expect(201);
    return response.body as AuthResponse;
  }

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  beforeEach(async () => {
    await startApp();
  });

  it('registers and logs in without exposing password or token hashes', async () => {
    const email = nextEmail();
    const password = 'correct horse battery staple';
    const registration = await register(email, password);

    expect(registration.accessToken).toEqual(expect.any(String));
    expect(registration.refreshToken).toEqual(expect.any(String));
    expect(registration.user).toMatchObject({
      email,
      name: 'Coffee Customer',
    });
    expect(JSON.stringify(registration)).not.toContain(password);
    expect(JSON.stringify(registration)).not.toContain('passwordHash');
    expect(JSON.stringify(registration)).not.toContain('tokenHash');

    const login = await request(httpServer())
      .post('/api/auth/login')
      .send({ email: email.toUpperCase(), password })
      .expect(200);

    expect(login.body).toMatchObject({
      user: { email },
      tokenType: 'Bearer',
    });
    expect(login.body.refreshToken).not.toBe(registration.refreshToken);

    const storedPassword = await pool.query(
      'SELECT password_hash FROM users WHERE email = $1',
      [email],
    );
    expect(storedPassword.rows[0].password_hash).toMatch(/^scrypt\$/);
    expect(storedPassword.rows[0].password_hash).not.toBe(password);

    const storedSessions = await pool.query(
      'SELECT token_hash FROM refresh_sessions',
    );
    expect(
      storedSessions.rows.map((row: { token_hash: string }) => row.token_hash),
    ).not.toContain(registration.refreshToken);
    expect(
      storedSessions.rows.map((row: { token_hash: string }) => row.token_hash),
    ).not.toContain(login.body.refreshToken);
  });

  it('uses stable failures for duplicate registration and invalid credentials', async () => {
    const email = nextEmail();
    const password = 'correct horse battery staple';
    await register(email, password);

    const duplicate = await request(httpServer())
      .post('/api/auth/register')
      .send({ email, password: 'another correct password' })
      .expect(409);
    expect(duplicate.body).toMatchObject({
      statusCode: 409,
      message: 'Registration failed',
    });
    expect(JSON.stringify(duplicate.body)).not.toContain(password);

    const invalidPassword = await request(httpServer())
      .post('/api/auth/login')
      .send({ email, password: 'not the account password' })
      .expect(401);
    const invalidEmail = await request(httpServer())
      .post('/api/auth/login')
      .send({ email: 'missing@example.com', password })
      .expect(401);

    expect(invalidPassword.body).toMatchObject({
      statusCode: 401,
      message: 'Invalid credentials',
    });
    expect(invalidEmail.body).toMatchObject({
      statusCode: 401,
      message: 'Invalid credentials',
    });
    expect(invalidPassword.body.message).toBe(invalidEmail.body.message);
  });

  it('does not expose password hashes through the existing user delete endpoint', async () => {
    const registered = await register();

    const deleted = await request(httpServer())
      .delete(`/api/user/${registered.user.id}`)
      .expect(200);

    expect(deleted.body).toMatchObject({
      id: registered.user.id,
      email: registered.user.email,
      name: registered.user.name,
    });
    expect(deleted.body).not.toHaveProperty('passwordHash');
  });

  it('rotates refresh tokens and revokes the family after old-token reuse', async () => {
    const first = await register();

    const rotated = await request(httpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(200);
    expect(rotated.body.refreshToken).not.toBe(first.refreshToken);

    await request(httpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(401)
      .expect(({ body }) => {
        expect(body.message).toBe('Invalid refresh token');
      });

    await request(httpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(401);

    const sessions = await pool.query(
      'SELECT status, revocation_reason FROM refresh_sessions ORDER BY created_at',
    );
    expect(sessions.rows).toHaveLength(2);
    expect(sessions.rows).toEqual(
      expect.arrayContaining([
        { status: 'REVOKED', revocation_reason: 'TOKEN_REUSE' },
      ]),
    );
    expect(
      sessions.rows.every(
        (row: { status: string }) => row.status === 'REVOKED',
      ),
    ).toBe(true);

    const events = await pool.query(
      "SELECT event_type FROM authentication_events WHERE event_type = 'REFRESH_TOKEN_REUSE_DETECTED'",
    );
    expect(events.rows).toHaveLength(1);
  });

  it('rejects expired refresh sessions without reviving them', async () => {
    const registered = await register();
    await pool.query(
      'UPDATE refresh_sessions SET expires_at = $1 WHERE token_hash = $2',
      [new Date(Date.now() - 1_000), tokenHash(registered.refreshToken)],
    );

    await request(httpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: registered.refreshToken })
      .expect(401);

    const sessions = await pool.query(
      'SELECT status FROM refresh_sessions WHERE token_hash = $1',
      [tokenHash(registered.refreshToken)],
    );
    expect(sessions.rows).toEqual([{ status: 'EXPIRED' }]);
  });

  it('makes current-device logout idempotent and rejects the revoked session', async () => {
    const registered = await register();

    await request(httpServer())
      .post('/api/auth/logout')
      .send({ refreshToken: registered.refreshToken })
      .expect(200)
      .expect({ success: true });
    await request(httpServer())
      .post('/api/auth/logout')
      .send({ refreshToken: registered.refreshToken })
      .expect(200)
      .expect({ success: true });
    await request(httpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: registered.refreshToken })
      .expect(401);

    const sessions = await pool.query(
      'SELECT status, revocation_reason FROM refresh_sessions',
    );
    expect(sessions.rows).toEqual([
      { status: 'REVOKED', revocation_reason: 'LOGOUT' },
    ]);
  });

  it('revokes all sessions for the authenticated account', async () => {
    const email = nextEmail();
    const password = 'correct horse battery staple';
    const first = await register(email, password);
    const second = await request(httpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);

    await request(httpServer())
      .post('/api/auth/logout-all')
      .set('Authorization', `Bearer ${first.accessToken}`)
      .expect(200)
      .expect({ success: true });

    await request(httpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(401);
    await request(httpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: second.body.refreshToken })
      .expect(401);

    const sessions = await pool.query(
      'SELECT status, revocation_reason FROM refresh_sessions ORDER BY created_at',
    );
    expect(sessions.rows).toEqual([
      { status: 'REVOKED', revocation_reason: 'LOGOUT_ALL' },
      { status: 'REVOKED', revocation_reason: 'LOGOUT_ALL' },
    ]);
  });
});

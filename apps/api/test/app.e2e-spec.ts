import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/api (GET)', () => {
    return request(app.getHttpServer())
      .get('/api')
      .expect(200)
      .expect('Hello World!');
  });

  it('propagates a safe correlation header and exposes bounded metrics', async () => {
    const correlationId = 'e2e-request-11';

    await request(app.getHttpServer())
      .get('/api')
      .set('x-correlation-id', correlationId)
      .expect(200)
      .expect('x-correlation-id', correlationId);

    const metrics = await request(app.getHttpServer())
      .get('/api/metrics')
      .expect(200)
      .expect('Content-Type', /text\/plain/);

    expect(metrics.text).toContain('coffee_order_http_requests_total');
    expect(metrics.text).toContain('route="/api"');
    expect(metrics.text).not.toContain(correlationId);
  });
});

import { Writable } from 'node:stream';
import type { NodeSDK } from '@opentelemetry/sdk-node';
import { createIntegrationEvent } from '../messaging/integration-event';
import { InMemoryIntegrationEventTransport } from '../messaging/in-memory-transport';
import { integrationEventTopology } from '../messaging/messaging.constants';
import {
  correlationIdFromHeader,
  generateCorrelationId,
  isValidCorrelationId,
  runWithCorrelationContext,
} from './correlation-context';
import { createPinoLogger, getLogContextFields } from './logger';
import { MetricsService } from './metrics.service';
import { loadObservabilityConfig } from './observability.config';
import { initializeTelemetry, shutdownTelemetry } from './telemetry';

describe('observability seams', () => {
  afterEach(async () => {
    await shutdownTelemetry();
  });

  it('generates and validates bounded correlation IDs', () => {
    const generated = generateCorrelationId();

    expect(isValidCorrelationId(generated)).toBe(true);
    expect(correlationIdFromHeader(' request-123 ')).toBe('request-123');
    expect(correlationIdFromHeader('request with spaces')).toBeUndefined();
    expect(correlationIdFromHeader(['request-1', 'request-2'])).toBeUndefined();
    expect(correlationIdFromHeader('a'.repeat(129))).toBeUndefined();
  });

  it('loads signal-specific OTLP endpoints without inventing an exporter', () => {
    expect(
      loadObservabilityConfig({
        OTEL_EXPORTER_OTLP_ENDPOINT: ' http://collector:4318 ',
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://traces:4318/v1/traces',
      }),
    ).toMatchObject({
      otlpEndpoint: 'http://collector:4318',
      otlpTracesEndpoint: 'http://traces:4318/v1/traces',
      otlpMetricsEndpoint: 'http://collector:4318',
    });

    expect(
      loadObservabilityConfig({
        OTEL_SDK_DISABLED: 'true',
      }).otlpEndpoint,
    ).toBeUndefined();
  });

  it('keeps correlation and causation context across async work', async () => {
    const observed = await runWithCorrelationContext(
      {
        correlationId: 'http-request-123',
        causationId: 'OrderPlaced:event-1',
      },
      async () => {
        await Promise.resolve();
        return getLogContextFields();
      },
    );

    expect(observed).toMatchObject({
      correlationId: 'http-request-123',
      causationId: 'OrderPlaced:event-1',
      traceId: null,
      spanId: null,
    });
  });

  it('inherits context at the Integration Event boundary', () => {
    const event = runWithCorrelationContext(
      {
        correlationId: 'http-request-456',
        causationId: 'OrderPlaced:event-2',
      },
      () =>
        createIntegrationEvent({
          eventType: 'PaymentStarted',
          eventVersion: 1,
          producer: 'Payment',
          aggregateType: 'PaymentIntent',
          aggregateId: 'payment-1',
          aggregateVersion: 1,
          payload: {},
        }),
    );

    expect(event).toMatchObject({
      correlationId: 'http-request-456',
      causationId: 'OrderPlaced:event-2',
    });
  });

  it('propagates event context through the in-memory transport', async () => {
    const metrics = new MetricsService();
    const transport = new InMemoryIntegrationEventTransport({}, metrics);
    let observed: ReturnType<typeof getLogContextFields> | undefined;
    const subscription = await transport.consume({
      topology: integrationEventTopology('observability', ['PaymentStarted']),
      handler: async () => {
        observed = getLogContextFields();
      },
    });

    const event = runWithCorrelationContext(
      {
        correlationId: 'http-request-transport',
        causationId: 'OrderPlaced:event-transport',
      },
      () =>
        createIntegrationEvent({
          eventType: 'PaymentStarted',
          eventVersion: 1,
          producer: 'Payment',
          aggregateType: 'PaymentIntent',
          aggregateId: 'payment-transport',
          aggregateVersion: 1,
          payload: {},
        }),
    );

    await transport.publish(event);
    await subscription.close();
    await transport.close();

    expect(observed).toMatchObject({
      correlationId: 'http-request-transport',
      causationId: 'OrderPlaced:event-transport',
    });
    const output = await metrics.render();
    expect(output).toContain('coffee_order_rabbitmq_consumer_total');
    expect(output).toContain('transport="in-memory"');
  });

  it('emits JSON Pino fields and redacts credentials and PII', () => {
    const lines: string[] = [];
    const previousLogLevel = process.env.PINO_LOG_LEVEL;
    process.env.PINO_LOG_LEVEL = 'info';
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });
    const logger = createPinoLogger(destination);

    runWithCorrelationContext(
      {
        correlationId: 'http-request-789',
        causationId: 'OrderPlaced:event-3',
      },
      () =>
        logger.info(
          {
            authorization: 'Bearer secret-token',
            cookie: 'session=secret-cookie',
            password: 'secret-password',
            email: 'customer@example.com',
            address: '1 Private Street',
            paymentMethod: {
              cardNumber: '4111111111111111',
              cvv: '123',
            },
            nested: {
              token: 'nested-secret-token',
            },
            safeValue: 'kept',
          },
          'structured log',
        ),
    );
    if (previousLogLevel === undefined) {
      delete process.env.PINO_LOG_LEVEL;
    } else {
      process.env.PINO_LOG_LEVEL = previousLogLevel;
    }

    const record = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(record).toMatchObject({
      service: 'coffee-order-api',
      version: 'local',
      correlationId: 'http-request-789',
      causationId: 'OrderPlaced:event-3',
      traceId: null,
      spanId: null,
      safeValue: 'kept',
    });
    expect(record.timestamp).toEqual(expect.any(String));
    expect(record.authorization).toBe('[REDACTED]');
    expect(record.cookie).toBe('[REDACTED]');
    expect(record.password).toBe('[REDACTED]');
    expect(record.email).toBe('[REDACTED]');
    expect(record.address).toBe('[REDACTED]');
    expect(record.paymentMethod).toBe('[REDACTED]');
    expect(record.nested).toMatchObject({
      token: '[REDACTED]',
    });
    expect(lines[0]).not.toContain('secret-token');
    expect(lines[0]).not.toContain('customer@example.com');
  });

  it('keeps useful structured error details while redacting error secrets', async () => {
    const lines: string[] = [];
    const previousLogLevel = process.env.PINO_LOG_LEVEL;
    process.env.PINO_LOG_LEVEL = 'info';
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });
    const logger = createPinoLogger(destination);
    const error = Object.assign(new Error('provider failed'), {
      token: 'error-token',
    });

    logger.error({ err: error }, 'provider call failed');
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (previousLogLevel === undefined) {
      delete process.env.PINO_LOG_LEVEL;
    } else {
      process.env.PINO_LOG_LEVEL = previousLogLevel;
    }

    const record = JSON.parse(lines[0]) as {
      err: { message: string; stack: string; token?: string };
    };
    expect(record.err.message).toBe('provider failed');
    expect(record.err.stack).toContain('Error: provider failed');
    expect(record.err.token).toBe('[REDACTED]');
    expect(lines[0]).not.toContain('error-token');
  });

  it('exposes low-cardinality Prometheus metrics without request identifiers', async () => {
    const metrics = new MetricsService();
    metrics.observeHttp(
      'GET',
      '/user/00000000-0000-4000-8000-000000000001',
      200,
      12,
    );
    metrics.observeHttp('POST', '/user/42', 500, 150);
    metrics.observeInbox('DUPLICATE', 3);
    metrics.recordOutboxPublishFailure();
    metrics.setOutboxBacklog(2, 12);
    metrics.setHealth('postgresql', 'up');
    metrics.setPostgresqlMigration('applied');
    metrics.recordRabbitRetry('in-memory');
    metrics.recordRabbitDeadLetter('in-memory');
    metrics.setRabbitBacklog('in-memory', 1, 'in-memory');
    metrics.recordRedisHit();
    metrics.recordRedisFallback();
    metrics.recordWorkflowRecovery('PaymentWorkflow');

    const output = await metrics.render();

    expect(output).toContain('coffee_order_http_requests_total');
    expect(output).toContain('coffee_order_http_errors_total');
    expect(output).toContain('coffee_order_inbox_processing_total');
    expect(output).toContain('coffee_order_outbox_publish_failures_total');
    expect(output).toContain('coffee_order_rabbitmq_retries_total');
    expect(output).toContain('coffee_order_rabbitmq_dead_letters_total');
    expect(output).toContain('transport="in-memory"');
    expect(output).toContain('coffee_order_postgresql_migration_status');
    expect(output).toContain('coffee_order_redis_hits_total');
    expect(output).toContain('coffee_order_workflow_recoveries_total');
    expect(output).toContain('route="/user/:id"');
    expect(output).not.toContain('00000000-0000-4000-8000-000000000001');
    expect(output).not.toContain('customer@example.com');
  });

  it('starts safely with a no-op OTEL configuration when no exporter exists', () => {
    const sdk = {
      start: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined),
    } as unknown as NodeSDK;

    const state = initializeTelemetry(
      {
        serviceName: 'coffee-order-api',
        serviceVersion: 'test',
        otelSdkDisabled: false,
      },
      () => sdk,
    );

    expect(state).toEqual({
      status: 'disabled',
      sdk: 'enabled',
      exporter: 'disabled',
    });
    expect(sdk.start).toHaveBeenCalledTimes(1);
  });

  it('does not initialize OTEL when explicitly disabled', () => {
    const sdkFactory = vi.fn();

    const state = initializeTelemetry(
      {
        serviceName: 'coffee-order-api',
        serviceVersion: 'test',
        otelSdkDisabled: true,
      },
      sdkFactory,
    );

    expect(state.status).toBe('disabled');
    expect(sdkFactory).not.toHaveBeenCalled();
  });
});

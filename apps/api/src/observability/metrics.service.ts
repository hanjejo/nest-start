import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import { loadObservabilityConfig } from './observability.config';

const STATUS_CLASSES = ['1xx', '2xx', '3xx', '4xx', '5xx'] as const;
const HEALTH_STATUSES = ['up', 'degraded', 'down', 'disabled'] as const;
const TRANSPORT_NAMES = ['rabbitmq', 'in-memory'] as const;
const WORKFLOW_NAMES = [
  'PaymentWorkflow',
  'DeliveryWorkflow',
  'SettlementWorkflow',
] as const;

export type TransportName = (typeof TRANSPORT_NAMES)[number];

function statusClass(statusCode: number): (typeof STATUS_CLASSES)[number] {
  const value = `${Math.floor(statusCode / 100)}xx`;
  return STATUS_CLASSES.includes(value as (typeof STATUS_CLASSES)[number])
    ? (value as (typeof STATUS_CLASSES)[number])
    : '5xx';
}

export function normalizeMetricRoute(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    return 'unknown';
  }

  const normalized = value
    .split('?')[0]
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .slice(0, 96);

  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function boundedLabel(value: string): string {
  return value.replace(/[^A-Za-z0-9._:/-]/g, '_').slice(0, 96) || 'unknown';
}

@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  private readonly httpRequests = new Counter({
    name: 'coffee_order_http_requests_total',
    help: 'Total HTTP requests handled by the API.',
    labelNames: ['method', 'route', 'status_class'],
    registers: [this.registry],
  });

  private readonly httpErrors = new Counter({
    name: 'coffee_order_http_errors_total',
    help: 'Total HTTP requests returning a server error.',
    labelNames: ['method', 'route', 'status_class'],
    registers: [this.registry],
  });

  private readonly httpDuration = new Histogram({
    name: 'coffee_order_http_request_duration_seconds',
    help: 'HTTP request duration in seconds.',
    labelNames: ['method', 'route', 'status_class'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [this.registry],
  });

  private readonly health = new Gauge({
    name: 'coffee_order_health_status',
    help: 'Health status of API and dependencies (1 means healthy).',
    labelNames: ['component', 'status'],
    registers: [this.registry],
  });

  private readonly outboxPending = new Gauge({
    name: 'coffee_order_outbox_pending',
    help: 'Number of currently pending or retryable Outbox events.',
    registers: [this.registry],
  });

  private readonly outboxOldestAge = new Gauge({
    name: 'coffee_order_outbox_oldest_age_seconds',
    help: 'Age in seconds of the oldest observable pending Outbox event.',
    registers: [this.registry],
  });

  private readonly outboxPublishFailures = new Counter({
    name: 'coffee_order_outbox_publish_failures_total',
    help: 'Total Outbox publish failures.',
    registers: [this.registry],
  });

  private readonly outboxPublished = new Counter({
    name: 'coffee_order_outbox_published_total',
    help: 'Total Outbox events published successfully.',
    registers: [this.registry],
  });

  private readonly outboxDeadLettered = new Counter({
    name: 'coffee_order_outbox_dead_lettered_total',
    help: 'Total Outbox events moved to Dead Letter handling.',
    registers: [this.registry],
  });

  private readonly inboxResults = new Counter({
    name: 'coffee_order_inbox_processing_total',
    help: 'Total Inbox processing results.',
    labelNames: ['status'],
    registers: [this.registry],
  });

  private readonly inboxDuration = new Histogram({
    name: 'coffee_order_inbox_processing_duration_seconds',
    help: 'Inbox processing duration in seconds.',
    labelNames: ['status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [this.registry],
  });

  private readonly rabbitPublish = new Counter({
    name: 'coffee_order_rabbitmq_publish_total',
    help: 'Total Integration Event publish attempts.',
    labelNames: ['transport', 'outcome'],
    registers: [this.registry],
  });

  private readonly rabbitConsumer = new Counter({
    name: 'coffee_order_rabbitmq_consumer_total',
    help: 'Total Integration Event consumer outcomes.',
    labelNames: ['transport', 'outcome'],
    registers: [this.registry],
  });

  private readonly rabbitFailures = new Counter({
    name: 'coffee_order_rabbitmq_failures_total',
    help: 'Total RabbitMQ transport failures.',
    labelNames: ['transport', 'operation'],
    registers: [this.registry],
  });

  private readonly rabbitBacklog = new Gauge({
    name: 'coffee_order_rabbitmq_backlog',
    help: 'Observable RabbitMQ backlog, when a transport adapter reports it.',
    labelNames: ['transport', 'queue'],
    registers: [this.registry],
  });

  private readonly rabbitRetries = new Counter({
    name: 'coffee_order_rabbitmq_retries_total',
    help: 'Total Integration Event retry handoffs.',
    labelNames: ['transport'],
    registers: [this.registry],
  });

  private readonly rabbitDeadLetters = new Counter({
    name: 'coffee_order_rabbitmq_dead_letters_total',
    help: 'Total Integration Event Dead Letter handoffs.',
    labelNames: ['transport'],
    registers: [this.registry],
  });

  private readonly postgresqlPool = new Gauge({
    name: 'coffee_order_postgresql_pool_connections',
    help: 'PostgreSQL pool connections by state.',
    labelNames: ['state'],
    registers: [this.registry],
  });

  private readonly postgresqlTransactionFailures = new Counter({
    name: 'coffee_order_postgresql_transaction_failures_total',
    help: 'Observable PostgreSQL transaction failures.',
    registers: [this.registry],
  });

  private readonly postgresqlMigration = new Gauge({
    name: 'coffee_order_postgresql_migration_status',
    help: 'PostgreSQL migration state, where one status is set to one.',
    labelNames: ['status'],
    registers: [this.registry],
  });

  private readonly redisHits = new Counter({
    name: 'coffee_order_redis_hits_total',
    help: 'Successful operations against the primary Redis store.',
    registers: [this.registry],
  });

  private readonly redisFallbacks = new Counter({
    name: 'coffee_order_redis_fallback_total',
    help: 'Redis operation failures that used the in-memory fallback.',
    registers: [this.registry],
  });

  private readonly redisErrors = new Counter({
    name: 'coffee_order_redis_errors_total',
    help: 'Observable Redis operation failures.',
    registers: [this.registry],
  });

  private readonly workflowsStarted = new Counter({
    name: 'coffee_order_workflow_starts_total',
    help: 'Total durable workflow starts.',
    labelNames: ['workflow'],
    registers: [this.registry],
  });

  private readonly workflowsCompleted = new Counter({
    name: 'coffee_order_workflow_completions_total',
    help: 'Total durable workflow completions.',
    labelNames: ['workflow'],
    registers: [this.registry],
  });

  private readonly workflowsFailed = new Counter({
    name: 'coffee_order_workflow_failures_total',
    help: 'Total durable workflow failures.',
    labelNames: ['workflow'],
    registers: [this.registry],
  });

  private readonly workflowsRetried = new Counter({
    name: 'coffee_order_workflow_retries_total',
    help: 'Total observable durable workflow retries.',
    labelNames: ['workflow'],
    registers: [this.registry],
  });

  private readonly workflowsRecovered = new Counter({
    name: 'coffee_order_workflow_recoveries_total',
    help: 'Total observable workflow deduplication or recovery handoffs.',
    labelNames: ['workflow'],
    registers: [this.registry],
  });

  private readonly workflowDuration = new Histogram({
    name: 'coffee_order_workflow_duration_seconds',
    help: 'Observable workflow duration in seconds.',
    labelNames: ['workflow', 'outcome'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
    registers: [this.registry],
  });

  constructor() {
    const config = loadObservabilityConfig();
    this.registry.setDefaultLabels({
      service: config.serviceName,
      version: config.serviceVersion,
    });
    this.setPostgresqlMigration('pending');
  }

  observeHttp(
    method: string | undefined,
    route: unknown,
    statusCode: number,
    durationMilliseconds: number,
  ): void {
    const labels = {
      method: boundedLabel(method?.toUpperCase() ?? 'UNKNOWN'),
      route: normalizeMetricRoute(route),
      status_class: statusClass(statusCode),
    };
    this.httpRequests.inc(labels);
    this.httpDuration.observe(
      labels,
      Math.max(0, durationMilliseconds) / 1_000,
    );
    if (statusCode >= 500) {
      this.httpErrors.inc(labels);
    }
  }

  setHealth(component: string, status: (typeof HEALTH_STATUSES)[number]): void {
    const componentLabel = boundedLabel(component);
    for (const healthStatus of HEALTH_STATUSES) {
      this.health.set(
        {
          component: componentLabel,
          status: healthStatus,
        },
        healthStatus === status ? 1 : 0,
      );
    }
  }

  setOutboxBacklog(count: number, oldestAgeSeconds: number): void {
    this.outboxPending.set(Math.max(0, count));
    this.outboxOldestAge.set(Math.max(0, oldestAgeSeconds));
  }

  recordOutboxPublishFailure(): void {
    this.outboxPublishFailures.inc();
  }

  recordOutboxPublished(): void {
    this.outboxPublished.inc();
  }

  recordOutboxDeadLettered(): void {
    this.outboxDeadLettered.inc();
  }

  observeInbox(status: string, durationMilliseconds: number): void {
    const normalizedStatus = boundedLabel(status);
    this.inboxResults.labels(normalizedStatus).inc();
    this.inboxDuration
      .labels(normalizedStatus)
      .observe(Math.max(0, durationMilliseconds) / 1_000);
  }

  recordRabbitPublish(
    outcome: 'success' | 'failure',
    transport: TransportName = 'rabbitmq',
  ): void {
    this.rabbitPublish.labels(transport, outcome).inc();
  }

  recordRabbitConsumer(
    outcome: 'success' | 'failure',
    transport: TransportName = 'rabbitmq',
  ): void {
    this.rabbitConsumer.labels(transport, outcome).inc();
  }

  recordRabbitFailure(
    operation: string,
    transport: TransportName = 'rabbitmq',
  ): void {
    this.rabbitFailures.labels(transport, boundedLabel(operation)).inc();
  }

  setRabbitBacklog(
    queue: string,
    count: number,
    transport: TransportName = 'rabbitmq',
  ): void {
    this.rabbitBacklog
      .labels(transport, boundedLabel(queue))
      .set(Math.max(0, count));
  }

  recordRabbitRetry(transport: TransportName = 'rabbitmq'): void {
    this.rabbitRetries.labels(transport).inc();
  }

  recordRabbitDeadLetter(transport: TransportName = 'rabbitmq'): void {
    this.rabbitDeadLetters.labels(transport).inc();
  }

  setPostgresqlHealth(status: 'up' | 'down'): void {
    this.setHealth('postgresql', status);
  }

  setPostgresqlMigration(status: 'pending' | 'applied' | 'failed'): void {
    for (const migrationStatus of ['pending', 'applied', 'failed'] as const) {
      this.postgresqlMigration.set(
        { status: migrationStatus },
        migrationStatus === status ? 1 : 0,
      );
    }
  }

  setPostgresqlPool(pool: {
    totalCount?: number;
    idleCount?: number;
    waitingCount?: number;
  }): void {
    this.postgresqlPool.set(
      { state: 'total' },
      Math.max(0, pool.totalCount ?? 0),
    );
    this.postgresqlPool.set(
      { state: 'idle' },
      Math.max(0, pool.idleCount ?? 0),
    );
    this.postgresqlPool.set(
      { state: 'waiting' },
      Math.max(0, pool.waitingCount ?? 0),
    );
  }

  recordPostgresqlTransactionFailure(): void {
    this.postgresqlTransactionFailures.inc();
  }

  recordRedisHit(): void {
    this.redisHits.inc();
  }

  setRedisHealth(status: 'up' | 'degraded' | 'down' | 'disabled'): void {
    this.setHealth('redis', status);
  }

  recordRedisFallback(): void {
    this.redisFallbacks.inc();
  }

  recordRedisError(): void {
    this.redisErrors.inc();
  }

  recordWorkflowStarted(workflow: string): void {
    this.workflowsStarted.labels(this.workflowLabel(workflow)).inc();
  }

  recordWorkflowCompleted(
    workflow: string,
    durationMilliseconds?: number,
  ): void {
    const label = this.workflowLabel(workflow);
    this.workflowsCompleted.labels(label).inc();
    if (durationMilliseconds !== undefined) {
      this.workflowDuration
        .labels(label, 'success')
        .observe(Math.max(0, durationMilliseconds) / 1_000);
    }
  }

  recordWorkflowFailure(workflow: string, durationMilliseconds?: number): void {
    const label = this.workflowLabel(workflow);
    this.workflowsFailed.labels(label).inc();
    if (durationMilliseconds !== undefined) {
      this.workflowDuration
        .labels(label, 'failure')
        .observe(Math.max(0, durationMilliseconds) / 1_000);
    }
  }

  recordWorkflowRetry(workflow: string): void {
    this.workflowsRetried.labels(this.workflowLabel(workflow)).inc();
  }

  recordWorkflowRecovery(workflow: string): void {
    this.workflowsRecovered.labels(this.workflowLabel(workflow)).inc();
  }
  async render(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  private workflowLabel(value: string): string {
    return WORKFLOW_NAMES.includes(value as (typeof WORKFLOW_NAMES)[number])
      ? value
      : 'unknown';
  }
}

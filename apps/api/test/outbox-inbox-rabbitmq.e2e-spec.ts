import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';
import { newDb } from 'pg-mem';
import {
  IntegrationEventEnvelope,
  createIntegrationEvent,
} from '../src/messaging/integration-event';
import {
  DEFAULT_RETRY_POLICY,
  integrationEventTopology,
} from '../src/messaging/messaging.constants';
import { InMemoryIntegrationEventTransport } from '../src/messaging/in-memory-transport';
import { InboxEffect, InboxService } from '../src/messaging/inbox.service';
import { OutboxDispatcher } from '../src/messaging/outbox-dispatcher.service';
import { OutboxService } from '../src/messaging/outbox.service';
import { DrizzleDB, resolveMigrationsFolder } from '../src/db/drizzle.module';
import * as schema from '../src/db/schema';
import {
  deadLetterEvents,
  inboxEvents,
  outboxEvents,
  users,
} from '../src/db/schema';
import { IntegrationEventDelivery } from '../src/messaging/messaging.transport';

const USER_ID = '00000000-0000-4000-8000-000000000901';
const OTHER_USER_ID = '00000000-0000-4000-8000-000000000902';

type TestDatabase = {
  db: DrizzleDB;
  pool: { end(): Promise<void> };
};

function createMemoryDatabase(): TestDatabase {
  const database = newDb();
  const { Pool } = database.adapters.createPg();
  const pool = new Pool();
  const query = pool.query.bind(pool);
  let backup:
    | {
        restore(): void;
      }
    | undefined;

  pool.query = (queryConfig: unknown, ...args: unknown[]) => {
    const queryText =
      typeof queryConfig === 'string'
        ? queryConfig
        : typeof queryConfig === 'object' &&
            queryConfig !== null &&
            'text' in queryConfig
          ? String((queryConfig as { text: unknown }).text)
          : '';
    const normalizedQuery = queryText.trim().toUpperCase();
    if (normalizedQuery === 'BEGIN') {
      backup = database.backup();
    }
    if (typeof queryConfig === 'object' && queryConfig !== null) {
      const sanitizedQuery = { ...(queryConfig as Record<string, unknown>) };
      const rowMode = sanitizedQuery.rowMode;
      delete sanitizedQuery.types;
      delete sanitizedQuery.rowMode;
      const result = query(sanitizedQuery, ...args);
      if (normalizedQuery === 'ROLLBACK') {
        backup?.restore();
        backup = undefined;
      } else if (normalizedQuery === 'COMMIT') {
        backup = undefined;
      }

      if (rowMode !== 'array') {
        return result;
      }

      return result.then((response: { rows: Record<string, unknown>[] }) => ({
        ...response,
        rows: response.rows.map((row) => Object.values(row)),
      }));
    }

    const result = query(queryConfig, ...args);
    if (normalizedQuery === 'ROLLBACK') {
      backup?.restore();
      backup = undefined;
    } else if (normalizedQuery === 'COMMIT') {
      backup = undefined;
    }
    return result;
  };
  const connect = pool.connect.bind(pool);
  pool.connect = async (...args: unknown[]) => {
    const client = await connect(...args);
    const clientQuery = client.query.bind(client);
    let backup:
      | {
          restore(): void;
        }
      | undefined;
    client.query = (queryConfig: unknown, ...queryArgs: unknown[]) => {
      const queryText =
        typeof queryConfig === 'string'
          ? queryConfig
          : typeof queryConfig === 'object' &&
              queryConfig !== null &&
              'text' in queryConfig
            ? String((queryConfig as { text: unknown }).text)
            : '';
      const normalizedQuery = queryText.trim().toUpperCase();
      if (normalizedQuery === 'BEGIN') {
        backup = database.backup();
      }
      const result = clientQuery(queryConfig, ...queryArgs);
      if (normalizedQuery === 'ROLLBACK') {
        backup?.restore();
        backup = undefined;
      } else if (normalizedQuery === 'COMMIT') {
        backup = undefined;
      }
      return result;
    };
    return client;
  };

  return {
    db: drizzle(pool, { schema }) as DrizzleDB,
    pool,
  };
}

function testEvent(eventId = 'event-1'): IntegrationEventEnvelope {
  return createIntegrationEvent({
    eventId,
    idempotencyKey: `idempotency-${eventId}`,
    eventType: 'OrderPlaced',
    eventVersion: 1,
    occurredAt: '2026-08-02T13:00:00.000Z',
    producer: 'Ordering',
    aggregateType: 'Order',
    aggregateId: USER_ID,
    aggregateVersion: 1,
    correlationId: `correlation-${eventId}`,
    causationId: null,
    payload: {
      orderId: USER_ID,
      storeId: '00000000-0000-4000-8000-000000000903',
      customerId: USER_ID,
      orderAmount: 450,
      currency: 'USD',
      lines: [{ productId: OTHER_USER_ID, quantity: 1 }],
    },
  });
}

async function migrateDatabase(db: DrizzleDB): Promise<void> {
  await migrate(db, { migrationsFolder: resolveMigrationsFolder() });
}

function delivery(event: IntegrationEventEnvelope): IntegrationEventDelivery {
  return {
    envelope: event,
    routingKey: event.eventType,
    attempt: 1,
    redelivered: false,
  };
}

describe('Outbox, Inbox, and RabbitMQ transport seams', () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = createMemoryDatabase();
    await migrateDatabase(database.db);
  });

  afterEach(async () => {
    await database.pool.end();
  });

  it('keeps the aggregate and immutable versioned Outbox envelope atomic', async () => {
    const outbox = new OutboxService(database.db);
    const event = testEvent('atomic-event');

    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.payload)).toBe(true);

    await expect(
      outbox.transaction(async (tx) => {
        await tx.insert(users).values({
          id: USER_ID,
          name: 'Atomic User',
          email: 'atomic@example.com',
        });
        await outbox.enqueue(tx, event);
        throw new Error('rollback aggregate and event');
      }),
    ).rejects.toThrow('rollback aggregate and event');

    expect(await database.db.select().from(users)).toHaveLength(0);
    expect(await database.db.select().from(outboxEvents)).toHaveLength(0);

    await outbox.transaction(async (tx) => {
      await tx.insert(users).values({
        id: USER_ID,
        name: 'Atomic User',
        email: 'atomic@example.com',
      });
      await outbox.enqueue(tx, event);
    });

    const [stored] = await database.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventId, event.eventId));
    expect(stored).toMatchObject({
      eventId: event.eventId,
      idempotencyKey: event.idempotencyKey,
      eventType: event.eventType,
      eventVersion: event.eventVersion,
      producer: event.producer,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      aggregateVersion: event.aggregateVersion,
      correlationId: event.correlationId,
      causationId: event.causationId,
      payload: event.payload,
      status: 'PENDING',
      attempts: 0,
    });
    expect(stored.occurredAt.toISOString()).toBe(event.occurredAt);
  });

  it('uses the durable topic exchange and context queue topology', () => {
    const topology = integrationEventTopology('Payment', ['OrderPlaced']);

    expect(topology).toEqual({
      context: 'payment',
      exchange: 'integration.events',
      queue: 'payment.integration.events',
      retryQueues: [
        'payment.integration.events.retry.1',
        'payment.integration.events.retry.2',
      ],
      deadLetterQueue: 'payment.integration.events.dlq',
      eventTypes: ['OrderPlaced'],
    });
  });

  it('publishes an Outbox event and records broker failures with bounded attempts', async () => {
    const outbox = new OutboxService(database.db);
    const transport = new InMemoryIntegrationEventTransport();
    const dispatcher = new OutboxDispatcher(outbox, transport);
    const event = testEvent('dispatch-event');

    await outbox.transaction((tx) => outbox.enqueue(tx, event));
    const published = await dispatcher.dispatch();

    expect(published).toEqual({
      attempted: 1,
      published: 1,
      failed: 0,
      deadLettered: 0,
    });
    expect(transport.published).toHaveLength(1);
    expect(transport.published[0]).toEqual(event);

    const [publishedRow] = await database.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventId, event.eventId));
    expect(publishedRow.status).toBe('PUBLISHED');
    expect(publishedRow.attempts).toBe(1);

    const failedEvent = testEvent('dispatch-failure-event');
    await outbox.transaction((tx) => outbox.enqueue(tx, failedEvent));
    transport.setPublishFailure(() => new Error('broker unavailable'));
    const policy = {
      maxAttempts: 2,
      baseDelayMs: 0,
      maxDelayMs: 0,
    };

    expect(await dispatcher.dispatch(100, policy)).toMatchObject({
      attempted: 1,
      failed: 1,
      deadLettered: 0,
    });
    expect(await dispatcher.dispatch(100, policy)).toMatchObject({
      attempted: 1,
      failed: 1,
      deadLettered: 1,
    });

    const [failedRow] = await database.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventId, failedEvent.eventId));
    expect(failedRow).toMatchObject({
      status: 'DEAD_LETTERED',
      attempts: 2,
      lastError: 'Error: broker unavailable',
    });
    const deadLetters = await database.db
      .select()
      .from(deadLetterEvents)
      .where(
        and(
          eq(deadLetterEvents.source, 'OUTBOX'),
          eq(deadLetterEvents.eventId, failedEvent.eventId),
        ),
      );
    expect(deadLetters).toHaveLength(1);
  });

  it('commits Inbox state effects once and acknowledges only after commit', async () => {
    const transport = new ObservingTransport(database.db);
    const inbox = new InboxService(database.db, transport);
    const event = testEvent('inbox-success-event');
    let effectCalls = 0;
    const effect: InboxEffect = async (_event, tx) => {
      effectCalls += 1;
      await tx.insert(users).values({
        id: OTHER_USER_ID,
        name: 'Inbox Effect',
        email: 'inbox-effect@example.com',
      });
    };

    const first = await inbox.processDelivery(
      delivery(event),
      'Payment',
      effect,
    );
    const duplicate = await inbox.processDelivery(
      delivery(event),
      'Payment',
      effect,
    );

    expect(first.status).toBe('PROCESSED');
    expect(duplicate.status).toBe('DUPLICATE');
    expect(effectCalls).toBe(1);
    expect(transport.observedInboxStatus).toBe('PROCESSED');
    expect(transport.acknowledged).toHaveLength(2);
    expect(
      await database.db.select().from(users).where(eq(users.id, OTHER_USER_ID)),
    ).toHaveLength(1);
  });

  it('rolls back a failed state effect, retries with backoff, and dead-letters poison events', async () => {
    const transport = new InMemoryIntegrationEventTransport();
    const inbox = new InboxService(database.db, transport);
    const event = testEvent('inbox-poison-event');
    let effectCalls = 0;
    const effect: InboxEffect = async (_event, tx) => {
      effectCalls += 1;
      await tx.insert(users).values({
        id: OTHER_USER_ID,
        name: 'Rolled Back Effect',
        email: 'rolled-back@example.com',
      });
      throw new Error('poison effect');
    };
    const policy = {
      ...DEFAULT_RETRY_POLICY,
      maxAttempts: 3,
      baseDelayMs: 10,
      maxDelayMs: 20,
    };

    const first = await inbox.processDelivery(
      delivery(event),
      'Payment',
      effect,
      policy,
    );
    const second = await inbox.processDelivery(
      delivery(event),
      'Payment',
      effect,
      policy,
    );
    const third = await inbox.processDelivery(
      delivery(event),
      'Payment',
      effect,
      policy,
    );

    expect(first).toMatchObject({ status: 'RETRY', attempts: 1 });
    expect(second).toMatchObject({ status: 'RETRY', attempts: 2 });
    expect(third).toMatchObject({
      status: 'DEAD_LETTERED',
      attempts: 3,
      delayMs: null,
    });
    expect(transport.retries.map((retry) => retry.delayMs)).toEqual([10, 20]);
    expect(transport.deadLetters).toHaveLength(1);
    expect(effectCalls).toBe(3);
    expect(
      await database.db.select().from(users).where(eq(users.id, OTHER_USER_ID)),
    ).toHaveLength(0);

    const [inboxRow] = await database.db
      .select()
      .from(inboxEvents)
      .where(
        and(
          eq(inboxEvents.consumerName, 'payment'),
          eq(inboxEvents.eventId, event.eventId),
        ),
      );
    expect(inboxRow).toMatchObject({
      status: 'DEAD_LETTERED',
      attempts: 3,
      lastError: 'Error: poison effect',
    });
  });

  it('does not repeat effects across the crash window before acknowledgement', async () => {
    const transport = new InMemoryIntegrationEventTransport();
    const inbox = new InboxService(database.db, transport);
    const event = testEvent('inbox-ack-crash-event');
    let effectCalls = 0;
    const effect: InboxEffect = async (_event, tx) => {
      effectCalls += 1;
      await tx.insert(users).values({
        id: OTHER_USER_ID,
        name: 'Ack Crash Effect',
        email: 'ack-crash@example.com',
      });
    };

    transport.setAcknowledgeFailure(new Error('process crashed before ack'));
    await expect(
      inbox.processDelivery(delivery(event), 'Payment', effect),
    ).rejects.toThrow('process crashed before ack');

    transport.setAcknowledgeFailure(undefined);
    const redelivery = await inbox.processDelivery(
      delivery(event),
      'Payment',
      effect,
    );

    expect(redelivery.status).toBe('DUPLICATE');
    expect(effectCalls).toBe(1);
    expect(transport.acknowledged).toHaveLength(1);
  });
});

class ObservingTransport extends InMemoryIntegrationEventTransport {
  observedInboxStatus: string | undefined;

  constructor(private readonly db: DrizzleDB) {
    super();
  }

  override async acknowledge(
    delivery: IntegrationEventDelivery,
  ): Promise<void> {
    const [row] = await this.db
      .select({ status: inboxEvents.status })
      .from(inboxEvents)
      .where(eq(inboxEvents.eventId, delivery.envelope.eventId))
      .limit(1);
    this.observedInboxStatus = row?.status;
    await super.acknowledge(delivery);
  }
}

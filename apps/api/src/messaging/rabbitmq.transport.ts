import { once } from 'node:events';
import amqp, { Channel, ChannelModel, ConsumeMessage } from 'amqplib';
import {
  eventFromJson,
  eventToJson,
  IntegrationEventEnvelope,
} from './integration-event';
import {
  DEFAULT_RETRY_POLICY,
  INTEGRATION_EVENTS_EXCHANGE,
  IntegrationEventTopology,
  RetryPolicy,
  retryDelayMs,
} from './messaging.constants';
import {
  IntegrationEventConsumerOptions,
  IntegrationEventDelivery,
  IntegrationEventSubscription,
  IntegrationEventTransport,
} from './messaging.transport';
import {
  runWithCorrelationContext,
  withCorrelationContext,
} from '../observability/correlation-context';
import { MetricsService } from '../observability/metrics.service';

export type RabbitMqTransportOptions = Readonly<{
  url: string;
  retryPolicy?: RetryPolicy;
}>;

type RabbitDelivery = Readonly<{
  message: ConsumeMessage;
  topology: IntegrationEventTopology;
}>;

function rabbitDelivery(delivery: IntegrationEventDelivery): RabbitDelivery {
  if (
    typeof delivery.raw !== 'object' ||
    delivery.raw === null ||
    !('message' in delivery.raw) ||
    !('topology' in delivery.raw)
  ) {
    throw new TypeError('Delivery did not originate from RabbitMQ');
  }
  return delivery.raw as RabbitDelivery;
}

export class RabbitMqIntegrationEventTransport
  implements IntegrationEventTransport
{
  private connection: ChannelModel | undefined;
  private channel: Channel | undefined;
  private readonly retryPolicy: RetryPolicy;

  constructor(
    private readonly options: RabbitMqTransportOptions,
    private readonly metrics?: MetricsService,
  ) {
    if (!options.url.trim()) {
      throw new TypeError('RabbitMQ URL is required');
    }
    this.retryPolicy = options.retryPolicy ?? DEFAULT_RETRY_POLICY;
  }

  async connect(): Promise<void> {
    if (this.channel) {
      return;
    }
    try {
      this.connection = await amqp.connect(this.options.url);
      this.channel = await this.connection.createChannel();
    } catch (error) {
      this.metrics?.recordRabbitFailure('connect');
      throw error;
    }
  }

  async ensureTopology(topology: IntegrationEventTopology): Promise<void> {
    const channel = await this.requireChannel();
    await channel.assertExchange(topology.exchange, 'topic', {
      durable: true,
    });
    const queueInfo = await channel.assertQueue(topology.queue, {
      durable: true,
    });
    this.metrics?.setRabbitBacklog(
      topology.queue,
      queueInfo.messageCount,
      'rabbitmq',
    );
    const deadLetterQueueInfo = await channel.assertQueue(
      topology.deadLetterQueue,
      {
        durable: true,
      },
    );
    this.metrics?.setRabbitBacklog(
      topology.deadLetterQueue,
      deadLetterQueueInfo.messageCount,
      'rabbitmq',
    );
    for (const eventType of topology.eventTypes) {
      await channel.bindQueue(topology.queue, topology.exchange, eventType);
    }

    for (const [index, queue] of topology.retryQueues.entries()) {
      const retryQueueInfo = await channel.assertQueue(queue, {
        durable: true,
        arguments: {
          'x-message-ttl': Math.max(
            1,
            retryDelayMs(index + 1, this.retryPolicy),
          ),
          'x-dead-letter-exchange': topology.exchange,
        },
      });
      this.metrics?.setRabbitBacklog(
        queue,
        retryQueueInfo.messageCount,
        'rabbitmq',
      );
    }
  }

  async publish(event: IntegrationEventEnvelope): Promise<void> {
    try {
      const channel = await this.requireChannel();
      await channel.assertExchange(INTEGRATION_EVENTS_EXCHANGE, 'topic', {
        durable: true,
      });
      await this.publishBuffer(
        channel,
        channel.publish(
          INTEGRATION_EVENTS_EXCHANGE,
          event.eventType,
          Buffer.from(eventToJson(event)),
          {
            persistent: true,
            contentType: 'application/json',
            messageId: event.eventId,
            type: event.eventType,
            headers: {
              'x-event-version': event.eventVersion,
              'x-idempotency-key': event.idempotencyKey,
              'x-correlation-id': event.correlationId,
              ...(event.causationId
                ? { 'x-causation-id': event.causationId }
                : {}),
            },
          },
        ),
      );
      this.metrics?.recordRabbitPublish('success');
    } catch (error) {
      this.metrics?.recordRabbitPublish('failure');
      this.metrics?.recordRabbitFailure('publish');
      throw error;
    }
  }

  async consume(
    options: IntegrationEventConsumerOptions,
  ): Promise<IntegrationEventSubscription> {
    const channel = await this.requireChannel();
    await this.ensureTopology(options.topology);
    await channel.prefetch(1);
    const result = await channel.consume(options.topology.queue, (message) => {
      if (!message) {
        return;
      }
      void this.handleMessage(message, options)
        .catch(() => {
          this.metrics?.recordRabbitConsumer('failure');
          // Leave the message unacknowledged so RabbitMQ can redeliver it.
        })
        .finally(() => {
          void this.refreshBacklog(channel, options.topology.queue);
        });
    });

    return {
      close: async () => {
        await channel.cancel(result.consumerTag);
      },
    };
  }

  async acknowledge(delivery: IntegrationEventDelivery): Promise<void> {
    try {
      const { message } = rabbitDelivery(delivery);
      const channel = await this.requireChannel();
      channel.ack(message);
    } catch (error) {
      this.metrics?.recordRabbitFailure('acknowledge');
      throw error;
    }
  }

  async retry(
    delivery: IntegrationEventDelivery,
    _delayMs: number,
    attempt: number,
  ): Promise<void> {
    try {
      const { message, topology } = rabbitDelivery(delivery);
      const channel = await this.requireChannel();
      const retryQueue =
        topology.retryQueues[
          Math.min(Math.max(attempt - 1, 0), topology.retryQueues.length - 1)
        ];
      await this.publishBuffer(
        channel,
        channel.sendToQueue(retryQueue, message.content, {
          persistent: true,
          contentType: message.properties.contentType ?? 'application/json',
          type: message.properties.type,
          messageId: message.properties.messageId,
          headers: {
            ...message.properties.headers,
            'x-retry-attempt': attempt + 1,
          },
        }),
      );
      this.metrics?.recordRabbitRetry();
      await this.refreshBacklog(channel, retryQueue);
    } catch (error) {
      this.metrics?.recordRabbitFailure('retry');
      throw error;
    }
  }

  async deadLetter(
    delivery: IntegrationEventDelivery,
    reason: string,
  ): Promise<void> {
    try {
      const { message, topology } = rabbitDelivery(delivery);
      const channel = await this.requireChannel();
      await this.publishBuffer(
        channel,
        channel.sendToQueue(topology.deadLetterQueue, message.content, {
          persistent: true,
          contentType: message.properties.contentType ?? 'application/json',
          type: message.properties.type,
          messageId: message.properties.messageId,
          headers: {
            ...message.properties.headers,
            'x-dead-letter-reason': reason,
          },
        }),
      );
      this.metrics?.recordRabbitDeadLetter();
      await this.refreshBacklog(channel, topology.deadLetterQueue);
    } catch (error) {
      this.metrics?.recordRabbitFailure('dead_letter');
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.channel?.close();
    this.channel = undefined;
    await this.connection?.close();
    this.connection = undefined;
  }

  private async handleMessage(
    message: ConsumeMessage,
    options: IntegrationEventConsumerOptions,
  ): Promise<void> {
    let event: IntegrationEventEnvelope;
    try {
      event = eventFromJson(message.content.toString('utf8'));
    } catch {
      const channel = await this.requireChannel();
      await this.publishBuffer(
        channel,
        channel.sendToQueue(options.topology.deadLetterQueue, message.content, {
          persistent: true,
          headers: {
            'x-dead-letter-reason': 'Invalid integration event envelope',
          },
        }),
      );
      this.metrics?.recordRabbitDeadLetter();
      await this.refreshBacklog(channel, options.topology.deadLetterQueue);
      channel.ack(message);
      this.metrics?.recordRabbitConsumer('failure');
      return;
    }

    const rawAttempt = message.properties.headers?.['x-retry-attempt'];
    const attempt =
      typeof rawAttempt === 'number' && Number.isSafeInteger(rawAttempt)
        ? rawAttempt
        : 1;
    const delivery: IntegrationEventDelivery = Object.freeze({
      envelope: event,
      routingKey: event.eventType,
      attempt,
      redelivered: message.fields.redelivered,
      raw: Object.freeze({ message, topology: options.topology }),
    });
    await runWithCorrelationContext(
      withCorrelationContext(event.correlationId, event.causationId),
      () => options.handler(delivery),
    );
    this.metrics?.recordRabbitConsumer('success');
  }

  private async refreshBacklog(channel: Channel, queue: string): Promise<void> {
    if (!this.metrics) {
      return;
    }
    try {
      const queueInfo = await channel.checkQueue(queue);
      this.metrics.setRabbitBacklog(queue, queueInfo.messageCount, 'rabbitmq');
    } catch {
      this.metrics.recordRabbitFailure('backlog');
    }
  }

  private async requireChannel(): Promise<Channel> {
    if (!this.channel) {
      await this.connect();
    }
    if (!this.channel) {
      throw new Error('RabbitMQ channel is unavailable');
    }
    return this.channel;
  }

  private async publishBuffer(
    channel: Channel,
    accepted: boolean,
  ): Promise<void> {
    if (!accepted) {
      await once(channel, 'drain');
    }
  }
}

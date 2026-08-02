import { IntegrationEventEnvelope } from './integration-event';
import {
  IntegrationEventConsumerOptions,
  IntegrationEventDelivery,
  IntegrationEventSubscription,
  IntegrationEventTransport,
} from './messaging.transport';
import { IntegrationEventTopology } from './messaging.constants';
import {
  runWithCorrelationContext,
  withCorrelationContext,
} from '../observability/correlation-context';
import { MetricsService } from '../observability/metrics.service';

export type InMemoryTransportOptions = Readonly<{
  publishFailure?: unknown | (() => unknown);
  acknowledgeFailure?: unknown | (() => unknown);
}>;

export type InMemoryDeadLetter = Readonly<{
  delivery: IntegrationEventDelivery;
  reason: string;
}>;

type InMemorySubscription = {
  options: IntegrationEventConsumerOptions;
  active: boolean;
};

function failureValue(value: unknown | (() => unknown) | undefined): unknown {
  return typeof value === 'function' ? (value as () => unknown)() : value;
}

function matches(
  topology: IntegrationEventTopology,
  event: IntegrationEventEnvelope,
): boolean {
  return (
    topology.eventTypes.length === 0 ||
    topology.eventTypes.includes(event.eventType)
  );
}

export class InMemoryIntegrationEventTransport
  implements IntegrationEventTransport
{
  readonly published: IntegrationEventEnvelope[] = [];
  readonly acknowledged: IntegrationEventDelivery[] = [];
  readonly retries: Array<{
    delivery: IntegrationEventDelivery;
    delayMs: number;
    attempt: number;
  }> = [];
  readonly deadLetters: InMemoryDeadLetter[] = [];

  private readonly subscriptions = new Set<InMemorySubscription>();
  private readonly deliverySubscriptions = new WeakMap<
    IntegrationEventDelivery,
    InMemorySubscription
  >();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private publishFailure: unknown | (() => unknown);
  private acknowledgeFailure: unknown | (() => unknown);
  private inFlightDeliveries = 0;
  private pendingRetries = 0;

  constructor(
    options: InMemoryTransportOptions = {},
    private readonly metrics?: MetricsService,
  ) {
    this.publishFailure = options.publishFailure;
    this.acknowledgeFailure = options.acknowledgeFailure;
  }

  setPublishFailure(value: unknown | (() => unknown) | undefined): void {
    this.publishFailure = value;
  }

  setAcknowledgeFailure(value: unknown | (() => unknown) | undefined): void {
    this.acknowledgeFailure = value;
  }

  async publish(event: IntegrationEventEnvelope): Promise<void> {
    const failure = failureValue(this.publishFailure);
    if (failure !== undefined) {
      this.metrics?.recordRabbitPublish('failure', 'in-memory');
      this.metrics?.recordRabbitFailure('publish', 'in-memory');
      throw failure instanceof Error ? failure : new Error(String(failure));
    }

    this.published.push(event);
    this.metrics?.recordRabbitPublish('success', 'in-memory');
    const deliveries: Promise<void>[] = [];
    for (const subscription of this.subscriptions) {
      if (
        subscription.active &&
        matches(subscription.options.topology, event)
      ) {
        deliveries.push(this.deliver(subscription, event, 1, false));
      }
    }
    await Promise.all(deliveries);
  }

  async consume(
    options: IntegrationEventConsumerOptions,
  ): Promise<IntegrationEventSubscription> {
    const subscription: InMemorySubscription = {
      options,
      active: true,
    };
    this.subscriptions.add(subscription);
    return {
      close: async () => {
        subscription.active = false;
        this.subscriptions.delete(subscription);
      },
    };
  }

  async acknowledge(delivery: IntegrationEventDelivery): Promise<void> {
    const failure = failureValue(this.acknowledgeFailure);
    if (failure !== undefined) {
      this.metrics?.recordRabbitFailure('acknowledge', 'in-memory');
      throw failure instanceof Error ? failure : new Error(String(failure));
    }
    this.acknowledged.push(delivery);
  }

  async retry(
    delivery: IntegrationEventDelivery,
    delayMs: number,
    attempt: number,
  ): Promise<void> {
    this.retries.push({ delivery, delayMs, attempt });
    this.metrics?.recordRabbitRetry('in-memory');
    const subscription = this.deliverySubscriptions.get(delivery);
    if (!subscription?.active) {
      return;
    }

    this.pendingRetries += 1;
    this.updateBacklog();
    const timer = setTimeout(
      () => {
        this.timers.delete(timer);
        this.pendingRetries = Math.max(0, this.pendingRetries - 1);
        this.updateBacklog();
        if (subscription.active) {
          void this.deliver(subscription, delivery.envelope, attempt + 1, true);
        }
      },
      Math.max(0, delayMs),
    );
    this.timers.add(timer);
  }

  async deadLetter(
    delivery: IntegrationEventDelivery,
    reason: string,
  ): Promise<void> {
    this.deadLetters.push({ delivery, reason });
    this.metrics?.recordRabbitDeadLetter('in-memory');
  }

  async close(): Promise<void> {
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.subscriptions.clear();
    this.pendingRetries = 0;
    this.inFlightDeliveries = 0;
    this.updateBacklog();
  }

  private async deliver(
    subscription: InMemorySubscription,
    event: IntegrationEventEnvelope,
    attempt: number,
    redelivered: boolean,
  ): Promise<void> {
    const delivery: IntegrationEventDelivery = Object.freeze({
      envelope: event,
      routingKey: event.eventType,
      attempt,
      redelivered,
    });
    this.deliverySubscriptions.set(delivery, subscription);
    this.inFlightDeliveries += 1;
    this.updateBacklog();
    try {
      let succeeded = true;
      try {
        await runWithCorrelationContext(
          withCorrelationContext(event.correlationId, event.causationId),
          () => subscription.options.handler(delivery),
        );
      } catch {
        succeeded = false;
        // A failed handler intentionally leaves the delivery unacknowledged.
      }
      this.metrics?.recordRabbitConsumer(
        succeeded ? 'success' : 'failure',
        'in-memory',
      );
    } finally {
      this.inFlightDeliveries = Math.max(0, this.inFlightDeliveries - 1);
      this.updateBacklog();
    }
  }

  private updateBacklog(): void {
    this.metrics?.setRabbitBacklog(
      'in-memory',
      this.inFlightDeliveries + this.pendingRetries,
      'in-memory',
    );
  }
}

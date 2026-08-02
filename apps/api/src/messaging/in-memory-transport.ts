import { IntegrationEventEnvelope } from './integration-event';
import {
  IntegrationEventConsumerOptions,
  IntegrationEventDelivery,
  IntegrationEventSubscription,
  IntegrationEventTransport,
} from './messaging.transport';
import { IntegrationEventTopology } from './messaging.constants';

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

  constructor(options: InMemoryTransportOptions = {}) {
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
      throw failure instanceof Error ? failure : new Error(String(failure));
    }

    this.published.push(event);
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
    const subscription = this.deliverySubscriptions.get(delivery);
    if (!subscription?.active) {
      return;
    }

    const timer = setTimeout(
      () => {
        this.timers.delete(timer);
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
  }

  async close(): Promise<void> {
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.subscriptions.clear();
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
    await subscription.options.handler(delivery).catch(() => {
      // A failed handler intentionally leaves the delivery unacknowledged.
    });
  }
}

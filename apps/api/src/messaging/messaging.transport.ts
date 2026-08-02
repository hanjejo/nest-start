import { IntegrationEventEnvelope } from './integration-event';
import { IntegrationEventTopology } from './messaging.constants';

export type IntegrationEventDelivery = Readonly<{
  envelope: IntegrationEventEnvelope;
  routingKey: string;
  attempt: number;
  redelivered: boolean;
  raw?: unknown;
}>;

export type IntegrationEventDeliveryHandler = (
  delivery: IntegrationEventDelivery,
) => Promise<void>;

export type IntegrationEventConsumerOptions = Readonly<{
  topology: IntegrationEventTopology;
  handler: IntegrationEventDeliveryHandler;
}>;

export interface IntegrationEventSubscription {
  close(): Promise<void>;
}

export interface IntegrationEventTransport {
  publish(event: IntegrationEventEnvelope): Promise<void>;
  consume(
    options: IntegrationEventConsumerOptions,
  ): Promise<IntegrationEventSubscription>;
  acknowledge(delivery: IntegrationEventDelivery): Promise<void>;
  retry(
    delivery: IntegrationEventDelivery,
    delayMs: number,
    attempt: number,
  ): Promise<void>;
  deadLetter(delivery: IntegrationEventDelivery, reason: string): Promise<void>;
  close(): Promise<void>;
}

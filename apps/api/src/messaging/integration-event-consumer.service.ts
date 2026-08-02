import { Inject, Injectable } from '@nestjs/common';
import { InboxEffect, InboxService } from './inbox.service';
import {
  DEFAULT_RETRY_POLICY,
  INTEGRATION_EVENT_TRANSPORT,
  IntegrationEventTopology,
  RetryPolicy,
} from './messaging.constants';
import {
  IntegrationEventSubscription,
  IntegrationEventTransport,
} from './messaging.transport';

export type IntegrationEventConsumerRegistration = Readonly<{
  consumerName: string;
  topology: IntegrationEventTopology;
  effect: InboxEffect;
  retryPolicy?: RetryPolicy;
}>;

@Injectable()
export class IntegrationEventConsumerService {
  constructor(
    private readonly inboxService: InboxService,
    @Inject(INTEGRATION_EVENT_TRANSPORT)
    private readonly transport: IntegrationEventTransport,
  ) {}

  start(
    registration: IntegrationEventConsumerRegistration,
  ): Promise<IntegrationEventSubscription> {
    return this.transport.consume({
      topology: registration.topology,
      handler: (delivery) =>
        this.inboxService
          .processDelivery(
            delivery,
            registration.consumerName,
            registration.effect,
            registration.retryPolicy ?? DEFAULT_RETRY_POLICY,
          )
          .then(() => undefined),
    });
  }
}

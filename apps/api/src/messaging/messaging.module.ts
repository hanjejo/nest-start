import { Global, Module } from '@nestjs/common';
import { InMemoryIntegrationEventTransport } from './in-memory-transport';
import { INTEGRATION_EVENT_TRANSPORT } from './messaging.constants';
import { IntegrationEventTransport } from './messaging.transport';
import { InboxService } from './inbox.service';
import { OutboxDispatcher } from './outbox-dispatcher.service';
import { OutboxService } from './outbox.service';
import { RabbitMqIntegrationEventTransport } from './rabbitmq.transport';
import { IntegrationEventConsumerService } from './integration-event-consumer.service';

function createTransport(): IntegrationEventTransport {
  const url = process.env.RABBITMQ_URL?.trim();
  if (!url) {
    return new InMemoryIntegrationEventTransport();
  }
  return new RabbitMqIntegrationEventTransport({ url });
}

@Global()
@Module({
  providers: [
    {
      provide: INTEGRATION_EVENT_TRANSPORT,
      useFactory: createTransport,
    },
    OutboxService,
    OutboxDispatcher,
    InboxService,
    IntegrationEventConsumerService,
  ],
  exports: [
    INTEGRATION_EVENT_TRANSPORT,
    OutboxService,
    OutboxDispatcher,
    InboxService,
    IntegrationEventConsumerService,
  ],
})
export class MessagingModule {}

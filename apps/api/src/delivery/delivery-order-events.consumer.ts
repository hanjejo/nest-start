import {
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { IntegrationEventConsumerService } from '../messaging/integration-event-consumer.service';
import { integrationEventTopology } from '../messaging/messaging.constants';
import { IntegrationEventSubscription } from '../messaging/messaging.transport';
import { DeliveryService } from './delivery.service';

@Injectable()
export class DeliveryOrderEventsConsumer
  implements OnModuleInit, OnApplicationShutdown
{
  private subscription: IntegrationEventSubscription | undefined;

  constructor(
    private readonly consumerService: IntegrationEventConsumerService,
    private readonly deliveryService: DeliveryService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.subscription = await this.consumerService.start({
      consumerName: 'delivery.order',
      topology: integrationEventTopology('Delivery', [
        'OrderConfirmed',
        'OrderPreparationStarted',
        'OrderReadyForDelivery',
      ]),
      effect: async (event, tx) => {
        if (event.eventType === 'OrderConfirmed') {
          await this.deliveryService.handleOrderConfirmed(event, tx);
          return;
        }
        if (event.eventType === 'OrderPreparationStarted') {
          await this.deliveryService.handleOrderPreparationStarted();
          return;
        }
        return this.deliveryService.handleOrderReady(event, tx);
      },
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.subscription?.close();
  }
}

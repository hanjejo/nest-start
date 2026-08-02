import {
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { IntegrationEventConsumerService } from '../messaging/integration-event-consumer.service';
import { integrationEventTopology } from '../messaging/messaging.constants';
import { IntegrationEventSubscription } from '../messaging/messaging.transport';
import { OrderingService } from './ordering.service';

@Injectable()
export class PaymentEventsConsumer
  implements OnModuleInit, OnApplicationShutdown
{
  private subscription: IntegrationEventSubscription | undefined;

  constructor(
    private readonly consumerService: IntegrationEventConsumerService,
    private readonly orderingService: OrderingService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.subscription = await this.consumerService.start({
      consumerName: 'ordering.payment',
      topology: integrationEventTopology('Ordering', [
        'PaymentSucceeded',
        'PaymentFailed',
        'PaymentExpired',
      ]),
      effect: (event, tx) => this.orderingService.applyPaymentEvent(event, tx),
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.subscription?.close();
  }
}

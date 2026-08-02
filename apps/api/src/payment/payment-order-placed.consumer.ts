import {
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { IntegrationEventConsumerService } from '../messaging/integration-event-consumer.service';
import { integrationEventTopology } from '../messaging/messaging.constants';
import { IntegrationEventSubscription } from '../messaging/messaging.transport';
import { PaymentService } from './payment.service';

@Injectable()
export class PaymentOrderPlacedConsumer
  implements OnModuleInit, OnApplicationShutdown
{
  private subscription: IntegrationEventSubscription | undefined;

  constructor(
    private readonly consumerService: IntegrationEventConsumerService,
    private readonly paymentService: PaymentService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.subscription = await this.consumerService.start({
      consumerName: 'payment.order-placed',
      topology: integrationEventTopology('Payment', ['OrderPlaced']),
      effect: (event, tx) => this.paymentService.handleOrderPlaced(event, tx),
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.subscription?.close();
  }
}

import {
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { IntegrationEventConsumerService } from '../messaging/integration-event-consumer.service';
import { integrationEventTopology } from '../messaging/messaging.constants';
import { IntegrationEventSubscription } from '../messaging/messaging.transport';
import { SettlementService } from './settlement.service';

@Injectable()
export class SettlementEventsConsumer
  implements OnModuleInit, OnApplicationShutdown
{
  private subscription: IntegrationEventSubscription | undefined;

  constructor(
    private readonly consumerService: IntegrationEventConsumerService,
    private readonly settlementService: SettlementService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.subscription = await this.consumerService.start({
      consumerName: 'settlement.integration',
      topology: integrationEventTopology('Settlement', [
        'PaymentSucceeded',
        'OrderCompleted',
        'PaymentRefunded',
        'OrderCancelled',
      ]),
      effect: (event, tx) =>
        this.settlementService.handleIntegrationEvent(event, tx),
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.subscription?.close();
  }
}

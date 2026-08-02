import { Module } from '@nestjs/common';
import { AuthModule } from '../identity-and-access/auth.module';
import { MessagingModule } from '../messaging/messaging.module';
import { RbacModule } from '../rbac/rbac.module';
import { DeliveryController } from './delivery.controller';
import { DELIVERY_PROVIDER } from './delivery-provider';
import { DeliveryOrderEventsConsumer } from './delivery-order-events.consumer';
import { DeliveryRepository } from './delivery.repository';
import { DeliveryService } from './delivery.service';
import { DeliveryWorkflowEngine } from './delivery-workflow.engine';
import { DeliveryWorkflowRuntimeService } from './delivery-workflow-runtime';
import { FakeDeliveryProvider } from './fake-delivery-provider';

@Module({
  imports: [AuthModule, MessagingModule, RbacModule],
  controllers: [DeliveryController],
  providers: [
    FakeDeliveryProvider,
    {
      provide: DELIVERY_PROVIDER,
      useExisting: FakeDeliveryProvider,
    },
    DeliveryRepository,
    DeliveryWorkflowEngine,
    DeliveryWorkflowRuntimeService,
    DeliveryService,
    DeliveryOrderEventsConsumer,
  ],
  exports: [
    FakeDeliveryProvider,
    DELIVERY_PROVIDER,
    DeliveryRepository,
    DeliveryWorkflowEngine,
    DeliveryWorkflowRuntimeService,
    DeliveryService,
  ],
})
export class DeliveryModule {}

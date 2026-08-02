import { Module } from '@nestjs/common';
import { AuthModule } from '../identity-and-access/auth.module';
import { AccessTokenGuard } from '../rbac/access-token.guard';
import { PermissionGuard } from '../rbac/permission.guard';
import { RbacModule } from '../rbac/rbac.module';
import { MessagingModule } from '../messaging/messaging.module';
import { OrderingController } from './ordering.controller';
import { DeliveryEventsConsumer } from './delivery-events.consumer';
import { OrderingService } from './ordering.service';
import { PaymentEventsConsumer } from './payment-events.consumer';

@Module({
  imports: [AuthModule, RbacModule, MessagingModule],
  controllers: [OrderingController],
  providers: [
    OrderingService,
    AccessTokenGuard,
    PermissionGuard,
    PaymentEventsConsumer,
    DeliveryEventsConsumer,
  ],
  exports: [OrderingService],
})
export class OrderingModule {}

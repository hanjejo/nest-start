import { Module } from '@nestjs/common';
import { AuthModule } from '../identity-and-access/auth.module';
import { MessagingModule } from '../messaging/messaging.module';
import { RbacModule } from '../rbac/rbac.module';
import { FakePaymentProvider } from './fake-payment-provider';
import { PaymentController } from './payment.controller';
import { PAYMENT_PROVIDER } from './payment-provider';
import { PaymentOrderPlacedConsumer } from './payment-order-placed.consumer';
import { PaymentRepository } from './payment.repository';
import { PaymentService } from './payment.service';
import { PaymentWorkflowEngine } from './payment-workflow.engine';
import { PaymentWorkflowRuntimeService } from './payment-workflow-runtime';

@Module({
  imports: [AuthModule, MessagingModule, RbacModule],
  controllers: [PaymentController],
  providers: [
    FakePaymentProvider,
    {
      provide: PAYMENT_PROVIDER,
      useExisting: FakePaymentProvider,
    },
    PaymentRepository,
    PaymentWorkflowEngine,
    PaymentWorkflowRuntimeService,
    PaymentService,
    PaymentOrderPlacedConsumer,
  ],
  exports: [
    FakePaymentProvider,
    PAYMENT_PROVIDER,
    PaymentRepository,
    PaymentWorkflowEngine,
    PaymentWorkflowRuntimeService,
    PaymentService,
  ],
})
export class PaymentModule {}

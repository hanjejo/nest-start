import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DrizzleModule } from '../db/drizzle.module';
import { HealthModule } from '../health/health.module';
import { AuthModule } from '../identity-and-access/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { CatalogModule } from '../catalog/catalog.module';
import { OrderingModule } from '../ordering/ordering.module';
import { StoreManagementModule } from '../store-management/store-management.module';
import { UserModule } from '../user/user.module';
import { MessagingModule } from '../messaging/messaging.module';
import { PaymentModule } from '../payment/payment.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { SettlementModule } from '../settlement/settlement.module';
import { PerformanceModule } from '../performance/performance.module';
import { ObservabilityModule } from '../observability/observability.module';

@Module({
  imports: [
    ObservabilityModule,
    DrizzleModule,
    PerformanceModule,
    HealthModule,
    AuthModule,
    RbacModule,
    StoreManagementModule,
    CatalogModule,
    OrderingModule,
    UserModule,
    MessagingModule,
    PaymentModule,
    DeliveryModule,
    SettlementModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

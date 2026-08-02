import { Module } from '@nestjs/common';
import { AuthModule } from '../identity-and-access/auth.module';
import { MessagingModule } from '../messaging/messaging.module';
import { RbacModule } from '../rbac/rbac.module';
import { SettlementController } from './settlement.controller';
import { SettlementEventsConsumer } from './settlement-events.consumer';
import { SettlementRepository } from './settlement.repository';
import { SettlementService } from './settlement.service';
import { SettlementWorkflowEngine } from './settlement-workflow.engine';
import { SettlementWorkflowRuntimeService } from './settlement-workflow-runtime';

@Module({
  imports: [AuthModule, MessagingModule, RbacModule],
  controllers: [SettlementController],
  providers: [
    SettlementRepository,
    SettlementWorkflowEngine,
    SettlementWorkflowRuntimeService,
    SettlementService,
    SettlementEventsConsumer,
  ],
  exports: [
    SettlementRepository,
    SettlementWorkflowEngine,
    SettlementWorkflowRuntimeService,
    SettlementService,
  ],
})
export class SettlementModule {}

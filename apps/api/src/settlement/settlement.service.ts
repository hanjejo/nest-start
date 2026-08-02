import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IntegrationEventEnvelope } from '../messaging/integration-event';
import { InboxEffectResult } from '../messaging/inbox.service';
import { DrizzleTransaction } from '../messaging/outbox.service';
import { RBAC_PERMISSIONS } from '../rbac/rbac.constants';
import { RbacService } from '../rbac/rbac.service';
import { SettlementWorkflowRuntimeService } from './settlement-workflow-runtime';
import { SettlementRepository, SettlementView } from './settlement.repository';

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function requiredUuid(value: unknown, field: string): string {
  if (!isUuid(value)) {
    throw new NotFoundException(`${field} not found`);
  }
  return value;
}

@Injectable()
export class SettlementService {
  constructor(
    private readonly settlementRepository: SettlementRepository,
    private readonly workflowRuntime: SettlementWorkflowRuntimeService,
    private readonly rbacService: RbacService,
  ) {}

  async handleIntegrationEvent(
    event: IntegrationEventEnvelope,
    tx: DrizzleTransaction,
  ): Promise<InboxEffectResult> {
    const result = await this.settlementRepository.projectEvent(event, tx);
    if (!result.workflowInput) {
      return {};
    }
    return {
      afterCommit: async () => {
        await this.workflowRuntime.start(result.workflowInput);
      },
    };
  }

  async getForUser(
    userId: string,
    settlementIdValue: unknown,
  ): Promise<SettlementView> {
    const settlementId = requiredUuid(settlementIdValue, 'Settlement');
    const view = await this.settlementRepository.getView(settlementId);
    if (!view) {
      throw new NotFoundException('Settlement not found');
    }
    await this.assertCanRead(userId, view.storeId);
    return view;
  }

  async getForOrder(
    userId: string,
    orderIdValue: unknown,
  ): Promise<SettlementView> {
    const orderId = requiredUuid(orderIdValue, 'Order');
    const view = await this.settlementRepository.getViewByOrder(orderId);
    if (!view) {
      throw new NotFoundException('Settlement not found');
    }
    await this.assertCanRead(userId, view.storeId);
    return view;
  }

  async listForStore(
    userId: string,
    storeIdValue: unknown,
  ): Promise<SettlementView[]> {
    const storeId = requiredUuid(storeIdValue, 'Store');
    await this.assertCanRead(userId, storeId);
    return this.settlementRepository.listViewsForStore(storeId);
  }

  private async assertCanRead(userId: string, storeId: string): Promise<void> {
    if (
      !(await this.rbacService.hasPermission(
        userId,
        RBAC_PERMISSIONS.SETTLEMENT_READ_STORE,
        storeId,
      ))
    ) {
      throw new ForbiddenException('Access denied');
    }
  }
}

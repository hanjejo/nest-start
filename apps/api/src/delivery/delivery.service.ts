import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IntegrationEventEnvelope } from '../messaging/integration-event';
import { DrizzleTransaction } from '../messaging/outbox.service';
import { InboxEffectResult } from '../messaging/inbox.service';
import { RBAC_PERMISSIONS } from '../rbac/rbac.constants';
import { RbacService } from '../rbac/rbac.service';
import { DeliveryRepository, DeliveryView } from './delivery.repository';
import { DeliveryWorkflowRuntimeService } from './delivery-workflow-runtime';

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
export class DeliveryService {
  constructor(
    private readonly deliveryRepository: DeliveryRepository,
    private readonly workflowRuntime: DeliveryWorkflowRuntimeService,
    private readonly rbacService: RbacService,
  ) {}

  async handleOrderConfirmed(
    event: IntegrationEventEnvelope,
    tx: DrizzleTransaction,
  ): Promise<void> {
    await this.deliveryRepository.createFromOrderConfirmed(event, tx);
  }

  async handleOrderPreparationStarted(): Promise<void> {
    // Preparation is owned by Ordering. Delivery only needs the ready fact to
    // start its provider workflow.
  }

  async handleOrderReady(
    event: IntegrationEventEnvelope,
    tx: DrizzleTransaction,
  ): Promise<InboxEffectResult> {
    const workflowInput = await this.deliveryRepository.prepareForOrderReady(
      event,
      tx,
    );
    if (!workflowInput) {
      return {};
    }

    return {
      afterCommit: async () => {
        await this.workflowRuntime.start(workflowInput);
      },
    };
  }

  async getForUser(
    userId: string,
    deliveryIdValue: unknown,
  ): Promise<DeliveryView> {
    const deliveryId = requiredUuid(deliveryIdValue, 'Delivery');
    const delivery = await this.deliveryRepository.getDelivery(deliveryId);
    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }
    await this.assertCanRead(userId, delivery.customerId, delivery.storeId);
    const view = await this.deliveryRepository.getView(delivery.id);
    if (!view) {
      throw new NotFoundException('Delivery not found');
    }
    return view;
  }

  async getForOrder(
    userId: string,
    orderIdValue: unknown,
  ): Promise<DeliveryView> {
    const orderId = requiredUuid(orderIdValue, 'Order');
    const delivery = await this.deliveryRepository.getDeliveryByOrder(orderId);
    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }
    await this.assertCanRead(userId, delivery.customerId, delivery.storeId);
    const view = await this.deliveryRepository.getView(delivery.id);
    if (!view) {
      throw new NotFoundException('Delivery not found');
    }
    return view;
  }

  async listForStore(
    userId: string,
    storeIdValue: unknown,
  ): Promise<DeliveryView[]> {
    const storeId = requiredUuid(storeIdValue, 'Store');
    await this.assertPermission(
      userId,
      RBAC_PERMISSIONS.ORDER_READ_STORE,
      storeId,
    );
    return this.deliveryRepository.listViewsForStore(storeId);
  }

  async retryForUser(
    userId: string,
    deliveryIdValue: unknown,
  ): Promise<DeliveryView> {
    const deliveryId = requiredUuid(deliveryIdValue, 'Delivery');
    const delivery = await this.deliveryRepository.getDelivery(deliveryId);
    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }
    await this.assertPermission(
      userId,
      RBAC_PERMISSIONS.ORDER_CANCEL_STORE,
      delivery.storeId,
    );

    const prepared = await this.deliveryRepository.prepareRetry(
      delivery.id,
      `delivery-retry:${delivery.id}:${Date.now()}`,
    );
    await this.workflowRuntime.start(prepared.workflowInput);
    const view = await this.deliveryRepository.getView(delivery.id);
    if (!view) {
      throw new NotFoundException('Delivery not found');
    }
    return view;
  }

  private async assertCanRead(
    userId: string,
    customerId: string,
    storeId: string,
  ): Promise<void> {
    if (
      customerId === userId &&
      (await this.rbacService.hasPermission(
        userId,
        RBAC_PERMISSIONS.ORDER_READ_OWN,
      ))
    ) {
      return;
    }
    await this.assertPermission(
      userId,
      RBAC_PERMISSIONS.ORDER_READ_STORE,
      storeId,
    );
  }

  private async assertPermission(
    userId: string,
    permission: string,
    storeId: string,
  ): Promise<void> {
    if (!(await this.rbacService.hasPermission(userId, permission, storeId))) {
      throw new ForbiddenException('Access denied');
    }
  }
}

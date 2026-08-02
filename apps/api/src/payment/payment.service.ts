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
import { PaymentProviderOutcome } from './payment-provider';
import {
  PaymentOutcomeApplication,
  PaymentRepository,
  PaymentView,
} from './payment.repository';
import { PaymentWorkflowRuntimeService } from './payment-workflow-runtime';
import { PaymentWorkflowInput } from './payment-workflow.types';

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

export type ProviderCallbackInput = Readonly<{
  paymentIntentId: string;
  attemptId: string;
  attemptNumber: number;
  workflowGeneration: number;
  correlationId: string;
  causationId: string | null;
  outcome: PaymentProviderOutcome;
}>;

@Injectable()
export class PaymentService {
  constructor(
    private readonly paymentRepository: PaymentRepository,
    private readonly workflowRuntime: PaymentWorkflowRuntimeService,
    private readonly rbacService: RbacService,
  ) {}

  async handleOrderPlaced(
    event: IntegrationEventEnvelope,
    tx: DrizzleTransaction,
  ): Promise<InboxEffectResult> {
    const intent = await this.paymentRepository.createFromOrderPlaced(
      event,
      tx,
    );
    const workflowInput: PaymentWorkflowInput = {
      paymentIntentId: intent.id,
      workflowGeneration: intent.workflowGeneration,
      correlationId: event.correlationId,
      causationId: event.eventId,
    };

    return {
      afterCommit: async () => {
        await this.workflowRuntime.start(workflowInput);
      },
    };
  }

  async getForUser(
    userId: string,
    paymentIntentIdValue: unknown,
  ): Promise<PaymentView> {
    const paymentIntentId = requiredUuid(
      paymentIntentIdValue,
      'Payment Intent',
    );
    const view = await this.paymentRepository.getView(paymentIntentId);
    if (!view) {
      throw new NotFoundException('Payment Intent not found');
    }
    await this.assertCanRead(userId, view);
    return view;
  }

  async getForOrder(
    userId: string,
    orderIdValue: unknown,
  ): Promise<PaymentView> {
    const orderId = requiredUuid(orderIdValue, 'Order');
    const intent = await this.paymentRepository.getIntentByOrder(orderId);
    if (!intent) {
      throw new NotFoundException('Payment Intent not found');
    }
    return this.getForUser(userId, intent.id);
  }

  async retryForUser(
    userId: string,
    paymentIntentIdValue: unknown,
  ): Promise<PaymentView> {
    const paymentIntentId = requiredUuid(
      paymentIntentIdValue,
      'Payment Intent',
    );
    const view = await this.paymentRepository.getView(paymentIntentId);
    if (!view) {
      throw new NotFoundException('Payment Intent not found');
    }
    if (
      view.customerId !== userId ||
      !(await this.rbacService.hasPermission(
        userId,
        RBAC_PERMISSIONS.PAYMENT_ATTEMPT_OWN,
      ))
    ) {
      throw new ForbiddenException('Access denied');
    }

    const prepared = await this.paymentRepository.prepareRetry(
      paymentIntentId,
      `payment-retry:${paymentIntentId}:${Date.now()}`,
    );
    await this.workflowRuntime.start(prepared.workflowInput);
    const refreshed = await this.paymentRepository.getView(paymentIntentId);
    if (!refreshed) {
      throw new NotFoundException('Payment Intent not found');
    }
    return refreshed;
  }

  async recordProviderCallback(
    input: ProviderCallbackInput,
  ): Promise<PaymentOutcomeApplication> {
    return this.paymentRepository.applyProviderOutcome(
      {
        paymentIntentId: input.paymentIntentId,
        workflowGeneration: input.workflowGeneration,
        correlationId: input.correlationId,
        causationId: input.causationId,
      },
      input.attemptId,
      input.attemptNumber,
      input.outcome,
    );
  }

  private async assertCanRead(
    userId: string,
    view: PaymentView,
  ): Promise<void> {
    if (
      view.customerId === userId &&
      (await this.rbacService.hasPermission(
        userId,
        RBAC_PERMISSIONS.PAYMENT_READ_OWN,
      ))
    ) {
      return;
    }
    if (
      await this.rbacService.hasPermission(
        userId,
        RBAC_PERMISSIONS.PAYMENT_READ_STORE,
        view.storeId,
      )
    ) {
      return;
    }
    throw new ForbiddenException('Access denied');
  }
}

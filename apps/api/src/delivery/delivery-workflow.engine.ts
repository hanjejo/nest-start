import { Inject, Injectable, Optional } from '@nestjs/common';
import { DELIVERY_PROVIDER, DeliveryProvider } from './delivery-provider';
import { DeliveryRepository } from './delivery.repository';
import {
  DELIVERY_WORKFLOW_NAME,
  DELIVERY_WORKFLOW_MAX_ATTEMPTS,
  DeliveryWorkflowInput,
  DeliveryWorkflowResult,
  DeliveryWorkflowStep,
} from './delivery-workflow.types';
import { MetricsService } from '../observability/metrics.service';
import { withSpan } from '../observability/tracing';

function directStep<T>(_name: string, work: () => Promise<T>): Promise<T> {
  return work();
}

@Injectable()
export class DeliveryWorkflowEngine {
  constructor(
    private readonly deliveryRepository: DeliveryRepository,
    @Inject(DELIVERY_PROVIDER)
    private readonly deliveryProvider: DeliveryProvider,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async run(
    input: DeliveryWorkflowInput,
    step: DeliveryWorkflowStep = directStep,
  ): Promise<DeliveryWorkflowResult> {
    return withSpan('workflow.delivery.run', () =>
      this.runInternal(input, step),
    );
  }

  private async runInternal(
    input: DeliveryWorkflowInput,
    step: DeliveryWorkflowStep,
  ): Promise<DeliveryWorkflowResult> {
    const initial = await step('load-delivery', () =>
      this.deliveryRepository.getDelivery(input.deliveryId),
    );
    if (!initial) {
      throw new Error(`Delivery ${input.deliveryId} was not found`);
    }
    if (this.isTerminal(initial.status)) {
      return this.result(initial.id, initial.status);
    }

    for (
      let attemptNumber = 1;
      attemptNumber <= DELIVERY_WORKFLOW_MAX_ATTEMPTS;
      attemptNumber += 1
    ) {
      const prepared = await step(
        `create-delivery-attempt-${input.workflowGeneration}-${attemptNumber}`,
        () => this.deliveryRepository.ensureAttempt(input, attemptNumber),
      );
      if (!prepared) {
        const current = await step('load-delivery-after-attempt', () =>
          this.requireDelivery(input.deliveryId),
        );
        return this.result(current.id, current.status);
      }

      const outcome = await step(
        `request-delivery-attempt-${input.workflowGeneration}-${attemptNumber}`,
        () =>
          withSpan('delivery.provider.deliver', () =>
            this.deliveryProvider.deliver({
              deliveryId: prepared.delivery.id,
              orderId: prepared.delivery.orderId,
              addressSnapshot: prepared.delivery.addressSnapshot,
              idempotencyKey: prepared.attempt.providerIdempotencyKey,
            }),
          ),
      );

      const application = await step(
        `record-delivery-callback-${outcome.callbackId}`,
        () =>
          this.deliveryRepository.applyProviderOutcome(
            input,
            prepared.attempt.id,
            attemptNumber,
            outcome,
          ),
      );
      if (application.retryable) {
        this.metrics?.recordWorkflowRetry(DELIVERY_WORKFLOW_NAME);
      }
      if (application.terminal || !application.retryable) {
        return this.result(
          application.delivery.id,
          application.delivery.status,
        );
      }

      const current = await step('load-delivery-after-attempt', () =>
        this.requireDelivery(input.deliveryId),
      );
      if (this.isTerminal(current.status)) {
        return this.result(current.id, current.status);
      }
    }

    const finalDelivery = await step('load-delivery-final', () =>
      this.requireDelivery(input.deliveryId),
    );
    return this.result(finalDelivery.id, finalDelivery.status);
  }

  private async requireDelivery(deliveryId: string) {
    const delivery = await this.deliveryRepository.getDelivery(deliveryId);
    if (!delivery) {
      throw new Error(`Delivery ${deliveryId} was not found`);
    }
    return delivery;
  }

  private isTerminal(status: string): boolean {
    return status === 'DELIVERED' || status === 'FAILED';
  }

  private result(
    deliveryId: string,
    status: 'REQUESTED' | 'READY' | 'IN_TRANSIT' | 'DELIVERED' | 'FAILED',
  ): DeliveryWorkflowResult {
    return {
      deliveryId,
      status,
    };
  }
}

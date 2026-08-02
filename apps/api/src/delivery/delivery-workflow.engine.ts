import { Inject, Injectable } from '@nestjs/common';
import { DELIVERY_PROVIDER, DeliveryProvider } from './delivery-provider';
import { DeliveryRepository } from './delivery.repository';
import {
  DELIVERY_WORKFLOW_MAX_ATTEMPTS,
  DeliveryWorkflowInput,
  DeliveryWorkflowResult,
  DeliveryWorkflowStep,
} from './delivery-workflow.types';

function directStep<T>(_name: string, work: () => Promise<T>): Promise<T> {
  return work();
}

@Injectable()
export class DeliveryWorkflowEngine {
  constructor(
    private readonly deliveryRepository: DeliveryRepository,
    @Inject(DELIVERY_PROVIDER)
    private readonly deliveryProvider: DeliveryProvider,
  ) {}

  async run(
    input: DeliveryWorkflowInput,
    step: DeliveryWorkflowStep = directStep,
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
          this.deliveryProvider.deliver({
            deliveryId: prepared.delivery.id,
            orderId: prepared.delivery.orderId,
            addressSnapshot: prepared.delivery.addressSnapshot,
            idempotencyKey: prepared.attempt.providerIdempotencyKey,
          }),
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

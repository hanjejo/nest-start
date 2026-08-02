import { Inject, Injectable, Optional } from '@nestjs/common';
import { PaymentIntent } from '../db/schema';
import { MetricsService } from '../observability/metrics.service';
import { PAYMENT_PROVIDER, PaymentProvider } from './payment-provider';
import { PaymentRepository } from './payment.repository';
import {
  PAYMENT_WORKFLOW_NAME,
  PAYMENT_WORKFLOW_MAX_ATTEMPTS,
  PaymentWorkflowInput,
  PaymentWorkflowResult,
  PaymentWorkflowStep,
} from './payment-workflow.types';
import { withSpan } from '../observability/tracing';

function directStep<T>(_name: string, work: () => Promise<T>): Promise<T> {
  return work();
}

@Injectable()
export class PaymentWorkflowEngine {
  constructor(
    private readonly paymentRepository: PaymentRepository,
    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider: PaymentProvider,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async run(
    input: PaymentWorkflowInput,
    step: PaymentWorkflowStep = directStep,
  ): Promise<PaymentWorkflowResult> {
    return withSpan('workflow.payment.run', () =>
      this.runInternal(input, step),
    );
  }

  private async runInternal(
    input: PaymentWorkflowInput,
    step: PaymentWorkflowStep,
  ): Promise<PaymentWorkflowResult> {
    const initial = await step('load-payment-intent', () =>
      this.paymentRepository.getIntent(input.paymentIntentId),
    );
    if (!initial) {
      throw new Error(`Payment Intent ${input.paymentIntentId} was not found`);
    }
    if (this.isTerminal(initial)) {
      return this.result(initial);
    }

    const expired = await step('expire-payment-intent-if-due', () =>
      this.paymentRepository.expireIfDue(input),
    );
    if (this.isTerminal(expired)) {
      return this.result(expired);
    }

    for (
      let attemptNumber = 1;
      attemptNumber <= PAYMENT_WORKFLOW_MAX_ATTEMPTS;
      attemptNumber += 1
    ) {
      const prepared = await step(
        `create-payment-attempt-${input.workflowGeneration}-${attemptNumber}`,
        () => this.paymentRepository.ensureAttempt(input, attemptNumber),
      );
      if (!prepared) {
        const current = await step(
          `load-payment-intent-after-attempt-${input.workflowGeneration}-${attemptNumber}`,
          () => this.requireIntent(input.paymentIntentId),
        );
        return this.result(current);
      }

      if (prepared.intent.expiresAt.getTime() <= Date.now()) {
        const expiredIntent = await step('expire-payment-intent-if-due', () =>
          this.paymentRepository.expireIfDue(input),
        );
        return this.result(expiredIntent);
      }

      const outcome = await step(
        `charge-payment-attempt-${input.workflowGeneration}-${attemptNumber}`,
        () =>
          withSpan('payment.provider.charge', () =>
            this.paymentProvider.charge({
              paymentIntentId: prepared.intent.id,
              orderId: prepared.intent.orderId,
              amountMinor: prepared.intent.amountMinor,
              currency: prepared.intent.currency,
              idempotencyKey: prepared.attempt.providerIdempotencyKey,
            }),
          ),
      );

      const application = await step(
        `record-payment-callback-${outcome.callbackId}`,
        () =>
          this.paymentRepository.applyProviderOutcome(
            input,
            prepared.attempt.id,
            attemptNumber,
            outcome,
          ),
      );
      if (application.retryable) {
        this.metrics?.recordWorkflowRetry(PAYMENT_WORKFLOW_NAME);
      }
      if (application.terminal || !application.retryable) {
        return this.result(application.intent);
      }

      const current = await step(
        `load-payment-intent-after-attempt-${input.workflowGeneration}-${attemptNumber}`,
        () => this.requireIntent(input.paymentIntentId),
      );
      if (this.isTerminal(current)) {
        return this.result(current);
      }
    }

    const finalIntent = await step('load-payment-intent-final', () =>
      this.requireIntent(input.paymentIntentId),
    );
    return this.result(finalIntent);
  }

  private async requireIntent(paymentIntentId: string): Promise<PaymentIntent> {
    const intent = await this.paymentRepository.getIntent(paymentIntentId);
    if (!intent) {
      throw new Error(`Payment Intent ${paymentIntentId} was not found`);
    }
    return intent;
  }

  private isTerminal(intent: PaymentIntent): boolean {
    return (
      intent.status === 'SUCCEEDED' ||
      intent.status === 'FAILED' ||
      intent.status === 'EXPIRED'
    );
  }

  private result(intent: PaymentIntent): PaymentWorkflowResult {
    return {
      paymentIntentId: intent.id,
      status: intent.status,
    };
  }
}

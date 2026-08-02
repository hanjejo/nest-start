import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  PaymentProvider,
  PaymentProviderChargeRequest,
  PaymentProviderOutcome,
} from './payment-provider';

export type FakePaymentProviderBehavior =
  | 'success'
  | 'retryable-failure'
  | 'non-retryable-failure'
  | 'timeout';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 20);
}

@Injectable()
export class FakePaymentProvider implements PaymentProvider {
  readonly requests: PaymentProviderChargeRequest[] = [];
  private readonly completedByIdempotencyKey = new Map<
    string,
    PaymentProviderOutcome
  >();
  private readonly chargeCounts = new Map<string, number>();
  private behavior: FakePaymentProviderBehavior = 'success';
  private queuedBehaviors: FakePaymentProviderBehavior[] = [];

  setBehavior(behavior: FakePaymentProviderBehavior): void {
    this.behavior = behavior;
  }

  enqueueBehavior(behavior: FakePaymentProviderBehavior): void {
    this.queuedBehaviors.push(behavior);
  }

  reset(): void {
    this.requests.length = 0;
    this.completedByIdempotencyKey.clear();
    this.chargeCounts.clear();
    this.queuedBehaviors = [];
  }

  chargeCount(idempotencyKey?: string): number {
    if (idempotencyKey) {
      return this.chargeCounts.get(idempotencyKey) ?? 0;
    }
    return [...this.chargeCounts.values()].reduce(
      (total, count) => total + count,
      0,
    );
  }

  outcomeFor(idempotencyKey: string): PaymentProviderOutcome | undefined {
    return this.completedByIdempotencyKey.get(idempotencyKey);
  }

  async charge(
    request: PaymentProviderChargeRequest,
  ): Promise<PaymentProviderOutcome> {
    this.requests.push(Object.freeze({ ...request }));

    const completed = this.completedByIdempotencyKey.get(
      request.idempotencyKey,
    );
    if (completed) {
      return completed;
    }

    const behavior = this.queuedBehaviors.shift() ?? this.behavior;
    const requestDigest = digest(request.idempotencyKey);

    if (behavior !== 'timeout') {
      this.chargeCounts.set(
        request.idempotencyKey,
        (this.chargeCounts.get(request.idempotencyKey) ?? 0) + 1,
      );
    }

    const outcome: PaymentProviderOutcome =
      behavior === 'timeout'
        ? {
            kind: 'TIMED_OUT',
            callbackId: `fake-timeout-${requestDigest}`,
            providerReference: null,
            failureReason: 'PROVIDER_TIMEOUT',
            retryable: true,
          }
        : behavior === 'success'
          ? {
              kind: 'SUCCEEDED',
              callbackId: `fake-callback-${requestDigest}`,
              providerReference: `fake-charge-${requestDigest}`,
            }
          : {
              kind: 'FAILED',
              callbackId: `fake-callback-${requestDigest}`,
              providerReference: null,
              failureReason:
                behavior === 'retryable-failure'
                  ? 'PROVIDER_UNAVAILABLE'
                  : 'CARD_DECLINED',
              retryable: behavior === 'retryable-failure',
            };

    const frozenOutcome = Object.freeze(outcome);
    this.completedByIdempotencyKey.set(request.idempotencyKey, frozenOutcome);
    return frozenOutcome;
  }
}

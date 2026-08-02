import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  DeliveryProvider,
  DeliveryProviderOutcome,
  DeliveryProviderRequest,
} from './delivery-provider';

export type FakeDeliveryProviderBehavior =
  | 'success'
  | 'progress'
  | 'retryable-failure'
  | 'non-retryable-failure';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 20);
}

@Injectable()
export class FakeDeliveryProvider implements DeliveryProvider {
  readonly requests: DeliveryProviderRequest[] = [];
  private readonly completedByIdempotencyKey = new Map<
    string,
    DeliveryProviderOutcome
  >();
  private readonly deliveryCounts = new Map<string, number>();
  private behavior: FakeDeliveryProviderBehavior = 'success';
  private queuedBehaviors: FakeDeliveryProviderBehavior[] = [];

  setBehavior(behavior: FakeDeliveryProviderBehavior): void {
    this.behavior = behavior;
  }

  enqueueBehavior(behavior: FakeDeliveryProviderBehavior): void {
    this.queuedBehaviors.push(behavior);
  }

  reset(): void {
    this.requests.length = 0;
    this.completedByIdempotencyKey.clear();
    this.deliveryCounts.clear();
    this.queuedBehaviors = [];
  }

  deliveryCount(idempotencyKey?: string): number {
    if (idempotencyKey) {
      return this.deliveryCounts.get(idempotencyKey) ?? 0;
    }
    return [...this.deliveryCounts.values()].reduce(
      (total, count) => total + count,
      0,
    );
  }

  outcomeFor(idempotencyKey: string): DeliveryProviderOutcome | undefined {
    return this.completedByIdempotencyKey.get(idempotencyKey);
  }

  async deliver(
    request: DeliveryProviderRequest,
  ): Promise<DeliveryProviderOutcome> {
    this.requests.push(Object.freeze({ ...request }));

    const completed = this.completedByIdempotencyKey.get(
      request.idempotencyKey,
    );
    if (completed) {
      return completed;
    }

    const behavior = this.queuedBehaviors.shift() ?? this.behavior;
    const requestDigest = digest(request.idempotencyKey);
    this.deliveryCounts.set(
      request.idempotencyKey,
      (this.deliveryCounts.get(request.idempotencyKey) ?? 0) + 1,
    );

    const outcome: DeliveryProviderOutcome =
      behavior === 'retryable-failure'
        ? {
            kind: 'FAILED',
            callbackId: `fake-delivery-callback-${requestDigest}`,
            providerReference: null,
            failureReason: 'PROVIDER_UNAVAILABLE',
            retryable: true,
          }
        : behavior === 'non-retryable-failure'
          ? {
              kind: 'FAILED',
              callbackId: `fake-delivery-callback-${requestDigest}`,
              providerReference: null,
              failureReason: 'ADDRESS_UNDELIVERABLE',
              retryable: false,
            }
          : {
              kind: 'SUCCEEDED',
              callbackId: `fake-delivery-callback-${requestDigest}`,
              providerReference: `fake-delivery-${requestDigest}`,
            };

    const frozenOutcome = Object.freeze(outcome);
    this.completedByIdempotencyKey.set(request.idempotencyKey, frozenOutcome);
    return frozenOutcome;
  }
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export type PaymentProviderChargeRequest = Readonly<{
  paymentIntentId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
}>;

export type PaymentProviderSuccess = Readonly<{
  kind: 'SUCCEEDED';
  callbackId: string;
  providerReference: string;
}>;

export type PaymentProviderFailure = Readonly<{
  kind: 'FAILED';
  callbackId: string;
  providerReference: null;
  failureReason: 'PROVIDER_UNAVAILABLE' | 'CARD_DECLINED';
  retryable: boolean;
}>;

export type PaymentProviderTimeout = Readonly<{
  kind: 'TIMED_OUT';
  callbackId: string;
  providerReference: null;
  failureReason: 'PROVIDER_TIMEOUT';
  retryable: true;
}>;

export type PaymentProviderOutcome =
  | PaymentProviderSuccess
  | PaymentProviderFailure
  | PaymentProviderTimeout;

export interface PaymentProvider {
  charge(
    request: PaymentProviderChargeRequest,
  ): Promise<PaymentProviderOutcome>;
}

import { AddressSnapshot } from '../messaging/address-snapshot';

export const DELIVERY_PROVIDER = Symbol('DELIVERY_PROVIDER');

export type DeliveryProviderRequest = Readonly<{
  deliveryId: string;
  orderId: string;
  addressSnapshot: AddressSnapshot;
  idempotencyKey: string;
}>;

export type DeliveryProviderSuccess = Readonly<{
  kind: 'SUCCEEDED';
  callbackId: string;
  providerReference: string;
}>;

export type DeliveryProviderFailure = Readonly<{
  kind: 'FAILED';
  callbackId: string;
  providerReference: null;
  failureReason: 'PROVIDER_UNAVAILABLE' | 'ADDRESS_UNDELIVERABLE';
  retryable: boolean;
}>;

export type DeliveryProviderOutcome =
  | DeliveryProviderSuccess
  | DeliveryProviderFailure;

export interface DeliveryProvider {
  deliver(request: DeliveryProviderRequest): Promise<DeliveryProviderOutcome>;
}

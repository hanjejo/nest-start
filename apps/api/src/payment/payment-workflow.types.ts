import { PaymentIntentStatus } from '../db/schema';

export const PAYMENT_WORKFLOW_NAME = 'PaymentWorkflow';
export const PAYMENT_WORKFLOW_QUEUE = 'payment-workflows';
export const PAYMENT_WORKFLOW_MAX_ATTEMPTS = 3;
export const PAYMENT_INTENT_EXPIRY_MS = 15 * 60 * 1_000;

export type PaymentWorkflowInput = Readonly<{
  paymentIntentId: string;
  workflowGeneration: number;
  correlationId: string;
  causationId: string | null;
}>;

export type PaymentWorkflowResult = Readonly<{
  paymentIntentId: string;
  status: PaymentIntentStatus;
}>;

export type PaymentWorkflowHandle = Readonly<{
  workflowId: string;
  runtime: 'dbos' | 'local';
  getResult: () => Promise<PaymentWorkflowResult>;
}>;

export type PaymentWorkflowStep = <T>(
  name: string,
  work: () => Promise<T>,
) => Promise<T>;

export function paymentWorkflowId(
  paymentIntentId: string,
  workflowGeneration: number,
): string {
  return `payment-intent:${paymentIntentId}:generation:${workflowGeneration}`;
}

export function paymentAttemptIdempotencyKey(
  paymentIntentId: string,
  workflowGeneration: number,
  attemptNumber: number,
): string {
  return `payment-intent:${paymentIntentId}:generation:${workflowGeneration}:attempt:${attemptNumber}`;
}

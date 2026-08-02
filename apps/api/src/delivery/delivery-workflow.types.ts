export const DELIVERY_WORKFLOW_NAME = 'DeliveryWorkflow';
export const DELIVERY_WORKFLOW_QUEUE = 'delivery-workflows';
export const DELIVERY_WORKFLOW_MAX_ATTEMPTS = 3;

export type DeliveryWorkflowInput = Readonly<{
  deliveryId: string;
  workflowGeneration: number;
  correlationId: string;
  causationId: string | null;
}>;

export type DeliveryWorkflowResult = Readonly<{
  deliveryId: string;
  status: 'REQUESTED' | 'READY' | 'IN_TRANSIT' | 'DELIVERED' | 'FAILED';
}>;

export type DeliveryWorkflowHandle = Readonly<{
  workflowId: string;
  runtime: 'dbos' | 'local';
  getResult: () => Promise<DeliveryWorkflowResult>;
}>;

export type DeliveryWorkflowStep = <T>(
  name: string,
  work: () => Promise<T>,
) => Promise<T>;

export function deliveryWorkflowId(
  deliveryId: string,
  workflowGeneration: number,
): string {
  return `delivery-workflow:${deliveryId}:generation:${workflowGeneration}`;
}

export function deliveryAttemptIdempotencyKey(
  deliveryId: string,
  workflowGeneration: number,
  attemptNumber: number,
): string {
  return `delivery-attempt:${deliveryId}:generation:${workflowGeneration}:attempt:${attemptNumber}`;
}

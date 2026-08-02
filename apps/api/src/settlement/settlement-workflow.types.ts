import { SettlementStatus } from '../db/schema';

export const SETTLEMENT_WORKFLOW_NAME = 'SettlementWorkflow';
export const SETTLEMENT_WORKFLOW_QUEUE = 'settlement-workflows';

export type SettlementWorkflowInput = Readonly<{
  settlementId: string;
  workflowGeneration: number;
  correlationId: string;
  causationId: string | null;
}>;

export type SettlementWorkflowResult = Readonly<{
  settlementId: string;
  status: SettlementStatus;
  payableAmountMinor: number;
}>;

export type SettlementWorkflowHandle = Readonly<{
  workflowId: string;
  runtime: 'dbos' | 'local';
  getResult: () => Promise<SettlementWorkflowResult>;
}>;

export type SettlementWorkflowStep = <T>(
  name: string,
  work: () => Promise<T>,
) => Promise<T>;

export function settlementWorkflowId(
  settlementId: string,
  workflowGeneration: number,
): string {
  return `settlement:${settlementId}:generation:${workflowGeneration}`;
}

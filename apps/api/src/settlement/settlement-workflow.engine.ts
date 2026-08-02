import { Injectable } from '@nestjs/common';
import {
  calculateSettlement,
  SettlementCalculation,
} from './settlement.calculator';
import { SettlementRepository } from './settlement.repository';
import {
  SettlementWorkflowInput,
  SettlementWorkflowResult,
  SettlementWorkflowStep,
} from './settlement-workflow.types';
import { withSpan } from '../observability/tracing';

function directStep<T>(_name: string, work: () => Promise<T>): Promise<T> {
  return work();
}

@Injectable()
export class SettlementWorkflowEngine {
  constructor(private readonly settlementRepository: SettlementRepository) {}

  async run(
    input: SettlementWorkflowInput,
    step: SettlementWorkflowStep = directStep,
  ): Promise<SettlementWorkflowResult> {
    return withSpan('workflow.settlement.run', () =>
      this.runInternal(input, step),
    );
  }

  private async runInternal(
    input: SettlementWorkflowInput,
    step: SettlementWorkflowStep,
  ): Promise<SettlementWorkflowResult> {
    const initial = await step('load-settlement', () =>
      this.settlementRepository.getSettlement(input.settlementId),
    );
    if (!initial) {
      throw new Error(`Settlement ${input.settlementId} was not found`);
    }
    if (initial.status === 'RECORDED') {
      return this.result(
        initial.id,
        initial.status,
        initial.payableAmountMinor,
      );
    }

    const facts = await step('load-settlement-facts', () =>
      this.settlementRepository.getWorkflowFacts(input.settlementId),
    );
    if (!facts) {
      return this.result(
        initial.id,
        initial.status,
        initial.payableAmountMinor,
      );
    }

    const calculation = await step('calculate-settlement', async () =>
      calculateSettlement({
        grossAmountMinor: facts.orderFact.amountMinor,
        feeBasisPoints: facts.settlement.feeBasisPoints,
        refunds: facts.refunds.map((refund) => refund.refundAmountMinor),
        adjustmentAmountMinor: facts.settlement.adjustmentAmountMinor,
      }),
    );
    this.assertCalculationMatchesProjection(facts.calculation, calculation);

    const recorded = await step('record-settlement-ledger', () =>
      this.settlementRepository.recordSettlement(input),
    );
    return this.result(
      recorded.id,
      recorded.status,
      recorded.payableAmountMinor,
    );
  }

  private assertCalculationMatchesProjection(
    projected: SettlementCalculation,
    calculated: SettlementCalculation,
  ): void {
    if (
      projected.grossAmountMinor !== calculated.grossAmountMinor ||
      projected.feeBasisPoints !== calculated.feeBasisPoints ||
      projected.feeAmountMinor !== calculated.feeAmountMinor ||
      projected.refundAmountMinor !== calculated.refundAmountMinor ||
      projected.adjustmentAmountMinor !== calculated.adjustmentAmountMinor ||
      projected.payableAmountMinor !== calculated.payableAmountMinor
    ) {
      throw new Error(
        'Settlement calculation changed between projection steps',
      );
    }
  }

  private result(
    settlementId: string,
    status: 'PENDING' | 'ELIGIBLE' | 'RECORDED',
    payableAmountMinor: number,
  ): SettlementWorkflowResult {
    return {
      settlementId,
      status,
      payableAmountMinor,
    };
  }
}

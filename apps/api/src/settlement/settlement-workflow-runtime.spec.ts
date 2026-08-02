import { SettlementWorkflowEngine } from './settlement-workflow.engine';
import { LocalSettlementWorkflowRuntime } from './settlement-workflow-runtime';
import {
  SettlementWorkflowInput,
  SettlementWorkflowResult,
} from './settlement-workflow.types';

const input: SettlementWorkflowInput = {
  settlementId: '90000000-0000-4000-8000-000000000301',
  workflowGeneration: 1,
  correlationId: 'correlation-runtime-test',
  causationId: 'order-completed:runtime-test',
};

describe('Settlement workflow runtime seam', () => {
  it('coalesces duplicate local starts by deterministic workflow identity', async () => {
    const result: SettlementWorkflowResult = {
      settlementId: input.settlementId,
      status: 'RECORDED',
      payableAmountMinor: 975,
    };
    const engine = {
      run: vi.fn().mockResolvedValue(result),
    } as unknown as SettlementWorkflowEngine;
    const runtime = new LocalSettlementWorkflowRuntime(engine);

    const [first, second] = await Promise.all([
      runtime.start(input),
      runtime.start(input),
    ]);

    expect(engine.run).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({
      workflowId: `settlement:${input.settlementId}:generation:1`,
      runtime: 'local',
    });
    expect(await second.getResult()).toEqual(result);
  });
});

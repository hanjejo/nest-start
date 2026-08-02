import { DBOS } from '@dbos-inc/dbos-sdk';
import { Pool } from 'pg';
import { SettlementWorkflowEngine } from './settlement-workflow.engine';
import {
  SETTLEMENT_WORKFLOW_NAME,
  SETTLEMENT_WORKFLOW_QUEUE,
  SettlementWorkflowHandle,
  SettlementWorkflowInput,
  SettlementWorkflowResult,
  settlementWorkflowId,
} from './settlement-workflow.types';
import type { SettlementWorkflowRuntime } from './settlement-workflow-runtime';

/**
 * DBOS is intentionally kept behind this runtime seam. The API bundle treats
 * the SDK as an external dependency, while tests and unavailable local
 * PostgreSQL instances use the explicit local runtime.
 */
export class DbosSettlementWorkflowRuntime
  implements SettlementWorkflowRuntime
{
  private initialized = false;
  private readonly registeredWorkflow: (
    input: SettlementWorkflowInput,
  ) => Promise<SettlementWorkflowResult>;

  constructor(
    private readonly engine: SettlementWorkflowEngine,
    private readonly pool: Pool,
  ) {
    this.registeredWorkflow = DBOS.registerWorkflow(
      async (input: SettlementWorkflowInput) =>
        this.engine.run(input, (name, work) =>
          DBOS.runStep(work, {
            name,
            retriesAllowed: name === 'record-settlement-ledger',
            maxAttempts: 3,
            intervalSeconds: 1,
          }),
        ),
      { name: SETTLEMENT_WORKFLOW_NAME },
    );
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    if (!DBOS.isInitialized()) {
      DBOS.setConfig({
        name: 'coffee-order-api',
        systemDatabaseUrl:
          process.env.DATABASE_URL ??
          'postgresql://localhost:5432/coffee_order',
        systemDatabasePool: this.pool,
        systemDatabaseSchemaName: 'dbos',
        applicationVersion: process.env.APP_VERSION ?? 'local',
        enableOTLP: false,
        tracingEnabled: false,
        logLevel: 'warn',
      });
      await DBOS.launch();
    }
    this.initialized = true;
  }

  async start(
    input: SettlementWorkflowInput,
  ): Promise<SettlementWorkflowHandle> {
    if (!this.initialized) {
      throw new Error('DBOS SettlementWorkflow runtime is not initialized');
    }

    const workflowId = settlementWorkflowId(
      input.settlementId,
      input.workflowGeneration,
    );
    const handle = await DBOS.startWorkflow(this.registeredWorkflow, {
      workflowID: workflowId,
      queueName: SETTLEMENT_WORKFLOW_QUEUE,
      duplicationPolicy: 'return-existing',
    })(input);

    return {
      workflowId,
      runtime: 'dbos',
      getResult: () => handle.getResult(),
    };
  }

  async shutdown(): Promise<void> {
    if (!this.initialized && !DBOS.isInitialized()) {
      return;
    }
    this.initialized = false;
    await DBOS.shutdown();
  }
}

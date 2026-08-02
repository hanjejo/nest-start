import { DBOS } from '@dbos-inc/dbos-sdk';
import { Pool } from 'pg';
import { PaymentWorkflowEngine } from './payment-workflow.engine';
import {
  PAYMENT_WORKFLOW_NAME,
  PAYMENT_WORKFLOW_QUEUE,
  PaymentWorkflowHandle,
  PaymentWorkflowInput,
  PaymentWorkflowResult,
  paymentWorkflowId,
} from './payment-workflow.types';
import type { PaymentWorkflowRuntime } from './payment-workflow-runtime';

export class DbosPaymentWorkflowRuntime implements PaymentWorkflowRuntime {
  private initialized = false;
  private readonly registeredWorkflow: (
    input: PaymentWorkflowInput,
  ) => Promise<PaymentWorkflowResult>;

  constructor(
    private readonly engine: PaymentWorkflowEngine,
    private readonly pool: Pool,
  ) {
    this.registeredWorkflow = DBOS.registerWorkflow(
      async (input: PaymentWorkflowInput) =>
        this.engine.run(input, (name, work) =>
          DBOS.runStep(work, {
            name,
            retriesAllowed: name.startsWith('charge-payment-attempt'),
            maxAttempts: 3,
            intervalSeconds: 1,
          }),
        ),
      { name: PAYMENT_WORKFLOW_NAME },
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

  async start(input: PaymentWorkflowInput): Promise<PaymentWorkflowHandle> {
    if (!this.initialized) {
      throw new Error('DBOS PaymentWorkflow runtime is not initialized');
    }

    const workflowId = paymentWorkflowId(
      input.paymentIntentId,
      input.workflowGeneration,
    );
    const handle = await DBOS.startWorkflow(this.registeredWorkflow, {
      workflowID: workflowId,
      queueName: PAYMENT_WORKFLOW_QUEUE,
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

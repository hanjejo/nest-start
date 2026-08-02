import { DBOS } from '@dbos-inc/dbos-sdk';
import { Pool } from 'pg';
import { DeliveryWorkflowEngine } from './delivery-workflow.engine';
import {
  DELIVERY_WORKFLOW_NAME,
  DELIVERY_WORKFLOW_QUEUE,
  DeliveryWorkflowHandle,
  DeliveryWorkflowInput,
  DeliveryWorkflowResult,
  deliveryWorkflowId,
} from './delivery-workflow.types';
import type { DeliveryWorkflowRuntime } from './delivery-workflow-runtime';

export class DbosDeliveryWorkflowRuntime implements DeliveryWorkflowRuntime {
  private initialized = false;
  private readonly registeredWorkflow: (
    input: DeliveryWorkflowInput,
  ) => Promise<DeliveryWorkflowResult>;

  constructor(
    private readonly engine: DeliveryWorkflowEngine,
    private readonly pool: Pool,
  ) {
    this.registeredWorkflow = DBOS.registerWorkflow(
      async (input: DeliveryWorkflowInput) =>
        this.engine.run(input, (name, work) =>
          DBOS.runStep(work, {
            name,
            retriesAllowed: name.startsWith('request-delivery-attempt'),
            maxAttempts: 3,
            intervalSeconds: 1,
          }),
        ),
      { name: DELIVERY_WORKFLOW_NAME },
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

  async start(input: DeliveryWorkflowInput): Promise<DeliveryWorkflowHandle> {
    if (!this.initialized) {
      throw new Error('DBOS DeliveryWorkflow runtime is not initialized');
    }

    const workflowId = deliveryWorkflowId(
      input.deliveryId,
      input.workflowGeneration,
    );
    const handle = await DBOS.startWorkflow(this.registeredWorkflow, {
      workflowID: workflowId,
      queueName: DELIVERY_WORKFLOW_QUEUE,
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

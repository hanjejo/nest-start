import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../db/drizzle.module';
import { safeFailureReason } from '../messaging/failure';
import { DbosDeliveryWorkflowRuntime } from './dbos-delivery-workflow-runtime';
import { DeliveryWorkflowEngine } from './delivery-workflow.engine';
import {
  DeliveryWorkflowHandle,
  DeliveryWorkflowInput,
  DeliveryWorkflowResult,
  deliveryWorkflowId,
} from './delivery-workflow.types';

export interface DeliveryWorkflowRuntime {
  start(input: DeliveryWorkflowInput): Promise<DeliveryWorkflowHandle>;
}

export class LocalDeliveryWorkflowRuntime implements DeliveryWorkflowRuntime {
  private readonly runs = new Map<string, Promise<DeliveryWorkflowResult>>();

  constructor(private readonly engine: DeliveryWorkflowEngine) {}

  async start(input: DeliveryWorkflowInput): Promise<DeliveryWorkflowHandle> {
    const workflowId = deliveryWorkflowId(
      input.deliveryId,
      input.workflowGeneration,
    );
    let result = this.runs.get(workflowId);
    if (!result) {
      result = this.engine.run(input);
      this.runs.set(workflowId, result);
      result.catch(() => {
        if (this.runs.get(workflowId) === result) {
          this.runs.delete(workflowId);
        }
      });
    }

    await result;
    return {
      workflowId,
      runtime: 'local',
      getResult: () => result as Promise<DeliveryWorkflowResult>,
    };
  }
}

@Injectable()
export class DeliveryWorkflowRuntimeService
  implements DeliveryWorkflowRuntime, OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(DeliveryWorkflowRuntimeService.name);
  private readonly localRuntime: LocalDeliveryWorkflowRuntime;
  private dbosRuntime: DbosDeliveryWorkflowRuntime | undefined;
  private activeRuntime: DeliveryWorkflowRuntime;
  private mode: 'dbos' | 'local' = 'local';

  constructor(
    private readonly engine: DeliveryWorkflowEngine,
    @Inject(DATABASE_POOL) private readonly pool: Pool,
  ) {
    this.localRuntime = new LocalDeliveryWorkflowRuntime(engine);
    this.activeRuntime = this.localRuntime;
  }

  async onModuleInit(): Promise<void> {
    if (!this.shouldUseDbos()) {
      return;
    }

    const dbosRuntime = new DbosDeliveryWorkflowRuntime(this.engine, this.pool);
    try {
      await dbosRuntime.initialize();
      this.dbosRuntime = dbosRuntime;
      this.activeRuntime = dbosRuntime;
      this.mode = 'dbos';
    } catch (error) {
      this.logger.warn(
        `DBOS DeliveryWorkflow unavailable; using explicit local fallback: ${safeFailureReason(error)}`,
      );
      await dbosRuntime.shutdown().catch(() => undefined);
    }
  }

  start(input: DeliveryWorkflowInput): Promise<DeliveryWorkflowHandle> {
    return this.activeRuntime.start(input);
  }

  get runtimeMode(): 'dbos' | 'local' {
    return this.mode;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.dbosRuntime?.shutdown();
  }

  private shouldUseDbos(): boolean {
    const configured =
      process.env.DELIVERY_WORKFLOW_RUNTIME?.trim().toLowerCase();
    if (configured === 'local') {
      return false;
    }
    if (configured === 'dbos') {
      return true;
    }
    return process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true';
  }
}

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
import { DbosSettlementWorkflowRuntime } from './dbos-settlement-workflow-runtime';
import { SettlementWorkflowEngine } from './settlement-workflow.engine';
import {
  SettlementWorkflowHandle,
  SettlementWorkflowInput,
  SettlementWorkflowResult,
  settlementWorkflowId,
} from './settlement-workflow.types';

export interface SettlementWorkflowRuntime {
  start(input: SettlementWorkflowInput): Promise<SettlementWorkflowHandle>;
}

export class LocalSettlementWorkflowRuntime
  implements SettlementWorkflowRuntime
{
  private readonly runs = new Map<string, Promise<SettlementWorkflowResult>>();

  constructor(private readonly engine: SettlementWorkflowEngine) {}

  async start(
    input: SettlementWorkflowInput,
  ): Promise<SettlementWorkflowHandle> {
    const workflowId = settlementWorkflowId(
      input.settlementId,
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
      getResult: () => result as Promise<SettlementWorkflowResult>,
    };
  }
}

@Injectable()
export class SettlementWorkflowRuntimeService
  implements SettlementWorkflowRuntime, OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(SettlementWorkflowRuntimeService.name);
  private readonly localRuntime: LocalSettlementWorkflowRuntime;
  private dbosRuntime: DbosSettlementWorkflowRuntime | undefined;
  private activeRuntime: SettlementWorkflowRuntime;
  private mode: 'dbos' | 'local' = 'local';

  constructor(
    private readonly engine: SettlementWorkflowEngine,
    @Inject(DATABASE_POOL) private readonly pool: Pool,
  ) {
    this.localRuntime = new LocalSettlementWorkflowRuntime(engine);
    this.activeRuntime = this.localRuntime;
  }

  async onModuleInit(): Promise<void> {
    if (!this.shouldUseDbos()) {
      return;
    }

    const dbosRuntime = new DbosSettlementWorkflowRuntime(
      this.engine,
      this.pool,
    );
    try {
      await dbosRuntime.initialize();
      this.dbosRuntime = dbosRuntime;
      this.activeRuntime = dbosRuntime;
      this.mode = 'dbos';
    } catch (error) {
      this.logger.warn(
        `DBOS SettlementWorkflow unavailable; using explicit local fallback: ${safeFailureReason(error)}`,
      );
      await dbosRuntime.shutdown().catch(() => undefined);
    }
  }

  start(input: SettlementWorkflowInput): Promise<SettlementWorkflowHandle> {
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
      process.env.SETTLEMENT_WORKFLOW_RUNTIME?.trim().toLowerCase();
    if (configured === 'local') {
      return false;
    }
    if (configured === 'dbos') {
      return true;
    }
    return process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true';
  }
}

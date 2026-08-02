import {
  Inject,
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../db/drizzle.module';
import { safeFailureReason } from '../messaging/failure';
import {
  runWithCorrelationContext,
  withCorrelationContext,
} from '../observability/correlation-context';
import { MetricsService } from '../observability/metrics.service';
import { DbosSettlementWorkflowRuntime } from './dbos-settlement-workflow-runtime';
import { SettlementWorkflowEngine } from './settlement-workflow.engine';
import {
  SettlementWorkflowHandle,
  SettlementWorkflowInput,
  SettlementWorkflowResult,
  SETTLEMENT_WORKFLOW_NAME,
  settlementWorkflowId,
} from './settlement-workflow.types';

export interface SettlementWorkflowRuntime {
  start(input: SettlementWorkflowInput): Promise<SettlementWorkflowHandle>;
}

export class LocalSettlementWorkflowRuntime
  implements SettlementWorkflowRuntime
{
  private readonly runs = new Map<string, Promise<SettlementWorkflowResult>>();

  constructor(
    private readonly engine: SettlementWorkflowEngine,
    private readonly metrics?: MetricsService,
  ) {}

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
    } else {
      this.metrics?.recordWorkflowRecovery(SETTLEMENT_WORKFLOW_NAME);
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
  private readonly localRuntime: LocalSettlementWorkflowRuntime;
  private dbosRuntime: DbosSettlementWorkflowRuntime | undefined;
  private activeRuntime: SettlementWorkflowRuntime;
  private mode: 'dbos' | 'local' = 'local';

  constructor(
    private readonly engine: SettlementWorkflowEngine,
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly logger: PinoLogger,
    @Optional() private readonly metrics?: MetricsService,
  ) {
    this.localRuntime = new LocalSettlementWorkflowRuntime(engine, metrics);
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
        {
          reason: safeFailureReason(error),
        },
        'DBOS SettlementWorkflow unavailable; using explicit local fallback',
      );
      await dbosRuntime.shutdown().catch(() => undefined);
    }
  }

  start(input: SettlementWorkflowInput): Promise<SettlementWorkflowHandle> {
    const startedAt = Date.now();
    this.metrics?.recordWorkflowStarted(SETTLEMENT_WORKFLOW_NAME);
    return this.startTracked(input, startedAt);
  }

  get runtimeMode(): 'dbos' | 'local' {
    return this.mode;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.dbosRuntime?.shutdown();
  }

  private async startTracked(
    input: SettlementWorkflowInput,
    startedAt: number,
  ): Promise<SettlementWorkflowHandle> {
    try {
      const handle = await runWithCorrelationContext(
        withCorrelationContext(input.correlationId, input.causationId),
        () => this.activeRuntime.start(input),
      );
      if (this.metrics) {
        void handle.getResult().then(
          () =>
            this.metrics?.recordWorkflowCompleted(
              SETTLEMENT_WORKFLOW_NAME,
              Date.now() - startedAt,
            ),
          () =>
            this.metrics?.recordWorkflowFailure(
              SETTLEMENT_WORKFLOW_NAME,
              Date.now() - startedAt,
            ),
        );
      }
      return handle;
    } catch (error) {
      this.metrics?.recordWorkflowFailure(
        SETTLEMENT_WORKFLOW_NAME,
        Date.now() - startedAt,
      );
      throw error;
    }
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

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
import { DbosDeliveryWorkflowRuntime } from './dbos-delivery-workflow-runtime';
import { DeliveryWorkflowEngine } from './delivery-workflow.engine';
import {
  DeliveryWorkflowHandle,
  DeliveryWorkflowInput,
  DeliveryWorkflowResult,
  DELIVERY_WORKFLOW_NAME,
  deliveryWorkflowId,
} from './delivery-workflow.types';

export interface DeliveryWorkflowRuntime {
  start(input: DeliveryWorkflowInput): Promise<DeliveryWorkflowHandle>;
}

export class LocalDeliveryWorkflowRuntime implements DeliveryWorkflowRuntime {
  private readonly runs = new Map<string, Promise<DeliveryWorkflowResult>>();

  constructor(
    private readonly engine: DeliveryWorkflowEngine,
    private readonly metrics?: MetricsService,
  ) {}

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
    } else {
      this.metrics?.recordWorkflowRecovery(DELIVERY_WORKFLOW_NAME);
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
  private readonly localRuntime: LocalDeliveryWorkflowRuntime;
  private dbosRuntime: DbosDeliveryWorkflowRuntime | undefined;
  private activeRuntime: DeliveryWorkflowRuntime;
  private mode: 'dbos' | 'local' = 'local';

  constructor(
    private readonly engine: DeliveryWorkflowEngine,
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly logger: PinoLogger,
    @Optional() private readonly metrics?: MetricsService,
  ) {
    this.localRuntime = new LocalDeliveryWorkflowRuntime(engine, metrics);
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
        {
          reason: safeFailureReason(error),
        },
        'DBOS DeliveryWorkflow unavailable; using explicit local fallback',
      );
      await dbosRuntime.shutdown().catch(() => undefined);
    }
  }

  start(input: DeliveryWorkflowInput): Promise<DeliveryWorkflowHandle> {
    const startedAt = Date.now();
    this.metrics?.recordWorkflowStarted(DELIVERY_WORKFLOW_NAME);
    return this.startTracked(input, startedAt);
  }

  get runtimeMode(): 'dbos' | 'local' {
    return this.mode;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.dbosRuntime?.shutdown();
  }

  private async startTracked(
    input: DeliveryWorkflowInput,
    startedAt: number,
  ): Promise<DeliveryWorkflowHandle> {
    try {
      const handle = await runWithCorrelationContext(
        withCorrelationContext(input.correlationId, input.causationId),
        () => this.activeRuntime.start(input),
      );
      if (this.metrics) {
        void handle.getResult().then(
          () =>
            this.metrics?.recordWorkflowCompleted(
              DELIVERY_WORKFLOW_NAME,
              Date.now() - startedAt,
            ),
          () =>
            this.metrics?.recordWorkflowFailure(
              DELIVERY_WORKFLOW_NAME,
              Date.now() - startedAt,
            ),
        );
      }
      return handle;
    } catch (error) {
      this.metrics?.recordWorkflowFailure(
        DELIVERY_WORKFLOW_NAME,
        Date.now() - startedAt,
      );
      throw error;
    }
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

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
import { DbosPaymentWorkflowRuntime } from './dbos-payment-workflow-runtime';
import { PaymentWorkflowEngine } from './payment-workflow.engine';
import {
  PaymentWorkflowHandle,
  PaymentWorkflowInput,
  PaymentWorkflowResult,
  PAYMENT_WORKFLOW_NAME,
  paymentWorkflowId,
} from './payment-workflow.types';

export interface PaymentWorkflowRuntime {
  start(input: PaymentWorkflowInput): Promise<PaymentWorkflowHandle>;
}

export class LocalPaymentWorkflowRuntime implements PaymentWorkflowRuntime {
  private readonly runs = new Map<string, Promise<PaymentWorkflowResult>>();

  constructor(
    private readonly engine: PaymentWorkflowEngine,
    private readonly metrics?: MetricsService,
  ) {}

  async start(input: PaymentWorkflowInput): Promise<PaymentWorkflowHandle> {
    const workflowId = paymentWorkflowId(
      input.paymentIntentId,
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
      this.metrics?.recordWorkflowRecovery(PAYMENT_WORKFLOW_NAME);
    }

    await result;
    return {
      workflowId,
      runtime: 'local',
      getResult: () => result as Promise<PaymentWorkflowResult>,
    };
  }
}

@Injectable()
export class PaymentWorkflowRuntimeService
  implements PaymentWorkflowRuntime, OnModuleInit, OnApplicationShutdown
{
  private readonly localRuntime: LocalPaymentWorkflowRuntime;
  private dbosRuntime: DbosPaymentWorkflowRuntime | undefined;
  private activeRuntime: PaymentWorkflowRuntime;
  private mode: 'dbos' | 'local' = 'local';

  constructor(
    private readonly engine: PaymentWorkflowEngine,
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly logger: PinoLogger,
    @Optional() private readonly metrics?: MetricsService,
  ) {
    this.localRuntime = new LocalPaymentWorkflowRuntime(engine, metrics);
    this.activeRuntime = this.localRuntime;
  }

  async onModuleInit(): Promise<void> {
    if (!this.shouldUseDbos()) {
      return;
    }

    const dbosRuntime = new DbosPaymentWorkflowRuntime(this.engine, this.pool);
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
        'DBOS PaymentWorkflow unavailable; using explicit local fallback',
      );
      await dbosRuntime.shutdown().catch(() => undefined);
    }
  }

  start(input: PaymentWorkflowInput): Promise<PaymentWorkflowHandle> {
    const startedAt = Date.now();
    this.metrics?.recordWorkflowStarted(PAYMENT_WORKFLOW_NAME);
    return this.startTracked(input, startedAt);
  }

  get runtimeMode(): 'dbos' | 'local' {
    return this.mode;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.dbosRuntime?.shutdown();
  }

  private async startTracked(
    input: PaymentWorkflowInput,
    startedAt: number,
  ): Promise<PaymentWorkflowHandle> {
    try {
      const handle = await runWithCorrelationContext(
        withCorrelationContext(input.correlationId, input.causationId),
        () => this.activeRuntime.start(input),
      );
      if (this.metrics) {
        void handle.getResult().then(
          () =>
            this.metrics?.recordWorkflowCompleted(
              PAYMENT_WORKFLOW_NAME,
              Date.now() - startedAt,
            ),
          () =>
            this.metrics?.recordWorkflowFailure(
              PAYMENT_WORKFLOW_NAME,
              Date.now() - startedAt,
            ),
        );
      }
      return handle;
    } catch (error) {
      this.metrics?.recordWorkflowFailure(
        PAYMENT_WORKFLOW_NAME,
        Date.now() - startedAt,
      );
      throw error;
    }
  }

  private shouldUseDbos(): boolean {
    const configured =
      process.env.PAYMENT_WORKFLOW_RUNTIME?.trim().toLowerCase();
    if (configured === 'local') {
      return false;
    }
    if (configured === 'dbos') {
      return true;
    }
    return process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true';
  }
}

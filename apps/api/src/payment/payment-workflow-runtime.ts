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
import { DbosPaymentWorkflowRuntime } from './dbos-payment-workflow-runtime';
import { PaymentWorkflowEngine } from './payment-workflow.engine';
import {
  PaymentWorkflowHandle,
  PaymentWorkflowInput,
  PaymentWorkflowResult,
  paymentWorkflowId,
} from './payment-workflow.types';

export interface PaymentWorkflowRuntime {
  start(input: PaymentWorkflowInput): Promise<PaymentWorkflowHandle>;
}

export class LocalPaymentWorkflowRuntime implements PaymentWorkflowRuntime {
  private readonly runs = new Map<string, Promise<PaymentWorkflowResult>>();

  constructor(private readonly engine: PaymentWorkflowEngine) {}

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
  private readonly logger = new Logger(PaymentWorkflowRuntimeService.name);
  private readonly localRuntime: LocalPaymentWorkflowRuntime;
  private dbosRuntime: DbosPaymentWorkflowRuntime | undefined;
  private activeRuntime: PaymentWorkflowRuntime;
  private mode: 'dbos' | 'local' = 'local';

  constructor(
    private readonly engine: PaymentWorkflowEngine,
    @Inject(DATABASE_POOL) private readonly pool: Pool,
  ) {
    this.localRuntime = new LocalPaymentWorkflowRuntime(engine);
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
        `DBOS PaymentWorkflow unavailable; using explicit local fallback: ${safeFailureReason(error)}`,
      );
      await dbosRuntime.shutdown().catch(() => undefined);
    }
  }

  start(input: PaymentWorkflowInput): Promise<PaymentWorkflowHandle> {
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

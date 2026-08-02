import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../db/drizzle.module';
import { PERFORMANCE_STORE } from '../performance/performance.constants';
import {
  PerformanceHealth,
  PerformanceStorePort,
} from '../performance/performance.types';
import { MetricsService } from '../observability/metrics.service';
import { TelemetryStatusService } from '../observability/telemetry';

export type HealthResponse = {
  status: 'ok' | 'degraded' | 'error';
  application: {
    status: 'up';
  };
  database: {
    status: 'up' | 'down';
  };
  redis: {
    status: 'up' | 'unavailable' | 'disabled';
    mode: 'redis' | 'memory';
  };
};

@Injectable()
export class HealthService {
  constructor(
    private readonly databaseService: DatabaseService,
    @Inject(PERFORMANCE_STORE)
    private readonly performanceStore: PerformanceStorePort,
    private readonly telemetryStatus: TelemetryStatusService,
    private readonly metrics: MetricsService,
  ) {}

  async check(): Promise<HealthResponse> {
    const [databaseIsHealthy, redis] = await Promise.all([
      this.databaseService.isHealthy(),
      this.performanceStore.health().catch(
        (): PerformanceHealth => ({
          status: 'unavailable',
          mode: 'memory',
        }),
      ),
    ]);
    const observability = this.telemetryStatus.health();
    const status = !databaseIsHealthy
      ? 'error'
      : redis.status === 'up'
        ? 'ok'
        : 'degraded';

    this.metrics.setHealth('database', databaseIsHealthy ? 'up' : 'down');
    this.metrics.setHealth(
      'redis',
      redis.status === 'up'
        ? 'up'
        : redis.status === 'disabled'
          ? 'disabled'
          : 'degraded',
    );
    this.metrics.setHealth(
      'observability',
      observability.status === 'up'
        ? 'up'
        : observability.status === 'disabled'
          ? 'disabled'
          : 'degraded',
    );
    this.metrics.setHealth(
      'api',
      status === 'ok' ? 'up' : status === 'error' ? 'down' : 'degraded',
    );

    return {
      status,
      application: {
        status: 'up',
      },
      database: {
        status: databaseIsHealthy ? 'up' : 'down',
      },
      redis,
    };
  }
}

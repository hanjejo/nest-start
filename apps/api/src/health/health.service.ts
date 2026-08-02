import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../db/drizzle.module';
import { PERFORMANCE_STORE } from '../performance/performance.constants';
import {
  PerformanceHealth,
  PerformanceStorePort,
} from '../performance/performance.types';

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

    return {
      status: !databaseIsHealthy
        ? 'error'
        : redis.status === 'up'
          ? 'ok'
          : 'degraded',
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

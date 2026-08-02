import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../db/drizzle.module';

export type HealthResponse = {
  status: 'ok' | 'error';
  application: {
    status: 'up';
  };
  database: {
    status: 'up' | 'down';
  };
};

@Injectable()
export class HealthService {
  constructor(private readonly databaseService: DatabaseService) {}

  async check(): Promise<HealthResponse> {
    const databaseIsHealthy = await this.databaseService.isHealthy();

    return {
      status: databaseIsHealthy ? 'ok' : 'error',
      application: {
        status: 'up',
      },
      database: {
        status: databaseIsHealthy ? 'up' : 'down',
      },
    };
  }
}

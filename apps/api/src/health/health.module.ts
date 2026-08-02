import { Module } from '@nestjs/common';
import { PerformanceModule } from '../performance/performance.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [PerformanceModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}

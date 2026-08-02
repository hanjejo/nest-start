import {
  Global,
  Module,
  MiddlewareConsumer,
  OnApplicationShutdown,
  RequestMethod,
} from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { CorrelationMiddleware } from './correlation.middleware';
import { createPinoHttpOptions } from './logger';
import { HttpMetricsMiddleware } from './metrics.middleware';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { shutdownTelemetry, TelemetryStatusService } from './telemetry';

class TelemetryLifecycle implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await shutdownTelemetry();
  }
}

@Global()
@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: createPinoHttpOptions(),
    }),
  ],
  controllers: [MetricsController],
  providers: [
    MetricsService,
    TelemetryStatusService,
    TelemetryLifecycle,
    HttpMetricsMiddleware,
  ],
  exports: [MetricsService, TelemetryStatusService],
})
export class ObservabilityModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(CorrelationMiddleware, HttpMetricsMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}

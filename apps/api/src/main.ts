import {
  initializeTelemetry,
  TelemetryStatusService,
} from './observability/telemetry';

async function bootstrap() {
  initializeTelemetry();
  const [{ NestFactory }, { Logger: PinoNestLogger }, { AppModule }] =
    await Promise.all([
      import('@nestjs/core'),
      import('nestjs-pino'),
      import('./app/app.module'),
    ]);
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(PinoNestLogger));
  app.enableCors({
    origin: ['http://localhost:4200', 'http://127.0.0.1:4200'],
  });
  app.setGlobalPrefix('api');
  const port = process.env.PORT || 3000;
  await app.listen(port);
  app.get(PinoNestLogger).log(
    {
      port,
      observability: app.get(TelemetryStatusService).health().status,
    },
    'API listening',
  );
}

bootstrap().catch(() => {
  process.stderr.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 50,
      service: process.env.OTEL_SERVICE_NAME ?? 'coffee-order-api',
      version: process.env.OTEL_SERVICE_VERSION ?? 'local',
      msg: 'API bootstrap failed',
    })}\n`,
  );
  process.exitCode = 1;
});

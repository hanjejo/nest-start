export const DEFAULT_SERVICE_NAME = 'coffee-order-api';
export const DEFAULT_SERVICE_VERSION = 'local';

export type ObservabilityConfig = Readonly<{
  serviceName: string;
  serviceVersion: string;
  otelSdkDisabled: boolean;
  otlpEndpoint?: string;
  otlpTracesEndpoint?: string;
  otlpMetricsEndpoint?: string;
}>;

function booleanFromEnvironment(
  value: string | undefined,
  fallback: boolean,
): boolean {
  if (value === undefined) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function nonEmpty(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized ? normalized : fallback;
}

export function loadObservabilityConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ObservabilityConfig {
  const otlpEndpoint =
    environment.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() || undefined;
  return {
    serviceName: nonEmpty(
      environment.OTEL_SERVICE_NAME ?? environment.SERVICE_NAME,
      DEFAULT_SERVICE_NAME,
    ),
    serviceVersion: nonEmpty(
      environment.OTEL_SERVICE_VERSION ??
        environment.SERVICE_VERSION ??
        environment.APP_VERSION,
      DEFAULT_SERVICE_VERSION,
    ),
    otelSdkDisabled: booleanFromEnvironment(
      environment.OTEL_SDK_DISABLED,
      false,
    ),
    otlpEndpoint,
    otlpTracesEndpoint:
      environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim() || otlpEndpoint,
    otlpMetricsEndpoint:
      environment.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT?.trim() || otlpEndpoint,
  };
}

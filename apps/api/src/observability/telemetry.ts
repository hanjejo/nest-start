import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { NodeSDK } from '@opentelemetry/sdk-node';
import type { NodeSDKConfiguration } from '@opentelemetry/sdk-node';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { Injectable } from '@nestjs/common';
import {
  DEFAULT_SERVICE_NAME,
  DEFAULT_SERVICE_VERSION,
  loadObservabilityConfig,
  ObservabilityConfig,
} from './observability.config';

export type TelemetryState = Readonly<{
  status: 'up' | 'degraded' | 'disabled';
  sdk: 'enabled' | 'disabled';
  exporter: 'configured' | 'degraded' | 'disabled';
}>;

export type TelemetrySdkFactory = (
  options: Partial<NodeSDKConfiguration>,
) => NodeSDK;

const disabledState: TelemetryState = {
  status: 'disabled',
  sdk: 'disabled',
  exporter: 'disabled',
};

let telemetryState: TelemetryState = disabledState;
let telemetrySdk: NodeSDK | undefined;

function endpointForSignal(endpoint: string, signal: 'traces' | 'metrics') {
  const parsed = new URL(endpoint);
  const signalPath = `/v1/${signal}`;
  if (parsed.pathname.endsWith(signalPath)) {
    return parsed.toString();
  }

  parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}${signalPath}`;
  parsed.search = '';
  return parsed.toString();
}

function createInstrumentations() {
  return getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-http': { enabled: true },
    '@opentelemetry/instrumentation-express': { enabled: true },
    '@opentelemetry/instrumentation-pg': { enabled: true },
    '@opentelemetry/instrumentation-amqplib': { enabled: true },
    '@opentelemetry/instrumentation-nestjs-core': { enabled: true },
    '@opentelemetry/instrumentation-redis': { enabled: true },
    '@opentelemetry/instrumentation-pino': { enabled: false },
    '@opentelemetry/instrumentation-fs': { enabled: false },
  });
}

export function createTelemetryOptions(
  config: ObservabilityConfig,
): Partial<NodeSDKConfiguration> {
  const tracesEndpoint = config.otlpTracesEndpoint ?? config.otlpEndpoint;
  const metricsEndpoint = config.otlpMetricsEndpoint ?? config.otlpEndpoint;
  const baseOptions: Partial<NodeSDKConfiguration> = {
    serviceName: config.serviceName,
    instrumentations: createInstrumentations(),
    logRecordProcessors: [],
  };

  return {
    ...baseOptions,
    ...(tracesEndpoint
      ? {
          traceExporter: new OTLPTraceExporter({
            url: endpointForSignal(tracesEndpoint, 'traces'),
          }),
        }
      : { spanProcessors: [] }),
    ...(metricsEndpoint
      ? {
          metricReaders: [
            new PeriodicExportingMetricReader({
              exporter: new OTLPMetricExporter({
                url: endpointForSignal(metricsEndpoint, 'metrics'),
              }),
              exportIntervalMillis: 15_000,
            }),
          ],
        }
      : { metricReaders: [] }),
  };
}

export function getTelemetryState(): TelemetryState {
  return telemetryState;
}

export function initializeTelemetry(
  config: ObservabilityConfig = loadObservabilityConfig(),
  sdkFactory: TelemetrySdkFactory = (options) => new NodeSDK(options),
): TelemetryState {
  if (telemetrySdk || telemetryState.status === 'up') {
    return telemetryState;
  }

  if (config.otelSdkDisabled) {
    telemetryState = disabledState;
    return telemetryState;
  }

  try {
    const sdk = sdkFactory(createTelemetryOptions(config));
    sdk.start();
    telemetrySdk = sdk;
    telemetryState =
      config.otlpEndpoint ||
      config.otlpTracesEndpoint ||
      config.otlpMetricsEndpoint
        ? {
            status: 'up',
            sdk: 'enabled',
            exporter: 'configured',
          }
        : {
            status: 'disabled',
            sdk: 'enabled',
            exporter: 'disabled',
          };
  } catch {
    telemetrySdk = undefined;
    telemetryState = {
      status: 'degraded',
      sdk: 'disabled',
      exporter: 'degraded',
    };
  }

  return telemetryState;
}

export async function shutdownTelemetry(): Promise<void> {
  const sdk = telemetrySdk;
  telemetrySdk = undefined;
  telemetryState = disabledState;
  await sdk?.shutdown().catch(() => undefined);
}

export type ObservabilityHealth = Readonly<{
  status: TelemetryState['status'];
  sdk: TelemetryState['sdk'];
  exporter: TelemetryState['exporter'];
}>;

@Injectable()
export class TelemetryStatusService {
  health(): ObservabilityHealth {
    const state = getTelemetryState();
    return {
      status: state.status,
      sdk: state.sdk,
      exporter: state.exporter,
    };
  }
}

export const DEFAULT_TELEMETRY_SERVICE = {
  name: DEFAULT_SERVICE_NAME,
  version: DEFAULT_SERVICE_VERSION,
} as const;

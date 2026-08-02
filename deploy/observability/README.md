# Local LGTM observability

This directory contains an optional local stack for the API's OpenTelemetry
signals and Pino container logs. It is not required for API startup:

```sh
docker compose -f deploy/observability/docker-compose.yaml up -d
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 pnpm nx serve api
```

The Collector sends traces to Tempo, metrics to Mimir remote write, and
structured logs from the container log file receiver to Loki. The Grafana
dashboard is provisioned automatically at `http://localhost:3001`.

The API's `/api/metrics` endpoint is intentionally operationally safe: it
contains only bounded route, component, outcome, queue, and workflow labels,
not request IDs, domain IDs, credentials, or payloads. Restrict it at the
deployment ingress when it is exposed outside a trusted network.

`alert-rules.yaml` is Prometheus/Mimir-compatible and covers API errors and
latency, Outbox/Inbox backlog and Dead Letters, dependency health, and
workflow failures. Local Loki, Tempo, and Mimir data retention is seven days.
Without `OTEL_EXPORTER_OTLP_ENDPOINT` (or a signal-specific OTLP endpoint), the
API keeps instrumentation in-process and does not claim that traces or metrics
were exported. No credentials or application secrets are included in these
files.

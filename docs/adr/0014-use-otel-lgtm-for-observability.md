---
status: accepted
---

# Use OpenTelemetry and LGTM for observability

Services emit OpenTelemetry signals and an OpenTelemetry Collector routes them to the LGTM stack: Loki for logs, Grafana for visualization, Tempo for traces, and Mimir for metrics. LGTM is an observability platform, not an application data store; PostgreSQL remains the only persisted application database.

---
status: accepted
---

# Define the v1 LGTM observability scope

OpenTelemetry traces cover HTTP, RabbitMQ, database, and provider calls; metrics cover API health, queue backlog, Outbox/DLQ, PostgreSQL, and Redis; structured JSON logs carry `traceId`, `spanId`, `correlationId`, and `causationId`. Grafana dashboards cover API, RabbitMQ, PostgreSQL, and Outbox/Inbox, with alerts for errors, latency, backlog, Dead Letters, and Outbox delay; local retention is seven days.

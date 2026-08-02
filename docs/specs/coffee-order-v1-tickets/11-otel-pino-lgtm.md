# 11 — OpenTelemetry, Pino, and LGTM

**What to build:** A customer order and payment flow produces correlated JSON logs, traces, and metrics that are visible in LGTM dashboards and trigger operational alerts.

**Blocked by:** 06 — Outbox, Inbox, and RabbitMQ transport; 07 — PaymentWorkflow.

**Status:** ready-for-agent (local draft; not published to GitHub)

- [ ] HTTP, RabbitMQ, database, and provider calls produce trace spans.
- [ ] Pino emits JSON logs containing trace and correlation identifiers.
- [ ] Metrics expose API health, queue backlog, Outbox age, DLQ count, PostgreSQL, and Redis behavior.
- [ ] Grafana dashboards show API, RabbitMQ, PostgreSQL, and Outbox/Inbox health.
- [ ] Alerts cover errors, latency, backlog, Dead Letters, and Outbox delay.
- [ ] Local observability data follows seven-day retention.

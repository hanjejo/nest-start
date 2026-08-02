# 17 — Performance and resilience verification

**What to build:** The service has measured performance and recovery behavior under representative order traffic, dependency failures, queue backlog, pod restarts, and workflow interruption.

**Blocked by:** 07 — PaymentWorkflow; 09 — SettlementWorkflow; 11 — OpenTelemetry, Pino, and LGTM; 12 — Kubernetes platform integration; 14 — CI GitOps pipeline.

**Status:** ready-for-agent (local draft; not published to GitHub)

- [ ] Representative HTTP and Order flows have repeatable load scenarios.
- [ ] API latency, error rate, queue depth, Outbox age, and workflow completion are measured.
- [ ] PostgreSQL, RabbitMQ, Redis, provider, and DBOS failure scenarios are exercised.
- [ ] Pod restart and consumer crash recovery are verified.
- [ ] Duplicate events and retries do not duplicate business effects.
- [ ] Synchronous API p95 stays at or below 300 ms excluding provider wait.
- [ ] Asynchronous workflow p95 stays at or below 30 seconds when no provider action is required.
- [ ] SLO thresholds and alert limits are recorded from observed behavior.

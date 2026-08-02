# Production Readiness Contract

Seam-level tests are necessary but do not complete a production service. A Ticket is complete only when its user-visible behavior and operational behavior are both demonstrated.

## Definition of done for every Ticket

- Functional behavior is covered by the highest useful external test seam.
- PostgreSQL changes have forward migration, rollback consideration, and data compatibility notes.
- Retryable work has an idempotency key and a bounded failure path.
- Persistent changes have an audit or failure record when operational investigation needs one.
- Logs are structured with `traceId`, `spanId`, `correlationId`, and `causationId` where available.
- Metrics and traces cover the new request, event, workflow, and dependency edges.
- Health, Readiness, and Liveness behavior is defined.
- Authorization and Store ID scope are tested at the API boundary.
- Secrets and personally identifiable information are not exposed in logs, events, images, or Git.
- Failure behavior is documented in a runbook.
- CI gates the behavior, migration, security, and deployment checks relevant to the Ticket.
- The change can be deployed, observed, rolled back, and recovered without manual database editing.

## Service-level indicators

The implementation must measure these indicators before production claims are made:

- HTTP availability and error rate
- HTTP latency by route and outcome
- Order placement success rate
- Payment workflow completion, retry, timeout, and failure rate
- Delivery workflow completion and failure rate
- Settlement workflow completion and duplicate-prevention rate
- Outbox age and publish failure count
- RabbitMQ queue depth, retry count, and Dead Letter count
- Inbox duplicate count and processing latency
- PostgreSQL connection saturation, transaction failure, and migration status
- Redis hit rate, error rate, and fallback count
- DBOS workflow recovery and retry-exhaustion count

Target SLO, RTO, and RPO values remain explicit release decisions rather than implicit assumptions.

## Data protection and recovery

- PostgreSQL uses WAL/PITR-capable backup configuration for the target environment.
- Backup success and backup age are observable.
- Restore is tested against a clean environment, not only backup creation.
- Restore verification checks schema, migrations, Orders, Payment records, Outbox, Inbox, Audit, and Failure records.
- RabbitMQ is treated as transport, not the only copy of an event.
- Redis can be recreated from PostgreSQL and Catalog state.
- Recovery procedures state how to pause consumers, replay Outbox records, handle duplicates, and resume workflows.

## Security and access

- Passwords and refresh credentials are stored only as hashes.
- Refresh Token reuse and suspicious authentication events are auditable.
- Every protected command has an explicit Permission.
- Every store-scoped command verifies Store ID ownership.
- Platform administrator actions are auditable.
- Secret values are injected at runtime and never committed in plaintext.
- Dependencies and container images are scanned before promotion.
- Sensitive request, payment, address, and credential data is redacted from logs and telemetry.

## Release and rollback

- CI runs tests, type checks, migration checks, dependency and image checks.
- Images are immutable and traceable to a source revision.
- Argo CD reports sync and health state.
- A failed rollout stops promotion.
- Rollback uses a known Git revision and compatible database migration strategy.
- Deployment runbooks include startup order, dependency failure, migration failure, and rollback handling.

## Failure drills

Before calling a production-ready slice complete, exercise the relevant failure path:

- PostgreSQL unavailable during API startup
- Transaction rollback after domain mutation begins
- Outbox publish failure
- RabbitMQ redelivery and duplicate delivery
- Consumer crash before ACK
- Provider timeout and duplicate Callback
- DBOS process restart during a Step
- Redis unavailable during a cacheable request
- Secret decryption or configuration failure
- Pod restart during an in-flight request

Record observed behavior and recovery steps with the Ticket.

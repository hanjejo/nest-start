# Context Map

This repository uses a multi-context domain-document layout.

Context boundaries are defined below and described by the linked Context glossaries. System-wide decisions live under `docs/adr/`; cross-Context events, states, and workflows live under `docs/domain/`.

## Confirmed decisions

- v1 supports multiple stores.
- Each order belongs to exactly one store.
- Store Management owns stores, operating status, hours, and store policies; Catalog owns products, prices, and menu visibility.
- Ordering references `Store ID` and product snapshots without owning Store or Catalog tables.
- Payment owns customer charge collection; Settlement owns the store payable ledger, including fees, refunds, and adjustments.
- Settlement becomes eligible after order completion; external bank transfers and provider settlement APIs are out of scope for v1.
- Orders may be cancelled before `PREPARING`; paid cancellations start Refund Workflow, and normal customer cancellation is unavailable after preparation begins.
- Payment owns payment intents and payment state; a `PaymentProvider` port isolates provider adapters, with a fake provider used in v1.
- Ordering cannot access Payment tables directly; it communicates through commands and integration events.
- Delivery owns one delivery per order, including the address snapshot and delivery state; v1 uses manual or simulated status changes behind a `DeliveryProvider` port.
- Identity and Access uses email/password credentials, short-lived access tokens, refresh-token rotation, and server-side refresh sessions that can be revoked on logout.
- Logout revokes the current PostgreSQL Refresh Session and clears the client token; Access Tokens remain short-lived, and logout-all revokes every Refresh Session without requiring a Redis denylist.
- Identity and Access owns roles, permissions, and assignments: `customer`, `store-operator`, `store-admin`, and `platform-admin`.
- Store operator and store admin permissions are scoped by `Store ID`; platform admin permissions are global, and APIs authorize by permission rather than role name.
- Ordering owns `AWAITING_PAYMENT`, `CONFIRMED`, `PREPARING`, `READY_FOR_DELIVERY`, `DELIVERING`, `COMPLETED`, and `CANCELLED`; Payment, Delivery, and Settlement own their own state machines.
- Contexts do not duplicate one another's lifecycle state; cross-context state changes travel through integration events.
- Integration Event envelopes contain `eventId`, `eventType`, `eventVersion`, `occurredAt`, `producer`, `aggregateId`, `correlationId`, `causationId`, and `payload`; Outbox stores the complete envelope.
- Domain Events remain Context-internal; Integration Events are immutable, additive changes keep the Version, and breaking changes use a new event type or Version.
- Aggregate changes and Outbox records commit atomically; Dispatcher delivery is at-least-once, Consumers deduplicate through Inbox records, and failed messages use exponential backoff before Dead Letter handling.
- Inbox recording and Consumer state changes commit atomically; distributed transactions are not used.
- PostgreSQL is the transactional store for domain data, Outbox, and Inbox; Contexts own their tables, and each Context's state change plus Outbox work stays in one transaction.
- PostgreSQL is the only persisted application data store in v1; durable audit and failure records use append-only PostgreSQL tables, while operational logs remain structured stdout/container logs.
- Redis is a non-authoritative performance layer for Catalog cache, rate limits, and short-lived temporary values; business state, authentication sessions, and event deduplication remain in PostgreSQL.
- Local `kind` secrets use encrypted `SOPS + age` manifests; AWS uses External Secrets Operator with AWS Secrets Manager, and plaintext Secrets never enter Git.
- Kubernetes `Service` and CoreDNS provide Service Discovery; internal dependencies use `ClusterIP` DNS, external HTTP uses Ingress or Gateway, and every workload defines Readiness and Liveness Probes.
- GitOps desired state lives in this Nx repository under `deploy/k8s`, with shared `base` manifests and `local`, `staging`, and `production` overlays; Argo CD watches an environment overlay, and promotion happens through Git changes.
- GitHub Actions runs pnpm validation, type checks, tests, image build and push, and GitOps desired-state updates; it never applies Kubernetes manifests directly.
- LGTM observes HTTP, RabbitMQ, database, and provider calls; metrics cover API health, queue backlog, Outbox/DLQ, PostgreSQL, and Redis, while structured logs carry trace and correlation identifiers with seven-day local retention.
- v1 operational targets are 99.9% monthly API availability, synchronous API p95 at or below 300 ms excluding provider wait, asynchronous workflow p95 at or below 30 seconds without provider action, RPO at most 15 minutes, and RTO within 60 minutes.
- OpenTelemetry SDK and instrumentation provide telemetry, while Pino emits structured JSON logs with trace and correlation context to stdout for Collector export into LGTM.
- DBOS provides PostgreSQL-backed durable execution for `PaymentWorkflow`, `DeliveryWorkflow`, and `SettlementWorkflow`; it does not replace normal Aggregate transactions, Outbox/Inbox, or RabbitMQ.
- DBOS workflows run in the NestJS API process in v1; the SDK remains external to Webpack, uses the existing PostgreSQL system database, and is not split into a separate Worker unless load isolation later requires it.
- Docker Compose supports fast local application development; `kind` runs the full Kubernetes integration stack, and Terraform AWS follows after the application specification is stable.
- RabbitMQ is the Integration Event transport; PostgreSQL Outbox remains the canonical event record, and consumers acknowledge messages only after Inbox and state changes commit.
- RabbitMQ uses one durable `integration.events` topic exchange, Context-specific durable queues, Event Type routing keys, TTL retry queues, and Context-specific Dead Letter Queues.
- Events have two layers: transaction-scoped domain events and cross-context integration events.
- Integration events publish after commit through the outbox and require idempotent consumers.

| Context             | Context document                              | Status  |
| ------------------- | --------------------------------------------- | ------- |
| Identity and Access | `apps/api/src/identity-and-access/CONTEXT.md` | Defined |
| Store Management    | `apps/api/src/store-management/CONTEXT.md`    | Defined |
| Catalog             | `apps/api/src/catalog/CONTEXT.md`             | Defined |
| Ordering            | `apps/api/src/ordering/CONTEXT.md`            | Defined |
| Payment             | `apps/api/src/payment/CONTEXT.md`             | Defined |
| Settlement          | `apps/api/src/settlement/CONTEXT.md`          | Defined |
| Delivery            | `apps/api/src/delivery/CONTEXT.md`            | Defined |

## Relationships

- **Identity and Access → Store Management**: Store Assignments authorize Store Operator and Store Administrator actions.
- **Identity and Access → Ordering**: Customer identity and permissions authorize Order commands; Ordering stores the identity reference only.
- **Store Management → Catalog**: Store Status, Operating Hours, and Store Policies determine whether Catalog data is sellable.
- **Store Management → Ordering**: Store Status, Operating Hours, and Store Policies determine whether a new Order is accepted.
- **Catalog → Ordering**: Ordering validates current Product and Price data, then captures a Product Snapshot.
- **Ordering → Payment**: `OrderPlaced` starts PaymentWorkflow.
- **Payment → Ordering**: `PaymentSucceeded`, `PaymentFailed`, `PaymentExpired`, and `PaymentRefunded` drive Order decisions.
- **Ordering → Delivery**: `OrderConfirmed` creates one Delivery; `OrderReadyForDelivery` starts delivery progress.
- **Delivery → Ordering**: `DeliveryStarted`, `DeliveryCompleted`, and `DeliveryFailed` update Order State.
- **Ordering → Settlement**: `OrderCompleted` starts SettlementWorkflow.
- **Payment → Settlement**: Payment outcomes and refunds provide facts through Integration Events; Settlement never reads Payment tables.

## Domain artifacts

- [State Models](./docs/domain/state-models.md)
- [Integration Event Catalog](./docs/domain/event-catalog.md)
- [Domain Workflows](./docs/domain/workflows.md)
- [Production Readiness Contract](./docs/operations/production-readiness.md)

## Still unresolved


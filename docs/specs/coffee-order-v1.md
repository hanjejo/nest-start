# Coffee Order v1 Specification

## Problem Statement

The project needs a multi-store coffee ordering platform that exercises DDD, Event-Driven Architecture, and Modular Monolith design without losing transactional safety. The platform must cover authentication, authorization, ordering, payment, settlement, delivery, observability, and Kubernetes operations while remaining runnable locally.

## Solution

Build a NestJS and React Nx monorepo organized around bounded contexts. PostgreSQL is the transactional source of truth. Contexts publish transaction-safe Integration Events through a PostgreSQL Outbox and RabbitMQ, and consumers use Inbox records for idempotent processing. RabbitMQ, Redis, OpenTelemetry, LGTM, Argo CD, and `kind` provide the local platform capabilities without changing domain ownership.

The platform supports multiple stores, but each Order belongs to exactly one Store. Payment and Delivery use provider ports with fake v1 adapters. DBOS is reserved for durable workflows that need recovery, retries, timers, or multi-step guarantees.

## User Stories

### Customer

1. As a customer, I want to register with an email and password, so that I can create orders.
2. As a customer, I want to log in, so that I can access protected features.
3. As a customer, I want to refresh an expired access token, so that I can continue a session without logging in again.
4. As a customer, I want to log out from the current device, so that its refresh session is revoked.
5. As a customer, I want to log out from all devices, so that every active refresh session is revoked.
6. As a customer, I want to browse stores, so that I can choose where to order.
7. As a customer, I want to browse a store's visible catalog, so that I can select coffee products.
8. As a customer, I want each order to belong to one store, so that pricing, preparation, delivery, and settlement remain unambiguous.
9. As a customer, I want to create an order from a store's catalog, so that the selected product and price are captured.
10. As a customer, I want to see an order awaiting payment, so that I know what action is required.
11. As a customer, I want to pay for an order, so that the store can begin fulfillment.
12. As a customer, I want payment failures to be visible, so that I can retry or abandon the order.
13. As a customer, I want to see order preparation and delivery status, so that I know when to expect the order.
14. As a customer, I want to cancel an eligible order, so that I am not charged for an order I no longer need.
15. As a customer, I want completed orders to remain viewable, so that I can review my purchase history.

### Store operator

16. As a store operator, I want to view orders for my assigned Store ID, so that I can prepare them.
17. As a store operator, I want to move an order through preparation states, so that the customer sees accurate progress.
18. As a store operator, I want to update delivery progress, so that the customer sees fulfillment status.
19. As a store operator, I want to be unable to access another store's orders, so that store data remains isolated.
20. As a store operator, I want failed payment and delivery events to be retried safely, so that transient failures do not duplicate work.

### Store administrator

21. As a store administrator, I want to manage store operating status, so that customers cannot order from a closed store.
22. As a store administrator, I want to manage store hours and policies, so that ordering rules match store operations.
23. As a store administrator, I want to manage products and prices for my store, so that the catalog is accurate.
24. As a store administrator, I want to view store settlement records, so that I can reconcile expected payouts.
25. As a store administrator, I want permissions scoped to my Store ID, so that administrative actions cannot cross store boundaries.

### Platform administrator

26. As a platform administrator, I want global permissions, so that I can operate the entire multi-store platform.
27. As a platform administrator, I want to inspect failed workflows, Outbox messages, and Dead Letter records, so that I can recover operational failures.
28. As a platform administrator, I want audit records for sensitive changes, so that administrative actions are traceable.

### System and operations

29. As the system, I want Aggregate state and Outbox records committed atomically, so that committed business changes are publishable.
30. As the system, I want consumers to record Inbox event IDs with state changes, so that duplicate deliveries are harmless.
31. As the system, I want RabbitMQ messages acknowledged only after consumer commits, so that failed work is redelivered.
32. As the system, I want retries and Dead Letter handling, so that poison messages do not block healthy work.
33. As the system, I want structured logs correlated with traces, so that failures can be investigated across Contexts.
34. As the system, I want durable workflows to resume after process failure, so that long-running payment, delivery, or settlement work is not lost.
35. As an operator, I want GitOps deployments reconciled by Argo CD, so that cluster state is auditable and reproducible.
36. As an operator, I want secrets encrypted before entering Git, so that deployment configuration does not expose credentials.
37. As an operator, I want local Compose and `kind` environments, so that application development and platform integration remain fast and repeatable.

## Implementation Decisions

### Contexts and ownership

- Identity and Access owns credentials, refresh sessions, roles, permissions, and assignments.
- Store Management owns stores, operating status, hours, and store policies.
- Catalog owns products, prices, and menu visibility.
- Ordering owns Orders, Store ID association, product snapshots, and the Order lifecycle.
- Payment owns payment intents and payment state.
- Settlement owns the store payable ledger, including fees, refunds, and adjustments.
- Delivery owns one Delivery per Order, the address snapshot, and delivery state.
- Contexts do not access one another's tables directly.
- Ordering stores the selected Store ID and product snapshots; it does not own Store or Catalog data.

### Order lifecycle

Ordering owns these states:

`AWAITING_PAYMENT` → `CONFIRMED` → `PREPARING` → `READY_FOR_DELIVERY` → `DELIVERING` → `COMPLETED`

`CANCELLED` is a terminal state reached only through an allowed cancellation command. The v1 policy allows cancellation before preparation begins; a paid cancellation starts a refund workflow, and normal customer cancellation is unavailable after `PREPARING`. Payment, Delivery, and Settlement keep their own state machines and do not duplicate their state inside Ordering.

### Events and messaging

- Domain Events are transaction-scoped and Context-internal.
- Integration Events are immutable cross-Context contracts.
- Integration Event envelopes contain `eventId`, `eventType`, `eventVersion`, `occurredAt`, `producer`, `aggregateId`, `correlationId`, `causationId`, and `payload`.
- Additive payload changes retain the event version; breaking changes use a new event type or version.
- PostgreSQL Outbox stores the complete envelope.
- RabbitMQ uses a durable `integration.events` topic exchange, Context-specific durable queues, Event Type routing keys, TTL retry queues, and Context-specific Dead Letter Queues.
- Consumers acknowledge messages only after Inbox recording and state changes commit.

### Transactions and reliability

- Aggregate changes and Outbox writes use one PostgreSQL transaction.
- Inbox event IDs and consumer state changes use one PostgreSQL transaction.
- Delivery is at-least-once; consumers are idempotent.
- Retries use exponential backoff.
- Exhausted messages remain available as Dead Letter records.
- Distributed transactions are not used.
- PostgreSQL remains authoritative when Redis or RabbitMQ is unavailable.

### Authentication and authorization

- Authentication uses email and password.
- Access Tokens are short-lived.
- Refresh Tokens rotate and are backed by server-side PostgreSQL Refresh Sessions.
- Logout revokes the current Refresh Session and clears the client token.
- `logout-all` revokes every Refresh Session for the user.
- Refresh Token hashes are stored, not plaintext tokens.
- Reuse of a revoked rotated Refresh Token revokes its token family.
- Roles are `customer`, `store-operator`, `store-admin`, and `platform-admin`.
- Store roles are scoped by Store ID; platform administrator permissions are global.
- API authorization checks explicit Permissions rather than Role names.

### Payment, settlement, and delivery

- Payment uses a `PaymentProvider` port with a fake v1 adapter.
- Fake payment behavior covers success, failure, timeout, and duplicate callbacks.
- Settlement becomes eligible after Order completion.
- Settlement records store payable amounts, fees, refunds, and adjustments.
- External bank transfers and provider settlement APIs are outside v1.
- Delivery uses a `DeliveryProvider` port with manual or simulated v1 status changes.
- Payment and Delivery failures are retried without duplicating business effects.

### Durable workflows

- DBOS runs only workflows that need durable recovery, retries, timers, or multi-step guarantees.
- PostgreSQL is DBOS's system database.
- DBOS does not replace normal Context transactions, Outbox, Inbox, or RabbitMQ transport.
- DBOS workflows are `PaymentWorkflow`, `DeliveryWorkflow`, and `SettlementWorkflow`.
- Workflow steps must be idempotent and must not bypass Context ownership.
- DBOS workflows run in the NestJS API process in v1; the SDK remains external to the Nx/Webpack bundle and uses the existing PostgreSQL system database.
- A separate Worker is deferred until measured load requires process isolation.

### Storage and platform

- PostgreSQL is the only persisted application data store in v1, including Domain, Outbox, Inbox, Audit, and Failure records.
- Redis is a non-authoritative layer for Catalog cache, rate limits, and short-lived temporary values.
- Redis does not own business state, authentication sessions, or event deduplication.
- Docker Compose supports fast local application development.
- `kind` runs the full Kubernetes integration stack.
- Kubernetes Service and CoreDNS provide Service Discovery.
- Internal dependencies use ClusterIP DNS; external HTTP uses Ingress or Gateway.
- Every workload defines Readiness and Liveness Probes.
- Argo CD reconciles Git-tracked Kubernetes desired state.
- GitHub Actions runs validation, type checks, tests, image build and push, and GitOps desired-state updates; it never applies Kubernetes manifests directly.
- Shared Kubernetes Base manifests and environment Overlays live in the Nx repository.
- Local secrets use SOPS and age; AWS uses External Secrets Operator with AWS Secrets Manager.
- Plaintext Kubernetes Secrets never enter Git.
- Terraform AWS follows after the application specification is stable.

### Observability

- OpenTelemetry SDK and instrumentation provide Trace, Metric, and Context propagation.
- Pino is the single application logger and emits structured JSON to stdout.
- Logs include `traceId`, `spanId`, `correlationId`, and `causationId` where available.
- OpenTelemetry Collector routes signals to Loki, Tempo, and Mimir.
- Grafana provides dashboards for API, RabbitMQ, PostgreSQL, and Outbox/Inbox.
- Alerts cover error rate, latency, queue backlog, Dead Letters, and Outbox delay.
- Local LGTM retention is seven days.

## Testing Decisions

Tests verify external behavior and recovery guarantees, not internal implementation details.

- API E2E tests cover authentication, authorization, store isolation, catalog access, ordering, payment, cancellation, delivery, and logout.
- PostgreSQL integration tests cover Aggregate plus Outbox atomicity, Inbox deduplication, Refresh Session revocation, audit records, and failure records.
- RabbitMQ contract tests cover Event Envelope shape, routing, acknowledgement timing, retry, and Dead Letter behavior.
- Provider adapter tests cover fake Payment and Delivery success, failure, timeout, and duplicate callbacks.
- DBOS tests cover workflow recovery, retries, durable timers, idempotent steps, and Webpack/runtime packaging.
- Observability tests verify structured log fields and trace correlation at the application boundary.
- Kubernetes smoke tests verify Service DNS, Readiness/Liveness Probes, Argo CD reconciliation, Secret decryption, and dependency startup.
- Existing Vitest tests remain the prior art for API behavior; Playwright remains the prior art for browser-to-API integration.

## Production Readiness

Seam-level tests are necessary but not sufficient. Every Ticket must demonstrate functional behavior, failure recovery, security boundaries, structured observability, health behavior, deployability, rollback, and relevant backup or restore behavior. The shared checklist and operational expectations live in `docs/operations/production-readiness.md`.

Before production claims, the service must measure HTTP, Order, PaymentWorkflow, DeliveryWorkflow, SettlementWorkflow, Outbox, RabbitMQ, Inbox, PostgreSQL, Redis, and DBOS health. v1 targets are 99.9% monthly API availability, synchronous API p95 at or below 300 ms excluding provider wait, asynchronous workflow p95 at or below 30 seconds when no provider action is required, RPO at most 15 minutes, and RTO within 60 minutes. Local Compose and `kind` validate behavior but do not claim production SLA compliance.

## Out of Scope

- MongoDB
- Kafka
- MinIO
- Consul and Eureka
- Vault
- OAuth and social login
- Real payment provider integration
- Real bank transfer and provider settlement APIs
- Real delivery carrier integration
- Coupons, loyalty points, inventory, and multi-store orders
- A single distributed transaction across Contexts
- Event-sourced write models
- AWS deployment before the application specification is stable

## Further Notes

- `CONTEXT-MAP.md` and accepted ADRs are the architecture record.
- Context glossaries, state models, the Integration Event Catalog, and domain workflows are the domain-language record.
- DBOS SDK external packaging and runtime validation are workflow implementation acceptance criteria.
- CI must test, build images, and update Git-tracked desired state without applying Kubernetes manifests directly.
- GitHub Issue publication is not available from the current read-only `gh` environment; this repository document is the local spec artifact until it is published.

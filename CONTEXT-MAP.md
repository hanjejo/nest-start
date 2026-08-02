# Context Map

This repository uses a multi-context domain-document layout.

Context boundaries are not authoritative yet. `/wayfinder` and `/domain-modeling` will resolve them before implementation. Resolved context documentation lives at `apps/api/src/<context>/CONTEXT.md`; system-wide decisions live under `docs/adr/`.

## Confirmed decisions

- v1 supports multiple stores.
- Each order belongs to exactly one store.
- Store Management owns stores, operating status, hours, and store policies; Catalog owns products, prices, and menu visibility.
- Ordering references `Store ID` and product snapshots without owning Store or Catalog tables.
- Payment owns customer charge collection; Settlement owns the store payable ledger, including fees, refunds, and adjustments.
- Settlement becomes eligible after order completion; external bank transfers and provider settlement APIs are out of scope for v1.
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
- RabbitMQ is the Integration Event transport; PostgreSQL Outbox remains the canonical event record, and consumers acknowledge messages only after Inbox and state changes commit.
- Events have two layers: transaction-scoped domain events and cross-context integration events.
- Integration events publish after commit through the outbox and require idempotent consumers.

| Candidate context   | Context document                              | Status    |
| ------------------- | --------------------------------------------- | --------- |
| Identity and Access | `apps/api/src/identity-and-access/CONTEXT.md` | Candidate |
| Store Management    | `apps/api/src/store-management/CONTEXT.md`    | Candidate |
| Catalog             | `apps/api/src/catalog/CONTEXT.md`             | Candidate |
| Ordering            | `apps/api/src/ordering/CONTEXT.md`            | Candidate |
| Settlement          | `apps/api/src/settlement/CONTEXT.md`          | Candidate |
| Payment             | `apps/api/src/payment/CONTEXT.md`             | Candidate |
| Delivery            | `apps/api/src/delivery/CONTEXT.md`            | Candidate |

## Still unresolved

- LGTM retention, dashboards, and alert rules.
- GitOps repository layout and environment overlays.
- RabbitMQ exchange, queue, retry, and Dead Letter topology.
- Local runtime and infrastructure scope.

---
status: accepted
---

# Support multiple stores and separate event layers

Coffee order v1 supports multiple stores, so store identity must remain part of the domain model rather than an implicit single-store assumption. Events are split into transaction-scoped domain events and cross-context integration events: domain events describe internal domain changes during the transaction, while integration events are published after commit through the outbox and form the stable boundary between contexts.

## Consequences

- Store ownership and store-specific rules remain explicit design work in the context map.
- Domain events must not become cross-context contracts.
- Integration events require durable outbox storage, retry handling, and idempotent consumers.

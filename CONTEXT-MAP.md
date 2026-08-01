# Context Map

This repository uses a multi-context domain-document layout.

Context boundaries are not authoritative yet. `/wayfinder` and `/domain-modeling` will resolve them before implementation. Resolved context documentation lives at `apps/api/src/<context>/CONTEXT.md`; system-wide decisions live under `docs/adr/`.

## Confirmed decisions

- v1 supports multiple stores.
- Each order belongs to exactly one store.
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

- Whether store data has its own context or belongs to Catalog.
- Settlement ownership and whether settlement means order-level accounting or merchant payout.
- Payment provider and delivery-provider boundaries.

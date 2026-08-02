# 05 — Single-store order

**What to build:** A customer can create an order from one store's catalog, capture product snapshots, view the order awaiting payment, and cancel it while cancellation is allowed.

**Blocked by:** 03 — Store-scoped RBAC; 04 — Multi-store catalog.

**Status:** ready-for-agent (local draft; not published to GitHub)

- [ ] Every order stores exactly one Store ID.
- [ ] Product name and price snapshots are captured at order creation.
- [ ] New orders start in `AWAITING_PAYMENT`.
- [ ] Products from different stores cannot be combined in one order.
- [ ] Cancellation before preparation changes the order to `CANCELLED`.
- [ ] Order API responses enforce customer and store-operator visibility rules.
- [ ] Tests cover price snapshots, store isolation, and cancellation.

---
status: accepted
---

# Keep lifecycle state with its owning context

Ordering owns the order lifecycle: `AWAITING_PAYMENT`, `CONFIRMED`, `PREPARING`, `READY_FOR_DELIVERY`, `DELIVERING`, `COMPLETED`, and `CANCELLED`. Payment, Delivery, and Settlement each own their own state machines; contexts do not duplicate one another's lifecycle state, and cross-context changes travel through integration events.

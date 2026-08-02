# 07 — PaymentWorkflow

**What to build:** A customer can pay for an awaiting order through the fake provider, and PaymentWorkflow durably handles success, failure, timeout, retry, and duplicate callback scenarios before the order becomes confirmed.

**Blocked by:** 05 — Single-store order; 06 — Outbox, Inbox, and RabbitMQ transport.

**Status:** ready-for-agent (local draft; not published to GitHub)

- [ ] A payment intent is created for one order and one customer.
- [ ] Fake provider success confirms the payment and advances the order.
- [ ] Provider failure leaves a safe retryable outcome.
- [ ] Timeout and retry do not create duplicate charges or confirmations.
- [ ] Duplicate callbacks are idempotent.
- [ ] DBOS resumes an interrupted workflow from its last completed step.
- [ ] Tests validate provider adapter and workflow recovery behavior.

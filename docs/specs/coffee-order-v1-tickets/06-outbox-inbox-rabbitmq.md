# 06 — Outbox, Inbox, and RabbitMQ transport

**What to build:** A committed domain change publishes its Integration Event through PostgreSQL Outbox and RabbitMQ, while a consumer records Inbox IDs and state changes atomically with safe acknowledgement, retry, and Dead Letter behavior.

**Blocked by:** 01 — API and PostgreSQL foundation.

**Status:** ready-for-agent (local draft; not published to GitHub)

- [ ] Aggregate changes and complete Integration Event envelopes commit with the Outbox.
- [ ] RabbitMQ uses the durable topic exchange and Context-specific queues.
- [ ] Consumers acknowledge only after Inbox and state changes commit.
- [ ] Duplicate deliveries do not repeat a business effect.
- [ ] Failed messages retry with backoff and eventually reach a Dead Letter Queue.
- [ ] Tests cover crash windows before and after acknowledgement.

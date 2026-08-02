---
status: accepted
---

# Use DBOS for durable workflows

DBOS provides PostgreSQL-backed durable execution for workflows that need recovery, retries, timers, or multi-step guarantees. It does not replace PostgreSQL domain transactions, the Outbox/Inbox pattern, or RabbitMQ; the DBOS SDK remains external to the Nx/Webpack bundle and must be validated at runtime.

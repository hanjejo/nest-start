---
status: accepted
---

# Use RabbitMQ for Integration Event transport

RabbitMQ transports Integration Events between Contexts using durable messages and consumer acknowledgements. PostgreSQL Outbox remains the canonical event record, and consumers acknowledge a message only after Inbox recording and state changes commit; retry and Dead Letter topology remain explicit deployment decisions.

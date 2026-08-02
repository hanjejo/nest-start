---
status: accepted
---

# Assign DBOS workflow boundaries

DBOS durably orchestrates `PaymentWorkflow`, `DeliveryWorkflow`, and `SettlementWorkflow` because they need external I/O, retries, timers, or recovery across steps. Ordinary Aggregate transactions remain direct PostgreSQL transactions, and DBOS workflows continue to use Outbox/Inbox and RabbitMQ rather than replacing them.

---
status: accepted
---

# Use Context queues with RabbitMQ retry and Dead Letter handling

RabbitMQ uses one durable `integration.events` topic exchange with Event Type routing keys and one durable queue per consuming Context. Each Context has TTL-based retry queues and a Dead Letter Queue; PostgreSQL Inbox remains responsible for deduplication, and queues are not created per event type.

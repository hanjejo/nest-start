---
status: accepted
---

# Use PostgreSQL only for persisted application data in v1

PostgreSQL is the only persisted application data store in v1, including domain data, Outbox, Inbox, durable audit records, and failure records. A separate MongoDB log database is out of scope; operational logs remain structured stdout or container logs, avoiding a second stateful service before its retention and search needs are proven.

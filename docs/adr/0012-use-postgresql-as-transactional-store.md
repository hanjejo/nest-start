---
status: accepted
---

# Use PostgreSQL as the transactional store

PostgreSQL is the single transactional store for domain data, Outbox, and Inbox in the modular monolith. Contexts own their tables, and each Context's state change plus Outbox work stays in one transaction; MongoDB remains undecided because insert-only writes alone do not establish a storage requirement.

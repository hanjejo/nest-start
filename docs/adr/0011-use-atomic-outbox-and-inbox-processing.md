---
status: accepted
---

# Use atomic Outbox and Inbox processing

Aggregate changes and Outbox records commit in one transaction. A Dispatcher delivers Integration Events at least once; consumers record event IDs in an Inbox and update their state in the same transaction, retry failures with exponential backoff, and retain exhausted messages as Dead Letter records instead of using distributed transactions.

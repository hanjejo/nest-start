---
status: accepted
---

# Use Redis as a non-authoritative performance layer

Redis serves Catalog cache, rate limits, and short-lived temporary values. It is not the source of truth for business state, authentication sessions, or event deduplication; PostgreSQL remains authoritative so Redis loss cannot corrupt ordering, payment, settlement, or authentication data.

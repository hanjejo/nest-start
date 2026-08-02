# 10 — Redis performance layer

**What to build:** Catalog reads use a Redis cache and API rate limits use short-lived Redis values, while PostgreSQL remains authoritative and the application remains correct when Redis is unavailable.

**Blocked by:** 04 — Multi-store catalog.

**Status:** ready-for-agent (local draft; not published to GitHub)

- [ ] Catalog cache entries are scoped by Store ID and catalog version.
- [ ] Cache invalidation follows product and price changes.
- [ ] Rate limits expire automatically.
- [ ] Redis failure falls back safely without losing business data.
- [ ] Redis never stores the authoritative order, payment, session, or Inbox state.
- [ ] Tests cover cache hits, invalidation, expiry, and Redis unavailability.

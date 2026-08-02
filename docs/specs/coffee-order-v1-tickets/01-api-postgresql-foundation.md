# 01 — API and PostgreSQL foundation

**What to build:** The service starts locally, connects to PostgreSQL, applies its schema, and exposes a health check that reports application and database availability.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent (local draft; not published to GitHub)

- [ ] API starts through the supported local command.
- [ ] PostgreSQL connection and schema migration work against a clean database.
- [ ] Health check reports database failure without exposing credentials.
- [ ] Vitest coverage verifies healthy and unavailable database behavior.

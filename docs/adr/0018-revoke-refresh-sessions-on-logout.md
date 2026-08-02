---
status: accepted
---

# Revoke refresh sessions on logout

Logout revokes the current PostgreSQL Refresh Session and clears the client token; `logout-all` revokes every Refresh Session for the user. Access Tokens remain short-lived rather than using a Redis denylist, and logout is idempotent so an already-revoked session returns success.

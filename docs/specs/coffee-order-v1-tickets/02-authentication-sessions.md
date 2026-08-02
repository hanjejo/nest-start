# 02 — Authentication sessions

**What to build:** Customers can register, log in, refresh an access token through rotating refresh sessions, log out from the current device, and log out from all devices.

**Blocked by:** 01 — API and PostgreSQL foundation.

**Status:** ready-for-agent (local draft; not published to GitHub)

- [ ] Email and password registration and login work through the API.
- [ ] Refresh tokens rotate and only hashes are persisted.
- [ ] Current-device logout revokes one refresh session and is idempotent.
- [ ] Logout-all revokes every refresh session for the user.
- [ ] Reuse of a revoked rotated token revokes its token family.
- [ ] Tests cover expired, revoked, and valid sessions.

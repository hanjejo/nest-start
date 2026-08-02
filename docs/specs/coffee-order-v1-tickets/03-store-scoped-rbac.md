# 03 — Store-scoped RBAC

**What to build:** Users receive explicit permissions through customer, store-operator, store-admin, or platform-admin roles, with store roles restricted to their assigned Store ID.

**Blocked by:** 02 — Authentication sessions.

**Status:** ready-for-agent (local draft; not published to GitHub)

- [ ] Roles, permissions, and assignments can be created and queried.
- [ ] Store operator and store admin access is restricted by Store ID.
- [ ] Platform admin access is global.
- [ ] API authorization checks permissions rather than role names.
- [ ] Unauthorized and cross-store access return consistent errors.
- [ ] Tests cover every role and store boundary.

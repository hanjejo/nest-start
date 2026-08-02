---
status: accepted
---

# Use store-scoped RBAC for authorization

Identity and Access owns roles, permissions, and assignments. v1 defines `customer`, `store-operator`, `store-admin`, and `platform-admin`; store roles are scoped by `Store ID`, platform admin is global, and API guards check permissions rather than role names so capabilities remain explicit.

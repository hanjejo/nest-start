# 04 — Multi-store catalog

**What to build:** Store administrators can manage store status, hours, policies, products, prices, and menu visibility while customers can browse only available catalog data for a selected store.

**Blocked by:** 01 — API and PostgreSQL foundation; 03 — Store-scoped RBAC.

**Status:** ready-for-agent (local draft; not published to GitHub)

- [ ] A platform can represent multiple stores.
- [ ] Store status, hours, and policies affect catalog availability.
- [ ] Store administrators manage products and prices only for assigned stores.
- [ ] Customers can browse visible products for one selected store.
- [ ] Catalog responses identify the owning Store ID.
- [ ] Tests cover multiple stores and cross-store access denial.

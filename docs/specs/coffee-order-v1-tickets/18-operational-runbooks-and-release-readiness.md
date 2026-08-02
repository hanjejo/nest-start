# 18 — Operational runbooks and release readiness

**What to build:** Operators can deploy, observe, troubleshoot, recover, and roll back the service using documented procedures and a repeatable production release checklist.

**Blocked by:** 13 — Argo CD GitOps deployment; 15 — Security and policy hardening; 16 — PostgreSQL backup and recovery; 17 — Performance and resilience verification.

**Status:** ready-for-agent (local draft; not published to GitHub)

- [ ] Startup, dependency failure, migration failure, and rollback runbooks exist.
- [ ] Payment, Delivery, Settlement, Outbox, Inbox, RabbitMQ, and DBOS failure runbooks exist.
- [ ] Dashboards and alerts link to actionable operator procedures.
- [ ] Backup restore and failure drills have recorded outcomes.
- [ ] Release checklist verifies tests, image provenance, migrations, secrets, health, and rollback.
- [ ] A release can be promoted and rolled back through GitOps without manual database editing.

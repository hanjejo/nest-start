# 16 — PostgreSQL backup and recovery

**What to build:** PostgreSQL data can be backed up, restored into a clean environment, and safely brought back into service without losing the records required for business recovery.

**Blocked by:** 01 — API and PostgreSQL foundation; 12 — Kubernetes platform integration.

**Status:** ready-for-agent (local draft; not published to GitHub)

- [ ] Target environment uses WAL/PITR-capable backup configuration.
- [ ] Backup success, age, and storage destination are observable.
- [ ] Restore is tested against a clean PostgreSQL environment.
- [ ] Restore verification covers schema, Orders, Payment, Outbox, Inbox, Audit, and Failure records.
- [ ] Recovery procedure explains consumer pause, Outbox replay, duplicate handling, and DBOS workflow resume.
- [ ] Recovery meets the v1 RPO of at most 15 minutes.
- [ ] Recovery meets the v1 RTO of 60 minutes or less.

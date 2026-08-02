# 12 — Kubernetes platform integration

**What to build:** The complete local platform runs on `kind` with PostgreSQL, RabbitMQ, Redis, LGTM, Kubernetes-native Service Discovery, health probes, and encrypted deployment secrets.

**Blocked by:** 06 — Outbox, Inbox, and RabbitMQ transport; 10 — Redis performance layer; 11 — OpenTelemetry, Pino, and LGTM.

**Status:** ready-for-agent (local draft; not published to GitHub)

- [ ] Dependencies run as reproducible Kubernetes workloads.
- [ ] Internal services resolve through Kubernetes Service DNS.
- [ ] Readiness and Liveness Probes prevent unhealthy traffic.
- [ ] PostgreSQL, RabbitMQ, Redis, and LGTM startup dependencies are explicit.
- [ ] Local secrets use encrypted SOPS and age manifests.
- [ ] A clean `kind` cluster can be provisioned and smoke-tested.

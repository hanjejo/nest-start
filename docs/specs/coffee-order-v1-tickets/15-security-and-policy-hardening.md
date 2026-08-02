# 15 — Security and policy hardening

**What to build:** The service enforces security policy at runtime and the delivery pipeline blocks known unsafe dependencies, images, secrets, and authorization regressions.

**Blocked by:** 03 — Store-scoped RBAC; 12 — Kubernetes platform integration; 14 — CI GitOps pipeline.

**Status:** ready-for-agent (local draft; not published to GitHub)

- [ ] Password and refresh credential hashing is verified.
- [ ] Refresh reuse, logout, and administrator actions are auditable.
- [ ] Protected commands enforce explicit Permission and Store ID scope.
- [ ] Sensitive payment, address, credential, and token values are redacted from logs and telemetry.
- [ ] SOPS/age and runtime Secret handling are checked for plaintext leaks.
- [ ] Dependency and container image vulnerability checks gate promotion.
- [ ] Security regression tests run in CI.

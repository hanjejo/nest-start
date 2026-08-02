# 14 — CI GitOps pipeline

**What to build:** A CI run validates the monorepo, builds and publishes application images, and updates Git-tracked Kubernetes desired state for Argo CD to reconcile.

**Blocked by:** 13 — Argo CD GitOps deployment.

**Status:** ready-for-agent (local draft; not published to GitHub)

- [ ] Unit, integration, E2E, and relevant platform checks run in CI.
- [ ] A successful build produces versioned application images.
- [ ] Image metadata updates the intended GitOps environment.
- [ ] Failed tests prevent image promotion and desired-state changes.
- [ ] CI never applies Kubernetes manifests directly.
- [ ] A Git revision can be traced from deployed image to source commit.

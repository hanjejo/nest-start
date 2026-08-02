# 13 — Argo CD GitOps deployment

**What to build:** Argo CD reconciles the local `kind` cluster from shared Kubernetes manifests and environment overlays, and a Git change can promote a tested application version without direct cluster commands.

**Blocked by:** 12 — Kubernetes platform integration.

**Status:** ready-for-agent (local draft; not published to GitHub)

- [ ] Shared deployment configuration and environment overlays are validated.
- [ ] Argo CD observes the intended local environment.
- [ ] Application and dependency health are visible through Argo CD.
- [ ] Git changes reconcile to the cluster reproducibly.
- [ ] Rollback uses a prior Git revision.
- [ ] No deployment step requires direct `kubectl apply`.

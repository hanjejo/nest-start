---
status: accepted
---

# Keep GitOps manifests in the monorepo

GitOps desired state lives in this Nx repository under `deploy/k8s`, with shared `base` manifests and `local`, `staging`, and `production` overlays. Argo CD watches an environment overlay, and environment promotion happens through Git changes rather than direct cluster commands.

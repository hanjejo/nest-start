---
status: accepted
---

# Use GitHub Actions for CI

GitHub Actions runs pnpm validation, type checks, tests, image build and push, and GitOps desired-state updates. It never applies Kubernetes manifests directly; Argo CD remains responsible for cluster reconciliation and deployment.

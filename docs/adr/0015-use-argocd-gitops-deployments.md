---
status: accepted
---

# Use Argo CD for GitOps deployments

CI runs tests, builds images, and updates the Git-tracked desired Kubernetes state; Argo CD reconciles that state into the local `kind` cluster. Deployment changes flow through Git, and CI does not apply manifests directly with `kubectl`, keeping the cluster state auditable and reproducible.

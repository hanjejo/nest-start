---
status: accepted
---

# Encrypt GitOps secrets

Local `kind` uses `SOPS + age` encrypted manifests, while AWS uses External Secrets Operator with AWS Secrets Manager. Plaintext Kubernetes Secrets never enter Git, and Vault is outside v1 so GitOps remains portable without adding another stateful secret service.

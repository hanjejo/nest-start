# Coffee Order v1 Ticket Drafts

These drafts follow the approved tracer-bullet order for `coffee-order-v1`. Each ticket is independently verifiable and declares its blockers.

The configured tracker is GitHub Issues, but this environment's `gh` CLI is read-only, so these files are not published issues. Publish each draft as a `ready-for-agent` issue when issue-write access is available.

Dependency order:

1. API and PostgreSQL foundation
2. Authentication sessions
3. Store-scoped RBAC
4. Multi-store catalog
5. Single-store order
6. Outbox, Inbox, and RabbitMQ transport
7. PaymentWorkflow
8. DeliveryWorkflow
9. SettlementWorkflow
10. Redis performance layer
11. OpenTelemetry, Pino, and LGTM
12. Kubernetes platform integration
13. Argo CD GitOps deployment
14. CI GitOps pipeline

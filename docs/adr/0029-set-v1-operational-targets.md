---
status: accepted
---

# Set v1 operational targets

The target production environment must provide 99.9% monthly API availability, synchronous API p95 at or below 300 ms excluding provider wait, asynchronous workflow p95 at or below 30 seconds when no provider action is required, RPO at most 15 minutes, and RTO within 60 minutes. Local Compose and `kind` validate behavior and recovery but do not claim production SLA compliance.

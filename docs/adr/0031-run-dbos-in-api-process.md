---
status: accepted
---

# Run DBOS in the API process

DBOS workflows run in the NestJS API process in v1, use the existing PostgreSQL system database, and keep the DBOS SDK external to the Nx/Webpack bundle. A separate Worker is deferred until measured load requires process isolation, avoiding an additional deployment and operational boundary.

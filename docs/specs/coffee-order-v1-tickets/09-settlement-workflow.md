# 09 — SettlementWorkflow

**What to build:** Completion of an order starts a durable SettlementWorkflow that calculates the store payable ledger and records fees, refunds, and adjustments exactly once.

**Blocked by:** 08 — DeliveryWorkflow.

**Status:** ready-for-agent (local draft; not published to GitHub)

- [ ] Only completed orders become settlement-eligible.
- [ ] Store payable amount, fees, refunds, and adjustments are recorded.
- [ ] Replayed completion events do not duplicate ledger entries.
- [ ] Settlement state is visible to authorized store administrators.
- [ ] External bank transfer is not required.
- [ ] DBOS resumes an interrupted settlement workflow.
- [ ] Tests cover calculation, idempotency, and recovery.

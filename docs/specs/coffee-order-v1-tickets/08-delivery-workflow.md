# 08 — DeliveryWorkflow

**What to build:** A confirmed order creates one delivery with an address snapshot, and DeliveryWorkflow durably handles manual or simulated delivery progress and retryable provider failures.

**Blocked by:** 07 — PaymentWorkflow.

**Status:** ready-for-agent (local draft; not published to GitHub)

- [ ] One Delivery is created in `REQUESTED` for one confirmed Order.
- [ ] Provider or simulated delivery progress starts after the Order reaches `READY_FOR_DELIVERY`.
- [ ] The delivery address is snapshotted at creation.
- [ ] Delivery status changes are visible to authorized customers and store operators.
- [ ] Fake provider failure and retry do not duplicate a Delivery.
- [ ] Delivery completion advances the owning order through Integration Events.
- [ ] DBOS resumes an interrupted delivery workflow.
- [ ] Tests cover store scope, status transitions, retries, and recovery.

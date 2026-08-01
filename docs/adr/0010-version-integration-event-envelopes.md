---
status: accepted
---

# Version immutable integration event envelopes

Integration Event envelopes contain `eventId`, `eventType`, `eventVersion`, `occurredAt`, `producer`, `aggregateId`, `correlationId`, `causationId`, and `payload`, and the Outbox stores the complete envelope. Domain Events stay Context-internal; additive changes remain compatible within a Version, while breaking changes use a new event type or Version.

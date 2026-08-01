---
status: accepted
---

# Isolate delivery providers behind adapters

Delivery owns one delivery per order, including the address snapshot and delivery state. v1 uses manual or simulated status changes behind a `DeliveryProvider` port; external carrier integrations can be added later without moving delivery ownership into Ordering.

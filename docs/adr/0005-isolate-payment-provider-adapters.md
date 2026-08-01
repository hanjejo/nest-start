---
status: accepted
---

# Isolate payment providers behind adapters

Payment owns payment intents and payment state, while a `PaymentProvider` port isolates external provider behavior. v1 uses a fake provider that can produce success, failure, timeout, and duplicate-callback scenarios; Ordering communicates with Payment through commands and integration events rather than shared tables.

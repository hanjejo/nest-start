---
status: accepted
---

# Cancel Orders before preparation

Customers and authorized Store Operators may cancel an Order before `PREPARING`; a paid cancellation starts the Payment refund workflow, and normal customer cancellation is unavailable after preparation begins. This keeps Order State, Payment refunds, and Settlement Ledger Entries as separate facts.

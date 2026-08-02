# Settlement

Settlement calculates and records what a Store is owed for completed Orders. It owns the store payable ledger; external bank transfer and provider payout execution are outside this Context and outside v1.

## Language

**Settlement**:
The accounting process that turns a completed Order into a store payable record.
_Avoid_: Payment, payout

**Store Payable**:
The amount currently owed to a Store after fees, refunds, and adjustments.
_Avoid_: Revenue, balance

**Fee**:
An amount withheld from the Store Payable under an applicable rule.
_Avoid_: Cost, commission

**Adjustment**:
A deliberate change to a Store Payable that is not the original Order Amount or Fee.
_Avoid_: Refund, correction

**Settlement Eligibility**:
The condition that a completed Order has all facts required for a Store Payable record.
_Avoid_: Payment success, payout complete

**Ledger Entry**:
An immutable increase or decrease recorded against a Store Payable.
_Avoid_: Balance mutation, transaction

## Ownership and boundaries

Settlement owns `Settlement`, its projected Order and Payment facts, and
immutable store-payable Ledger Entries. It consumes `PaymentSucceeded`,
`OrderCompleted`, `PaymentRefunded`, and `OrderCancelled` through the Inbox.
It never reads or mutates Ordering or Payment tables.

`OrderCompleted` and a matching successful payment are both required before a
Settlement becomes `ELIGIBLE`. Delivery or Payment state is not copied into the
Settlement aggregate. A cancellation blocks eligibility; a refund is recorded
only from the `PaymentRefunded` Integration Event.

## v1 calculation policy

All amounts are integer minor units and must fit a PostgreSQL `integer`.
Settlement uses a configurable fee of `SETTLEMENT_FEE_BASIS_POINTS`, defaulting
to 250 basis points (2.5%). The fee is rounded down:

`fee = floor(gross * feeBasisPoints / 10,000)`

`store payable = gross - fee - refunds + adjustments`.

Refunds and optional internal adjustment snapshots are projected before
recording, and the calculation rejects negative or overflowed payable values.
Gross and fee entries are immutable ledger entries; each refund and non-zero
adjustment gets its own idempotent entry. v1 does not transfer money or call a
bank/provider payout API.

## Recovery

`SettlementWorkflow` records the final ledger and `SettlementRecorded` Outbox
event in one PostgreSQL transaction. Ledger and Outbox idempotency keys make
workflow reruns and duplicate event delivery harmless. DBOS is used when
available in the API process with PostgreSQL as its system database; tests and
unavailable DBOS instances use an explicit local runtime fallback and do not
claim durable DBOS recovery.

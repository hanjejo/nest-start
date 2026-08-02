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

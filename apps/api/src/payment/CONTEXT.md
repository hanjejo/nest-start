# Payment

Payment records the attempt to collect a customer's money for an Order and reconciles provider outcomes. It owns payment state and provider interaction, but it does not own the Order lifecycle.

## Language

**Payment Intent**:
The request to collect the agreed Order Amount for one Order.
_Avoid_: Order, invoice

**Payment Attempt**:
One provider interaction made to fulfill a Payment Intent.
_Avoid_: Retry, transaction

**Payment Outcome**:
The provider's accepted result for a Payment Attempt.
_Avoid_: Order state, settlement

**Payment Callback**:
A provider message reporting a Payment Outcome after the original request.
_Avoid_: Webhook event, notification

**Refund**:
The return of all or part of collected customer money.
_Avoid_: Cancellation, adjustment

**Payment Provider**:
An external or simulated party that accepts payment requests and reports outcomes.
_Avoid_: Gateway, processor

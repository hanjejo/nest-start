# Domain Workflows

These workflows describe business interaction across Contexts. A command is handled by one owning Context; Integration Events carry facts to other Contexts; DBOS is used only where recovery across multiple steps matters.

## Authentication and logout

1. Account submits credentials.
2. Identity and Access validates credentials and creates an `ACTIVE` Refresh Session.
3. Identity and Access returns a short-lived Access Token and a Refresh Token.
4. Refresh rotates the Token Family and revokes the previous refresh credential.
5. Logout revokes the current Refresh Session and clears the client token.
6. Logout-all revokes every Refresh Session for the Account.
7. Reuse of a revoked rotated credential revokes its Token Family and records a security-relevant audit entry.

Authentication state never depends on Redis. Access Token expiry limits the lifetime of a token that was issued before logout.

## Place order and pay

1. Customer selects one Store and submits `Place Order`.
2. Ordering validates Store Status, Operating Hours, Store Policy, and current Catalog data.
3. Ordering captures Product Snapshots and creates an Order in `AWAITING_PAYMENT`.
4. Ordering commits the Order and `OrderPlaced` Outbox record in one PostgreSQL transaction.
5. RabbitMQ delivers `OrderPlaced` to Payment.
6. Payment records a Payment Intent and starts `PaymentWorkflow`.
7. PaymentWorkflow calls the Fake Payment Provider as a durable step.
8. A success, failure, timeout, or duplicate Callback updates Payment exactly once.
9. Payment publishes `PaymentSucceeded`, `PaymentFailed`, or `PaymentExpired`.
10. Ordering consumes the Payment event through Inbox and moves the Order to `CONFIRMED` or `CANCELLED`.

PaymentWorkflow retries provider operations, but it never directly mutates Ordering state.

## Fulfill and deliver

1. Ordering emits `OrderConfirmed`; Delivery creates one Delivery in `REQUESTED` with an Address Snapshot.
2. Store Operator issues `Start Preparation`; Ordering moves the Order to `PREPARING`.
3. Store Operator issues `Mark Ready`; Ordering moves the Order to `READY_FOR_DELIVERY`.
4. DeliveryWorkflow starts provider or simulated status changes after the Order is ready.
5. Delivery emits `DeliveryStarted` and `DeliveryCompleted` through Outbox.
6. Ordering consumes those events and moves the Order to `DELIVERING` and then `COMPLETED`.
7. Provider failure moves Delivery to `FAILED`; retry does not create a second Delivery.

Delivery owns Delivery Status. Ordering owns Order State.

## Complete and settle

1. Ordering commits `COMPLETED` and `OrderCompleted` in one transaction.
2. Settlement consumes `OrderCompleted` and starts `SettlementWorkflow`.
3. SettlementWorkflow gathers the Order Amount and Payment facts from its own projections.
4. Settlement calculates Fees, Refunds, Adjustments, and Store Payable.
5. Settlement writes immutable Ledger Entries exactly once.
6. Settlement emits `SettlementRecorded` for platform operations.

Settlement records the Store Payable ledger. It does not transfer money to a bank in v1.

## Cancellation and refund

1. Customer or authorized Store Operator submits `Cancel Order`.
2. Under the v1 policy, Ordering accepts cancellation only before preparation begins.
3. Ordering commits `CANCELLED` and `OrderCancelled`.
4. If payment succeeded, Payment starts the refund portion of PaymentWorkflow.
5. Payment emits `PaymentRefunded` after provider confirmation.
6. Settlement records the refund as an immutable negative Ledger Entry.

Cancellation, refund, and settlement are separate facts. A cancelled Order is not itself a refund.

## Failure and recovery

1. Domain state and Outbox Event commit atomically.
2. Dispatcher publishes the event to RabbitMQ.
3. Consumer begins a transaction and checks Inbox by `eventId`.
4. A duplicate event exits without repeating the business effect.
5. A failed consumer transaction rolls back Inbox and state changes.
6. RabbitMQ redelivers after the message remains unacknowledged.
7. Retry policy applies backoff and eventually routes poison messages to a Dead Letter Queue.
8. DBOS resumes a workflow from its last completed step after process recovery.
9. Pino logs and OpenTelemetry context connect the original request, event, consumer, and workflow.

## Workflow ownership

| Workflow             | Owner      | Durable reason                                     | Does not own  |
| -------------------- | ---------- | -------------------------------------------------- | ------------- |
| `PaymentWorkflow`    | Payment    | Provider I/O, timeout, callback, retry             | Order State   |
| `DeliveryWorkflow`   | Delivery   | Provider/simulation progress and retry             | Order State   |
| `SettlementWorkflow` | Settlement | Calculation, recovery, idempotent ledger recording | Bank transfer |

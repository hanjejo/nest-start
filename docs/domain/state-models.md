# Domain State Models

These state models describe business lifecycle, not database implementation. A Context owns its state; other Contexts react to the owner's Integration Events.

## State ownership

| Context             | State owner           | Terminal states                 |
| ------------------- | --------------------- | ------------------------------- |
| Store Management    | Store Status          | `SUSPENDED`                     |
| Catalog             | Product Lifecycle     | `ARCHIVED`                      |
| Ordering            | Order State           | `COMPLETED`, `CANCELLED`        |
| Payment             | Payment State         | `FAILED`, `EXPIRED`, `REFUNDED` |
| Delivery            | Delivery Status       | `DELIVERED`, `FAILED`           |
| Settlement          | Settlement State      | `RECORDED`                      |
| Identity and Access | Refresh Session State | `REVOKED`, `EXPIRED`            |

## Store Status

| From               | Event or command | To          | Rule                                                               |
| ------------------ | ---------------- | ----------- | ------------------------------------------------------------------ |
| `DRAFT`            | Open Store       | `OPEN`      | Store may accept new Orders when hours and policies permit.        |
| `OPEN`             | Close Store      | `CLOSED`    | Existing Orders continue; new Orders are rejected.                 |
| `CLOSED`           | Open Store       | `OPEN`      | Store becomes orderable when hours and policies permit.            |
| `OPEN` or `CLOSED` | Suspend Store    | `SUSPENDED` | New Orders are rejected until an administrator restores the Store. |

## Product Lifecycle

| From                   | Event or command  | To            | Rule                                                          |
| ---------------------- | ----------------- | ------------- | ------------------------------------------------------------- |
| `DRAFT`                | Publish Product   | `PUBLISHED`   | Product appears when its Store and Menu Visibility permit it. |
| `PUBLISHED`            | Unpublish Product | `UNPUBLISHED` | Product cannot be selected for new Orders.                    |
| `UNPUBLISHED`          | Publish Product   | `PUBLISHED`   | Product becomes selectable again.                             |
| Any non-archived state | Archive Product   | `ARCHIVED`    | Historical Product Snapshots remain valid.                    |

## Order State

| From                 | Trigger                         | To                   | Owner                      |
| -------------------- | ------------------------------- | -------------------- | -------------------------- |
| —                    | Place Order                     | `AWAITING_PAYMENT`   | Customer                   |
| `AWAITING_PAYMENT`   | Payment Succeeded               | `CONFIRMED`          | Payment event              |
| `AWAITING_PAYMENT`   | Cancel Order or Payment Expired | `CANCELLED`          | Customer or system         |
| `CONFIRMED`          | Start Preparation               | `PREPARING`          | Store Operator             |
| `CONFIRMED`          | Allowed cancellation            | `CANCELLED`          | Customer or Store Operator |
| `PREPARING`          | Mark Ready                      | `READY_FOR_DELIVERY` | Store Operator             |
| `READY_FOR_DELIVERY` | Delivery Started                | `DELIVERING`         | Delivery event             |
| `DELIVERING`         | Delivery Completed              | `COMPLETED`          | Delivery event             |

Proposed v1 cancellation policy: cancellation is allowed before preparation begins. A paid cancellation requires a Payment refund workflow; cancellation after `PREPARING` is outside the normal customer path and requires an explicit operational policy.

## Payment State

| From        | Trigger               | To          | Rule                                                               |
| ----------- | --------------------- | ----------- | ------------------------------------------------------------------ |
| —           | Create Payment Intent | `PENDING`   | One Payment Intent belongs to one Order.                           |
| `PENDING`   | Provider success      | `SUCCEEDED` | Emit `PaymentSucceeded` once.                                      |
| `PENDING`   | Provider failure      | `FAILED`    | The customer may start a new attempt under the same Intent policy. |
| `PENDING`   | Timeout expiry        | `EXPIRED`   | No late success may silently confirm an expired Order.             |
| `SUCCEEDED` | Refund accepted       | `REFUNDED`  | Emit `PaymentRefunded` once per refund outcome.                    |

## Delivery Status

| From                                  | Trigger           | To           | Rule                               |
| ------------------------------------- | ----------------- | ------------ | ---------------------------------- |
| —                                     | Create Delivery   | `REQUESTED`  | One Delivery belongs to one Order. |
| `REQUESTED`                           | Delivery accepted | `READY`      | Address Snapshot is fixed.         |
| `READY`                               | Start Delivery    | `IN_TRANSIT` | Emit `DeliveryStarted`.            |
| `IN_TRANSIT`                          | Confirm arrival   | `DELIVERED`  | Emit `DeliveryCompleted`.          |
| `REQUESTED`, `READY`, or `IN_TRANSIT` | Provider failure  | `FAILED`     | Retry creates no second Delivery.  |

## Settlement State

| From       | Trigger             | To         | Rule                                            |
| ---------- | ------------------- | ---------- | ----------------------------------------------- |
| —          | Order not completed | `PENDING`  | No Store Payable exists yet.                    |
| `PENDING`  | Order Completed     | `ELIGIBLE` | Required Order and Payment facts are available. |
| `ELIGIBLE` | Calculate ledger    | `RECORDED` | Write immutable Ledger Entries exactly once.    |

Fees, refunds, and adjustments are additional Ledger Entries. They do not rewrite a historical entry or require a separate payout state in v1.

## Refresh Session State

| From                   | Trigger              | To        | Rule                                                           |
| ---------------------- | -------------------- | --------- | -------------------------------------------------------------- |
| —                      | Login                | `ACTIVE`  | A new Refresh Session and Token Family begin.                  |
| `ACTIVE`               | Logout or logout-all | `REVOKED` | Refresh cannot continue.                                       |
| `ACTIVE`               | Expiry               | `EXPIRED` | Refresh cannot continue.                                       |
| `REVOKED` or `EXPIRED` | Any refresh attempt  | unchanged | Return an authentication failure without reviving the Session. |

# Integration Event Catalog

Commands are directed requests and use imperative names. Events are facts that already happened and use past-tense names. Only Integration Events below cross Context boundaries; Domain Events remain inside their owning Context.

Every Integration Event uses the shared envelope:

`eventId`, `idempotencyKey`, `eventType`, `eventVersion`, `occurredAt`,
`producer`, `aggregateType`, `aggregateId`, `aggregateVersion`, `correlationId`,
`causationId`, and `payload`.

## Store and Catalog events

| Event                 | Producer         | Consumers         | Required payload                                    |
| --------------------- | ---------------- | ----------------- | --------------------------------------------------- |
| `StoreOpened`         | Store Management | Catalog, Ordering | `storeId`                                           |
| `StoreClosed`         | Store Management | Catalog, Ordering | `storeId`, `reason`                                 |
| `StoreSuspended`      | Store Management | Catalog, Ordering | `storeId`, `reason`                                 |
| `ProductPublished`    | Catalog          | Ordering          | `storeId`, `productId`, `name`, `price`, `currency` |
| `ProductUnpublished`  | Catalog          | Ordering          | `storeId`, `productId`                              |
| `ProductPriceChanged` | Catalog          | Ordering          | `storeId`, `productId`, `price`, `currency`         |

Catalog events update read-side knowledge and cache state. Ordering still validates the current Catalog entry before taking a Product Snapshot.

## Order and Payment events

| Event              | Producer | Consumers            | Required payload                                                                   |
| ------------------ | -------- | -------------------- | ---------------------------------------------------------------------------------- |
| `OrderPlaced`      | Ordering | Payment              | `orderId`, `storeId`, `customerId`, `orderAmount`, `currency`, `lines`             |
| `PaymentSucceeded` | Payment  | Ordering, Settlement | `paymentIntentId`, `orderId`, `storeId`, `amount`, `currency`, `providerReference` |
| `PaymentFailed`    | Payment  | Ordering             | `paymentIntentId`, `orderId`, `reason`, `retryable`                                |
| `PaymentExpired`   | Payment  | Ordering             | `paymentIntentId`, `orderId`, `expiredAt`                                          |
| `PaymentRefunded`  | Payment  | Ordering, Settlement | `paymentIntentId`, `orderId`, `refundAmount`, `currency`, `providerReference`      |
| `OrderConfirmed`   | Ordering | Delivery             | `orderId`, `storeId`, `customerId`, `addressSnapshot`                              |
| `OrderCancelled`   | Ordering | Payment, Settlement  | `orderId`, `storeId`, `reason`, `refundRequired`                                   |

`OrderPlaced` starts PaymentWorkflow. Payment owns provider outcomes; Ordering changes its own Order State only after consuming the corresponding Payment event.

## Fulfillment and settlement events

| Event                     | Producer   | Consumers           | Required payload                                                  |
| ------------------------- | ---------- | ------------------- | ----------------------------------------------------------------- |
| `OrderPreparationStarted` | Ordering   | Delivery            | `orderId`, `storeId`                                              |
| `OrderReadyForDelivery`   | Ordering   | Delivery            | `orderId`, `storeId`                                              |
| `DeliveryCreated`         | Delivery   | Ordering            | `deliveryId`, `orderId`, `storeId`, `addressSnapshot`             |
| `DeliveryStarted`         | Delivery   | Ordering            | `deliveryId`, `orderId`, `storeId`, `startedAt`                   |
| `DeliveryCompleted`       | Delivery   | Ordering            | `deliveryId`, `orderId`, `storeId`, `completedAt`                 |
| `DeliveryFailed`          | Delivery   | Ordering            | `deliveryId`, `orderId`, `storeId`, `reason`, `retryable`         |
| `OrderCompleted`          | Ordering   | Settlement          | `orderId`, `storeId`, `orderAmount`, `currency`, `completedAt`    |
| `SettlementRecorded`      | Settlement | Platform operations | `settlementId`, `orderId`, `storeId`, `payableAmount`, `currency` |

Settlement consumes Payment and Order facts through events or its own projections. It never reads Payment or Ordering tables directly.

## Event rules

- Consumers use `eventId` as the Inbox idempotency key.
- `correlationId` identifies one business request across Contexts.
- `causationId` identifies the event or command that caused the current event.
- `storeId` is required on every store-scoped event.
- `orderId` is required on every Order, Payment, Delivery, and Settlement event.
- Event payloads contain snapshots needed by consumers; consumers do not resolve facts by reaching into another Context's tables.
- A retry republishes the same event identity; it does not create a new business event.
- Breaking payload changes create a new event type or event version.

# Ordering

Ordering records a customer's request to buy Products from one Store and tracks the fulfillment lifecycle of that request. It owns the Order and its historical product and amount information.

## Language

**Order**:
A customer's request to buy one or more Products from exactly one Store.
_Avoid_: Purchase, transaction

**Order Line**:
One Product quantity and its agreed amount within an Order.
_Avoid_: Item, line item

**Product Snapshot**:
The Product name and Price captured when an Order is placed.
_Avoid_: Catalog reference, live product

**Order Amount**:
The total amount agreed for an Order at placement.
_Avoid_: Price, payment amount

**Order State**:
The current stage of an Order's fulfillment lifecycle.
_Avoid_: Payment status, delivery status

**Cancellation**:
The accepted ending of an Order before fulfillment reaches a non-cancellable stage.
_Avoid_: Deletion, refund

**Store Scope**:
The rule that every Order belongs to one and only one Store.
_Avoid_: Multi-store order, shared cart

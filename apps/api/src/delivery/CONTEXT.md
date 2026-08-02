# Delivery

Delivery fulfills one completed-for-delivery Order and tracks where it is in the delivery lifecycle. It owns the address snapshot and delivery state, but it does not own the Order lifecycle.

## Language

**Delivery**:
The fulfillment of one Order to one destination.
_Avoid_: Shipment, order

**Address Snapshot**:
The destination details captured for a Delivery at creation time.
_Avoid_: Customer address, live address

**Delivery Request**:
A request to arrange Delivery for an Order.
_Avoid_: Order, dispatch

**Delivery Status**:
The current progress of a Delivery.
_Avoid_: Order state, provider outcome

**Delivery Provider**:
An external or simulated party that accepts Delivery Requests and reports progress.
_Avoid_: Carrier, courier

**Delivery Completion**:
The confirmed arrival of a Delivery at its destination.
_Avoid_: Order completion, settlement

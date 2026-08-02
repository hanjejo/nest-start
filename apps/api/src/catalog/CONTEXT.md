# Catalog

Catalog defines what each Store offers and the price at which it is offered. It publishes the sellable view of products; Ordering owns the historical product snapshot captured in an Order.

## Language

**Product**:
A coffee or menu item that a Store may offer for sale.
_Avoid_: Item, SKU

**Price**:
The amount currently offered for a Product by a Store.
_Avoid_: Cost, charge

**Menu Visibility**:
The decision about whether a Product appears in a Store's customer-facing catalog.
_Avoid_: Product status, availability

**Published Product**:
A Product whose current Price and Menu Visibility make it selectable by customers.
_Avoid_: Active item, live SKU

**Archived Product**:
A Product no longer offered for new Orders while historical snapshots remain meaningful.
_Avoid_: Deleted product, removed item

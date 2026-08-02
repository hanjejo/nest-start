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

## v1 API boundary

Store Management exposes `GET/PATCH /api/stores/:storeId/operations`.
Catalog exposes the customer browse view at
`GET /api/stores/:storeId/catalog` and store-scoped management under
`/api/stores/:storeId/catalog/products`.

Products retain their owning `storeId`, descriptive fields, lifecycle, and
menu visibility. Prices are versioned records with integer `amountMinor`,
three-letter currency, and effective timestamps. Replacing a price closes the
previous version so a later Order can capture immutable product, store, and
price facts without depending on the current catalog.

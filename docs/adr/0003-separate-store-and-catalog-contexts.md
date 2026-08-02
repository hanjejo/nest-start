---
status: accepted
---

# Separate Store Management from Catalog

Store Management owns stores, operating status, hours, and store policies. Catalog owns products, prices, and menu visibility; Ordering references the selected store and product snapshots without owning either context's tables, keeping merchant operations separate from the sellable menu.

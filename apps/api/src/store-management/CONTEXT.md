# Store Management

Store Management represents the stores that operate on the platform and the rules that determine when and how each store can accept orders. It does not own products or orders.

## Language

**Store**:
A business location that accepts and fulfills orders.
_Avoid_: Branch, vendor

**Store Status**:
The current operating condition of a store.
_Avoid_: Availability, health

**Operating Hours**:
The recurring schedule during which a store may accept orders.
_Avoid_: Opening time, shift

**Store Policy**:
A rule that governs how a store accepts or fulfills orders.
_Avoid_: Configuration, preference

**Open**:
A Store Status that permits new orders when other Store Policies also allow them.
_Avoid_: Active, enabled

**Closed**:
A Store Status that prevents new orders while preserving existing order work.
_Avoid_: Disabled, offline

## v1 operations representation

Store identity remains in the shared `stores` table used by Identity and
Access assignments. Store Management owns its operational columns: `status`,
UTC-only `operatingHours`, and `policies`.

Operating hours are a weekday map of non-overlapping `[open, close)` intervals
using `HH:mm` strings. `24:00` is the only supported value after `23:59`.
Orderability always evaluates the current UTC day and time; the host machine's
local timezone is never used. The v1 policy is
`{ "acceptingOrders": boolean }`. A store is orderable only in `OPEN` status,
with `acceptingOrders: true`, and during one of its UTC intervals.

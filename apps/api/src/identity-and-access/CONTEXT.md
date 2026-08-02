# Identity and Access

Identity and Access establishes who can use the platform and what they are allowed to do. It owns authenticated identities, credentials, sessions, roles, permissions, and store assignments.

## Language

**Account**:
An authenticated identity that can sign in to the platform.
_Avoid_: User, profile

**Customer**:
A person who places and owns orders.
_Avoid_: Buyer, client

**Store Operator**:
A person who performs day-to-day work for an assigned store.
_Avoid_: Staff, worker

**Store Administrator**:
A person who manages an assigned store's configuration and catalog.
_Avoid_: Store owner, manager

**Platform Administrator**:
A person with platform-wide operational authority.
_Avoid_: Superuser, root

**Role**:
A named grouping of permissions assigned to an account.
_Avoid_: User type, access level

**Permission**:
A single capability an account may exercise.
_Avoid_: Role, privilege set

**Store Assignment**:
The relationship that grants an account a store-scoped role for one store.
_Avoid_: Membership, tenancy

**Refresh Session**:
An active sign-in session that can issue new access credentials until it expires or is revoked.
_Avoid_: Login, token

**Token Family**:
The sequence of rotated refresh credentials descended from one sign-in session.
_Avoid_: Token chain, session group

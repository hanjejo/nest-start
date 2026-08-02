import { randomUUID } from 'node:crypto';
import {
  boolean,
  check,
  integer,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const users = pgTable('users', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export const refreshSessionStatuses = ['ACTIVE', 'REVOKED', 'EXPIRED'] as const;
export type RefreshSessionStatus = (typeof refreshSessionStatuses)[number];

export const refreshSessionRevocationReasons = [
  'ROTATED',
  'LOGOUT',
  'LOGOUT_ALL',
  'TOKEN_REUSE',
] as const;
export type RefreshSessionRevocationReason =
  (typeof refreshSessionRevocationReasons)[number];

export const refreshSessions = pgTable(
  'refresh_sessions',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id')
      .notNull()
      .$defaultFn(() => randomUUID()),
    tokenHash: text('token_hash').notNull().unique(),
    status: text('status')
      .$type<RefreshSessionStatus>()
      .notNull()
      .default('ACTIVE'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revocationReason: text(
      'revocation_reason',
    ).$type<RefreshSessionRevocationReason | null>(),
  },
  (table) => [
    index('refresh_sessions_user_id_idx').on(table.userId),
    index('refresh_sessions_family_id_idx').on(table.familyId),
  ],
);

export type RefreshSession = typeof refreshSessions.$inferSelect;
export type NewRefreshSession = typeof refreshSessions.$inferInsert;

export const authenticationEventTypes = [
  'REFRESH_TOKEN_REUSE_DETECTED',
] as const;
export type AuthenticationEventType = (typeof authenticationEventTypes)[number];

export const authenticationEvents = pgTable(
  'authentication_events',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    sessionId: uuid('session_id').references(() => refreshSessions.id, {
      onDelete: 'set null',
    }),
    familyId: uuid('family_id'),
    eventType: text('event_type').$type<AuthenticationEventType>().notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('authentication_events_user_id_idx').on(table.userId),
    index('authentication_events_family_id_idx').on(table.familyId),
  ],
);

export type AuthenticationEvent = typeof authenticationEvents.$inferSelect;

export const roleAssignmentScopes = ['GLOBAL', 'STORE'] as const;
export type RoleAssignmentScope = (typeof roleAssignmentScopes)[number];

export const permissionScopes = ['GLOBAL', 'STORE'] as const;
export type PermissionScope = (typeof permissionScopes)[number];

export const roles = pgTable(
  'roles',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    name: text('name').notNull().unique(),
    description: text('description').notNull(),
    assignmentScope: text('assignment_scope')
      .$type<RoleAssignmentScope>()
      .notNull(),
    globalStoreAccess: boolean('global_store_access').notNull().default(false),
    system: boolean('system').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'roles_assignment_scope_check',
      sql`assignment_scope IN ('GLOBAL', 'STORE')`,
    ),
    check(
      'roles_global_store_access_check',
      sql`global_store_access = false OR assignment_scope = 'GLOBAL'`,
    ),
    index('roles_assignment_scope_idx').on(table.assignmentScope),
  ],
);

export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;

export const permissions = pgTable(
  'permissions',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    key: text('key').notNull().unique(),
    description: text('description').notNull(),
    scope: text('scope').$type<PermissionScope>().notNull(),
    system: boolean('system').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check('permissions_scope_check', sql`scope IN ('GLOBAL', 'STORE')`),
    index('permissions_scope_idx').on(table.scope),
  ],
);

export type Permission = typeof permissions.$inferSelect;
export type NewPermission = typeof permissions.$inferInsert;

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('role_permissions_role_permission_unique').on(
      table.roleId,
      table.permissionId,
    ),
    index('role_permissions_role_id_idx').on(table.roleId),
    index('role_permissions_permission_id_idx').on(table.permissionId),
  ],
);

export type RolePermission = typeof rolePermissions.$inferSelect;
export type NewRolePermission = typeof rolePermissions.$inferInsert;

export const storeStatuses = ['DRAFT', 'OPEN', 'CLOSED', 'SUSPENDED'] as const;
export type StoreStatus = (typeof storeStatuses)[number];

export const storeWeekdays = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;
export type StoreWeekday = (typeof storeWeekdays)[number];

export type OperatingHoursInterval = {
  open: string;
  close: string;
};
export type OperatingHours = Record<StoreWeekday, OperatingHoursInterval[]>;
export type StorePolicies = {
  acceptingOrders: boolean;
};

export const stores = pgTable(
  'stores',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    name: text('name').notNull().unique(),
    status: text('status').$type<StoreStatus>().notNull().default('DRAFT'),
    timezone: text('timezone').notNull().default('UTC'),
    operatingHours: jsonb('operating_hours')
      .$type<OperatingHours>()
      .notNull()
      .default(
        sql`'{"sunday":[],"monday":[],"tuesday":[],"wednesday":[],"thursday":[],"friday":[],"saturday":[]}'::jsonb`,
      ),
    policies: jsonb('policies')
      .$type<StorePolicies>()
      .notNull()
      .default(sql`'{"acceptingOrders":true}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'stores_status_check',
      sql`status IN ('DRAFT', 'OPEN', 'CLOSED', 'SUSPENDED')`,
    ),
    check('stores_timezone_check', sql`timezone = 'UTC'`),
    index('stores_name_idx').on(table.name),
    index('stores_status_idx').on(table.status),
  ],
);

export type Store = typeof stores.$inferSelect;
export type NewStore = typeof stores.$inferInsert;

export const productLifecycles = [
  'DRAFT',
  'PUBLISHED',
  'UNPUBLISHED',
  'ARCHIVED',
] as const;
export type ProductLifecycle = (typeof productLifecycles)[number];

export const products = pgTable(
  'products',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    lifecycle: text('lifecycle')
      .$type<ProductLifecycle>()
      .notNull()
      .default('DRAFT'),
    menuVisible: boolean('menu_visible').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'products_lifecycle_check',
      sql`lifecycle IN ('DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED')`,
    ),
    unique('products_store_name_unique').on(table.storeId, table.name),
    index('products_store_id_idx').on(table.storeId),
    index('products_store_visibility_idx').on(
      table.storeId,
      table.lifecycle,
      table.menuVisible,
    ),
  ],
);

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;

export const productPrices = pgTable(
  'product_prices',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    amountMinor: integer('amount_minor').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),
    effectiveFrom: timestamp('effective_from', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check('product_prices_amount_minor_check', sql`amount_minor >= 0`),
    check(
      'product_prices_currency_check',
      sql`currency = upper(currency) AND currency <> ''`,
    ),
    check(
      'product_prices_effective_range_check',
      sql`effective_to IS NULL OR effective_to >= effective_from`,
    ),
    index('product_prices_product_effective_idx').on(
      table.productId,
      table.effectiveFrom,
    ),
  ],
);

export type ProductPrice = typeof productPrices.$inferSelect;
export type NewProductPrice = typeof productPrices.$inferInsert;

export const orderStatuses = [
  'AWAITING_PAYMENT',
  'CONFIRMED',
  'PREPARING',
  'READY_FOR_DELIVERY',
  'DELIVERING',
  'COMPLETED',
  'CANCELLED',
] as const;
export type OrderStatus = (typeof orderStatuses)[number];

export const orders = pgTable(
  'orders',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'restrict' }),
    status: text('status')
      .$type<OrderStatus>()
      .notNull()
      .default('AWAITING_PAYMENT'),
    currency: varchar('currency', { length: 3 }).notNull(),
    totalAmountMinor: integer('total_amount_minor').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'orders_status_check',
      sql`status IN ('AWAITING_PAYMENT', 'CONFIRMED', 'PREPARING', 'READY_FOR_DELIVERY', 'DELIVERING', 'COMPLETED', 'CANCELLED')`,
    ),
    check(
      'orders_currency_check',
      sql`currency = upper(currency) AND currency <> ''`,
    ),
    check('orders_total_amount_minor_check', sql`total_amount_minor >= 0`),
    index('orders_customer_id_idx').on(table.customerId),
    index('orders_customer_created_at_idx').on(
      table.customerId,
      table.createdAt,
    ),
    index('orders_store_id_idx').on(table.storeId),
    index('orders_store_status_created_at_idx').on(
      table.storeId,
      table.status,
      table.createdAt,
    ),
    index('orders_status_idx').on(table.status),
  ],
);

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').notNull(),
    productName: text('product_name').notNull(),
    unitAmountMinor: integer('unit_amount_minor').notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    quantity: integer('quantity').notNull(),
    lineAmountMinor: integer('line_amount_minor').notNull(),
  },
  (table) => [
    check(
      'order_items_currency_check',
      sql`currency = upper(currency) AND currency <> ''`,
    ),
    check('order_items_unit_amount_minor_check', sql`unit_amount_minor >= 0`),
    check('order_items_quantity_check', sql`quantity > 0`),
    check('order_items_line_amount_minor_check', sql`line_amount_minor >= 0`),
    unique('order_items_order_product_unique').on(
      table.orderId,
      table.productId,
    ),
    index('order_items_order_id_idx').on(table.orderId),
    index('order_items_product_id_idx').on(table.productId),
  ],
);

export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;

export const roleAssignments = pgTable(
  'role_assignments',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id').references(() => stores.id, {
      onDelete: 'cascade',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('role_assignments_user_role_store_unique').on(
      table.userId,
      table.roleId,
      table.storeId,
    ),
    uniqueIndex('role_assignments_user_role_global_unique')
      .on(table.userId, table.roleId)
      .where(sql`${table.storeId} IS NULL`),
    index('role_assignments_user_id_idx').on(table.userId),
    index('role_assignments_role_id_idx').on(table.roleId),
    index('role_assignments_store_id_idx').on(table.storeId),
    index('role_assignments_user_store_idx').on(table.userId, table.storeId),
  ],
);

export type RoleAssignment = typeof roleAssignments.$inferSelect;
export type NewRoleAssignment = typeof roleAssignments.$inferInsert;

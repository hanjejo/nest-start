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
import { AddressSnapshot } from '../messaging/address-snapshot';

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
    aggregateVersion: integer('aggregate_version').notNull().default(1),
    currency: varchar('currency', { length: 3 }).notNull(),
    totalAmountMinor: integer('total_amount_minor').notNull(),
    addressSnapshot: jsonb('address_snapshot').$type<AddressSnapshot | null>(),
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
    check('orders_aggregate_version_check', sql`aggregate_version > 0`),
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

export const paymentIntentStatuses = [
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'EXPIRED',
] as const;
export type PaymentIntentStatus = (typeof paymentIntentStatuses)[number];

export const paymentAttemptStatuses = [
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'TIMED_OUT',
] as const;
export type PaymentAttemptStatus = (typeof paymentAttemptStatuses)[number];

export const paymentCallbackOutcomes = [
  'SUCCEEDED',
  'FAILED',
  'TIMED_OUT',
] as const;
export type PaymentCallbackOutcome = (typeof paymentCallbackOutcomes)[number];

export const paymentIntents = pgTable(
  'payment_intents',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    orderId: uuid('order_id').notNull(),
    customerId: uuid('customer_id').notNull(),
    storeId: uuid('store_id').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    status: text('status')
      .$type<PaymentIntentStatus>()
      .notNull()
      .default('PENDING'),
    aggregateVersion: integer('aggregate_version').notNull().default(1),
    currentAttemptNumber: integer('current_attempt_number')
      .notNull()
      .default(0),
    workflowGeneration: integer('workflow_generation').notNull().default(1),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    providerReference: text('provider_reference'),
    lastFailureReason: text('last_failure_reason'),
    lastFailureRetryable: boolean('last_failure_retryable')
      .notNull()
      .default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('payment_intents_order_id_unique').on(table.orderId),
    check(
      'payment_intents_status_check',
      sql`status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED')`,
    ),
    check('payment_intents_amount_minor_check', sql`amount_minor >= 0`),
    check(
      'payment_intents_currency_check',
      sql`currency = upper(currency) AND currency <> ''`,
    ),
    check(
      'payment_intents_aggregate_version_check',
      sql`aggregate_version > 0`,
    ),
    check(
      'payment_intents_current_attempt_number_check',
      sql`current_attempt_number >= 0`,
    ),
    check(
      'payment_intents_workflow_generation_check',
      sql`workflow_generation > 0`,
    ),
    check(
      'payment_intents_succeeded_reference_check',
      sql`status <> 'SUCCEEDED' OR provider_reference IS NOT NULL`,
    ),
    index('payment_intents_customer_status_idx').on(
      table.customerId,
      table.status,
      table.createdAt,
    ),
    index('payment_intents_status_expiry_idx').on(
      table.status,
      table.expiresAt,
    ),
    index('payment_intents_order_id_idx').on(table.orderId),
  ],
);

export type PaymentIntent = typeof paymentIntents.$inferSelect;
export type NewPaymentIntent = typeof paymentIntents.$inferInsert;

export const paymentAttempts = pgTable(
  'payment_attempts',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    paymentIntentId: uuid('payment_intent_id')
      .notNull()
      .references(() => paymentIntents.id, { onDelete: 'cascade' }),
    workflowGeneration: integer('workflow_generation').notNull().default(1),
    attemptNumber: integer('attempt_number').notNull(),
    providerIdempotencyKey: text('provider_idempotency_key').notNull().unique(),
    status: text('status')
      .$type<PaymentAttemptStatus>()
      .notNull()
      .default('PENDING'),
    providerReference: text('provider_reference').unique(),
    failureReason: text('failure_reason'),
    retryable: boolean('retryable').notNull().default(false),
    requestedAt: timestamp('requested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('payment_attempts_intent_number_unique').on(
      table.paymentIntentId,
      table.workflowGeneration,
      table.attemptNumber,
    ),
    check(
      'payment_attempts_status_check',
      sql`status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'TIMED_OUT')`,
    ),
    check('payment_attempts_number_check', sql`attempt_number > 0`),
    check(
      'payment_attempts_workflow_generation_check',
      sql`workflow_generation > 0`,
    ),
    check(
      'payment_attempts_succeeded_reference_check',
      sql`status <> 'SUCCEEDED' OR provider_reference IS NOT NULL`,
    ),
    index('payment_attempts_intent_created_idx').on(
      table.paymentIntentId,
      table.createdAt,
    ),
    index('payment_attempts_status_idx').on(table.status),
  ],
);

export type PaymentAttempt = typeof paymentAttempts.$inferSelect;
export type NewPaymentAttempt = typeof paymentAttempts.$inferInsert;

export const paymentCallbacks = pgTable(
  'payment_callbacks',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    paymentIntentId: uuid('payment_intent_id')
      .notNull()
      .references(() => paymentIntents.id, { onDelete: 'cascade' }),
    paymentAttemptId: uuid('payment_attempt_id')
      .notNull()
      .references(() => paymentAttempts.id, { onDelete: 'cascade' }),
    callbackId: text('callback_id').notNull().unique(),
    outcome: text('outcome').$type<PaymentCallbackOutcome>().notNull(),
    providerReference: text('provider_reference'),
    failureReason: text('failure_reason'),
    retryable: boolean('retryable').notNull().default(false),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('payment_callbacks_intent_callback_unique').on(
      table.paymentIntentId,
      table.callbackId,
    ),
    check(
      'payment_callbacks_outcome_check',
      sql`outcome IN ('SUCCEEDED', 'FAILED', 'TIMED_OUT')`,
    ),
    index('payment_callbacks_intent_received_idx').on(
      table.paymentIntentId,
      table.receivedAt,
    ),
  ],
);

export type PaymentCallback = typeof paymentCallbacks.$inferSelect;
export type NewPaymentCallback = typeof paymentCallbacks.$inferInsert;

export const outboxStatuses = [
  'PENDING',
  'PUBLISHED',
  'FAILED',
  'DEAD_LETTERED',
] as const;
export type OutboxStatus = (typeof outboxStatuses)[number];

export const inboxStatuses = [
  'PROCESSING',
  'PROCESSED',
  'FAILED',
  'DEAD_LETTERED',
] as const;
export type InboxStatus = (typeof inboxStatuses)[number];

export const deadLetterSources = ['OUTBOX', 'INBOX'] as const;
export type DeadLetterSource = (typeof deadLetterSources)[number];

export const outboxEvents = pgTable(
  'outbox_events',
  {
    eventId: text('event_id').primaryKey(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    eventType: text('event_type').notNull(),
    eventVersion: integer('event_version').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    producer: text('producer').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    aggregateVersion: integer('aggregate_version'),
    correlationId: text('correlation_id').notNull(),
    causationId: text('causation_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status').$type<OutboxStatus>().notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    lastError: text('last_error'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check('outbox_events_event_version_check', sql`event_version > 0`),
    check('outbox_events_attempts_check', sql`attempts >= 0`),
    check(
      'outbox_events_status_check',
      sql`status IN ('PENDING', 'PUBLISHED', 'FAILED', 'DEAD_LETTERED')`,
    ),
    index('outbox_events_status_attempt_idx').on(
      table.status,
      table.nextAttemptAt,
    ),
    index('outbox_events_aggregate_idx').on(
      table.aggregateType,
      table.aggregateId,
    ),
    index('outbox_events_event_type_idx').on(table.eventType),
  ],
);

export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type NewOutboxEvent = typeof outboxEvents.$inferInsert;

export const inboxEvents = pgTable(
  'inbox_events',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    consumerName: text('consumer_name').notNull(),
    eventId: text('event_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    eventType: text('event_type').notNull(),
    eventVersion: integer('event_version').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    producer: text('producer').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    aggregateVersion: integer('aggregate_version'),
    correlationId: text('correlation_id').notNull(),
    causationId: text('causation_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status').$type<InboxStatus>().notNull().default('PROCESSING'),
    attempts: integer('attempts').notNull().default(0),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('inbox_events_consumer_event_unique').on(
      table.consumerName,
      table.eventId,
    ),
    unique('inbox_events_consumer_idempotency_unique').on(
      table.consumerName,
      table.idempotencyKey,
    ),
    check('inbox_events_event_version_check', sql`event_version > 0`),
    check('inbox_events_attempts_check', sql`attempts >= 0`),
    check(
      'inbox_events_status_check',
      sql`status IN ('PROCESSING', 'PROCESSED', 'FAILED', 'DEAD_LETTERED')`,
    ),
    index('inbox_events_consumer_status_idx').on(
      table.consumerName,
      table.status,
      table.nextAttemptAt,
    ),
    index('inbox_events_event_id_idx').on(table.eventId),
  ],
);

export type InboxEvent = typeof inboxEvents.$inferSelect;
export type NewInboxEvent = typeof inboxEvents.$inferInsert;

export const deadLetterEvents = pgTable(
  'dead_letter_events',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    source: text('source').$type<DeadLetterSource>().notNull(),
    consumerName: text('consumer_name'),
    eventId: text('event_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    eventType: text('event_type').notNull(),
    eventVersion: integer('event_version').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    producer: text('producer').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    aggregateVersion: integer('aggregate_version'),
    correlationId: text('correlation_id').notNull(),
    causationId: text('causation_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    attempts: integer('attempts').notNull(),
    reason: text('reason').notNull(),
    failedAt: timestamp('failed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('dead_letter_events_source_consumer_event_unique').on(
      table.source,
      table.consumerName,
      table.eventId,
    ),
    check('dead_letter_events_event_version_check', sql`event_version > 0`),
    check('dead_letter_events_attempts_check', sql`attempts > 0`),
    index('dead_letter_events_event_id_idx').on(table.eventId),
    index('dead_letter_events_source_idx').on(table.source, table.failedAt),
  ],
);

export type DeadLetterEvent = typeof deadLetterEvents.$inferSelect;
export type NewDeadLetterEvent = typeof deadLetterEvents.$inferInsert;

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

export const deliveryStatuses = [
  'REQUESTED',
  'READY',
  'IN_TRANSIT',
  'DELIVERED',
  'FAILED',
] as const;
export type DeliveryStatus = (typeof deliveryStatuses)[number];

export const deliveryAttemptStatuses = [
  'PENDING',
  'SUCCEEDED',
  'FAILED',
] as const;
export type DeliveryAttemptStatus = (typeof deliveryAttemptStatuses)[number];

export const deliveryCallbackOutcomes = ['SUCCEEDED', 'FAILED'] as const;
export type DeliveryCallbackOutcome = (typeof deliveryCallbackOutcomes)[number];

export const deliveries = pgTable(
  'deliveries',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    orderId: uuid('order_id').notNull(),
    storeId: uuid('store_id').notNull(),
    customerId: uuid('customer_id').notNull(),
    addressSnapshot: jsonb('address_snapshot')
      .$type<AddressSnapshot>()
      .notNull(),
    status: text('status')
      .$type<DeliveryStatus>()
      .notNull()
      .default('REQUESTED'),
    aggregateVersion: integer('aggregate_version').notNull().default(1),
    currentAttemptNumber: integer('current_attempt_number')
      .notNull()
      .default(0),
    workflowGeneration: integer('workflow_generation').notNull().default(1),
    providerReference: text('provider_reference'),
    lastFailureReason: text('last_failure_reason'),
    lastFailureRetryable: boolean('last_failure_retryable')
      .notNull()
      .default(false),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('deliveries_order_id_unique').on(table.orderId),
    check(
      'deliveries_status_check',
      sql`status IN ('REQUESTED', 'READY', 'IN_TRANSIT', 'DELIVERED', 'FAILED')`,
    ),
    check('deliveries_aggregate_version_check', sql`aggregate_version > 0`),
    check(
      'deliveries_current_attempt_number_check',
      sql`current_attempt_number >= 0`,
    ),
    check('deliveries_workflow_generation_check', sql`workflow_generation > 0`),
    check(
      'deliveries_delivered_reference_check',
      sql`status <> 'DELIVERED' OR provider_reference IS NOT NULL`,
    ),
    index('deliveries_store_status_created_at_idx').on(
      table.storeId,
      table.status,
      table.createdAt,
    ),
    index('deliveries_customer_created_at_idx').on(
      table.customerId,
      table.createdAt,
    ),
    index('deliveries_status_idx').on(table.status),
    index('deliveries_order_id_idx').on(table.orderId),
  ],
);

export type Delivery = typeof deliveries.$inferSelect;
export type NewDelivery = typeof deliveries.$inferInsert;

export const deliveryAttempts = pgTable(
  'delivery_attempts',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    workflowGeneration: integer('workflow_generation').notNull().default(1),
    attemptNumber: integer('attempt_number').notNull(),
    providerIdempotencyKey: text('provider_idempotency_key').notNull().unique(),
    status: text('status')
      .$type<DeliveryAttemptStatus>()
      .notNull()
      .default('PENDING'),
    providerReference: text('provider_reference').unique(),
    failureReason: text('failure_reason'),
    retryable: boolean('retryable').notNull().default(false),
    requestedAt: timestamp('requested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('delivery_attempts_delivery_generation_number_unique').on(
      table.deliveryId,
      table.workflowGeneration,
      table.attemptNumber,
    ),
    check(
      'delivery_attempts_status_check',
      sql`status IN ('PENDING', 'SUCCEEDED', 'FAILED')`,
    ),
    check('delivery_attempts_number_check', sql`attempt_number > 0`),
    check(
      'delivery_attempts_workflow_generation_check',
      sql`workflow_generation > 0`,
    ),
    check(
      'delivery_attempts_succeeded_reference_check',
      sql`status <> 'SUCCEEDED' OR provider_reference IS NOT NULL`,
    ),
    index('delivery_attempts_delivery_created_idx').on(
      table.deliveryId,
      table.createdAt,
    ),
    index('delivery_attempts_status_idx').on(table.status),
  ],
);

export type DeliveryAttempt = typeof deliveryAttempts.$inferSelect;
export type NewDeliveryAttempt = typeof deliveryAttempts.$inferInsert;

export const deliveryCallbacks = pgTable(
  'delivery_callbacks',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    deliveryAttemptId: uuid('delivery_attempt_id')
      .notNull()
      .references(() => deliveryAttempts.id, { onDelete: 'cascade' }),
    callbackId: text('callback_id').notNull().unique(),
    outcome: text('outcome').$type<DeliveryCallbackOutcome>().notNull(),
    providerReference: text('provider_reference'),
    failureReason: text('failure_reason'),
    retryable: boolean('retryable').notNull().default(false),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('delivery_callbacks_delivery_callback_unique').on(
      table.deliveryId,
      table.callbackId,
    ),
    check(
      'delivery_callbacks_outcome_check',
      sql`outcome IN ('SUCCEEDED', 'FAILED')`,
    ),
    index('delivery_callbacks_delivery_received_idx').on(
      table.deliveryId,
      table.receivedAt,
    ),
  ],
);

export type DeliveryCallback = typeof deliveryCallbacks.$inferSelect;
export type NewDeliveryCallback = typeof deliveryCallbacks.$inferInsert;

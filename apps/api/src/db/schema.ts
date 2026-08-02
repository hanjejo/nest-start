import { randomUUID } from 'node:crypto';
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
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

export const stores = pgTable(
  'stores',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    name: text('name').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('stores_name_idx').on(table.name)],
);

export type Store = typeof stores.$inferSelect;
export type NewStore = typeof stores.$inferInsert;

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

import { randomUUID } from 'node:crypto';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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

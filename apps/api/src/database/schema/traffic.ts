import { pgTable, uuid, varchar, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users';

/** Administrator-managed rules on client addresses (single IPs or CIDR ranges). */
export const ipRules = pgTable(
  'ip_rules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** Normalised: a single address is stored as /32 (IPv4) or /128 (IPv6). */
    cidr: varchar('cidr', { length: 64 }).notNull(),
    /** DENY (refuse every request) or ALLOW. */
    action: varchar('action', { length: 8 }).notNull(),
    /** GLOBAL (a DENY blocks everything; an ALLOW is trusted and skips rate limits and automatic blocks) or ADMIN (an ALLOW restricts the admin routes to these ranges). */
    scope: varchar('scope', { length: 8 }).default('GLOBAL').notNull(),
    reason: varchar('reason', { length: 200 }).notNull(),
    createdBy: uuid('created_by'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('ip_rules_scope_idx').on(table.scope, table.action)]
);

/** A temporary block of an address, a user, or a login account, placed by an administrator or automatically after repeated abuse. */
export const trafficBlocks = pgTable(
  'traffic_blocks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** IP, USER or ACCOUNT (a login e-mail, stored as a hash). */
    subjectType: varchar('subject_type', { length: 8 }).notNull(),
    subject: varchar('subject', { length: 64 }).notNull(),
    reason: varchar('reason', { length: 200 }).notNull(),
    /** AUTO or ADMIN. */
    source: varchar('source', { length: 8 }).notNull(),
    createdBy: uuid('created_by'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('traffic_blocks_active_idx').on(table.subjectType, table.subject, table.expiresAt), index('traffic_blocks_created_idx').on(table.createdAt)]
);

/** A per-user limit that replaces the plan-based default. A null value keeps the default for that window. */
export const userRateOverrides = pgTable('user_rate_overrides', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  perMinute: integer('per_minute'),
  perDay: integer('per_day'),
  note: varchar('note', { length: 200 }),
  setBy: uuid('set_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

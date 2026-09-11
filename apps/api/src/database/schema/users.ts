import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { userRoleEnum, userStatusEnum } from './enums';

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: varchar('email', { length: 255 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }),
    firstName: varchar('first_name', { length: 100 }).notNull(),
    lastName: varchar('last_name', { length: 100 }).notNull(),
    displayName: varchar('display_name', { length: 200 }),
    role: userRoleEnum('role').default('USER').notNull(),
    status: userStatusEnum('status').default('ACTIVE').notNull(),
    provider: varchar('provider', { length: 50 }).default('EMAIL').notNull(),
    providerId: varchar('provider_id', { length: 255 }),
    googleId: varchar('google_id', { length: 255 }),
    microsoftId: varchar('microsoft_id', { length: 255 }),
    avatarUrl: text('avatar_url'),
    profilePicture: text('profile_picture'),
    phoneNumber: varchar('phone_number', { length: 50 }),
    organizationId: uuid('organization_id'),
    organizationName: varchar('organization_name', { length: 255 }),
    isEmailVerified: boolean('is_email_verified').default(false).notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    twoFactorEnabled: boolean('two_factor_enabled').default(false).notNull(),
    twoFactorSecret: text('two_factor_secret'),
    metadata: jsonb('metadata').default({}),
    lastLoginProvider: varchar('last_login_provider', { length: 50 }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('users_email_idx').on(table.email),
    uniqueIndex('users_google_id_idx').on(table.googleId),
    uniqueIndex('users_microsoft_id_idx').on(table.microsoftId),
    index('users_role_idx').on(table.role),
    index('users_status_idx').on(table.status),
    index('users_org_idx').on(table.organizationId),
    index('users_provider_idx').on(table.provider),
  ]
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 255 }).notNull(),
    familyId: uuid('family_id').defaultRandom().notNull(),
    isRevoked: boolean('is_revoked').default(false).notNull(),
    userAgent: text('user_agent'),
    ipAddress: varchar('ip_address', { length: 45 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('refresh_tokens_user_idx').on(table.userId),
    index('refresh_tokens_family_idx').on(table.familyId),
    index('refresh_tokens_hash_idx').on(table.tokenHash),
    index('refresh_tokens_expires_idx').on(table.expiresAt),
  ]
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    keyPrefix: varchar('key_prefix', { length: 16 }).notNull(),
    keyHash: varchar('key_hash', { length: 255 }).notNull(),
    scopes: jsonb('scopes').default(['read']).notNull(),
    rateLimit: jsonb('rate_limit').default({ limit: 100, ttl: 60 }),
    isActive: boolean('is_active').default(true).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('api_keys_user_idx').on(table.userId),
    index('api_keys_prefix_idx').on(table.keyPrefix),
    uniqueIndex('api_keys_hash_idx').on(table.keyHash),
  ]
);

export const usersRelations = relations(users, ({ many }) => ({
  refreshTokens: many(refreshTokens),
  apiKeys: many(apiKeys),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, {
    fields: [refreshTokens.userId],
    references: [users.id],
  }),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, {
    fields: [apiKeys.userId],
    references: [users.id],
  }),
}));

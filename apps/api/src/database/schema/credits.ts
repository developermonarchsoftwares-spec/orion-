import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { creditTransactionTypeEnum } from './enums';
import { users } from './users';
import { businesses } from './businesses';

export const userWallets = pgTable(
  'user_wallets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    dailyCredits: integer('daily_credits').default(5).notNull(),
    purchasedCredits: integer('purchased_credits').default(0).notNull(),
    balance: integer('balance').default(5).notNull(),
    lastDailyCreditDate: varchar('last_daily_credit_date', { length: 10 }),
    lifetimePurchased: integer('lifetime_purchased').default(0).notNull(),
    lifetimeUsed: integer('lifetime_used').default(0).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('user_wallets_user_idx').on(table.userId),
  ]
);

export const creditPackages = pgTable(
  'credit_packages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: varchar('slug', { length: 50 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    priceInr: integer('price_inr'), // null for enterprise/custom
    credits: integer('credits').notNull(),
    userLimit: integer('user_limit'), // null for unlimited
    billingType: varchar('billing_type', { length: 50 }).default('ONE_TIME').notNull(),
    popular: boolean('popular').default(false).notNull(),
    features: jsonb('features').default([]).notNull(),
    badgeText: varchar('badge_text', { length: 100 }),
    isActive: boolean('is_active').default(true).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('credit_packages_slug_idx').on(table.slug),
    index('credit_packages_is_active_idx').on(table.isActive),
    index('credit_packages_sort_order_idx').on(table.sortOrder),
  ]
);

export const pricingSettings = pgTable(
  'pricing_settings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    key: varchar('key', { length: 100 }).notNull(),
    value: jsonb('value').notNull(),
    description: varchar('description', { length: 255 }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('pricing_settings_key_idx').on(table.key),
  ]
);

export const creditTransactions = pgTable(
  'credit_transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    walletId: uuid('wallet_id')
      .notNull()
      .references(() => userWallets.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    amount: integer('amount').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    balanceType: varchar('balance_type', { length: 50 }).default('PURCHASED'),
    dailyBalanceAfter: integer('daily_balance_after'),
    purchasedBalanceAfter: integer('purchased_balance_after'),
    type: creditTransactionTypeEnum('type').notNull(),
    description: varchar('description', { length: 255 }).notNull(),
    referenceId: varchar('reference_id', { length: 255 }),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('credit_tx_wallet_idx').on(table.walletId),
    index('credit_tx_user_idx').on(table.userId),
    index('credit_tx_type_idx').on(table.type),
    index('credit_tx_created_at_idx').on(table.createdAt),
  ]
);

export const leadUnlocks = pgTable(
  'lead_unlocks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    creditsSpent: integer('credits_spent').default(1).notNull(),
    unlockedAt: timestamp('unlocked_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('lead_unlocks_user_business_idx').on(table.userId, table.businessId),
    index('lead_unlocks_user_idx').on(table.userId),
    index('lead_unlocks_business_idx').on(table.businessId),
  ]
);

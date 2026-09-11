import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const industries = pgTable(
  'industries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: varchar('code', { length: 50 }).notNull(),
    name: varchar('name', { length: 150 }).notNull(),
    slug: varchar('slug', { length: 150 }).notNull(),
    description: text('description'),
    parentId: uuid('parent_id'),
    businessCount: integer('business_count').default(0).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('industries_code_idx').on(table.code),
    uniqueIndex('industries_slug_idx').on(table.slug),
    index('industries_parent_idx').on(table.parentId),
    index('industries_name_idx').on(table.name),
  ]
);

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    industryId: uuid('industry_id').references(() => industries.id, { onDelete: 'set null' }),
    name: varchar('name', { length: 150 }).notNull(),
    slug: varchar('slug', { length: 150 }).notNull(),
    code: varchar('code', { length: 50 }),
    description: text('description'),
    iconName: varchar('icon_name', { length: 50 }),
    businessCount: integer('business_count').default(0).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('categories_slug_idx').on(table.slug),
    index('categories_industry_idx').on(table.industryId),
    index('categories_name_idx').on(table.name),
  ]
);

export const businessTypes = pgTable(
  'business_types',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: varchar('code', { length: 50 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    description: text('description'),
    legalForm: varchar('legal_form', { length: 100 }),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('business_types_code_idx').on(table.code),
    uniqueIndex('business_types_slug_idx').on(table.slug),
    index('business_types_name_idx').on(table.name),
  ]
);

export const msmeCategories = pgTable(
  'msme_categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: varchar('code', { length: 50 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    investmentLimitMax: integer('investment_limit_max'),
    turnoverLimitMax: integer('turnover_limit_max'),
    description: text('description'),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('msme_categories_code_idx').on(table.code),
    uniqueIndex('msme_categories_slug_idx').on(table.slug),
  ]
);

export const industriesRelations = relations(industries, ({ many }) => ({
  categories: many(categories),
}));

export const categoriesRelations = relations(categories, ({ one }) => ({
  industry: one(industries, {
    fields: [categories.industryId],
    references: [industries.id],
  }),
}));

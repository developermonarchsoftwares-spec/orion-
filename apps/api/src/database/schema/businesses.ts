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
import { relations } from 'drizzle-orm';
import {
  businessStatusEnum,
  businessOpportunityTierEnum,
  businessTypeEnum,
  msmeCategoryEnum,
} from './enums';
import { industries, categories, businessTypes, msmeCategories } from './taxonomies';

export const businesses = pgTable(
  'businesses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: varchar('slug', { length: 300 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    legalName: varchar('legal_name', { length: 255 }),
    status: businessStatusEnum('status').default('DRAFT').notNull(),
    industryId: uuid('industry_id').references(() => industries.id, { onDelete: 'set null' }),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    businessTypeId: uuid('business_type_id').references(() => businessTypes.id, { onDelete: 'set null' }),
    businessType: businessTypeEnum('business_type').default('PRIVATE_LIMITED'),
    msmeCategoryId: uuid('msme_category_id').references(() => msmeCategories.id, { onDelete: 'set null' }),
    msmeCategory: msmeCategoryEnum('msme_category').default('NOT_APPLICABLE'),
    opportunityTier: businessOpportunityTierEnum('opportunity_tier').default('LOW').notNull(),
    employeeCountRange: varchar('employee_count_range', { length: 50 }),
    annualRevenueRange: varchar('annual_revenue_range', { length: 50 }),
    foundingYear: integer('founding_year'),
    incorporationDate: timestamp('incorporation_date', { withTimezone: true }),
    description: text('description'),
    logoUrl: text('logo_url'),
    bannerUrl: text('banner_url'),
    isEnriched: boolean('is_enriched').default(false).notNull(),
    isVerified: boolean('is_verified').default(false).notNull(),
    lastEnrichedAt: timestamp('last_enriched_at', { withTimezone: true }),
    sourceId: uuid('source_id'),
    metadata: jsonb('metadata').default({}),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('businesses_slug_idx').on(table.slug),
    index('businesses_name_idx').on(table.name),
    index('businesses_legal_name_idx').on(table.legalName),
    index('businesses_status_idx').on(table.status),
    index('businesses_industry_idx').on(table.industryId),
    index('businesses_category_idx').on(table.categoryId),
    index('businesses_business_type_idx').on(table.businessTypeId),
    index('businesses_type_enum_idx').on(table.businessType),
    index('businesses_msme_category_idx').on(table.msmeCategoryId),
    index('businesses_opportunity_tier_idx').on(table.opportunityTier),
    index('businesses_created_at_idx').on(table.createdAt),
    index('businesses_published_at_idx').on(table.publishedAt),
  ]
);

export const businessesRelations = relations(businesses, ({ one }) => ({
  industry: one(industries, {
    fields: [businesses.industryId],
    references: [industries.id],
  }),
  category: one(categories, {
    fields: [businesses.categoryId],
    references: [categories.id],
  }),
  businessTypeRef: one(businessTypes, {
    fields: [businesses.businessTypeId],
    references: [businessTypes.id],
  }),
  msmeCategoryRef: one(msmeCategories, {
    fields: [businesses.msmeCategoryId],
    references: [msmeCategories.id],
  }),
}));

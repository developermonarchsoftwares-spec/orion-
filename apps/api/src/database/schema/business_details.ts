import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  decimal,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { identifierTypeEnum, digitalPlatformEnum } from './enums';
import { businesses } from './businesses';
import { users } from './users';

export const businessLocations = pgTable(
  'business_locations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    addressLine1: text('address_line1').notNull(),
    addressLine2: text('address_line2'),
    landmark: varchar('landmark', { length: 255 }),
    city: varchar('city', { length: 100 }).notNull(),
    district: varchar('district', { length: 100 }).notNull(),
    state: varchar('state', { length: 100 }).notNull(),
    pincode: varchar('pincode', { length: 20 }).notNull(),
    country: varchar('country', { length: 100 }).default('India').notNull(),
    latitude: decimal('latitude', { precision: 10, scale: 7 }),
    longitude: decimal('longitude', { precision: 10, scale: 7 }),
    isPrimary: boolean('is_primary').default(true).notNull(),
    isRegisteredOffice: boolean('is_registered_office').default(false).notNull(),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('bus_loc_business_idx').on(table.businessId),
    index('bus_loc_state_idx').on(table.state),
    index('bus_loc_district_idx').on(table.district),
    index('bus_loc_city_idx').on(table.city),
    index('bus_loc_pincode_idx').on(table.pincode),
    index('bus_loc_geo_idx').on(table.latitude, table.longitude),
  ]
);

export const businessContacts = pgTable(
  'business_contacts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    fullName: varchar('full_name', { length: 150 }).notNull(),
    title: varchar('title', { length: 150 }),
    department: varchar('department', { length: 100 }),
    email: varchar('email', { length: 255 }),
    isEmailVerified: boolean('is_email_verified').default(false).notNull(),
    phone: varchar('phone', { length: 50 }),
    isPhoneVerified: boolean('is_phone_verified').default(false).notNull(),
    isDirectDial: boolean('is_direct_dial').default(false).notNull(),
    linkedinUrl: text('linkedin_url'),
    isPrimary: boolean('is_primary').default(false).notNull(),
    isDecisionMaker: boolean('is_decision_maker').default(false).notNull(),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('bus_contacts_business_idx').on(table.businessId),
    index('bus_contacts_email_idx').on(table.email),
    index('bus_contacts_phone_idx').on(table.phone),
    index('bus_contacts_decision_maker_idx').on(table.isDecisionMaker),
  ]
);

export const digitalPresences = pgTable(
  'digital_presences',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    platform: digitalPlatformEnum('platform').notNull(),
    handle: varchar('handle', { length: 150 }),
    url: text('url').notNull(),
    domain: varchar('domain', { length: 255 }),
    isVerified: boolean('is_verified').default(false).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    followerCount: integer('follower_count'),
    techStackDetected: jsonb('tech_stack_detected').default([]),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('digital_presence_business_idx').on(table.businessId),
    index('digital_presence_platform_idx').on(table.platform),
    index('digital_presence_domain_idx').on(table.domain),
  ]
);

export const businessIdentifiers = pgTable(
  'business_identifiers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    type: identifierTypeEnum('type').notNull(),
    value: varchar('value', { length: 100 }).notNull(),
    normalizedValue: varchar('normalized_value', { length: 100 }).notNull(),
    isPrimary: boolean('is_primary').default(false).notNull(),
    isVerified: boolean('is_verified').default(false).notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('bus_ident_type_norm_val_idx').on(table.type, table.normalizedValue),
    index('bus_ident_business_idx').on(table.businessId),
    index('bus_ident_type_idx').on(table.type),
    index('bus_ident_val_idx').on(table.value),
  ]
);

export const businessMetrics = pgTable(
  'business_metrics',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    completenessScore: integer('completeness_score').default(0).notNull(),
    verificationScore: integer('verification_score').default(0).notNull(),
    freshnessScore: integer('freshness_score').default(0).notNull(),
    digitalPresenceScore: integer('digital_presence_score').default(0).notNull(),
    confidenceScore: integer('confidence_score').default(0).notNull(),
    factorBreakdown: jsonb('factor_breakdown').default({}).notNull(),
    lastCalculated: timestamp('last_calculated', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('bus_metrics_business_idx').on(table.businessId),
    index('bus_metrics_completeness_idx').on(table.completenessScore),
    index('bus_metrics_verification_idx').on(table.verificationScore),
  ]
);

export const businessScores = pgTable(
  'business_scores',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    orionScore: integer('orion_score').default(0).notNull(),
    scoreVersion: varchar('score_version', { length: 50 }).default('v1.0').notNull(),
    weightsApplied: jsonb('weights_applied').default({}).notNull(),
    calculatedAt: timestamp('calculated_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('bus_scores_business_idx').on(table.businessId),
    index('bus_scores_orion_score_idx').on(table.orionScore),
    index('bus_scores_calculated_at_idx').on(table.calculatedAt),
  ]
);

export const businessHistory = pgTable(
  'business_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    changedById: uuid('changed_by_id').references(() => users.id, { onDelete: 'set null' }),
    changeType: varchar('change_type', { length: 100 }).notNull(),
    fieldName: varchar('field_name', { length: 100 }),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    fullSnapshot: jsonb('full_snapshot').default({}).notNull(),
    changeReason: text('change_reason'),
    sourceBatchId: uuid('source_batch_id'),
    changedAt: timestamp('changed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('bus_history_business_idx').on(table.businessId),
    index('bus_history_changed_at_idx').on(table.changedAt),
    index('bus_history_change_type_idx').on(table.changeType),
  ]
);

export const businessRefreshHistory = pgTable(
  'business_refresh_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    triggeredById: uuid('triggered_by_id').references(() => users.id, { onDelete: 'set null' }),
    sourceId: uuid('source_id'),
    sourceType: varchar('source_type', { length: 100 }),
    fieldsUpdated: jsonb('fields_updated').default([]).notNull(),
    status: varchar('status', { length: 50 }).default('COMPLETED').notNull(),
    durationMs: integer('duration_ms'),
    refreshedAt: timestamp('refreshed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('bus_refresh_business_idx').on(table.businessId),
    index('bus_refresh_at_idx').on(table.refreshedAt),
  ]
);

export const businessLocationsRelations = relations(businessLocations, ({ one }) => ({
  business: one(businesses, {
    fields: [businessLocations.businessId],
    references: [businesses.id],
  }),
}));

export const businessContactsRelations = relations(businessContacts, ({ one }) => ({
  business: one(businesses, {
    fields: [businessContacts.businessId],
    references: [businesses.id],
  }),
}));

export const digitalPresencesRelations = relations(digitalPresences, ({ one }) => ({
  business: one(businesses, {
    fields: [digitalPresences.businessId],
    references: [businesses.id],
  }),
}));

export const businessIdentifiersRelations = relations(businessIdentifiers, ({ one }) => ({
  business: one(businesses, {
    fields: [businessIdentifiers.businessId],
    references: [businesses.id],
  }),
}));

export const businessMetricsRelations = relations(businessMetrics, ({ one }) => ({
  business: one(businesses, {
    fields: [businessMetrics.businessId],
    references: [businesses.id],
  }),
}));

export const businessScoresRelations = relations(businessScores, ({ one }) => ({
  business: one(businesses, {
    fields: [businessScores.businessId],
    references: [businesses.id],
  }),
}));

export const businessHistoryRelations = relations(businessHistory, ({ one }) => ({
  business: one(businesses, {
    fields: [businessHistory.businessId],
    references: [businesses.id],
  }),
}));

export const businessRefreshHistoryRelations = relations(businessRefreshHistory, ({ one }) => ({
  business: one(businesses, {
    fields: [businessRefreshHistory.businessId],
    references: [businesses.id],
  }),
}));

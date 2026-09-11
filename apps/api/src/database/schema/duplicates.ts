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
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { duplicateMatchTypeEnum, reviewActionEnum } from './enums';
import { importRecords } from './imports';
import { businesses } from './businesses';
import { users } from './users';

export const duplicateClusters = pgTable(
  'duplicate_clusters',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clusterKey: varchar('cluster_key', { length: 255 }).notNull(),
    primaryBusinessId: uuid('primary_business_id').references(() => businesses.id, { onDelete: 'set null' }),
    totalCandidates: integer('total_candidates').default(0).notNull(),
    status: varchar('status', { length: 50 }).default('PENDING').notNull(),
    resolvedAction: reviewActionEnum('resolved_action'),
    resolvedById: uuid('resolved_by_id').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('dup_clusters_key_idx').on(table.clusterKey),
    index('dup_clusters_primary_bus_idx').on(table.primaryBusinessId),
    index('dup_clusters_status_idx').on(table.status),
  ]
);

export const duplicateCandidates = pgTable(
  'duplicate_candidates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clusterId: uuid('cluster_id')
      .notNull()
      .references(() => duplicateClusters.id, { onDelete: 'cascade' }),
    recordId: uuid('record_id').references(() => importRecords.id, { onDelete: 'cascade' }),
    matchedBusinessId: uuid('matched_business_id').references(() => businesses.id, { onDelete: 'cascade' }),
    confidenceScore: decimal('confidence_score', { precision: 5, scale: 2 }).notNull(), // e.g. 95.50%
    matchType: duplicateMatchTypeEnum('match_type').notNull(),
    matchDetails: jsonb('match_details').default({}).notNull(),
    isResolved: boolean('is_resolved').default(false).notNull(),
    resolvedAction: reviewActionEnum('resolved_action'),
    resolvedNotes: text('resolved_notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('dup_candidates_cluster_idx').on(table.clusterId),
    index('dup_candidates_record_idx').on(table.recordId),
    index('dup_candidates_matched_bus_idx').on(table.matchedBusinessId),
    index('dup_candidates_match_type_idx').on(table.matchType),
    index('dup_candidates_confidence_idx').on(table.confidenceScore),
  ]
);

export const duplicateClustersRelations = relations(duplicateClusters, ({ many, one }) => ({
  candidates: many(duplicateCandidates),
  primaryBusiness: one(businesses, {
    fields: [duplicateClusters.primaryBusinessId],
    references: [businesses.id],
  }),
}));

export const duplicateCandidatesRelations = relations(duplicateCandidates, ({ one }) => ({
  cluster: one(duplicateClusters, {
    fields: [duplicateCandidates.clusterId],
    references: [duplicateClusters.id],
  }),
  record: one(importRecords, {
    fields: [duplicateCandidates.recordId],
    references: [importRecords.id],
  }),
  matchedBusiness: one(businesses, {
    fields: [duplicateCandidates.matchedBusinessId],
    references: [businesses.id],
  }),
}));

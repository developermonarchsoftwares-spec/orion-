import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { reviewActionEnum } from './enums';
import { importRecords } from './imports';
import { duplicateClusters } from './duplicates';
import { businesses } from './businesses';
import { users } from './users';

export const reviewQueue = pgTable(
  'review_queue',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    recordId: uuid('record_id')
      .notNull()
      .references(() => importRecords.id, { onDelete: 'cascade' }),
    clusterId: uuid('cluster_id').references(() => duplicateClusters.id, { onDelete: 'set null' }),
    priority: integer('priority').default(0).notNull(),
    status: varchar('status', { length: 50 }).default('PENDING').notNull(),
    reviewerId: uuid('reviewer_id').references(() => users.id, { onDelete: 'set null' }),
    decision: reviewActionEnum('decision'),
    reviewNotes: text('review_notes'),
    editedPayload: jsonb('edited_payload'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('review_queue_record_idx').on(table.recordId),
    index('review_queue_cluster_idx').on(table.clusterId),
    index('review_queue_status_idx').on(table.status),
    index('review_queue_priority_idx').on(table.priority),
    index('review_queue_reviewer_idx').on(table.reviewerId),
  ]
);

export const publishQueue = pgTable(
  'publish_queue',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    recordId: uuid('record_id')
      .notNull()
      .references(() => importRecords.id, { onDelete: 'cascade' }),
    targetBusinessId: uuid('target_business_id').references(() => businesses.id, { onDelete: 'set null' }),
    publishMode: varchar('publish_mode', { length: 50 }).default('CREATE').notNull(), // CREATE, UPDATE, MERGE
    status: varchar('status', { length: 50 }).default('PENDING').notNull(), // PENDING, PROCESSING, PUBLISHED, FAILED
    retryCount: integer('retry_count').default(0).notNull(),
    errorMessage: text('error_message'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).defaultNow().notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('publish_queue_record_idx').on(table.recordId),
    index('publish_queue_target_bus_idx').on(table.targetBusinessId),
    index('publish_queue_status_idx').on(table.status),
    index('publish_queue_scheduled_idx').on(table.scheduledAt),
  ]
);

export const reviewQueueRelations = relations(reviewQueue, ({ one }) => ({
  record: one(importRecords, {
    fields: [reviewQueue.recordId],
    references: [importRecords.id],
  }),
  cluster: one(duplicateClusters, {
    fields: [reviewQueue.clusterId],
    references: [duplicateClusters.id],
  }),
  reviewer: one(users, {
    fields: [reviewQueue.reviewerId],
    references: [users.id],
  }),
}));

export const publishQueueRelations = relations(publishQueue, ({ one }) => ({
  record: one(importRecords, {
    fields: [publishQueue.recordId],
    references: [importRecords.id],
  }),
  targetBusiness: one(businesses, {
    fields: [publishQueue.targetBusinessId],
    references: [businesses.id],
  }),
}));

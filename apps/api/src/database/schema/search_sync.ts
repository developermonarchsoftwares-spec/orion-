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
import { searchSyncStatusEnum } from './enums';
import { businesses } from './businesses';

export const searchSyncLogs = pgTable(
  'search_sync_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    action: varchar('action', { length: 50 }).default('UPSERT').notNull(), // UPSERT, DELETE
    status: searchSyncStatusEnum('status').default('PENDING').notNull(),
    retryCount: integer('retry_count').default(0).notNull(),
    errorMessage: text('error_message'),
    payloadSnapshot: jsonb('payload_snapshot'),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('search_sync_business_idx').on(table.businessId),
    index('search_sync_status_idx').on(table.status),
    index('search_sync_created_at_idx').on(table.createdAt),
  ]
);

export const searchSyncLogsRelations = relations(searchSyncLogs, ({ one }) => ({
  business: one(businesses, {
    fields: [searchSyncLogs.businessId],
    references: [businesses.id],
  }),
}));

import { pgTable, uuid, varchar, integer, timestamp, text, jsonb, index } from 'drizzle-orm/pg-core';

export const queueJobs = pgTable(
  'queue_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    queueName: varchar('queue_name', { length: 100 }).notNull(),
    jobName: varchar('job_name', { length: 100 }).notNull(),
    data: jsonb('data').notNull(),
    status: varchar('status', { length: 20 }).default('WAITING').notNull(), // WAITING, ACTIVE, COMPLETED, FAILED
    attempts: integer('attempts').default(0).notNull(),
    maxAttempts: integer('max_attempts').default(3).notNull(),
    error: text('error'),
    result: jsonb('result'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_queue_jobs_queue_status').on(table.queueName, table.status),
    index('idx_queue_jobs_created_at').on(table.createdAt),
  ],
);

export type QueueJob = typeof queueJobs.$inferSelect;
export type NewQueueJob = typeof queueJobs.$inferInsert;

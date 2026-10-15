import { pgTable, uuid, varchar, integer, boolean, timestamp, index, customType } from 'drizzle-orm/pg-core';
import { users } from './users';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

/** A recurring export. The file is produced for the owner and kept on its export job for a limited time. */
export const exportSchedules = pgTable(
  'export_schedules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    dataset: varchar('dataset', { length: 40 }).notNull(),
    format: varchar('format', { length: 8 }).notNull(),
    /** DAILY, WEEKLY or MONTHLY. */
    frequency: varchar('frequency', { length: 10 }).notNull(),
    hourUtc: integer('hour_utc').default(6).notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull(),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    /** COMPLETED or FAILED. */
    lastStatus: varchar('last_status', { length: 12 }),
    /** A schedule that fails three runs in a row is disabled. */
    consecutiveFailures: integer('consecutive_failures').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('export_schedules_user_idx').on(table.userId), index('export_schedules_due_idx').on(table.enabled, table.nextRunAt)]
);

/**
 * One row per export, on demand or scheduled: who, what, how many rows, when, how often downloaded. This is the export history
 * and, together with the EXPORT_* audit_logs entries, the audit trail. Only scheduled exports keep `content` (until `expires_at`).
 */
export const exportJobs = pgTable(
  'export_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scheduleId: uuid('schedule_id'),
    dataset: varchar('dataset', { length: 40 }).notNull(),
    format: varchar('format', { length: 8 }).notNull(),
    /** ON_DEMAND or SCHEDULED. */
    source: varchar('source', { length: 12 }).notNull(),
    /** COMPLETED, FAILED or EXPIRED (file removed after retention). */
    status: varchar('status', { length: 12 }).notNull(),
    rowCount: integer('row_count').default(0).notNull(),
    truncated: boolean('truncated').default(false).notNull(),
    fileName: varchar('file_name', { length: 255 }),
    contentType: varchar('content_type', { length: 100 }),
    sizeBytes: integer('size_bytes').default(0).notNull(),
    content: bytea('content'),
    error: varchar('error', { length: 500 }),
    downloadCount: integer('download_count').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => [index('export_jobs_user_idx').on(table.userId, table.createdAt), index('export_jobs_schedule_idx').on(table.scheduleId)]
);

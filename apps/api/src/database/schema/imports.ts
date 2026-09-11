import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import {
  dataSourceTypeEnum,
  importStatusEnum,
  importRecordStatusEnum,
  validationSeverityEnum,
} from './enums';
import { users } from './users';

export const dataSources = pgTable(
  'data_sources',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 150 }).notNull(),
    type: dataSourceTypeEnum('type').notNull(),
    description: text('description'),
    config: jsonb('config').default({}).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    totalRecordsIngested: integer('total_records_ingested').default(0).notNull(),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('data_sources_type_idx').on(table.type),
    index('data_sources_active_idx').on(table.isActive),
  ]
);

export const importBatches = pgTable(
  'import_batches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sourceId: uuid('source_id').references(() => dataSources.id, { onDelete: 'set null' }),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    filename: varchar('filename', { length: 255 }).notNull(),
    fileKey: text('file_key').notNull(),
    fileSize: integer('file_size').notNull(),
    mimeType: varchar('mime_type', { length: 100 }).default('text/csv').notNull(),
    status: importStatusEnum('status').default('PENDING').notNull(),
    totalRecords: integer('total_records').default(0).notNull(),
    processedRecords: integer('processed_records').default(0).notNull(),
    successfulRecords: integer('successful_records').default(0).notNull(),
    failedRecords: integer('failed_records').default(0).notNull(),
    duplicateRecords: integer('duplicate_records').default(0).notNull(),
    mappingConfig: jsonb('mapping_config').default({}).notNull(),
    options: jsonb('options').default({ autoNormalize: true, autoValidate: true, autoDetectDuplicates: true }).notNull(),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('import_batches_status_idx').on(table.status),
    index('import_batches_source_idx').on(table.sourceId),
    index('import_batches_created_by_idx').on(table.createdById),
    index('import_batches_created_at_idx').on(table.createdAt),
  ]
);

export const importRecords = pgTable(
  'import_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => importBatches.id, { onDelete: 'cascade' }),
    rowNumber: integer('row_number').notNull(),
    status: importRecordStatusEnum('status').default('PENDING').notNull(),
    rawPayload: jsonb('raw_payload').notNull(),
    normalizedPayload: jsonb('normalized_payload'),
    errorDetails: jsonb('error_details'),
    targetBusinessId: uuid('target_business_id'),
    hasDuplicates: boolean('has_duplicates').default(false).notNull(),
    isReviewed: boolean('is_reviewed').default(false).notNull(),
    isPublished: boolean('is_published').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('import_records_batch_idx').on(table.batchId),
    index('import_records_status_idx').on(table.status),
    index('import_records_row_num_idx').on(table.rowNumber),
    index('import_records_duplicates_idx').on(table.hasDuplicates),
  ]
);

export const validationLogs = pgTable(
  'validation_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    recordId: uuid('record_id')
      .notNull()
      .references(() => importRecords.id, { onDelete: 'cascade' }),
    ruleName: varchar('rule_name', { length: 100 }).notNull(),
    field: varchar('field', { length: 100 }).notNull(),
    severity: validationSeverityEnum('severity').default('ERROR').notNull(),
    message: text('message').notNull(),
    passed: boolean('passed').notNull(),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('validation_logs_record_idx').on(table.recordId),
    index('validation_logs_rule_idx').on(table.ruleName),
    index('validation_logs_severity_idx').on(table.severity),
  ]
);

export const importBatchesRelations = relations(importBatches, ({ many, one }) => ({
  records: many(importRecords),
  source: one(dataSources, {
    fields: [importBatches.sourceId],
    references: [dataSources.id],
  }),
}));

export const importRecordsRelations = relations(importRecords, ({ one, many }) => ({
  batch: one(importBatches, {
    fields: [importRecords.batchId],
    references: [importBatches.id],
  }),
  validationLogs: many(validationLogs),
}));

export const validationLogsRelations = relations(validationLogs, ({ one }) => ({
  record: one(importRecords, {
    fields: [validationLogs.recordId],
    references: [importRecords.id],
  }),
}));

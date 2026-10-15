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
  check,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
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
    /**
     * Phase 15: what Orion may do with records from this source. UNREVIEWED (the default, and the honest state of every source nobody has
     * assessed), APPROVED (records may be published), RESTRICTED (published only by an explicit, recorded override, never automatically; the
     * restriction text says what is permitted), REVOKED (nothing from it may be published and what it supplied is held back).
     */
    trustStatus: varchar('trust_status', { length: 12 }).default('UNREVIEWED').notNull(),
    /** Permitted purposes and limits, as recorded by the administrator who assessed the source. Internal: never shown to customers. */
    usageRestrictions: text('usage_restrictions'),
    /** How the data is obtained, as stated by the administrator (for example CSV_UPLOAD, MANUAL_ENTRY, LICENSED_DATASET, PARTNER_FEED). Not verified by Orion. */
    collectionMethod: varchar('collection_method', { length: 40 }),
    /** A reference to the source's terms, licence or public page, where one exists and may be recorded. */
    sourceReference: text('source_reference'),
    trustDecidedById: uuid('trust_decided_by_id').references(() => users.id, { onDelete: 'set null' }),
    trustDecidedAt: timestamp('trust_decided_at', { withTimezone: true }),
    trustReason: varchar('trust_reason', { length: 500 }),
    totalRecordsIngested: integer('total_records_ingested').default(0).notNull(),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('data_sources_type_idx').on(table.type),
    index('data_sources_active_idx').on(table.isActive),
    index('data_sources_trust_idx').on(table.trustStatus),
    check('data_sources_trust_chk', sql`${table.trustStatus} IN ('UNREVIEWED', 'APPROVED', 'RESTRICTED', 'REVOKED')`),
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
    /** Aggregate outcome of the (best-effort) People ingestion stage for this batch. Null = never attempted. */
    peopleSummary: jsonb('people_summary'),
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
    /** Outcome of the People ingestion stage for this row (counts + per-person outcome codes). */
    peopleResult: jsonb('people_result'),
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

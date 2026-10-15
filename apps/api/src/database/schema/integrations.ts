import { pgTable, uuid, varchar, integer, text, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users';

/** A customer's connection to a third-party system: an outbound webhook endpoint, or a CRM. Secrets are stored sealed, never in the clear. */
export const integrations = pgTable(
  'integrations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** WEBHOOK or HUBSPOT. */
    type: varchar('type', { length: 16 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    /** ACTIVE, PAUSED (by the owner) or DISABLED (switched off after repeated failures or a rejected credential). */
    status: varchar('status', { length: 12 }).default('ACTIVE').notNull(),
    targetUrl: varchar('target_url', { length: 500 }),
    events: jsonb('events').default([]).notNull(),
    /** Signs outbound deliveries and verifies inbound callbacks. Sealed (AES-256-GCM). */
    signingSecretEnc: text('signing_secret_enc').notNull(),
    /** The CRM access token. Sealed. */
    credentialEnc: text('credential_enc'),
    consecutiveFailures: integer('consecutive_failures').default(0).notNull(),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
    lastError: varchar('last_error', { length: 300 }),
    disabledReason: varchar('disabled_reason', { length: 100 }),
    lastValidation: jsonb('last_validation'),
    lastValidatedAt: timestamp('last_validated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('integrations_user_idx').on(table.userId), index('integrations_status_idx').on(table.status)]
);

/** One event for one webhook endpoint: its retry state, last response, and the receiver's acknowledgement callback. */
export const integrationDeliveries = pgTable(
  'integration_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    integrationId: uuid('integration_id')
      .notNull()
      .references(() => integrations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    event: varchar('event', { length: 50 }).notNull(),
    payload: jsonb('payload').notNull(),
    /** PENDING (not yet tried), FAILED (will retry), SUCCEEDED, or DEAD (retries exhausted or cancelled). */
    status: varchar('status', { length: 12 }).default('PENDING').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(),
    lastStatusCode: integer('last_status_code'),
    lastError: varchar('last_error', { length: 300 }),
    durationMs: integer('duration_ms'),
    /** The receiver's own result, reported through the callback endpoint: PROCESSED or REJECTED. */
    ackStatus: varchar('ack_status', { length: 12 }),
    ackMessage: varchar('ack_message', { length: 300 }),
    ackedAt: timestamp('acked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  (table) => [
    index('integration_deliveries_due_idx').on(table.status, table.nextAttemptAt),
    index('integration_deliveries_integration_idx').on(table.integrationId, table.createdAt),
  ]
);

/** What was pushed to a CRM for which local record, and a hash of what was pushed, so drift can be detected. */
export const syncRecords = pgTable(
  'sync_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    integrationId: uuid('integration_id')
      .notNull()
      .references(() => integrations.id, { onDelete: 'cascade' }),
    /** COMPANY or CONTACT. */
    entityType: varchar('entity_type', { length: 10 }).notNull(),
    localId: uuid('local_id').notNull(),
    externalId: varchar('external_id', { length: 100 }),
    payloadHash: varchar('payload_hash', { length: 64 }).notNull(),
    /** SYNCED or FAILED. */
    status: varchar('status', { length: 10 }).notNull(),
    lastError: varchar('last_error', { length: 300 }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('sync_records_entity_idx').on(table.integrationId, table.entityType, table.localId)]
);

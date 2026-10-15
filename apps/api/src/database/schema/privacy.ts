import { pgTable, uuid, varchar, text, boolean, timestamp, index, uniqueIndex, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';

/** Append-only consent ledger. The latest row per (user, purpose) is the current choice; history proves what was agreed and when. */
export const consentRecords = pgTable(
  'consent_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** ANALYTICS, MARKETING, PRODUCT_UPDATES or SALE_SHARING (the CCPA "do not sell or share" opt-out; Orion does not sell data). */
    purpose: varchar('purpose', { length: 32 }).notNull(),
    granted: boolean('granted').notNull(),
    policyVersion: varchar('policy_version', { length: 16 }).notNull(),
    /** web, settings or api. */
    source: varchar('source', { length: 16 }).default('settings').notNull(),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('consent_records_user_purpose_idx').on(table.userId, table.purpose, table.createdAt)]
);

/** Data-subject requests (GDPR Art. 15/17/20, CCPA access/delete). due_at is the statutory deadline (30 days). Holds no personal data beyond a hash of the email. */
export const privacyRequests = pgTable(
  'privacy_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    emailHash: varchar('email_hash', { length: 64 }).notNull(),
    /** EXPORT or DELETE. */
    type: varchar('type', { length: 8 }).notNull(),
    /** PENDING (waiting out the cooling-off period), COMPLETED, REJECTED or CANCELLED. */
    status: varchar('status', { length: 12 }).default('PENDING').notNull(),
    note: varchar('note', { length: 300 }),
    requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
    /** A deletion runs at or after this time; the user can cancel until then. */
    executeAfter: timestamp('execute_after', { withTimezone: true }),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('privacy_requests_user_idx').on(table.userId),
    index('privacy_requests_status_idx').on(table.status, table.executeAfter),
  ]
);

/**
 * Requests from individuals who are NOT necessarily Orion customers: removal, suppression, correction or a report about a contact value
 * (Phase 11). The request holds a one-way digest of the value it is about, never the value. The requester's contact e-mail and a proposed
 * correction are kept only until the request ends and are then cleared. Free text is internal and never returned to other people.
 */
export const dataSubjectRequests = pgTable(
  'data_subject_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** Public reference the requester quotes (not a secret). */
    reference: varchar('reference', { length: 20 }).notNull(),
    /** sha256 of the secret sent only to the requester's mailbox; unlocks status, verification and replies. */
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    /** REMOVAL, SUPPRESSION, CORRECTION or REPORT. */
    type: varchar('type', { length: 12 }).notNull(),
    /** REQUESTED, VALIDATING, NEEDS_INFO, APPROVED, SUPPRESSED, COMPLETED or REJECTED. */
    status: varchar('status', { length: 12 }).default('REQUESTED').notNull(),
    /** EMAIL, PHONE or LINKEDIN: what kind of value the request is about. */
    subjectKind: varchar('subject_kind', { length: 8 }).notNull(),
    /** sha256 of the normalised value (see contact_suppressions). The value itself is not stored. */
    subjectDigest: varchar('subject_digest', { length: 64 }).notNull(),
    /** SUBJECT or REPRESENTATIVE. A representative is never auto-trusted. */
    requesterRole: varchar('requester_role', { length: 14 }).default('SUBJECT').notNull(),
    /** What was proved: EMAIL_CONTROL (the mailbox in question confirmed), CONTACT_EMAIL_ONLY (only the requester's own mailbox) or NONE. */
    evidence: varchar('evidence', { length: 20 }).default('NONE').notNull(),
    contactEmail: varchar('contact_email', { length: 255 }),
    proposedValue: varchar('proposed_value', { length: 255 }),
    details: varchar('details', { length: 500 }),
    requesterNote: varchar('requester_note', { length: 500 }),
    /** The only reviewer text the requester can read. */
    publicMessage: varchar('public_message', { length: 300 }),
    /** Internal. */
    decisionReason: varchar('decision_reason', { length: 500 }),
    /** Counts only: { contacts, businesses, people }. */
    matchSummary: jsonb('match_summary'),
    resultSummary: jsonb('result_summary'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    decidedById: uuid('decided_by_id').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('dsr_reference_uq').on(table.reference),
    // one open request per (type, value): a repeat is a no-op, not a second queue entry or a second e-mail
    uniqueIndex('dsr_open_subject_uq').on(table.type, table.subjectKind, table.subjectDigest).where(sql`${table.status} NOT IN ('COMPLETED', 'REJECTED')`),
    index('dsr_status_idx').on(table.status, table.createdAt),
    index('dsr_subject_idx').on(table.subjectKind, table.subjectDigest),
  ]
);

/**
 * Durable record that a contact value must not be (re)introduced into customer-facing company contacts. Holds a digest only, never the value,
 * the name or the company. Rows cannot be edited or deleted (database triggers). Enforced by a trigger on business_contacts, so every writer
 * (import publishing, scripts, direct SQL) is covered.
 */
export const contactSuppressions = pgTable(
  'contact_suppressions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** EMAIL, PHONE or LINKEDIN. */
    identityKind: varchar('identity_kind', { length: 8 }).notNull(),
    identityDigest: varchar('identity_digest', { length: 64 }).notNull(),
    /** CONTACT: a row carrying this value is not stored at all. FIELD: the row is stored without this value. Phones are always FIELD (a number can be shared). */
    scope: varchar('scope', { length: 8 }).notNull(),
    requestId: uuid('request_id').references(() => dataSubjectRequests.id, { onDelete: 'set null' }),
    /** A short code, never free text: REMOVAL, SUPPRESSION, CORRECTED_OUT or LINKED_IDENTIFIER. */
    reasonCode: varchar('reason_code', { length: 20 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('contact_suppressions_uq').on(table.identityKind, table.identityDigest)]
);

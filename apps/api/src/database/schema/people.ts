import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  date,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { dataSourceTypeEnum, personVerificationStatusEnum } from './enums';
import { users } from './users';
import { businesses } from './businesses';

/**
 * People / Decision-Maker Intelligence (customer-facing layer).
 *
 * A `person` is a real-world individual, independent of any one company. The role a person
 * holds inside a company lives on `company_people` (a person can hold several roles), and so
 * does the role classification, because it is company-specific. Contact points live in
 * `person_contacts` and evidence in `people_evidence`.
 *
 * Customer-facing endpoints never write these tables (except `person_unlocks`). The future
 * enrichment pipeline writes through PeopleWriteService. Customers only see rows with
 * data_status = 'PUBLISHED'.
 */
export const people = pgTable(
  'people',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    firstName: varchar('first_name', { length: 100 }),
    middleName: varchar('middle_name', { length: 100 }),
    lastName: varchar('last_name', { length: 100 }),
    fullName: varchar('full_name', { length: 200 }).notNull(),
    normalizedName: varchar('normalized_name', { length: 200 }).notNull(),
    /** Earlier normalised names (from reviewer corrections) so re-ingesting the old spelling still finds this person. */
    nameAliases: text('name_aliases').array().default(sql`'{}'::text[]`).notNull(),
    linkedinUrl: text('linkedin_url'),
    /** Canonical LinkedIn URL; the strongest person-level dedupe key. */
    normalizedLinkedinUrl: varchar('normalized_linkedin_url', { length: 300 }),
    photoUrl: text('photo_url'),
    city: varchar('city', { length: 100 }),
    state: varchar('state', { length: 100 }),
    country: varchar('country', { length: 100 }),
    /** DRAFT (invisible) | PUBLISHED (customer-visible) | SUPPRESSED (opt-out / takedown) */
    dataStatus: varchar('data_status', { length: 20 }).default('DRAFT').notNull(),
    verificationStatus: personVerificationStatusEnum('verification_status').default('UNVERIFIED').notNull(),
    confidenceScore: integer('confidence_score').default(0).notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('people_norm_linkedin_idx')
      .on(table.normalizedLinkedinUrl)
      .where(sql`${table.normalizedLinkedinUrl} IS NOT NULL`),
    index('people_normalized_name_idx').on(table.normalizedName),
    index('people_data_status_idx').on(table.dataStatus),
    index('people_city_idx').on(table.city),
    index('people_state_idx').on(table.state),
    check('people_data_status_chk', sql`${table.dataStatus} IN ('DRAFT', 'PUBLISHED', 'SUPPRESSED')`),
    check('people_confidence_chk', sql`${table.confidenceScore} BETWEEN 0 AND 100`),
  ],
);

export const companyPeople = pgTable(
  'company_people',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    /** OWNER | FOUNDER | EXECUTIVE | DIRECTOR | PARTNER | EMPLOYEE | ADVISOR | OTHER */
    relationshipType: varchar('relationship_type', { length: 30 }).default('EMPLOYEE').notNull(),
    jobTitleAtCompany: varchar('job_title_at_company', { length: 200 }).notNull(),
    normalizedJobTitle: varchar('normalized_job_title', { length: 200 }).notNull(),
    /**
     * Earlier normalised titles of this same relationship (set when a reviewer changes the title).
     * Re-ingesting an old title resolves to this role instead of creating a second one.
     */
    titleAliases: text('title_aliases').array().default(sql`'{}'::text[]`).notNull(),
    /** Classification output (modules/people/classification); never rely on the raw title alone. */
    department: varchar('department', { length: 40 }).default('UNKNOWN').notNull(),
    seniorityLevel: varchar('seniority_level', { length: 30 }).default('UNKNOWN').notNull(),
    /** NULL when the role is not classified as a decision-making role. */
    decisionMakerType: varchar('decision_maker_type', { length: 60 }),
    isCurrent: boolean('is_current').default(true).notNull(),
    /**
     * Role-level publication gate. A role is customer-visible only when this is true AND the
     * person is PUBLISHED. Ingestion creates roles unpublished so a newly discovered role of an
     * already-published person is never exposed before review.
     */
    isPublished: boolean('is_published').default(false).notNull(),
    /**
     * Internal review state. PENDING (awaiting review) | APPROVED (published) | REJECTED | QUARANTINED
     * (held for data fixes). DB invariant: is_published implies APPROVED (see check constraint).
     */
    reviewStatus: varchar('review_status', { length: 20 }).default('PENDING').notNull(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedById: uuid('reviewed_by_id').references(() => users.id, { onDelete: 'set null' }),
    reviewNote: text('review_note'),
    /** AUTO = derived by classifyRole; REVIEWER = set by a reviewer and protected from re-ingestion. */
    classificationSource: varchar('classification_source', { length: 10 }).default('AUTO').notNull(),
    /**
     * Taxonomy version that produced the AUTO classification currently in force (Phase 6.5). NULL = classified before
     * versioning existed (nothing is back-filled) or set by a reviewer. The full history lives in company_people_classifications.
     */
    classificationVersion: varchar('classification_version', { length: 20 }),
    /** EXACT_RULE | NORMALIZED_RULE | FALLBACK | UNCLASSIFIED; NULL for legacy or reviewer-set classifications. */
    classificationStrength: varchar('classification_strength', { length: 16 }),
    classifiedAt: timestamp('classified_at', { withTimezone: true }),
    startDate: date('start_date'),
    endDate: date('end_date'),
    confidenceScore: integer('confidence_score').default(0).notNull(),
    verificationStatus: personVerificationStatusEnum('verification_status').default('UNVERIFIED').notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    /**
     * Freshness (Phase 6.7). last_seen_at (above) = Orion last saw THIS role claim again. last_confirmed_at = a reviewer last
     * accepted (approved) it. Neither is verification: verified_at lives in the verification ledger. NULL = never / unknown.
     */
    lastConfirmedAt: timestamp('last_confirmed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('company_people_role_uq').on(table.businessId, table.personId, table.normalizedJobTitle),
    index('company_people_business_current_idx').on(table.businessId, table.isCurrent),
    index('company_people_person_idx').on(table.personId),
    index('company_people_dm_type_idx').on(table.decisionMakerType),
    index('company_people_department_idx').on(table.department),
    index('company_people_seniority_idx').on(table.seniorityLevel),
    index('company_people_review_idx').on(table.reviewStatus, table.createdAt),
    check('company_people_review_status_chk', sql`${table.reviewStatus} IN ('PENDING', 'APPROVED', 'REJECTED', 'QUARANTINED')`),
    check('company_people_classification_source_chk', sql`${table.classificationSource} IN ('AUTO', 'REVIEWER')`),
    check(
      'company_people_classification_strength_chk',
      sql`${table.classificationStrength} IS NULL OR ${table.classificationStrength} IN ('EXACT_RULE', 'NORMALIZED_RULE', 'FALLBACK', 'UNCLASSIFIED')`,
    ),
    check('company_people_published_approved_chk', sql`${table.isPublished} = false OR ${table.reviewStatus} = 'APPROVED'`),
    check('company_people_confidence_chk', sql`${table.confidenceScore} BETWEEN 0 AND 100`),
  ],
);

export const personContacts = pgTable(
  'person_contacts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    /** WORK_EMAIL | PHONE | MOBILE. Personal email is deliberately not modelled. */
    contactType: varchar('contact_type', { length: 20 }).notNull(),
    contactValue: varchar('contact_value', { length: 255 }).notNull(),
    normalizedValue: varchar('normalized_value', { length: 255 }).notNull(),
    isPrimary: boolean('is_primary').default(false).notNull(),
    /** Only published contact points are ever returned to customers, even after unlock. */
    isPublished: boolean('is_published').default(false).notNull(),
    verificationStatus: personVerificationStatusEnum('verification_status').default('UNVERIFIED').notNull(),
    confidenceScore: integer('confidence_score').default(0).notNull(),
    sourceType: dataSourceTypeEnum('source_type'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    /**
     * Freshness (Phase 6.7). last_seen_at = Orion last saw THIS contact claim again (NULL on contacts that predate it: unknown,
     * not back-filled). last_confirmed_at = a reviewer last accepted (published) it. Neither is verification.
     */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    lastConfirmedAt: timestamp('last_confirmed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('person_contacts_uq').on(table.personId, table.contactType, table.normalizedValue),
    index('person_contacts_lookup_idx').on(table.contactType, table.normalizedValue),
    index('person_contacts_person_idx').on(table.personId),
    check('person_contacts_type_chk', sql`${table.contactType} IN ('WORK_EMAIL', 'PHONE', 'MOBILE')`),
    check('person_contacts_confidence_chk', sql`${table.confidenceScore} BETWEEN 0 AND 100`),
  ],
);

export const peopleEvidence = pgTable(
  'people_evidence',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    /** Set when the evidence supports a specific company role. */
    companyPersonId: uuid('company_person_id').references(() => companyPeople.id, { onDelete: 'cascade' }),
    /** Set when the evidence supports a specific contact point. */
    contactId: uuid('contact_id').references(() => personContacts.id, { onDelete: 'cascade' }),
    /** sha256 of (target, source, evidence type, source locator): re-observing a source updates the row. */
    fingerprint: varchar('fingerprint', { length: 64 }),
    sourceType: dataSourceTypeEnum('source_type').notNull(),
    /** e.g. REGISTRY_FILING | COMPANY_WEBSITE | PROFESSIONAL_PROFILE | MANUAL_REVIEW | EMAIL_CHECK */
    evidenceType: varchar('evidence_type', { length: 40 }).notNull(),
    /** Internal only: never returned by customer-facing endpoints. */
    sourceUrl: text('source_url'),
    sourceReference: varchar('source_reference', { length: 255 }),
    observedAt: timestamp('observed_at', { withTimezone: true }).defaultNow().notNull(),
    /** Evidence only counts toward "verified" when this is set. */
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    confidenceScore: integer('confidence_score').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('people_evidence_person_idx').on(table.personId),
    index('people_evidence_company_person_idx').on(table.companyPersonId),
    index('people_evidence_contact_idx').on(table.contactId),
    uniqueIndex('people_evidence_fingerprint_uq')
      .on(table.fingerprint)
      .where(sql`${table.fingerprint} IS NOT NULL`),
    check('people_evidence_confidence_chk', sql`${table.confidenceScore} BETWEEN 0 AND 100`),
  ],
);

/**
 * Field-level verification ledger. One row per (claim target, claimed value): WHAT was verified
 * (claim_type + claimed_value), WHO (verified_by_*), WHEN (verified_at), WHY (note) and BASED ON WHAT
 * (evidence_id -> people_evidence). Approval/publication is a separate decision (company_people.review_status).
 * A changed value gets a new row; the previous row stays as history.
 */
export const peopleVerifications = pgTable(
  'people_verifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** IDENTITY | RELATIONSHIP | TITLE | EMAIL | PHONE | LINKEDIN */
    claimType: varchar('claim_type', { length: 20 }).notNull(),
    /** '<CLAIM>:<subject id>', e.g. TITLE:<company_people.id>, EMAIL:<person_contacts.id>. */
    targetKey: varchar('target_key', { length: 80 }).notNull(),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    companyPersonId: uuid('company_person_id').references(() => companyPeople.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').references(() => personContacts.id, { onDelete: 'cascade' }),
    /**
     * The value the decision was about, for change detection and history. Identity / relationship / title
     * store the (public role-level) normalised value; email / phone / LinkedIn store ONLY a digest
     * ('h:' + sha256) so contact data is never duplicated here. See claimedValueFor().
     */
    claimedValue: varchar('claimed_value', { length: 300 }).notNull(),
    /** VERIFIED | DISPUTED */
    status: varchar('status', { length: 12 }).notNull(),
    evidenceId: uuid('evidence_id').references(() => peopleEvidence.id, { onDelete: 'set null' }),
    evidenceStrength: integer('evidence_strength').default(0).notNull(),
    /** REVIEWER (a named human) | SYSTEM (ingestion or migration; never a human, never has verified_by_id). */
    verifiedByKind: varchar('verified_by_kind', { length: 10 }).default('REVIEWER').notNull(),
    /** REVIEWER_EVIDENCE | INGESTION_ATTESTED | LEGACY_BACKFILL */
    method: varchar('method', { length: 30 }).default('REVIEWER_EVIDENCE').notNull(),
    /** For SYSTEM rows: the SOURCE that attested it (e.g. GOVERNMENT_REGISTRY). Not a person in this system. */
    attestedBy: varchar('attested_by', { length: 255 }),
    verifiedById: uuid('verified_by_id').references(() => users.id, { onDelete: 'set null' }),
    verifiedByLabel: varchar('verified_by_label', { length: 255 }).notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).defaultNow().notNull(),
    note: text('note').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('people_verifications_target_value_uq').on(table.targetKey, table.claimedValue),
    index('people_verifications_person_idx').on(table.personId),
    index('people_verifications_role_idx').on(table.companyPersonId),
    check(
      'people_verifications_claim_chk',
      sql`${table.claimType} IN ('IDENTITY', 'RELATIONSHIP', 'TITLE', 'EMAIL', 'PHONE', 'LINKEDIN')`,
    ),
    check('people_verifications_status_chk', sql`${table.status} IN ('VERIFIED', 'DISPUTED')`),
    check('people_verifications_kind_chk', sql`${table.verifiedByKind} IN ('REVIEWER', 'SYSTEM')`),
    check('people_verifications_method_chk', sql`${table.method} IN ('REVIEWER_EVIDENCE', 'INGESTION_ATTESTED', 'LEGACY_BACKFILL')`),
    // a system event can never be attributed to a human account
    check('people_verifications_system_no_human_chk', sql`${table.verifiedByKind} = 'REVIEWER' OR ${table.verifiedById} IS NULL`),
  ],
);

/**
 * Source registry (Phase 6.1): describes WHERE people data may come from and WHAT each source is allowed to claim.
 * Rows hold no credentials or secrets (enforced in SourceRegistryService). The registry describes a source; an adapter
 * supplies records; only PeopleIngestionService writes People data.
 */
export const peopleSources = pgTable(
  'people_sources',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** Stable, human-readable identifier; never reused. */
    key: varchar('key', { length: 60 }).notNull(),
    displayName: varchar('display_name', { length: 120 }).notNull(),
    /** Reuses the existing data-source categories. */
    sourceType: dataSourceTypeEnum('source_type').notNull(),
    version: varchar('version', { length: 20 }).default('1').notNull(),
    /** A source is usable only when enabled AND its terms are acknowledged (DB-enforced for enabled). */
    enabled: boolean('enabled').default(false).notNull(),
    termsReference: varchar('terms_reference', { length: 255 }),
    termsAcknowledgedAt: timestamp('terms_acknowledged_at', { withTimezone: true }),
    /** NONE | LOW | MEDIUM | HIGH */
    costClass: varchar('cost_class', { length: 10 }).default('NONE').notNull(),
    freshnessTtlDays: integer('freshness_ttl_days'),
    /** NONE | PARTIAL | FULL: the most the source may attest (always as a SYSTEM event, never human verification). */
    maxAttestation: varchar('max_attestation', { length: 10 }).default('NONE').notNull(),
    /** NULL = unrestricted (allowed only for internal, human-supplied source types). */
    allowedEvidenceTypes: text('allowed_evidence_types').array(),
    /** { permissions: {identity,title,email,phone,linkedin,evidence,attestation}, enforceSourceType }. No secrets. */
    policy: jsonb('policy').default(sql`'{}'::jsonb`).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('people_sources_key_uq').on(table.key),
    check('people_sources_key_chk', sql`${table.key} ~ '^[a-z0-9][a-z0-9._-]{1,58}$'`),
    check('people_sources_version_chk', sql`length(trim(${table.version})) > 0`),
    check('people_sources_cost_chk', sql`${table.costClass} IN ('NONE', 'LOW', 'MEDIUM', 'HIGH')`),
    check('people_sources_attestation_chk', sql`${table.maxAttestation} IN ('NONE', 'PARTIAL', 'FULL')`),
    check('people_sources_ttl_chk', sql`${table.freshnessTtlDays} IS NULL OR ${table.freshnessTtlDays} > 0`),
    check('people_sources_policy_chk', sql`jsonb_typeof(${table.policy}) = 'object'`),
    check('people_sources_enabled_terms_chk', sql`${table.enabled} = false OR ${table.termsAcknowledgedAt} IS NOT NULL`),
    check('people_sources_evidence_types_chk', sql`${table.allowedEvidenceTypes} IS NOT NULL OR ${table.sourceType} IN ('MANUAL_IMPORT', 'USER_SUBMISSION')`),
  ],
);

/**
 * Append-only observation history (Phase 6.2): one row each time a registered source hands Orion a record.
 * It answers WHICH source (and version), WHICH source record, WHICH run, WHEN acquired, WHEN the source says it was true,
 * WHAT it said about the role (name/title/currency), and WHAT came of it (ingested -> person / role / evidence, or quarantined).
 * It holds NO contact data and no raw payload (only a size, a content fingerprint and an optional external reference):
 * the record itself lives in the People tables, or in quarantine when it was rejected.
 * Rows are never updated (a trigger enforces this); they are removed only with their person (cascade) or by retention.
 * Evidence stays deduplicated in people_evidence; many observations may point at one evidence row.
 */
export const peopleObservations = pgTable(
  'people_observations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sourceKey: varchar('source_key', { length: 60 })
      .notNull()
      .references(() => peopleSources.key, { onDelete: 'restrict' }),
    /** Registry version AT THE TIME of the observation; never rewritten when the registry version changes. */
    sourceVersion: varchar('source_version', { length: 20 }).notNull(),
    /** The source's own identifier of the record. Together with source_key it identifies "the same source record". */
    sourceRecordId: varchar('source_record_id', { length: 200 }).notNull(),
    /** The acquisition / run that produced this observation. */
    batchRef: varchar('batch_ref', { length: 100 }).notNull(),
    /** When Orion obtained the record. */
    acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull(),
    /** When the SOURCE says the information was true / current. NULL = the source did not say. Never defaulted. */
    observedAt: timestamp('observed_at', { withTimezone: true }),
    /** sha256 of what the record says (excludes when it was observed). Changes whenever a claimed value changes. */
    contentFingerprint: varchar('content_fingerprint', { length: 64 }).notNull(),
    /** INGESTED | QUARANTINED */
    outcome: varchar('outcome', { length: 12 }).notNull(),
    /** Machine codes only (no personal data) when the record was quarantined. */
    reasonCodes: text('reason_codes').array(),
    personId: uuid('person_id').references(() => people.id, { onDelete: 'cascade' }),
    companyPersonId: uuid('company_person_id').references(() => companyPeople.id, { onDelete: 'cascade' }),
    businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'set null' }),
    /** The role-scoped evidence row this observation produced or re-confirmed. */
    evidenceId: uuid('evidence_id').references(() => peopleEvidence.id, { onDelete: 'set null' }),
    /** What the source said about the role (role-level facts; contacts are deliberately NOT copied here). */
    observedName: varchar('observed_name', { length: 200 }),
    observedTitle: varchar('observed_title', { length: 200 }),
    /** The title as the taxonomy normalised it, and the taxonomy version that did so (Phase 6.5). NULL on earlier observations. */
    normalizedTitle: varchar('normalized_title', { length: 200 }),
    classificationVersion: varchar('classification_version', { length: 20 }),
    observedIsCurrent: boolean('observed_is_current'),
    payloadBytes: integer('payload_bytes').default(0).notNull(),
    /** Optional pointer to where the full payload lives (never the payload itself). */
    payloadRef: varchar('payload_ref', { length: 255 }),
    /** When Orion wrote this row (rows are immutable, so this is also the last change). */
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('people_observations_identity_uq').on(table.sourceKey, table.sourceRecordId, table.contentFingerprint, table.batchRef, table.outcome),
    index('people_observations_record_idx').on(table.sourceKey, table.sourceRecordId, table.acquiredAt),
    index('people_observations_person_idx').on(table.personId),
    index('people_observations_role_idx').on(table.companyPersonId),
    index('people_observations_batch_idx').on(table.batchRef),
    check('people_observations_outcome_chk', sql`${table.outcome} IN ('INGESTED', 'QUARANTINED')`),
    check('people_observations_ingested_chk', sql`${table.outcome} <> 'INGESTED' OR ${table.personId} IS NOT NULL`),
    check('people_observations_bytes_chk', sql`${table.payloadBytes} >= 0 AND ${table.payloadBytes} <= 1048576`),
  ],
);

/**
 * Durable suppression registry (Phase 6.4). "This identity must not be reintroduced or published as a person by future
 * ingestion." One row per deterministic identity signal of a suppressed person (LinkedIn, work e-mail, phone), stored only
 * as a digest ('h:' + sha256 of the normalised value), so no readable contact data is kept. It is separate from
 * people.data_status (which stays for operational use) and survives deletion of the person row (person_id is then NULL).
 * Rows are never edited or deleted (triggers); lifting a suppression is a future, explicit administrative operation.
 * Names, titles and company names are never suppression keys.
 */
export const peopleSuppressions = pgTable(
  'people_suppressions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    personId: uuid('person_id').references(() => people.id, { onDelete: 'set null' }),
    /** LINKEDIN | WORK_EMAIL | PHONE (phone and mobile) */
    identityKind: varchar('identity_kind', { length: 12 }).notNull(),
    /** 'h:' + sha256(normalised value). Never the value itself. */
    identityDigest: varchar('identity_digest', { length: 80 }).notNull(),
    /** Reviewer-supplied reason. Internal only. */
    reason: text('reason'),
    /** REVIEWER_ACTION | QUARANTINE_ACTION | LEGACY_SET_STATUS | LEGACY_BACKFILL */
    origin: varchar('origin', { length: 24 }).notNull(),
    /** A pointer such as 'quarantine:<id>'; never personal data. */
    sourceReference: varchar('source_reference', { length: 255 }),
    suppressedByKind: varchar('suppressed_by_kind', { length: 10 }).default('REVIEWER').notNull(),
    suppressedById: uuid('suppressed_by_id').references(() => users.id, { onDelete: 'set null' }),
    suppressedByLabel: varchar('suppressed_by_label', { length: 255 }),
    suppressedAt: timestamp('suppressed_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('people_suppressions_identity_uq').on(table.identityKind, table.identityDigest),
    index('people_suppressions_person_idx').on(table.personId),
    check('people_suppressions_kind_chk', sql`${table.identityKind} IN ('LINKEDIN', 'WORK_EMAIL', 'PHONE')`),
    check('people_suppressions_digest_chk', sql`${table.identityDigest} ~ '^h:[0-9a-f]{64}$'`),
    check('people_suppressions_origin_chk', sql`${table.origin} IN ('REVIEWER_ACTION', 'QUARANTINE_ACTION', 'LEGACY_SET_STATUS', 'LEGACY_BACKFILL')`),
    check('people_suppressions_by_kind_chk', sql`${table.suppressedByKind} IN ('REVIEWER', 'SYSTEM')`),
    check('people_suppressions_system_no_human_chk', sql`${table.suppressedByKind} = 'REVIEWER' OR ${table.suppressedById} IS NULL`),
  ],
);

export const personUnlocks = pgTable(
  'person_unlocks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    creditsSpent: integer('credits_spent').default(1).notNull(),
    unlockedAt: timestamp('unlocked_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('person_unlocks_user_person_idx').on(table.userId, table.personId),
    index('person_unlocks_user_idx').on(table.userId),
    index('person_unlocks_person_idx').on(table.personId),
  ],
);

export const peopleRelations = relations(people, ({ many }) => ({
  roles: many(companyPeople),
  contacts: many(personContacts),
  evidence: many(peopleEvidence),
}));

export const companyPeopleRelations = relations(companyPeople, ({ one }) => ({
  business: one(businesses, { fields: [companyPeople.businessId], references: [businesses.id] }),
  person: one(people, { fields: [companyPeople.personId], references: [people.id] }),
}));

export const personContactsRelations = relations(personContacts, ({ one }) => ({
  person: one(people, { fields: [personContacts.personId], references: [people.id] }),
}));

/**
 * Records rejected by the ingestion layer (bad data, unknown company, ambiguous or suppressed
 * identity...). Nothing here is customer-visible; it exists so a reviewer can fix and re-run.
 */
export const peopleIngestionQuarantine = pgTable(
  'people_ingestion_quarantine',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    batchRef: varchar('batch_ref', { length: 100 }),
    sourceLabel: varchar('source_label', { length: 100 }),
    /** sha256 of the raw payload: re-running the same bad file does not add duplicate rows. */
    fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
    raw: jsonb('raw').notNull(),
    reasons: jsonb('reasons').notNull(),
    /** PENDING | RESOLVED | DISCARDED */
    status: varchar('status', { length: 20 }).default('PENDING').notNull(),
    /** How a reviewer closed it: { action, by, at, note, personId?, companyPersonId? }. */
    resolution: jsonb('resolution'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('people_quarantine_fingerprint_uq').on(table.fingerprint),
    index('people_quarantine_batch_idx').on(table.batchRef),
    index('people_quarantine_status_idx').on(table.status),
    check('people_quarantine_status_chk', sql`${table.status} IN ('PENDING', 'RESOLVED', 'DISCARDED')`),
  ],
);

/**
 * Contact provenance (Phase 6.6). One row per contact / identity claim an observation carried: WHICH observation (and so which
 * source, source version, source record and run) claimed WHICH contact point, and which evidence row backs it. It links existing
 * records (people_observations -> person_contacts -> people_evidence) and stores only a digest of the value ('h:' + sha256 of the
 * normalised value), never the contact itself and never any payload. "Source reported it" is NOT "verified": verification stays
 * in the verification ledger. Rows are never updated (a trigger enforces it); they go only with their observation or contact.
 */
export const peopleObservationClaims = pgTable(
  'people_observation_claims',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    observationId: uuid('observation_id')
      .notNull()
      .references(() => peopleObservations.id, { onDelete: 'cascade' }),
    /** WORK_EMAIL | PHONE | MOBILE | LINKEDIN */
    claimType: varchar('claim_type', { length: 12 }).notNull(),
    /** The canonical contact row this claim resolved to (NULL for LINKEDIN, which lives on the person). */
    contactId: uuid('contact_id').references(() => personContacts.id, { onDelete: 'cascade' }),
    /** 'h:' + sha256(normalised value): the same convention as the verification ledger and suppression registry. */
    valueDigest: varchar('value_digest', { length: 80 }).notNull(),
    /** The evidence row (CONTACT_CLAIM / IDENTITY_CLAIM) this observation produced or re-confirmed, when there is one. */
    evidenceId: uuid('evidence_id').references(() => peopleEvidence.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('people_observation_claims_uq').on(table.observationId, table.claimType, table.valueDigest),
    index('people_observation_claims_contact_idx').on(table.contactId),
    index('people_observation_claims_evidence_idx').on(table.evidenceId),
    check('people_observation_claims_type_chk', sql`${table.claimType} IN ('WORK_EMAIL', 'PHONE', 'MOBILE', 'LINKEDIN')`),
    check('people_observation_claims_digest_chk', sql`${table.valueDigest} ~ '^h:[0-9a-f]{64}$'`),
  ],
);

/**
 * Append-only classification history of a role (Phase 6.5). SYSTEM_CLASSIFICATION rows are what a specific taxonomy version
 * decided for a normalised title; REVIEWER_OVERRIDE rows are what a reviewer decided. The two are never merged: an override
 * never replaces the system result and a re-classification never replaces an override. company_people carries the classification
 * currently in force; this table says how every one of them came about, without consulting current configuration.
 * Rows are never updated (a trigger enforces it); they are removed only with their role (cascade).
 */
export const companyPeopleClassifications = pgTable(
  'company_people_classifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyPersonId: uuid('company_person_id')
      .notNull()
      .references(() => companyPeople.id, { onDelete: 'cascade' }),
    /** SYSTEM_CLASSIFICATION | REVIEWER_OVERRIDE */
    kind: varchar('kind', { length: 24 }).notNull(),
    /** Taxonomy version of a system result ("unversioned" snapshots a legacy value). NULL for an override. */
    taxonomyVersion: varchar('taxonomy_version', { length: 20 }),
    normalizedTitle: varchar('normalized_title', { length: 200 }).notNull(),
    seniorityLevel: varchar('seniority_level', { length: 30 }).notNull(),
    department: varchar('department', { length: 40 }).notNull(),
    decisionMakerType: varchar('decision_maker_type', { length: 60 }),
    relationshipType: varchar('relationship_type', { length: 30 }),
    /** Compact rule id string, e.g. SEN-EXEC-FOUNDER|DEP-EXEC-OWNER|DM-EXEC-FOUNDER-CEO|REL-FOUNDER. NULL for overrides and legacy snapshots. */
    ruleId: varchar('rule_id', { length: 300 }),
    ruleTrace: jsonb('rule_trace'),
    strength: varchar('strength', { length: 16 }),
    actorKind: varchar('actor_kind', { length: 10 }).default('SYSTEM').notNull(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorLabel: varchar('actor_label', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('company_people_classifications_system_uq')
      .on(table.companyPersonId, table.taxonomyVersion, table.normalizedTitle)
      .where(sql`${table.kind} = 'SYSTEM_CLASSIFICATION'`),
    index('company_people_classifications_role_idx').on(table.companyPersonId, table.createdAt),
    check('company_people_classifications_kind_chk', sql`${table.kind} IN ('SYSTEM_CLASSIFICATION', 'REVIEWER_OVERRIDE')`),
    check('company_people_classifications_version_chk', sql`${table.kind} = 'REVIEWER_OVERRIDE' OR ${table.taxonomyVersion} IS NOT NULL`),
    check('company_people_classifications_actor_chk', sql`${table.actorKind} IN ('SYSTEM', 'REVIEWER')`),
    check('company_people_classifications_strength_chk', sql`${table.strength} IS NULL OR ${table.strength} IN ('EXACT_RULE', 'NORMALIZED_RULE', 'FALLBACK', 'UNCLASSIFIED')`),
  ],
);

/**
 * Detected conflicts between People claims (Phase 6.8). A conflict says "these claims disagree and a reviewer should look";
 * it never says which side is right. Nothing here deletes, verifies, unverifies, publishes, unpublishes or suppresses anything,
 * and no code in this phase sets RESOLVED (resolution is a later, explicit reviewer workflow). One row per (type, subject_key);
 * re-detection only moves last_detected_at. The claims behind it are in people_conflict_links, which point at the existing
 * observation / observation-claim / evidence / person / role / contact rows: no payload, no contact value, no credentials.
 */
export const peopleConflicts = pgTable(
  'people_conflicts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** CONTACT_MULTIPLE_PEOPLE | IDENTITY_LINKEDIN | CONTACT_CONFLICTING_VALUES | ROLE_TITLE | ROLE_CURRENCY | COMPANY_RELATIONSHIP */
    conflictType: varchar('conflict_type', { length: 40 }).notNull(),
    /** Deterministic key of WHAT conflicts (digests / ids only), unique with the type: makes detection idempotent in the database. */
    subjectKey: varchar('subject_key', { length: 200 }).notNull(),
    /** OPEN | RESOLVED. This phase only ever writes OPEN. */
    status: varchar('status', { length: 10 }).default('OPEN').notNull(),
    personId: uuid('person_id').references(() => people.id, { onDelete: 'cascade' }),
    businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }),
    /** Machine-readable facts only (e.g. CURRENT vs HISTORICAL by freshness); never contact values or payloads. */
    details: jsonb('details'),
    firstDetectedAt: timestamp('first_detected_at', { withTimezone: true }).defaultNow().notNull(),
    lastDetectedAt: timestamp('last_detected_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('people_conflicts_subject_uq').on(table.conflictType, table.subjectKey),
    index('people_conflicts_person_idx').on(table.personId),
    index('people_conflicts_status_idx').on(table.status, table.lastDetectedAt),
    check('people_conflicts_status_chk', sql`${table.status} IN ('OPEN', 'RESOLVED')`),
    check(
      'people_conflicts_type_chk',
      sql`${table.conflictType} IN ('CONTACT_MULTIPLE_PEOPLE', 'IDENTITY_LINKEDIN', 'CONTACT_CONFLICTING_VALUES', 'ROLE_TITLE', 'ROLE_CURRENCY', 'COMPANY_RELATIONSHIP')`,
    ),
  ],
);

/** The claims behind a conflict, by reference to existing provenance rows. Append-only. */
export const peopleConflictLinks = pgTable(
  'people_conflict_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conflictId: uuid('conflict_id')
      .notNull()
      .references(() => peopleConflicts.id, { onDelete: 'cascade' }),
    /** Deterministic key of this claim within the conflict (idempotency). */
    linkKey: varchar('link_key', { length: 200 }).notNull(),
    observationId: uuid('observation_id').references(() => peopleObservations.id, { onDelete: 'cascade' }),
    observationClaimId: uuid('observation_claim_id').references(() => peopleObservationClaims.id, { onDelete: 'cascade' }),
    evidenceId: uuid('evidence_id').references(() => peopleEvidence.id, { onDelete: 'set null' }),
    personId: uuid('person_id').references(() => people.id, { onDelete: 'cascade' }),
    companyPersonId: uuid('company_person_id').references(() => companyPeople.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').references(() => personContacts.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('people_conflict_links_uq').on(table.conflictId, table.linkKey),
    index('people_conflict_links_observation_idx').on(table.observationId),
  ],
);

/**
 * One acquisition run of a registered source (Phase 6.9): the orchestration record. It says WHICH source (and version) was run,
 * with WHICH limits, how far it got (counters + opaque cursor checkpoint) and how it ended. It does NOT hold records, payloads,
 * credentials or per-record history: record-level truth stays in people_observations (the run's batch_ref is the observation run
 * id, so a replay of the same run is recognised by the Phase 6.2 idempotency). State transitions are atomic conditional UPDATEs;
 * claim_token + lease_expires_at make sure one worker owns a RUNNING run.
 */
export const peopleAcquisitionRuns = pgTable(
  'people_acquisition_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sourceKey: varchar('source_key', { length: 60 })
      .notNull()
      .references(() => peopleSources.key, { onDelete: 'restrict' }),
    /** Registry version at the time the run was created. */
    sourceVersion: varchar('source_version', { length: 20 }).notNull(),
    /** The observation run id for every record of this run (people_observations.batch_ref). Unique: one run, one id. */
    batchRef: varchar('batch_ref', { length: 100 }).notNull(),
    /** QUEUED | RUNNING | COMPLETED | FAILED | CANCELLED */
    status: varchar('status', { length: 10 }).default('QUEUED').notNull(),
    // limits snapshot (the run resumes with the limits it was created with unless explicitly raised)
    maxRecords: integer('max_records').notNull(),
    batchSize: integer('batch_size').notNull(),
    /** Declared cost units allowed for the run; NULL = no cap. Units are declared by the adapter (zero when it has no cost model). */
    maxCostUnits: integer('max_cost_units'),
    maxRetries: integer('max_retries').default(3).notNull(),
    backoffBaseMs: integer('backoff_base_ms').default(1000).notNull(),
    batchIntervalMs: integer('batch_interval_ms').default(0).notNull(),
    // progress
    recordsSeen: integer('records_seen').default(0).notNull(),
    recordsCreated: integer('records_created').default(0).notNull(),
    recordsUpdated: integer('records_updated').default(0).notNull(),
    recordsUnchanged: integer('records_unchanged').default(0).notNull(),
    recordsQuarantined: integer('records_quarantined').default(0).notNull(),
    /** Records whose transient failure survived every retry. They can be retried by resuming the run. */
    recordsFailed: integer('records_failed').default(0).notNull(),
    /** Records already completed earlier in this run (recognised through their observation) and not processed again. */
    recordsSkipped: integer('records_skipped').default(0).notNull(),
    batchesDone: integer('batches_done').default(0).notNull(),
    retries: integer('retries').default(0).notNull(),
    costUnits: integer('cost_units').default(0).notNull(),
    /** Opaque resume cursor exactly as the adapter returned it; never invented. NULL for sources without paged fetch. */
    cursor: text('cursor'),
    failureCode: varchar('failure_code', { length: 40 }),
    /** Short machine-oriented text; never record content. */
    failureMessage: varchar('failure_message', { length: 300 }),
    claimToken: uuid('claim_token'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('people_acquisition_runs_batch_ref_uq').on(table.batchRef),
    index('people_acquisition_runs_source_idx').on(table.sourceKey, table.createdAt),
    index('people_acquisition_runs_status_idx').on(table.status),
    check('people_acquisition_runs_status_chk', sql`${table.status} IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')`),
    check(
      'people_acquisition_runs_limits_chk',
      sql`${table.maxRecords} > 0 AND ${table.batchSize} > 0 AND ${table.batchSize} <= ${table.maxRecords} AND ${table.maxRetries} >= 0 AND ${table.backoffBaseMs} >= 0 AND ${table.batchIntervalMs} >= 0 AND (${table.maxCostUnits} IS NULL OR ${table.maxCostUnits} >= 0)`,
    ),
    check(
      'people_acquisition_runs_counts_chk',
      sql`${table.recordsSeen} >= 0 AND ${table.recordsCreated} >= 0 AND ${table.recordsUpdated} >= 0 AND ${table.recordsUnchanged} >= 0 AND ${table.recordsQuarantined} >= 0 AND ${table.recordsFailed} >= 0 AND ${table.recordsSkipped} >= 0 AND ${table.batchesDone} >= 0 AND ${table.retries} >= 0 AND ${table.costUnits} >= 0`,
    ),
  ],
);


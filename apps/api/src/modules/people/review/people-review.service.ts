import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { and, desc, asc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql, SQL } from 'drizzle-orm';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { BusinessException } from '../../../common/errors/business.exception';
import { recordReviewerOverride, recordSystemClassification, snapshotLegacyClassification } from '../classification/classification-history';
import { RoleClassificationService } from '../classification/role-classification.service';
import type { IRoleClassification } from '../classification/role-classifier';
import { CURRENT_TAXONOMY_VERSION } from '../classification/taxonomies';
import { DECISION_MAKER_TYPE_LABELS } from '../classification/role-taxonomy.config';
import { checkRoleCombination } from '../ingestion/person-record.normalizer';
import {
  DECISION_MAKER_TYPES,
  DEPARTMENTS,
  SENIORITY_LEVELS,
  VERIFICATION_STALE_AFTER_DAYS,
  VERIFICATION_STATUSES,
  type DecisionMakerType,
  type Department,
  type SeniorityLevel,
} from '../people.constants';
import { IReviewContext, PeoplePublishingService } from '../people-publishing.service';
import { contactAttributionStatus, loadContactAttribution } from '../people-contact-attribution';
import { lockPersonOfRole } from '../suppression/people-suppression';
import { confidenceLevel, effectiveVerification } from '../policies/verification.policy';
import {
  clampScore,
  evidenceFingerprint,
  isGenericMailbox,
  isValidEmail,
  normalizeContactValue,
  normalizePersonName,
  normalizeSourceLocator,
  parsePhone,
  splitPersonName,
} from '../people.utils';
import { PeopleVerificationService } from '../verification/people-verification.service';
import { reconcileContact } from '../verification/verification-state';
import { buildVerificationPanel, toLedgerRow } from '../verification/verification-panel';
import { ApproveDto, ReviewQueueQueryDto, RoleEditDto } from './review.dto';
import { parsePublicUrl } from '../../../common/utils/public-url.util';

type Tx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];
const SOURCE_TYPES = ['GOVERNMENT_REGISTRY', 'WEB_SCRAPING', 'MANUAL_IMPORT', 'API_INTEGRATION', 'USER_SUBMISSION', 'PARTNER_FEED'];
/** Most import observations listed in a role dossier (newest first); the dossier says when there are more. */
const PROVENANCE_LIMIT = 20;

const SOURCE_LABELS: Record<string, string> = {
  GOVERNMENT_REGISTRY: 'Government registry data (manually supplied)',
  WEB_SCRAPING: 'Web source',
  MANUAL_IMPORT: 'Manual import / upload',
  API_INTEGRATION: 'Provider integration',
  USER_SUBMISSION: 'User submission',
  PARTNER_FEED: 'Partner feed',
};

const list = (v?: string) => (v ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();
const bad = (message: string, code: string, status = HttpStatus.BAD_REQUEST) => new BusinessException(message, code, status);

/**
 * Internal review of DRAFT people. The unit of review is a ROLE (a person at a company): approving
 * one role never publishes the person's other roles, and contacts are published only when named.
 * All visibility changes are delegated to PeoplePublishingService (the single publishing gate);
 * this service adds the queue, the detail view and audited reviewer edits.
 */
@Injectable()
export class PeopleReviewService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDb,
    private readonly publishing: PeoplePublishingService,
    private readonly verification: PeopleVerificationService,
    @Optional() private readonly classifier: RoleClassificationService = new RoleClassificationService(),
  ) {}

  // ------------------------------------------------------------------ queue
  async getQueue(q: ReviewQueueQueryDto) {
    const cp = schema.companyPeople;
    const conds: SQL[] = [];
    const status = q.status ?? 'PENDING';
    if (status !== 'ALL') conds.push(eq(cp.reviewStatus, status));
    if (q.businessId) conds.push(eq(cp.businessId, q.businessId));
    if (q.company?.trim()) conds.push(ilike(schema.businesses.name, `%${q.company.trim()}%`));
    if (q.q?.trim()) {
      const like = `%${q.q.trim()}%`;
      conds.push(or(ilike(schema.people.fullName, like), ilike(cp.jobTitleAtCompany, like))!);
    }
    const types = list(q.decisionMakerType);
    if (types.length) {
      const real = types.filter((t) => t !== 'NONE');
      const parts: SQL[] = [];
      if (real.length) parts.push(inArray(cp.decisionMakerType, real));
      if (types.includes('NONE')) parts.push(isNull(cp.decisionMakerType));
      conds.push(or(...parts)!);
    }
    const verifs = list(q.verification).filter((v) => (VERIFICATION_STATUSES as readonly string[]).includes(v));
    if (q.verification && verifs.length === 0) conds.push(sql`false`);
    if (verifs.length) conds.push(sql`${cp.verificationStatus}::text IN (${sql.join(verifs.map((v) => sql`${v}`), sql`, `)})`);
    const sources = list(q.source);
    if (sources.length) {
      conds.push(
        sql`EXISTS (SELECT 1 FROM people_evidence se WHERE se.company_person_id = ${cp.id} AND se.source_type::text IN (${sql.join(sources.map((s) => sql`${s}`), sql`, `)}))`,
      );
    }
    if (q.minConfidence !== undefined) conds.push(gte(cp.confidenceScore, q.minConfidence));
    if (q.maxConfidence !== undefined) conds.push(lte(cp.confidenceScore, q.maxConfidence));
    if (q.createdFrom) conds.push(gte(cp.createdAt, new Date(q.createdFrom)));
    if (q.createdTo) conds.push(lte(cp.createdAt, new Date(q.createdTo)));
    if (q.updatedFrom) conds.push(gte(cp.updatedAt, new Date(q.updatedFrom)));
    if (q.updatedTo) conds.push(lte(cp.updatedAt, new Date(q.updatedTo)));
    if (q.hasEvidence !== undefined) {
      conds.push(
        q.hasEvidence
          ? sql`EXISTS (SELECT 1 FROM people_evidence he WHERE he.company_person_id = ${cp.id})`
          : sql`NOT EXISTS (SELECT 1 FROM people_evidence he WHERE he.company_person_id = ${cp.id})`,
      );
    }
    const where = conds.length ? and(...conds) : undefined;

    const order = {
      created_desc: [desc(cp.createdAt), desc(cp.id)],
      created_asc: [asc(cp.createdAt), asc(cp.id)],
      updated_desc: [desc(cp.updatedAt), desc(cp.id)],
      confidence_desc: [desc(cp.confidenceScore), desc(cp.createdAt)],
      confidence_asc: [asc(cp.confidenceScore), desc(cp.createdAt)],
    }[q.sort ?? 'created_desc'];

    const page = q.page ?? 1;
    const limit = q.limit ?? 25;

    // One statement for the page: evidence/contact aggregates are index-backed correlated
    // sub-selects (people_evidence_company_person_idx, person_contacts_person_idx), not per-row queries.
    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select({
          role: cp,
          personName: schema.people.fullName,
          personStatus: schema.people.dataStatus,
          companyName: schema.businesses.name,
          companyStatus: schema.businesses.status,
          evidenceCount: sql<number>`(SELECT count(*)::int FROM people_evidence ev WHERE ev.company_person_id = ${cp.id})`,
          verifiedEvidenceCount: sql<number>`(SELECT count(*)::int FROM people_evidence ev WHERE ev.company_person_id = ${cp.id} AND ev.verified_at IS NOT NULL)`,
          sourceTypes: sql<string[]>`(SELECT COALESCE(array_agg(DISTINCT ev.source_type::text), '{}') FROM people_evidence ev WHERE ev.company_person_id = ${cp.id})`,
          contactCount: sql<number>`(SELECT count(*)::int FROM person_contacts pc WHERE pc.person_id = ${cp.personId})`,
          publishedContactCount: sql<number>`(SELECT count(*)::int FROM person_contacts pc WHERE pc.person_id = ${cp.personId} AND pc.is_published)`,
        })
        .from(cp)
        .innerJoin(schema.people, eq(schema.people.id, cp.personId))
        .innerJoin(schema.businesses, eq(schema.businesses.id, cp.businessId))
        .where(where)
        .orderBy(...order)
        .limit(limit)
        .offset((page - 1) * limit),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(cp)
        .innerJoin(schema.people, eq(schema.people.id, cp.personId))
        .innerJoin(schema.businesses, eq(schema.businesses.id, cp.businessId))
        .where(where),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.role.id,
        personId: r.role.personId,
        fullName: r.personName,
        personStatus: r.personStatus,
        companyId: r.role.businessId,
        companyName: r.companyName,
        companyStatus: r.companyStatus,
        jobTitle: r.role.jobTitleAtCompany,
        department: r.role.department,
        seniorityLevel: r.role.seniorityLevel,
        decisionMakerType: r.role.decisionMakerType,
        decisionMakerLabel: r.role.decisionMakerType ? DECISION_MAKER_TYPE_LABELS[r.role.decisionMakerType as DecisionMakerType] : null,
        isCurrent: r.role.isCurrent,
        reviewStatus: r.role.reviewStatus,
        isPublished: r.role.isPublished,
        verificationStatus: r.role.verificationStatus,
        confidence: { score: r.role.confidenceScore, level: confidenceLevel(r.role.confidenceScore, r.role.verificationStatus) },
        evidenceCount: r.evidenceCount,
        verifiedEvidenceCount: r.verifiedEvidenceCount,
        sourceTypes: r.sourceTypes,
        contactCount: r.contactCount,
        publishedContactCount: r.publishedContactCount,
        createdAt: r.role.createdAt,
        updatedAt: r.role.updatedAt,
        lastSeenAt: r.role.lastSeenAt,
        reviewedAt: r.role.reviewedAt,
      })),
      pagination: { page, limit, totalItems: total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async getStats() {
    const [roles, quarantine] = await Promise.all([
      this.db
        .select({ status: schema.companyPeople.reviewStatus, n: sql<number>`count(*)::int` })
        .from(schema.companyPeople)
        .groupBy(schema.companyPeople.reviewStatus),
      this.db
        .select({ status: schema.peopleIngestionQuarantine.status, n: sql<number>`count(*)::int` })
        .from(schema.peopleIngestionQuarantine)
        .groupBy(schema.peopleIngestionQuarantine.status),
    ]);
    const by = (rows: Array<{ status: string; n: number }>) => Object.fromEntries(rows.map((r) => [r.status, r.n]));
    return { roles: by(roles), quarantine: by(quarantine) };
  }

  // ------------------------------------------------------------------ detail
  async getRoleDetail(companyPersonId: string) {
    const [row] = await this.db
      .select({ role: schema.companyPeople, person: schema.people, business: schema.businesses })
      .from(schema.companyPeople)
      .innerJoin(schema.people, eq(schema.people.id, schema.companyPeople.personId))
      .innerJoin(schema.businesses, eq(schema.businesses.id, schema.companyPeople.businessId))
      .where(eq(schema.companyPeople.id, companyPersonId));
    if (!row) throw bad('Role not found', 'ROLE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const { role, person, business } = row;

    const [contacts, evidence, otherRoles, ledger, attribution] = await Promise.all([
      this.db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, person.id)),
      this.db.select().from(schema.peopleEvidence).where(eq(schema.peopleEvidence.personId, person.id)).orderBy(desc(schema.peopleEvidence.observedAt)),
      this.db
        .select({
          id: schema.companyPeople.id,
          businessId: schema.companyPeople.businessId,
          companyName: schema.businesses.name,
          jobTitle: schema.companyPeople.jobTitleAtCompany,
          reviewStatus: schema.companyPeople.reviewStatus,
          isPublished: schema.companyPeople.isPublished,
          isCurrent: schema.companyPeople.isCurrent,
        })
        .from(schema.companyPeople)
        .innerJoin(schema.businesses, eq(schema.businesses.id, schema.companyPeople.businessId))
        .where(eq(schema.companyPeople.personId, person.id)),
      this.db.select().from(schema.peopleVerifications).where(eq(schema.peopleVerifications.personId, person.id)),
      loadContactAttribution(this.db, [person.id]),
    ]);

    const auditIds = [role.id, person.id, ...contacts.map((c) => c.id)];
    const audit = await this.db
      .select({
        id: schema.auditLogs.id,
        action: schema.auditLogs.action,
        entityType: schema.auditLogs.entityType,
        entityId: schema.auditLogs.entityId,
        oldValues: schema.auditLogs.oldValues,
        newValues: schema.auditLogs.newValues,
        createdAt: schema.auditLogs.createdAt,
        reviewerEmail: schema.users.email,
      })
      .from(schema.auditLogs)
      .leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.userId))
      .where(and(inArray(schema.auditLogs.entityId, auditIds), sql`${schema.auditLogs.entityType} LIKE 'PEOPLE_%'`))
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(50);

    const contactById = new Map(contacts.map((c) => [c.id, c]));
    const now = new Date();
    const evidenceView = evidence.map((e) => {
      const ageDays = e.verifiedAt ? (now.getTime() - e.verifiedAt.getTime()) / 86_400_000 : null;
      return {
        id: e.id,
        scope: e.contactId ? 'CONTACT' : e.companyPersonId ? (e.companyPersonId === role.id ? 'ROLE' : 'OTHER_ROLE') : 'PERSON',
        appliesToThisRole: e.companyPersonId === role.id,
        contactId: e.contactId,
        contactType: e.contactId ? contactById.get(e.contactId)?.contactType ?? null : null,
        sourceType: e.sourceType,
        sourceLabel: SOURCE_LABELS[e.sourceType] ?? e.sourceType,
        sourceReference: e.sourceReference,
        sourceUrl: e.sourceUrl, // internal reviewers only; the customer API never returns this
        evidenceType: e.evidenceType,
        observedAt: e.observedAt,
        verifiedAt: e.verifiedAt,
        status: e.verifiedAt ? (ageDays! > VERIFICATION_STALE_AFTER_DAYS ? 'STALE' : 'VERIFIED') : 'UNVERIFIED',
        confidenceScore: e.confidenceScore,
      };
    });

    const roleEvidence = evidence.filter((e) => e.companyPersonId === role.id);
    const verifiedRoleEvidence = roleEvidence.filter((e) => !!e.verifiedAt).length;
    const effective = effectiveVerification({
      status: role.verificationStatus,
      lastVerifiedAt: role.lastVerifiedAt,
      verifiedEvidenceCount: verifiedRoleEvidence,
    });

    const blockers: string[] = [];
    if (person.dataStatus === 'SUPPRESSED') blockers.push('PERSON_SUPPRESSED');
    if (role.reviewStatus === 'REJECTED' || role.reviewStatus === 'QUARANTINED') blockers.push('REOPEN_REQUIRED');
    if (roleEvidence.length === 0) blockers.push('EVIDENCE_REQUIRED');

    const classificationHistory = await this.db
      .select()
      .from(schema.companyPeopleClassifications)
      .where(eq(schema.companyPeopleClassifications.companyPersonId, role.id))
      .orderBy(asc(schema.companyPeopleClassifications.createdAt), asc(schema.companyPeopleClassifications.id));

    // Internal (reviewer-only): conflicts this person is part of, each with the claims behind it. Nothing here is a verdict.
    const conflictRows = await this.db
      .select()
      .from(schema.peopleConflicts)
      .where(
        or(
          eq(schema.peopleConflicts.personId, person.id),
          inArray(schema.peopleConflicts.id, this.db.select({ id: schema.peopleConflictLinks.conflictId }).from(schema.peopleConflictLinks).where(eq(schema.peopleConflictLinks.personId, person.id))),
        ),
      )
      .orderBy(desc(schema.peopleConflicts.lastDetectedAt))
      .limit(50);
    const conflictLinks = conflictRows.length
      ? await this.db
          .select({
            conflictId: schema.peopleConflictLinks.conflictId,
            observationId: schema.peopleConflictLinks.observationId,
            observationClaimId: schema.peopleConflictLinks.observationClaimId,
            evidenceId: schema.peopleConflictLinks.evidenceId,
            personId: schema.peopleConflictLinks.personId,
            companyPersonId: schema.peopleConflictLinks.companyPersonId,
            contactId: schema.peopleConflictLinks.contactId,
            sourceKey: schema.peopleObservations.sourceKey,
            sourceVersion: schema.peopleObservations.sourceVersion,
          })
          .from(schema.peopleConflictLinks)
          .leftJoin(schema.peopleObservations, eq(schema.peopleObservations.id, schema.peopleConflictLinks.observationId))
          .where(inArray(schema.peopleConflictLinks.conflictId, conflictRows.map((c) => c.id)))
      : [];

    // Internal (reviewer-only, read-only): where the import says this relationship came from. Rows are never written here.
    const provenanceRows = await this.db
      .select({
        sourceKey: schema.peopleObservations.sourceKey,
        sourceName: schema.peopleSources.displayName,
        sourceVersion: schema.peopleObservations.sourceVersion,
        batchRef: schema.peopleObservations.batchRef,
        sourceRecordId: schema.peopleObservations.sourceRecordId,
        acquiredAt: schema.peopleObservations.acquiredAt,
        observedAt: schema.peopleObservations.observedAt,
        observedTitle: schema.peopleObservations.observedTitle,
        observedIsCurrent: schema.peopleObservations.observedIsCurrent,
      })
      .from(schema.peopleObservations)
      .leftJoin(schema.peopleSources, eq(schema.peopleSources.key, schema.peopleObservations.sourceKey))
      .where(and(eq(schema.peopleObservations.companyPersonId, role.id), eq(schema.peopleObservations.outcome, 'INGESTED')))
      .orderBy(desc(schema.peopleObservations.acquiredAt), desc(schema.peopleObservations.createdAt), desc(schema.peopleObservations.id))
      .limit(PROVENANCE_LIMIT + 1);

    return {
      provenance: {
        // false = no import observation exists for this role (created by hand, or imported before observations were recorded): nothing is guessed
        available: provenanceRows.length > 0,
        truncated: provenanceRows.length > PROVENANCE_LIMIT,
        observations: provenanceRows.slice(0, PROVENANCE_LIMIT).map((o) => ({
          source: { key: o.sourceKey, name: o.sourceName ?? o.sourceKey, version: o.sourceVersion },
          batchRef: o.batchRef,
          sourceRecordId: o.sourceRecordId,
          acquiredAt: o.acquiredAt,
          observedAt: o.observedAt,
          observedTitle: o.observedTitle,
          observedIsCurrent: o.observedIsCurrent,
        })),
      },
      conflicts: conflictRows.map((c) => ({
        id: c.id,
        type: c.conflictType,
        status: c.status,
        firstDetectedAt: c.firstDetectedAt,
        lastDetectedAt: c.lastDetectedAt,
        details: c.details,
        claims: conflictLinks.filter((l) => l.conflictId === c.id).map(({ conflictId: _c, ...l }) => l),
      })),
      // Internal (reviewer-only). Why this role is classified as it is, independent of the current configuration.
      classification: {
        source: role.classificationSource,
        taxonomyVersion: role.classificationVersion,
        strength: role.classificationStrength,
        classifiedAt: role.classifiedAt,
        currentTaxonomyVersion: CURRENT_TAXONOMY_VERSION,
        /** true when the automatic classification was made by an older (or unrecorded) taxonomy version. */
        outdated: role.classificationVersion !== CURRENT_TAXONOMY_VERSION,
        history: classificationHistory.map((h) => ({
          kind: h.kind,
          taxonomyVersion: h.taxonomyVersion,
          normalizedTitle: h.normalizedTitle,
          seniorityLevel: h.seniorityLevel,
          department: h.department,
          decisionMakerType: h.decisionMakerType,
          ruleId: h.ruleId,
          strength: h.strength,
          decidedBy: h.actorLabel,
          createdAt: h.createdAt,
        })),
      },
      role: {
        id: role.id,
        jobTitle: role.jobTitleAtCompany,
        normalizedTitle: role.normalizedJobTitle,
        department: role.department,
        seniorityLevel: role.seniorityLevel,
        decisionMakerType: role.decisionMakerType,
        decisionMakerLabel: role.decisionMakerType ? DECISION_MAKER_TYPE_LABELS[role.decisionMakerType as DecisionMakerType] : null,
        classificationSource: role.classificationSource,
        relationshipType: role.relationshipType,
        isCurrent: role.isCurrent,
        startDate: role.startDate,
        endDate: role.endDate,
        reviewStatus: role.reviewStatus,
        isPublished: role.isPublished,
        reviewedAt: role.reviewedAt,
        reviewNote: role.reviewNote,
        firstSeenAt: role.firstSeenAt,
        lastSeenAt: role.lastSeenAt,
        createdAt: role.createdAt,
        updatedAt: role.updatedAt,
      },
      quality: {
        confidence: { score: role.confidenceScore, level: confidenceLevel(role.confidenceScore, effective) },
        storedVerificationStatus: role.verificationStatus,
        effectiveVerificationStatus: effective,
        lastVerifiedAt: role.lastVerifiedAt,
        evidenceCount: roleEvidence.length,
        verifiedEvidenceCount: verifiedRoleEvidence,
      },
      person: {
        id: person.id,
        fullName: person.fullName,
        nameAliases: person.nameAliases,
        linkedinUrl: person.linkedinUrl,
        location: { city: person.city, state: person.state, country: person.country },
        dataStatus: person.dataStatus,
        firstSeenAt: person.firstSeenAt,
        lastSeenAt: person.lastSeenAt,
      },
      company: { id: business.id, name: business.name, slug: business.slug, status: business.status },
      contacts: contacts.map((c) => ({
        id: c.id,
        type: c.contactType,
        value: c.contactValue,
        isPublished: c.isPublished,
        verificationStatus: c.verificationStatus,
        lastVerifiedAt: c.lastVerifiedAt,
        confidenceScore: c.confidenceScore,
        sourceType: c.sourceType,
        evidenceCount: evidence.filter((e) => e.contactId === c.id).length,
        // reviewer information only: where the import says this contact came from, read against THIS role's company (no ids, no observation rows)
        attribution: contactAttributionStatus(c, role.businessId, attribution),
        canPublish: c.verificationStatus !== 'CONFLICTED' && evidence.some((e) => e.contactId === c.id),
      })),
      evidence: evidenceView,
      verification: buildVerificationPanel({ role, person, contacts, evidence, ledger: ledger.map(toLedgerRow), companyName: business.name }),
      otherRoles: otherRoles.filter((r) => r.id !== role.id),
      readiness: { canApprove: blockers.length === 0, blockers },
      auditTrail: audit,
    };
  }

  // ------------------------------------------------------------------ actions
  /** Approve = publish THIS role (+ any contacts named for THIS person), atomically. */
  async approve(companyPersonId: string, ctx: IReviewContext, dto: ApproveDto = {}) {
    return this.db.transaction(async (tx) => {
      await lockPersonOfRole(tx, companyPersonId); // the contacts named below are validated against the state that is then published
      const contactIds = await this.ownedContactIds(tx, companyPersonId, dto.publishContactIds);
      const res = await this.publishing.publishRoleTx(tx, companyPersonId, ctx);
      for (const id of contactIds) await this.publishing.publishContactTx(tx, id, ctx);
      return { ...res, publishedContactIds: contactIds };
    });
  }

  /** Contacts named in a request must belong to the role's person (no publishing someone else's contact by id). */
  private async ownedContactIds(tx: Tx, companyPersonId: string, ids?: string[]) {
    const unique = [...new Set(ids ?? [])];
    const [role] = await tx.select({ personId: schema.companyPeople.personId }).from(schema.companyPeople).where(eq(schema.companyPeople.id, companyPersonId));
    if (!role) throw bad('Role not found', 'ROLE_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (unique.length === 0) return [];
    const owned = await tx
      .select({ id: schema.personContacts.id })
      .from(schema.personContacts)
      .where(and(inArray(schema.personContacts.id, unique), eq(schema.personContacts.personId, role.personId)));
    if (owned.length !== unique.length) throw bad('Contact not found for this person', 'CONTACT_NOT_FOUND', HttpStatus.NOT_FOUND);
    return unique;
  }

  reject(id: string, ctx: IReviewContext) { return this.publishing.rejectRole(id, ctx); }
  quarantine(id: string, ctx: IReviewContext) { return this.publishing.quarantineRole(id, ctx); }
  reopen(id: string, ctx: IReviewContext) { return this.publishing.reopenRole(id, ctx); }
  unpublish(id: string, ctx: IReviewContext) {
    if (!ctx.note || ctx.note.trim().length < 3) throw bad('A reason is required to unpublish a role', 'REASON_REQUIRED');
    return this.publishing.unpublishRole(id, ctx);
  }
  suppressPerson(personId: string, ctx: IReviewContext) {
    if (!ctx.note || ctx.note.trim().length < 3) throw bad('A reason is required to suppress a person', 'REASON_REQUIRED');
    return this.publishing.suppressPerson(personId, ctx);
  }

  async publishContact(contactId: string, ctx: IReviewContext) { return this.publishing.publishContact(contactId, ctx); }
  async unpublishContact(contactId: string, ctx: IReviewContext) { return this.publishing.unpublishContact(contactId, ctx); }

  // ------------------------------------------------------------------ edit
  /**
   * Audited reviewer correction. Reviewers can fix what the data says (name, title, classification,
   * current/former, dates, contact values) but only with a stated reason, and any contact value they
   * enter must cite a source; edited contacts are reset to unverified + unpublished. Reviewers cannot
   * mark anything verified here. Optionally approves in the same transaction.
   */
  async editRole(companyPersonId: string, dto: RoleEditDto, ctx: IReviewContext, approve?: { publishContactIds?: string[] }) {
    if (!ctx.note || ctx.note.trim().length < 3) throw bad('A reason is required to edit a record', 'REASON_REQUIRED');

    return this.db.transaction(async (tx) => {
      await lockPersonOfRole(tx, companyPersonId); // an edit (and an edit-and-approve) cannot interleave with a suppression of the same person
      const [row] = await tx
        .select({ role: schema.companyPeople, person: schema.people })
        .from(schema.companyPeople)
        .innerJoin(schema.people, eq(schema.people.id, schema.companyPeople.personId))
        .where(eq(schema.companyPeople.id, companyPersonId));
      if (!row) throw bad('Role not found', 'ROLE_NOT_FOUND', HttpStatus.NOT_FOUND);
      const { role, person } = row;
      if (person.dataStatus === 'SUPPRESSED') throw bad('Person is suppressed', 'PERSON_SUPPRESSED', HttpStatus.CONFLICT);

      const changes: Array<{ field: string; from: unknown; to: unknown }> = [];
      const roleSet: Partial<typeof schema.companyPeople.$inferInsert> = {};
      const personSet: Partial<typeof schema.people.$inferInsert> = {};
      const now = new Date();

      // ---- name
      if (dto.fullName !== undefined) {
        const name = collapse(dto.fullName);
        if (normalizePersonName(name).split(' ').filter(Boolean).length < 2 || /[0-9@]|https?:/i.test(name)) {
          throw bad('A first and last name are required (no digits, emails or URLs)', 'INVALID_NAME');
        }
        if (name !== person.fullName) {
          const norm = normalizePersonName(name);
          Object.assign(personSet, { fullName: name, normalizedName: norm, ...splitPersonName(name) });
          if (norm !== person.normalizedName) {
            personSet.nameAliases = [...new Set([...(person.nameAliases ?? []), person.normalizedName])].filter((a) => a !== norm);
          }
          changes.push({ field: 'fullName', from: person.fullName, to: name });
        }
      }

      // ---- title and classification
      let classification = { department: role.department, seniorityLevel: role.seniorityLevel, decisionMakerType: role.decisionMakerType, source: role.classificationSource };
      // What the CURRENT taxonomy says about the (new) title. Always kept in the history; it becomes the role's classification
      // only when no reviewer override owns it.
      let systemResult: IRoleClassification | null = null;
      if (dto.jobTitle !== undefined) {
        const title = collapse(dto.jobTitle);
        if (!title) throw bad('Job title cannot be empty', 'MISSING_TITLE');
        const c = this.classifier.classify(title);
        if (title !== role.jobTitleAtCompany) {
          if (c.normalizedTitle !== role.normalizedJobTitle) {
            const [dup] = await tx
              .select({ id: schema.companyPeople.id })
              .from(schema.companyPeople)
              .where(
                and(
                  eq(schema.companyPeople.businessId, role.businessId),
                  eq(schema.companyPeople.personId, role.personId),
                  ne(schema.companyPeople.id, role.id),
                  or(
                    eq(schema.companyPeople.normalizedJobTitle, c.normalizedTitle),
                    sql`${c.normalizedTitle} = ANY(${schema.companyPeople.titleAliases})`,
                  ),
                ),
              );
            if (dup) throw bad('This person already has a role with that title at this company', 'ROLE_EXISTS', HttpStatus.CONFLICT);
            // keep the replaced title so re-ingesting it resolves to this role
            roleSet.titleAliases = [...new Set([...(role.titleAliases ?? []), role.normalizedJobTitle])].filter((a) => a !== c.normalizedTitle);
          }
          roleSet.jobTitleAtCompany = title;
          roleSet.normalizedJobTitle = c.normalizedTitle;
          changes.push({ field: 'jobTitle', from: role.jobTitleAtCompany, to: title });
        }
        systemResult = c;
        // A new title is re-classified automatically, but an earlier reviewer override is never overwritten by that.
        if (role.classificationSource !== 'REVIEWER') {
          classification = { department: c.department, seniorityLevel: c.seniorityLevel, decisionMakerType: c.decisionMakerType, source: 'AUTO' };
        }
      }
      const overrides = dto.department !== undefined || dto.seniorityLevel !== undefined || dto.decisionMakerType !== undefined;
      if (dto.department !== undefined) {
        if (!(DEPARTMENTS as readonly string[]).includes(dto.department)) throw bad(`Unknown department "${dto.department}"`, 'INVALID_CLASSIFICATION');
        classification.department = dto.department as Department;
      }
      if (dto.seniorityLevel !== undefined) {
        if (!(SENIORITY_LEVELS as readonly string[]).includes(dto.seniorityLevel)) throw bad(`Unknown seniority "${dto.seniorityLevel}"`, 'INVALID_CLASSIFICATION');
        classification.seniorityLevel = dto.seniorityLevel as SeniorityLevel;
      }
      if (dto.decisionMakerType !== undefined) {
        if (dto.decisionMakerType !== null && !(DECISION_MAKER_TYPES as readonly string[]).includes(dto.decisionMakerType)) {
          throw bad(`Unknown decision-maker type "${dto.decisionMakerType}"`, 'INVALID_CLASSIFICATION');
        }
        classification.decisionMakerType = dto.decisionMakerType;
      }
      if (overrides) {
        const combo = checkRoleCombination(classification.department, classification.seniorityLevel, classification.decisionMakerType ?? '');
        if (combo) throw bad(combo, 'INVALID_ROLE_COMBINATION');
        classification.source = 'REVIEWER';
      }
      if (classification.department !== role.department) changes.push({ field: 'department', from: role.department, to: classification.department });
      if (classification.seniorityLevel !== role.seniorityLevel) changes.push({ field: 'seniorityLevel', from: role.seniorityLevel, to: classification.seniorityLevel });
      if (classification.decisionMakerType !== role.decisionMakerType) changes.push({ field: 'decisionMakerType', from: role.decisionMakerType, to: classification.decisionMakerType });
      if (classification.source !== role.classificationSource) changes.push({ field: 'classificationSource', from: role.classificationSource, to: classification.source });
      Object.assign(roleSet, {
        department: classification.department,
        seniorityLevel: classification.seniorityLevel,
        decisionMakerType: classification.decisionMakerType,
        classificationSource: classification.source,
      });
      if (systemResult && classification.source === 'AUTO') {
        Object.assign(roleSet, { classificationVersion: systemResult.taxonomyVersion, classificationStrength: systemResult.strength, classifiedAt: now });
      }

      // ---- current / dates
      const day = (v?: string) => (v ? new Date(v) : null);
      const startDate = dto.startDate !== undefined ? dto.startDate || null : role.startDate;
      const endDate = dto.endDate !== undefined ? dto.endDate || null : role.endDate;
      const isCurrent = dto.isCurrent ?? role.isCurrent;
      for (const [k, v] of [['startDate', startDate], ['endDate', endDate]] as const) {
        if (v && Number.isNaN(day(v)!.getTime())) throw bad(`${k} is not a valid date`, 'INVALID_DATES');
      }
      if (startDate && endDate && day(endDate)! < day(startDate)!) throw bad('endDate is before startDate', 'INVALID_DATES');
      if (isCurrent && endDate && day(endDate)!.getTime() < now.getTime()) throw bad('A current role cannot have a past end date', 'CONFLICTING_CURRENT_FLAG');
      if (isCurrent !== role.isCurrent) changes.push({ field: 'isCurrent', from: role.isCurrent, to: isCurrent });
      if (startDate !== role.startDate) changes.push({ field: 'startDate', from: role.startDate, to: startDate });
      if (endDate !== role.endDate) changes.push({ field: 'endDate', from: role.endDate, to: endDate });
      Object.assign(roleSet, { isCurrent, startDate, endDate });

      // ---- contacts (each value must cite a source)
      for (const c of dto.contacts ?? []) {
        if (!SOURCE_TYPES.includes(c.source.type)) throw bad(`Unknown source type "${c.source.type}"`, 'INVALID_SOURCE_TYPE');
        if (!c.source.reference?.trim() && !c.source.url?.trim()) throw bad('A contact value needs a source reference or URL', 'SOURCE_REQUIRED');
        if (c.source.url) {
          // same rule as ingestion: an explicit public http(s) URL without credentials
          const checked = /^https?:\/\//i.test(c.source.url.trim()) ? parsePublicUrl(c.source.url) : null;
          if (!checked || !checked.ok) throw bad('source.url must be a valid public http(s) URL without credentials', 'INVALID_SOURCE_URL');
        }
        let stored: string;
        if (c.type === 'WORK_EMAIL') {
          stored = c.value.trim().toLowerCase();
          if (!isValidEmail(stored)) throw bad('Invalid email address', 'INVALID_CONTACT');
          if (isGenericMailbox(stored)) throw bad('Shared mailboxes are not personal work emails', 'INVALID_CONTACT');
        } else {
          const p = parsePhone(c.value);
          if (!p.ok) throw bad(`Invalid phone number: ${p.reason}`, 'INVALID_CONTACT');
          stored = p.e164!;
        }
        const norm = normalizeContactValue(c.type, stored);
        if (c.type === 'WORK_EMAIL') {
          const [other] = await tx
            .select({ id: schema.personContacts.id })
            .from(schema.personContacts)
            .where(and(eq(schema.personContacts.contactType, 'WORK_EMAIL'), eq(schema.personContacts.normalizedValue, norm), sql`${schema.personContacts.personId} <> ${role.personId}`));
          if (other) throw bad('That email belongs to another person', 'CONTACT_BELONGS_TO_ANOTHER_PERSON', HttpStatus.CONFLICT);
        }
        const [same] = await tx
          .select({ id: schema.personContacts.id })
          .from(schema.personContacts)
          .where(and(eq(schema.personContacts.personId, role.personId), eq(schema.personContacts.contactType, c.type), eq(schema.personContacts.normalizedValue, norm)));

        let contactId: string;
        if (c.contactId) {
          const [existing] = await tx
            .select()
            .from(schema.personContacts)
            .where(and(eq(schema.personContacts.id, c.contactId), eq(schema.personContacts.personId, role.personId)));
          if (!existing) throw bad('Contact not found for this person', 'CONTACT_NOT_FOUND', HttpStatus.NOT_FOUND);
          if (existing.contactType !== c.type) throw bad('A contact cannot change type', 'INVALID_CONTACT');
          if (existing.normalizedValue === norm) continue; // unchanged
          if (same) throw bad('That value already exists for this person', 'CONTACT_EXISTS', HttpStatus.CONFLICT);
          await tx
            .update(schema.personContacts)
            .set({
              contactValue: stored,
              normalizedValue: norm,
              // a reviewer-typed value is unverified and must be re-reviewed before customers can see it;
              // the status column itself is derived from the ledger (reconcileContact below)
              lastVerifiedAt: null,
              isPublished: false,
              updatedAt: now,
            })
            .where(eq(schema.personContacts.id, existing.id));
          await reconcileContact(tx, existing.id, now);
          changes.push({ field: `contact.${c.type}`, from: existing.contactValue, to: stored });
          contactId = existing.id;
        } else {
          if (same) throw bad('That value already exists for this person', 'CONTACT_EXISTS', HttpStatus.CONFLICT);
          const [created] = await tx
            .insert(schema.personContacts)
            .values({ personId: role.personId, contactType: c.type, contactValue: stored, normalizedValue: norm, sourceType: c.source.type as any })
            .returning({ id: schema.personContacts.id });
          changes.push({ field: `contact.${c.type}`, from: null, to: stored });
          contactId = created.id;
        }
        await this.addEvidenceRow(tx, {
          personId: role.personId,
          companyPersonId: null,
          contactId,
          sourceType: c.source.type,
          evidenceType: 'REVIEWER_EDIT',
          sourceReference: c.source.reference ?? null,
          sourceUrl: c.source.url ?? null,
          observedAt: now,
          scopeKey: `C:${contactId}`,
        });
      }

      // ---- supporting evidence (always unverified: verification is not something a reviewer edit can claim)
      for (const e of dto.addEvidence ?? []) {
        if (!SOURCE_TYPES.includes(e.sourceType)) throw bad(`Unknown source type "${e.sourceType}"`, 'INVALID_SOURCE_TYPE');
        if (!e.sourceReference?.trim() && !e.sourceUrl?.trim()) throw bad('Evidence needs a source reference or URL', 'SOURCE_REQUIRED');
        const added = await this.addEvidenceRow(tx, {
          personId: role.personId,
          companyPersonId: role.id,
          contactId: null,
          sourceType: e.sourceType,
          evidenceType: e.evidenceType.trim().toUpperCase().replace(/\s+/g, '_'),
          sourceReference: e.sourceReference ?? null,
          sourceUrl: e.sourceUrl ?? null,
          observedAt: e.observedAt ? new Date(e.observedAt) : now,
          scopeKey: `R:${role.id}`,
        });
        if (added) changes.push({ field: 'evidence', from: null, to: `${e.sourceType}:${e.evidenceType}:${e.sourceReference ?? e.sourceUrl}` });
      }

      if (changes.length === 0) throw bad('Nothing to change', 'NO_CHANGES');

      if (Object.keys(personSet).length) {
        await tx.update(schema.people).set({ ...personSet, updatedAt: now }).where(eq(schema.people.id, person.id));
      }
      await tx.update(schema.companyPeople).set({ ...roleSet, updatedAt: now }).where(eq(schema.companyPeople.id, role.id));

      // Classification history (append-only): the system result and the reviewer decision are separate rows; neither replaces the other.
      if (systemResult) await recordSystemClassification(tx, role.id, systemResult);
      if (overrides) {
        if (!systemResult && role.classificationSource === 'AUTO') {
          // keep the automatic value the reviewer is about to override
          await snapshotLegacyClassification(
            tx,
            role.id,
            { normalizedTitle: role.normalizedJobTitle, seniorityLevel: role.seniorityLevel, department: role.department, decisionMakerType: role.decisionMakerType, relationshipType: role.relationshipType },
            role.classificationVersion,
          );
        }
        await recordReviewerOverride(
          tx,
          role.id,
          {
            normalizedTitle: roleSet.normalizedJobTitle ?? role.normalizedJobTitle,
            seniorityLevel: classification.seniorityLevel,
            department: classification.department,
            decisionMakerType: classification.decisionMakerType,
            relationshipType: role.relationshipType,
          },
          { id: ctx.reviewerId ?? null, label: ctx.reviewedBy },
        );
      }

      await this.publishing.writeAudit(tx, ctx, {
        action: 'PEOPLE_ROLE_EDITED',
        entityType: 'PEOPLE_ROLE',
        entityId: role.id,
        old: Object.fromEntries(changes.map((c) => [c.field, c.from])),
        new: { ...Object.fromEntries(changes.map((c) => [c.field, c.to])), personId: person.id, companyId: role.businessId },
      });

      // A verified name/title that was just changed no longer counts as verified: mark it for review.
      const invalidatedClaims =
        changes.some((c) => c.field === 'fullName' || c.field === 'jobTitle')
          ? await this.verification.afterReviewerEdit(tx, role.id, ctx, now)
          : [];

      let approved: unknown = undefined;
      if (approve) {
        const contactIds = await this.ownedContactIds(tx, role.id, approve.publishContactIds);
        approved = await this.publishing.publishRoleTx(tx, role.id, ctx);
        for (const id of contactIds) await this.publishing.publishContactTx(tx, id, ctx);
      }
      return { companyPersonId: role.id, changes, approved, invalidatedClaims };
    });
  }

  private async addEvidenceRow(
    tx: Tx,
    e: {
      personId: string;
      companyPersonId: string | null;
      contactId: string | null;
      sourceType: string;
      evidenceType: string;
      sourceReference: string | null;
      sourceUrl: string | null;
      observedAt: Date;
      scopeKey: string;
    },
  ): Promise<boolean> {
    const fingerprint = evidenceFingerprint([e.personId, e.scopeKey, e.sourceType, e.evidenceType, normalizeSourceLocator(e.sourceUrl, e.sourceReference)]);
    const inserted = await tx
      .insert(schema.peopleEvidence)
      .values({
        personId: e.personId,
        companyPersonId: e.companyPersonId,
        contactId: e.contactId,
        fingerprint,
        sourceType: e.sourceType as any,
        evidenceType: e.evidenceType.slice(0, 40),
        sourceReference: e.sourceReference,
        sourceUrl: e.sourceUrl,
        observedAt: e.observedAt,
        verifiedAt: null,
        confidenceScore: clampScore(0),
      })
      .onConflictDoNothing()
      .returning({ id: schema.peopleEvidence.id });
    return inserted.length > 0;
  }
}

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lte, sql, SQL } from 'drizzle-orm';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { BusinessException } from '../../../common/errors/business.exception';
import { IRawPersonRecord } from '../ingestion/ingestion.types';
import { PeopleIngestionService } from '../ingestion/people-ingestion.service';
import { normalizeRawPerson } from '../ingestion/person-record.normalizer';
import { IReviewContext, PeoplePublishingService } from '../people-publishing.service';
import { PeopleWriteService } from '../people-write.service';
import { normalizePersonName } from '../people.utils';
import { QuarantineQueryDto } from './review.dto';

const bad = (message: string, code: string, status = HttpStatus.BAD_REQUEST) => new BusinessException(message, code, status);

/** Raw fields a reviewer may correct before retrying. Provenance, verification and confidence are NOT editable. */
export const RETRY_PATCHABLE_FIELDS = [
  'personName', 'jobTitle', 'email', 'phone', 'mobile', 'linkedinUrl',
  'businessId', 'businessSlug', 'businessIdentifier',
  'isCurrent', 'startDate', 'endDate', 'location', 'city', 'state', 'country',
] as const;

const isIngestionRaw = (raw: unknown): raw is IRawPersonRecord =>
  !!raw && typeof raw === 'object' && (raw as any).kind !== 'REVIEWER_QUARANTINE';

/**
 * Reviewer view of the ingestion quarantine (people_ingestion_quarantine). Nothing here retries or
 * resolves automatically: every transition is an explicit, audited reviewer action, and an
 * ambiguous identity is never re-attempted unless a reviewer supplies the missing identifier.
 */
@Injectable()
export class PeopleQuarantineService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDb,
    private readonly ingestion: PeopleIngestionService,
    private readonly writer: PeopleWriteService,
    private readonly publishing: PeoplePublishingService,
  ) {}

  async list(q: QuarantineQueryDto) {
    const t = schema.peopleIngestionQuarantine;
    const conds: SQL[] = [];
    const status = q.status ?? 'PENDING';
    if (status !== 'ALL') conds.push(eq(t.status, status));
    if (q.batchRef) conds.push(eq(t.batchRef, q.batchRef));
    if (q.code) conds.push(sql`${t.reasons} @> ${JSON.stringify([{ code: q.code }])}::jsonb`);
    if (q.createdFrom) conds.push(gte(t.createdAt, new Date(q.createdFrom)));
    if (q.createdTo) conds.push(lte(t.createdAt, new Date(q.createdTo)));
    const where = conds.length ? and(...conds) : undefined;
    const page = q.page ?? 1;
    const limit = q.limit ?? 25;

    const [rows, [{ total }]] = await Promise.all([
      this.db.select().from(t).where(where).orderBy(desc(t.createdAt), desc(t.id)).limit(limit).offset((page - 1) * limit),
      this.db.select({ total: sql<number>`count(*)::int` }).from(t).where(where),
    ]);
    return {
      items: rows.map((r) => {
        const raw = (r.raw ?? {}) as Record<string, any>;
        return {
          id: r.id,
          status: r.status,
          batchRef: r.batchRef,
          sourceLabel: r.sourceLabel,
          kind: raw.kind === 'REVIEWER_QUARANTINE' ? 'REVIEWER_QUARANTINE' : 'INGESTION',
          personName: raw.personName ?? null,
          jobTitle: raw.jobTitle ?? null,
          reasons: r.reasons,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        };
      }),
      pagination: { page, limit, totalItems: total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async getDetail(id: string) {
    const row = await this.load(id);
    const raw = row.raw as Record<string, any>;

    if (!isIngestionRaw(raw)) {
      // A role a reviewer put on hold: show the role it points at.
      return {
        id: row.id, status: row.status, kind: 'REVIEWER_QUARANTINE', batchRef: row.batchRef, sourceLabel: row.sourceLabel,
        raw, normalized: null, reasons: row.reasons, validationErrors: [], companyMatch: null, identityCandidates: [],
        source: null, resolution: row.resolution, createdAt: row.createdAt, updatedAt: row.updatedAt,
        roleId: raw.companyPersonId ?? null,
      };
    }

    const normalized = normalizeRawPerson(raw);
    const businessRef = normalized.ok
      ? normalized.record.businessRef
      : {
          id: raw.businessId,
          slug: raw.businessSlug,
          identifier: raw.businessIdentifier?.value ? { type: String(raw.businessIdentifier.type).toUpperCase(), value: String(raw.businessIdentifier.value).toUpperCase().replace(/\s+/g, '') } : undefined,
          // company hints (Phase 6.3) so a reviewer also sees how a hint-only record would resolve
          name: raw.company?.name,
          legalName: raw.company?.legalName,
          website: raw.company?.website,
          domain: raw.company?.domain,
          city: raw.company?.city,
          state: raw.company?.state,
          pincode: raw.company?.pincode,
        };
    const hasRef = !!(businessRef.id || businessRef.slug || businessRef.identifier || businessRef.identifiers || businessRef.name || businessRef.legalName || businessRef.website || businessRef.domain);
    const companyMatch = hasRef ? await this.ingestion.checkCompany(businessRef) : { status: 'NOT_FOUND' as const };

    // Identity ambiguity: who could this be? (same normalised name, current or earlier spelling, at that company)
    let identityCandidates: unknown[] = [];
    if (companyMatch.businessId && raw.personName) {
      const name = normalizePersonName(String(raw.personName).split(/\s+[-|]\s+|,/)[0]);
      identityCandidates = await this.db
        .select({
          personId: schema.people.id,
          fullName: schema.people.fullName,
          linkedinUrl: schema.people.linkedinUrl,
          dataStatus: schema.people.dataStatus,
          roleId: schema.companyPeople.id,
          jobTitle: schema.companyPeople.jobTitleAtCompany,
          reviewStatus: schema.companyPeople.reviewStatus,
        })
        .from(schema.people)
        .innerJoin(schema.companyPeople, eq(schema.companyPeople.personId, schema.people.id))
        .where(
          and(
            eq(schema.companyPeople.businessId, companyMatch.businessId),
            sql`(${schema.people.normalizedName} = ${name} OR ${name} = ANY(${schema.people.nameAliases}))`,
          ),
        )
        .limit(20);
    }

    return {
      id: row.id,
      status: row.status,
      kind: 'INGESTION',
      batchRef: row.batchRef,
      sourceLabel: row.sourceLabel,
      raw,
      normalized: normalized.ok ? normalized.record : null,
      reasons: row.reasons,
      validationErrors: normalized.ok ? [] : normalized.reasons,
      companyMatch,
      identityCandidates,
      source: raw.source ?? null,
      resolution: row.resolution,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** Reviewer says "handled" (fixed elsewhere / duplicate / not needed). For a reviewer-held role this reopens the role. */
  async resolve(id: string, ctx: IReviewContext) {
    this.requireNote(ctx, 'resolve a quarantine item');
    const row = await this.load(id);
    this.requirePending(row);
    const raw = row.raw as Record<string, any>;
    if (!isIngestionRaw(raw) && raw.companyPersonId) {
      await this.publishing.reopenRole(raw.companyPersonId, ctx); // also closes this row
      return { id, status: 'RESOLVED' as const, action: 'REOPEN_ROLE' };
    }
    return this.close(id, 'RESOLVED', 'RESOLVED_MANUALLY', ctx, row);
  }

  /** Discard the record: it stays out of Orion. */
  async reject(id: string, ctx: IReviewContext) {
    this.requireNote(ctx, 'reject a quarantine item');
    const row = await this.load(id);
    this.requirePending(row);
    const raw = row.raw as Record<string, any>;
    if (!isIngestionRaw(raw) && raw.companyPersonId) {
      await this.publishing.rejectRole(raw.companyPersonId, ctx);
    }
    return this.close(id, 'DISCARDED', 'REJECTED', ctx, row);
  }

  /**
   * Explicit re-attempt. Optional `patch` supplies corrected/missing identifying data (never provenance or
   * verification). Success creates/updates a DRAFT role that then enters the normal review queue; failure keeps the
   * item PENDING with fresh reasons. Nothing is published.
   */
  async retry(id: string, ctx: IReviewContext, patch?: Record<string, unknown>) {
    this.requireNote(ctx, 'retry a quarantine item');
    const row = await this.load(id);
    this.requirePending(row);
    const raw = row.raw as Record<string, any>;
    if (!isIngestionRaw(raw)) throw bad('Reviewer-held roles are reopened (resolve), not retried', 'NOT_RETRYABLE', HttpStatus.CONFLICT);

    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch ?? {})) {
      if (!(RETRY_PATCHABLE_FIELDS as readonly string[]).includes(k)) {
        throw bad(`Field "${k}" cannot be edited on a quarantined record`, 'FIELD_NOT_EDITABLE');
      }
      clean[k] = v;
    }
    const candidate: IRawPersonRecord = { ...raw, ...clean } as IRawPersonRecord;

    const report = await this.ingestion.ingest([candidate], { batchRef: `review-retry:${id}`, sourceLabel: 'reviewer-retry', quarantine: false });
    const result = report.results[0];

    if (result.outcome === 'QUARANTINED') {
      await this.db.transaction(async (tx) => {
        await tx.update(schema.peopleIngestionQuarantine).set({ reasons: result.reasons ?? [], updatedAt: new Date() }).where(eq(schema.peopleIngestionQuarantine.id, id));
        await this.publishing.writeAudit(tx, ctx, {
          action: 'PEOPLE_QUARANTINE_RETRY_FAILED',
          entityType: 'PEOPLE_QUARANTINE',
          entityId: id,
          old: { reasons: row.reasons },
          new: { reasons: result.reasons, patchedFields: Object.keys(clean) },
        });
      });
      return { id, status: 'PENDING' as const, outcome: 'QUARANTINED' as const, reasons: result.reasons };
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.peopleIngestionQuarantine)
        .set({
          status: 'RESOLVED',
          raw: candidate as unknown as Record<string, unknown>,
          resolution: { action: 'RETRY', by: ctx.reviewedBy, at: new Date().toISOString(), note: ctx.note, outcome: result.outcome, personId: result.personId, companyPersonId: result.companyPersonId },
          updatedAt: new Date(),
        })
        .where(eq(schema.peopleIngestionQuarantine.id, id));
      await this.publishing.writeAudit(tx, ctx, {
        action: 'PEOPLE_QUARANTINE_RETRIED',
        entityType: 'PEOPLE_QUARANTINE',
        entityId: id,
        old: { status: row.status, raw: pickPatched(raw, clean) },
        new: { status: 'RESOLVED', raw: pickPatched(candidate, clean), outcome: result.outcome, personId: result.personId, companyPersonId: result.companyPersonId },
      });
    });
    return { id, status: 'RESOLVED' as const, outcome: result.outcome, personId: result.personId, companyPersonId: result.companyPersonId };
  }

  /**
   * Blocks the person from ever being re-ingested. Uses an existing person when `personId` is given or the record
   * belongs to a reviewer-held role; otherwise creates a suppressed stub from the record so that future ingestion
   * (by LinkedIn, work email, or name at that company) is refused.
   */
  async suppress(id: string, ctx: IReviewContext, personId?: string) {
    this.requireNote(ctx, 'suppress a person');
    const row = await this.load(id);
    this.requirePending(row);
    const raw = row.raw as Record<string, any>;

    let target = personId ?? (!isIngestionRaw(raw) ? (raw.personId as string | undefined) : undefined);
    if (!target) {
      const normalized = normalizeRawPerson(raw as IRawPersonRecord);
      if (!normalized.ok) throw bad('This record cannot be tied to a person; supply personId', 'PERSON_REQUIRED', HttpStatus.CONFLICT);
      const check = await this.ingestion.checkCompany(normalized.record.businessRef);
      if (check.status !== 'MATCHED') throw bad('The company is not resolved; supply personId', 'PERSON_REQUIRED', HttpStatus.CONFLICT);
      try {
        const stub = await this.writer.upsertPersonForBusiness({ ...normalized.record.upsert, businessId: check.businessId! });
        target = stub.personId;
      } catch (err) {
        if (err instanceof BusinessException && err.errorCode === 'AMBIGUOUS_IDENTITY') {
          throw bad('Several people match; choose one and supply personId', 'PERSON_REQUIRED', HttpStatus.CONFLICT);
        }
        if (err instanceof BusinessException && err.errorCode === 'SUPPRESSED_PERSON') {
          // the identity is already suppressed: the goal of this action is met; close against that person
          const known = (err.details as { suppression?: { personId?: string | null } } | undefined)?.suppression?.personId;
          if (!known) return this.close(id, 'DISCARDED', 'SUPPRESSED', ctx, row, { personId: null, alreadySuppressed: true });
          target = known;
        } else throw err;
      }
    }
    await this.publishing.suppressPerson(target, ctx, { origin: 'QUARANTINE_ACTION', sourceReference: `quarantine:${id}` });
    return this.close(id, 'DISCARDED', 'SUPPRESSED', ctx, row, { personId: target });
  }

  // ------------------------------------------------------------------ helpers
  private async load(id: string) {
    const [row] = await this.db.select().from(schema.peopleIngestionQuarantine).where(eq(schema.peopleIngestionQuarantine.id, id));
    if (!row) throw bad('Quarantine item not found', 'QUARANTINE_NOT_FOUND', HttpStatus.NOT_FOUND);
    return row;
  }
  private requirePending(row: { status: string }) {
    if (row.status !== 'PENDING') throw bad(`Item is already ${row.status}`, 'QUARANTINE_CLOSED', HttpStatus.CONFLICT);
  }
  private requireNote(ctx: IReviewContext, what: string) {
    if (!ctx.note || ctx.note.trim().length < 3) throw bad(`A reason is required to ${what}`, 'REASON_REQUIRED');
  }

  private async close(
    id: string,
    status: 'RESOLVED' | 'DISCARDED',
    action: string,
    ctx: IReviewContext,
    row: { status: string },
    extra: Record<string, unknown> = {},
  ) {
    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.peopleIngestionQuarantine)
        .set({ status, resolution: { action, by: ctx.reviewedBy, at: new Date().toISOString(), note: ctx.note, ...extra }, updatedAt: new Date() })
        .where(eq(schema.peopleIngestionQuarantine.id, id));
      await this.publishing.writeAudit(tx, ctx, {
        action: `PEOPLE_QUARANTINE_${action}`,
        entityType: 'PEOPLE_QUARANTINE',
        entityId: id,
        old: { status: row.status },
        new: { status, ...extra },
      });
    });
    return { id, status, action, ...extra };
  }
}

const pickPatched = (rec: Record<string, any>, patch: Record<string, unknown>) =>
  Object.fromEntries(Object.keys(patch).map((k) => [k, rec[k] ?? null]));

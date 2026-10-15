import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { sql, SQL } from 'drizzle-orm';
import { BusinessException } from '../../../common/errors/business.exception';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import { VERIFICATION_STALE_AFTER_DAYS } from '../people.constants';
import { MetricsRangeDto, ProblemBatchesQueryDto } from './metrics.dto';

const rowsOf = (res: any): any[] => (res?.rows ?? res) as any[];
const num = (v: unknown): number => Number(v ?? 0);
const int = (row: Record<string, unknown> | undefined, keys: string[]) => Object.fromEntries(keys.map((k) => [k, num(row?.[k])]));
const asMap = (rows: any[], key: string, val = 'n') => Object.fromEntries(rows.map((r) => [String(r[key]), num(r[val])]));

/**
 * Data quality and pipeline metrics (Phase 6.14): FACTUAL counts derived on request, with aggregate SQL, from the tables the
 * pipeline already writes. It stores nothing, has no status or lifecycle of its own, and computes no score, rank or prediction.
 * It returns numbers and machine codes only: no contact values, names, payloads, source configuration, reviewer identity or text.
 *
 * Date range (from / to, inclusive, ISO 8601; omitted = all time) applies to the CREATION time of what is counted:
 *   events    import_batches, people_ingestion_quarantine, people_observations, people_conflicts (first detected),
 *             publish_queue, people_acquisition_runs, people_suppressions
 *   records   people (contacts section) and company_people (review / verification / classification sections)
 * Record sections are therefore "of the people / roles created in the range, as they stand now"; `asOf` says when.
 */
@Injectable()
export class PeopleMetricsService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDb) {}

  async overview(range: MetricsRangeDto) {
    const { from, to } = this.validate(range);
    const at = (col: string): SQL[] => this.bounds(col, from, to);
    const where = (col: string) => {
      const c = at(col);
      return c.length ? sql`WHERE ${sql.join(c, sql` AND `)}` : sql``;
    };
    const and = (col: string) => {
      const c = at(col);
      return c.length ? sql` AND ${sql.join(c, sql` AND `)}` : sql``;
    };
    const run = async (q: SQL) => rowsOf(await this.db.execute(q));

    const [
      batchAgg, batchStatus, quarantineStatus, quarantineCodes, obs, registry,
      people, contactConflicts, roles, classificationSource, classificationVersion, conflicts,
      health, duration, publishQ, runs,
    ] = await Promise.all([
      run(sql`SELECT count(*)::int AS batches, COALESCE(sum(total_records), 0)::int AS total, COALESCE(sum(processed_records), 0)::int AS processed,
          COALESCE(sum(successful_records), 0)::int AS accepted, COALESCE(sum(failed_records), 0)::int AS rejected, COALESCE(sum(duplicate_records), 0)::int AS duplicates,
          COALESCE(sum((people_summary->>'received')::int), 0)::int AS p_received, COALESCE(sum((people_summary->>'created')::int), 0)::int AS p_created,
          COALESCE(sum((people_summary->>'updated')::int), 0)::int AS p_updated, COALESCE(sum((people_summary->>'unchanged')::int), 0)::int AS p_skipped,
          COALESCE(sum((people_summary->>'quarantined')::int), 0)::int AS p_quarantined, COALESCE(sum((people_summary->>'rejected')::int), 0)::int AS p_rejected,
          COALESCE(sum((people_summary->>'errors')::int), 0)::int AS p_errors
        FROM import_batches ${where('created_at')}`),
      run(sql`SELECT status::text AS k, count(*)::int AS n FROM import_batches ${where('created_at')} GROUP BY status ORDER BY k`),
      run(sql`SELECT status AS k, count(*)::int AS n FROM people_ingestion_quarantine ${where('created_at')} GROUP BY status ORDER BY k`),
      run(sql`SELECT COALESCE(reasons->0->>'code', 'UNKNOWN') AS k, count(*)::int AS n FROM people_ingestion_quarantine ${where('created_at')} GROUP BY 1 ORDER BY n DESC, k ASC LIMIT 20`),
      run(sql`SELECT count(*)::int AS observations,
          count(*) FILTER (WHERE outcome = 'INGESTED')::int AS matched,
          count(*) FILTER (WHERE reason_codes @> ARRAY['BUSINESS_NOT_FOUND']::text[])::int AS not_found,
          count(*) FILTER (WHERE reason_codes @> ARRAY['AMBIGUOUS_COMPANY_MATCH']::text[])::int AS ambiguous_company,
          count(*) FILTER (WHERE reason_codes @> ARRAY['SUPPRESSED_PERSON']::text[])::int AS suppression_hits,
          count(*) FILTER (WHERE reason_codes @> ARRAY['AMBIGUOUS_IDENTITY']::text[])::int AS ambiguous_identity
        FROM people_observations ${where('created_at')}`),
      run(sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE true ${and('created_at')})::int AS in_range FROM people_suppressions`),
      run(sql`SELECT count(*)::int AS total,
          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM person_contacts c WHERE c.person_id = p.id AND c.contact_type = 'WORK_EMAIL'))::int AS with_email,
          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM person_contacts c WHERE c.person_id = p.id AND c.contact_type IN ('PHONE', 'MOBILE')))::int AS with_phone,
          count(*) FILTER (WHERE p.linkedin_url IS NOT NULL)::int AS with_linkedin,
          count(*) FILTER (WHERE p.linkedin_url IS NOT NULL OR EXISTS (SELECT 1 FROM person_contacts c WHERE c.person_id = p.id))::int AS with_any
        FROM people p WHERE p.data_status <> 'SUPPRESSED' ${and('p.created_at')}`),
      run(sql`SELECT count(*)::int AS n FROM people_conflicts WHERE status = 'OPEN' AND conflict_type IN ('CONTACT_MULTIPLE_PEOPLE', 'CONTACT_CONFLICTING_VALUES') ${and('first_detected_at')}`),
      run(sql`SELECT count(*)::int AS total,
          count(*) FILTER (WHERE review_status = 'PENDING')::int AS pending, count(*) FILTER (WHERE review_status = 'APPROVED')::int AS approved,
          count(*) FILTER (WHERE review_status = 'REJECTED')::int AS rejected, count(*) FILTER (WHERE review_status = 'QUARANTINED')::int AS quarantined,
          count(*) FILTER (WHERE is_published)::int AS published,
          count(*) FILTER (WHERE verification_status::text = 'VERIFIED')::int AS verified,
          count(*) FILTER (WHERE verification_status::text = 'PARTIALLY_VERIFIED')::int AS partially_verified,
          count(*) FILTER (WHERE verification_status::text = 'UNVERIFIED')::int AS unverified,
          count(*) FILTER (WHERE verification_status::text = 'CONFLICTED')::int AS disputed,
          count(*) FILTER (WHERE verification_status::text = 'STALE' OR (verification_status::text = 'VERIFIED' AND (last_verified_at IS NULL OR last_verified_at < now() - make_interval(days => ${VERIFICATION_STALE_AFTER_DAYS}))))::int AS stale,
          count(*) FILTER (WHERE seniority_level <> 'UNKNOWN')::int AS classified,
          count(*) FILTER (WHERE seniority_level = 'UNKNOWN')::int AS unclassified,
          count(*) FILTER (WHERE decision_maker_type IS NOT NULL)::int AS decision_makers
        FROM company_people ${where('created_at')}`),
      run(sql`SELECT classification_source AS k, count(*)::int AS n FROM company_people ${where('created_at')} GROUP BY 1 ORDER BY k`),
      run(sql`SELECT COALESCE(classification_version, 'unversioned') AS k, count(*)::int AS n FROM company_people ${where('created_at')} GROUP BY 1 ORDER BY k`),
      run(sql`SELECT conflict_type AS type, status AS k, count(*)::int AS n FROM people_conflicts ${where('first_detected_at')} GROUP BY conflict_type, status ORDER BY type, k`),
      run(sql`SELECT count(*) FILTER (WHERE status = 'FAILED')::int AS failed_batches,
          count(*) FILTER (WHERE COALESCE((people_summary->>'errors')::int, 0) > 0)::int AS batches_with_people_errors,
          COALESCE(sum(failed_records), 0)::int AS failed_records
        FROM import_batches ${where('created_at')}`),
      run(sql`SELECT count(*)::int AS measured, COALESCE(round(avg(d)::numeric, 2), 0) AS avg_seconds, COALESCE(round(max(d)::numeric, 2), 0) AS max_seconds,
          COALESCE(round((percentile_cont(0.95) WITHIN GROUP (ORDER BY d))::numeric, 2), 0) AS p95_seconds
        FROM (SELECT extract(epoch FROM (completed_at - started_at)) AS d FROM import_batches
              WHERE status = 'COMPLETED' AND started_at IS NOT NULL AND completed_at IS NOT NULL ${and('created_at')}) t`),
      run(sql`SELECT count(*) FILTER (WHERE status = 'FAILED')::int AS failed, COALESCE(sum(retry_count), 0)::int AS retries FROM publish_queue ${where('created_at')}`),
      run(sql`SELECT status AS k, count(*)::int AS n, COALESCE(sum(retries), 0)::int AS retries, COALESCE(sum(records_failed), 0)::int AS records_failed,
          COALESCE(round(avg(extract(epoch FROM (finished_at - started_at)))::numeric, 2), 0) AS avg_seconds
        FROM people_acquisition_runs ${where('created_at')} GROUP BY status ORDER BY k`),
    ]);

    const b = batchAgg[0];
    const o = obs[0];
    const p = people[0];
    const r = roles[0];
    const total = num(p?.total);
    const withAny = num(p?.with_any);
    const byType: Record<string, Record<string, number>> = {};
    for (const c of conflicts) (byType[c.type] ??= {})[c.k] = num(c.n);

    return {
      range: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },
      asOf: new Date().toISOString(),
      acquisition: {
        uploads: num(b?.batches),
        byStatus: asMap(batchStatus, 'k'),
        rows: int(b, ['total', 'processed', 'accepted', 'rejected', 'duplicates']),
        people: { received: num(b?.p_received), created: num(b?.p_created), updated: num(b?.p_updated), skipped: num(b?.p_skipped), quarantined: num(b?.p_quarantined), rejected: num(b?.p_rejected), errors: num(b?.p_errors) },
        quarantine: { total: Object.values(asMap(quarantineStatus, 'k')).reduce((a, c) => a + c, 0), byStatus: asMap(quarantineStatus, 'k'), topReasonCodes: quarantineCodes.map((x) => ({ code: x.k, count: num(x.n) })) },
      },
      companyResolution: {
        basis: 'keyed observations',
        matched: num(o?.matched),
        notFound: num(o?.not_found),
        ambiguous: num(o?.ambiguous_company),
      },
      identity: {
        basis: 'keyed observations',
        suppressionHits: num(o?.suppression_hits),
        duplicateIdentityAttempts: num(o?.ambiguous_identity),
        suppressionRegistry: { total: num(registry[0]?.total), inRange: num(registry[0]?.in_range) },
      },
      contacts: {
        basis: 'people created in range, excluding suppressed',
        people: total,
        withEmail: num(p?.with_email),
        withPhone: num(p?.with_phone),
        withLinkedin: num(p?.with_linkedin),
        withAnyContact: withAny,
        missingContacts: total - withAny,
        openContactConflicts: num(contactConflicts[0]?.n),
      },
      review: {
        basis: 'roles created in range',
        roles: num(r?.total),
        pending: num(r?.pending), approved: num(r?.approved), rejected: num(r?.rejected), quarantined: num(r?.quarantined), published: num(r?.published),
      },
      verification: {
        basis: 'roles created in range; stale = stored STALE, or VERIFIED older than the existing staleness window',
        staleAfterDays: VERIFICATION_STALE_AFTER_DAYS,
        verified: num(r?.verified), partiallyVerified: num(r?.partially_verified), unverified: num(r?.unverified), disputed: num(r?.disputed), stale: num(r?.stale),
      },
      classification: {
        basis: 'roles created in range',
        classified: num(r?.classified),
        unclassified: num(r?.unclassified),
        decisionMakers: num(r?.decision_makers),
        bySource: asMap(classificationSource, 'k'),
        byTaxonomyVersion: asMap(classificationVersion, 'k'),
      },
      conflicts: {
        basis: 'first detected in range',
        open: Object.fromEntries(Object.entries(byType).map(([t, s]) => [t, s.OPEN ?? 0]).filter(([, n]) => (n as number) > 0)),
        openTotal: Object.values(byType).reduce((a, s) => a + (s.OPEN ?? 0), 0),
        resolvedTotal: Object.values(byType).reduce((a, s) => a + (s.RESOLVED ?? 0), 0),
      },
      pipelineHealth: {
        failedBatches: num(health[0]?.failed_batches),
        batchesWithPeopleErrors: num(health[0]?.batches_with_people_errors),
        failedRows: num(health[0]?.failed_records),
        peopleStageErrors: num(b?.p_errors),
        publishQueue: { failed: num(publishQ[0]?.failed), retries: num(publishQ[0]?.retries) },
        processingSeconds: { batchesMeasured: num(duration[0]?.measured), average: num(duration[0]?.avg_seconds), p95: num(duration[0]?.p95_seconds), max: num(duration[0]?.max_seconds) },
        acquisitionRuns: runs.map((x) => ({ status: x.k, runs: num(x.n), retries: num(x.retries), failedRecords: num(x.records_failed), averageSeconds: num(x.avg_seconds) })),
      },
    };
  }

  /** Batches with failures, rejected rows or People-stage problems: counts only, newest first, paginated. */
  async problemBatches(q: ProblemBatchesQueryDto) {
    const { from, to } = this.validate(q);
    const page = q.page ?? 1;
    const limit = q.limit ?? 20;
    const conds: SQL[] = [
      sql`(b.status = 'FAILED' OR b.failed_records > 0 OR COALESCE((b.people_summary->>'errors')::int, 0) + COALESCE((b.people_summary->>'rejected')::int, 0) + COALESCE((b.people_summary->>'quarantined')::int, 0) > 0)`,
      ...this.bounds('b.created_at', from, to),
    ];
    const where = sql`WHERE ${sql.join(conds, sql` AND `)}`;
    const [rows, count] = await Promise.all([
      this.db.execute(sql`SELECT b.id, b.filename, b.status::text AS status, b.created_at, b.total_records, b.failed_records, b.duplicate_records,
          COALESCE((b.people_summary->>'errors')::int, 0) AS people_errors, COALESCE((b.people_summary->>'rejected')::int, 0) AS people_rejected,
          COALESCE((b.people_summary->>'quarantined')::int, 0) AS people_quarantined,
          CASE WHEN b.started_at IS NOT NULL AND b.completed_at IS NOT NULL THEN round(extract(epoch FROM (b.completed_at - b.started_at))::numeric, 2) END AS duration_seconds
        FROM import_batches b ${where} ORDER BY b.created_at DESC, b.id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`),
      this.db.execute(sql`SELECT count(*)::int AS n FROM import_batches b ${where}`),
    ]);
    const total = num(rowsOf(count)[0]?.n);
    return {
      items: rowsOf(rows).map((r) => ({
        id: r.id,
        filename: r.filename,
        status: r.status,
        createdAt: r.created_at,
        rows: { total: num(r.total_records), failed: num(r.failed_records), duplicate: num(r.duplicate_records) },
        people: { errors: num(r.people_errors), rejected: num(r.people_rejected), quarantined: num(r.people_quarantined) },
        durationSeconds: r.duration_seconds === null || r.duration_seconds === undefined ? null : num(r.duration_seconds),
      })),
      pagination: { page, limit, totalItems: total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  private validate(r: MetricsRangeDto): { from?: Date; to?: Date } {
    const from = r.from ? new Date(r.from) : undefined;
    const to = r.to ? new Date(r.to) : undefined;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
      throw new BusinessException('Invalid date range', 'INVALID_DATE_RANGE', HttpStatus.BAD_REQUEST);
    }
    if (from && to && from > to) throw new BusinessException('"from" must not be after "to"', 'INVALID_DATE_RANGE', HttpStatus.BAD_REQUEST);
    return { from, to };
  }

  /** Inclusive bounds on a creation-time column. `col` is always a constant from this file, never user input. */
  private bounds(col: string, from?: Date, to?: Date): SQL[] {
    const out: SQL[] = [];
    if (from) out.push(sql`${sql.raw(col)} >= ${from.toISOString()}::timestamptz`);
    if (to) out.push(sql`${sql.raw(col)} <= ${to.toISOString()}::timestamptz`);
    return out;
  }
}

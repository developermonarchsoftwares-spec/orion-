import { HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { and, desc, eq, gte, ilike, inArray, lte, sql, SQL } from 'drizzle-orm';
import { BusinessException } from '../../../common/errors/business.exception';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { OpsBatchesQueryDto, OpsRecordsQueryDto } from '../dto/import-operations.dto';
import { ImportPeopleBridge } from '../people/import-people.bridge';
import { emptyPeopleSummary, IPeopleIngestionSummary } from '../people/import-people.types';

/** Most records re-run by one reprocess call; a larger backlog is simply run again. */
export const MAX_REPROCESS_PER_CALL = 500;

const PEOPLE_KEYS = Object.keys(emptyPeopleSummary()) as Array<keyof IPeopleIngestionSummary>;

const rowsOf = (res: any): any[] => (res?.rows ?? res) as any[];

/**
 * Internal operations view over the existing upload pipeline (Phase 6.13). It READS the import tables the pipeline already writes
 * (import_batches / import_records / validation_logs / publish_queue) and the People stage's report stored on them. It has no
 * ingestion logic of its own: "reprocess" calls the existing ImportPeopleBridge, which hands records to the existing, idempotent
 * People ingestion. It never returns raw row payloads, mapping/options, file keys, source configuration, error text or person
 * and contact data: only counts, status, outcome and reason codes (plus the company name, so an operator can find the row).
 */
@Injectable()
export class ImportOperationsService {
  private readonly logger = new Logger(ImportOperationsService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDb,
    @Optional() private readonly bridge?: ImportPeopleBridge,
    @Optional() private readonly audit?: AuditLogService,
  ) {}

  // ------------------------------------------------------------------ list
  async listBatches(q: OpsBatchesQueryDto) {
    const b = schema.importBatches;
    const page = q.page ?? 1;
    const limit = q.limit ?? 20;
    const conds: SQL[] = [];
    if (q.status && q.status !== 'ALL') conds.push(eq(b.status, q.status));
    if (q.from) conds.push(gte(b.createdAt, new Date(q.from)));
    if (q.to) conds.push(lte(b.createdAt, new Date(q.to)));
    if (q.sourceId) conds.push(eq(b.sourceId, q.sourceId));
    if (q.q?.trim()) conds.push(ilike(b.filename, `%${q.q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`));
    if (q.hasIssues) {
      const issues = sql`(${b.failedRecords} > 0 OR ${b.status} = 'FAILED'
        OR COALESCE((${b.peopleSummary}->>'rejected')::int, 0) + COALESCE((${b.peopleSummary}->>'quarantined')::int, 0) + COALESCE((${b.peopleSummary}->>'errors')::int, 0) > 0)`;
      conds.push(q.hasIssues === 'true' ? issues : sql`NOT ${issues}`);
    }
    const where = conds.length ? and(...conds) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select({ batch: b, sourceName: schema.dataSources.name, sourceType: schema.dataSources.type })
        .from(b)
        .leftJoin(schema.dataSources, eq(schema.dataSources.id, b.sourceId))
        .where(where)
        .orderBy(desc(b.createdAt), desc(b.id))
        .limit(limit)
        .offset((page - 1) * limit),
      this.db.select({ total: sql<number>`count(*)::int` }).from(b).where(where),
    ]);

    const breakdown = await this.recordStatusCounts(rows.map((r) => r.batch.id));
    return {
      items: rows.map((r) => this.toBatchView(r.batch, { name: r.sourceName, type: r.sourceType }, breakdown.get(r.batch.id) ?? {})),
      pagination: { page, limit, totalItems: total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  // ------------------------------------------------------------------ detail
  async getBatchDetail(batchId: string, q: OpsRecordsQueryDto) {
    const b = schema.importBatches;
    const [row] = await this.db
      .select({ batch: b, sourceName: schema.dataSources.name, sourceType: schema.dataSources.type })
      .from(b)
      .leftJoin(schema.dataSources, eq(schema.dataSources.id, b.sourceId))
      .where(eq(b.id, batchId));
    if (!row) throw new BusinessException('Import batch not found', 'IMPORT_BATCH_NOT_FOUND', HttpStatus.NOT_FOUND);

    const page = q.page ?? 1;
    const limit = q.limit ?? 50;
    const r = schema.importRecords;
    const recConds: SQL[] = [eq(r.batchId, batchId)];
    if (q.status && q.status !== 'ALL') recConds.push(eq(r.status, q.status));
    // the same filters for the aliased raw query below
    const rawConds: SQL[] = [sql`r.batch_id = ${batchId}`];
    if (q.status && q.status !== 'ALL') rawConds.push(sql`r.status = ${q.status}`);

    const [records, [{ total }], breakdown, peopleCodes, validationCodes] = await Promise.all([
      this.db.execute(sql`
        SELECT r.id, r.row_number, r.status, r.has_duplicates, r.is_published, r.people_result,
          COALESCE(r.normalized_payload->>'name', r.raw_payload->>'business_name', r.raw_payload->>'name') AS company_name,
          pq.status AS publish_status, pq.retry_count AS publish_retries, pq.target_business_id
        FROM import_records r
        LEFT JOIN LATERAL (SELECT p.status, p.retry_count, p.target_business_id FROM publish_queue p WHERE p.record_id = r.id ORDER BY p.created_at DESC, p.id DESC LIMIT 1) pq ON true
        WHERE ${sql.join(rawConds, sql` AND `)}
        ORDER BY r.row_number ASC, r.id ASC
        LIMIT ${limit} OFFSET ${(page - 1) * limit}`),
      this.db.select({ total: sql<number>`count(*)::int` }).from(r).where(and(...recConds)),
      this.recordStatusCounts([batchId]),
      this.db.execute(sql`
        SELECT code, count(*)::int AS n
        FROM import_records r, jsonb_array_elements(COALESCE(r.people_result->'outcomes', '[]'::jsonb)) o, jsonb_array_elements_text(COALESCE(o->'codes', '[]'::jsonb)) code
        WHERE r.batch_id = ${batchId} GROUP BY code ORDER BY n DESC, code ASC`),
      this.db.execute(sql`
        SELECT v.rule_name, v.field, v.severity::text AS severity, count(*)::int AS n
        FROM validation_logs v JOIN import_records r ON r.id = v.record_id
        WHERE r.batch_id = ${batchId} AND NOT v.passed GROUP BY v.rule_name, v.field, v.severity ORDER BY n DESC, v.rule_name ASC, v.field ASC`),
    ]);

    const list = rowsOf(records);
    const failedRules = list.length
      ? rowsOf(
          await this.db.execute(sql`
            SELECT v.record_id, v.rule_name, v.field, v.severity::text AS severity FROM validation_logs v
            WHERE NOT v.passed AND v.record_id IN (${sql.join(list.map((x) => sql`${x.id}::uuid`), sql`, `)}) ORDER BY v.rule_name, v.field`),
        )
      : [];

    return {
      batch: this.toBatchView(row.batch, { name: row.sourceName, type: row.sourceType }, breakdown.get(batchId) ?? {}),
      reasonCodes: {
        people: rowsOf(peopleCodes).map((x) => ({ code: x.code, count: x.n })),
        validation: rowsOf(validationCodes).map((x) => ({ rule: x.rule_name, field: x.field, severity: x.severity, count: x.n })),
      },
      records: list.map((x) => {
        const pr = (x.people_result ?? null) as Record<string, any> | null;
        return {
          id: x.id,
          rowNumber: x.row_number,
          status: x.status,
          isDuplicate: x.has_duplicates || x.status === 'FLAGGED_DUPLICATE',
          isPublished: x.status === 'PUBLISHED' || x.is_published,
          companyName: x.company_name ?? null,
          businessId: x.target_business_id ?? null,
          publish: x.publish_status ? { status: x.publish_status, retries: x.publish_retries } : null,
          validationFailures: failedRules.filter((v) => v.record_id === x.id).map((v) => ({ rule: v.rule_name, field: v.field, severity: v.severity })),
          people: pr
            ? {
                attempted: !!pr.attempted,
                skipped: pr.skipped ?? null,
                failed: !!pr.error,
                counts: Object.fromEntries(PEOPLE_KEYS.map((k) => [k, Number(pr[k] ?? 0)])),
                // per person: outcome and machine codes only
                outcomes: ((pr.outcomes ?? []) as any[]).map((o) => ({ index: o.index, outcome: o.outcome, codes: o.codes ?? [] })),
              }
            : null,
        };
      }),
      pagination: { page, limit, totalItems: total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  // ------------------------------------------------------------------ reprocess
  /**
   * Re-runs ONLY the People stage of already PUBLISHED company rows whose People result is missing or errored (never attempted,
   * or ingestion failed as a whole). It goes through the existing bridge and ingestion, whose observation / writer idempotency
   * makes a repeat a no-op for anything already ingested. Rejected and quarantined people are NOT retried here: they are decisions
   * and belong to the existing quarantine and review workflows. Failed company rows are re-run with the existing publish-batch action.
   */
  async reprocessPeople(batchId: string, actor: { userId?: string }) {
    if (!this.bridge) throw new BusinessException('The People stage is not available', 'PEOPLE_STAGE_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE);
    const [batch] = await this.db.select().from(schema.importBatches).where(eq(schema.importBatches.id, batchId));
    if (!batch) throw new BusinessException('Import batch not found', 'IMPORT_BATCH_NOT_FOUND', HttpStatus.NOT_FOUND);

    const candidates = rowsOf(
      await this.db.execute(sql`
        SELECT r.id, r.batch_id, r.row_number, r.raw_payload, r.created_at,
          (SELECT p.target_business_id FROM publish_queue p WHERE p.record_id = r.id AND p.status = 'PUBLISHED' AND p.target_business_id IS NOT NULL ORDER BY p.created_at DESC, p.id DESC LIMIT 1) AS business_id
        FROM import_records r
        WHERE r.batch_id = ${batchId} AND r.status = 'PUBLISHED'
          AND (r.people_result IS NULL OR r.people_result->>'error' IS NOT NULL OR COALESCE((r.people_result->>'errors')::int, 0) > 0)
        ORDER BY r.row_number ASC, r.id ASC
        LIMIT ${MAX_REPROCESS_PER_CALL + 1}`),
    );
    const more = candidates.length > MAX_REPROCESS_PER_CALL;
    const todo = candidates.slice(0, MAX_REPROCESS_PER_CALL);

    const out = { candidates: todo.length, reprocessed: 0, stillFailing: 0, skippedNoCompany: 0, moreRemaining: more };
    for (const c of todo) {
      if (!c.business_id) {
        out.skippedNoCompany++;
        continue;
      }
      // the bridge never throws and stores the new result on the record (replacing the errored one)
      const res = await this.bridge.ingestForPublishedRecord({
        businessId: c.business_id,
        record: { id: c.id, batchId: c.batch_id, rowNumber: c.row_number, rawPayload: c.raw_payload, createdAt: new Date(c.created_at) },
      });
      if (res.error || res.errors > 0) out.stillFailing++;
      else out.reprocessed++;
    }
    await this.recomputePeopleSummary(batchId);
    await this.audit?.record({ userId: actor.userId, action: 'IMPORT_PEOPLE_REPROCESSED', entityType: 'IMPORT_BATCH', entityId: batchId, newValues: out });
    return { batchId, ...out };
  }

  /** The batch summary is, by definition, the sum of its records' People results; recomputing keeps it exact after a reprocess. */
  private async recomputePeopleSummary(batchId: string) {
    const sum = (k: string) => sql`COALESCE(sum((r.people_result->>${k})::int), 0)::int`;
    const [agg] = rowsOf(
      await this.db.execute(sql`
        SELECT count(*) FILTER (WHERE r.people_result IS NOT NULL)::int AS withresult,
          ${sum('received')} AS received, ${sum('accepted')} AS accepted, ${sum('created')} AS created, ${sum('updated')} AS updated,
          ${sum('unchanged')} AS unchanged, ${sum('quarantined')} AS quarantined, ${sum('rejected')} AS rejected, ${sum('errors')} AS errors
        FROM import_records r WHERE r.batch_id = ${batchId}`),
    );
    if (!agg || agg.withresult === 0) return;
    await this.db
      .update(schema.importBatches)
      .set({
        peopleSummary: Object.fromEntries(PEOPLE_KEYS.map((k) => [k, Number(agg[k] ?? 0)])),
        updatedAt: new Date(),
      })
      .where(eq(schema.importBatches.id, batchId));
  }

  // ------------------------------------------------------------------ helpers
  private async recordStatusCounts(batchIds: string[]): Promise<Map<string, Record<string, number>>> {
    const map = new Map<string, Record<string, number>>();
    if (batchIds.length === 0) return map;
    const rows = await this.db
      .select({ batchId: schema.importRecords.batchId, status: schema.importRecords.status, n: sql<number>`count(*)::int` })
      .from(schema.importRecords)
      .where(inArray(schema.importRecords.batchId, batchIds))
      .groupBy(schema.importRecords.batchId, schema.importRecords.status);
    for (const r of rows) map.set(r.batchId, { ...(map.get(r.batchId) ?? {}), [r.status]: r.n });
    return map;
  }

  private toBatchView(
    batch: typeof schema.importBatches.$inferSelect,
    source: { name: string | null; type: string | null },
    byStatus: Record<string, number>,
  ) {
    const ps = (batch.peopleSummary ?? null) as Partial<IPeopleIngestionSummary> | null;
    const people = ps ? Object.fromEntries(PEOPLE_KEYS.map((k) => [k, Number(ps[k] ?? 0)])) : null;
    const peopleIssues = people ? Number(people.rejected) + Number(people.quarantined) + Number(people.errors) : 0;
    const hasIssues = batch.status === 'FAILED' || batch.failedRecords > 0 || peopleIssues > 0;
    return {
      id: batch.id,
      filename: batch.filename,
      status: batch.status,
      createdAt: batch.createdAt,
      startedAt: batch.startedAt,
      completedAt: batch.completedAt,
      fileSize: batch.fileSize,
      source: source.name || source.type ? { name: source.name, type: source.type } : { name: 'Manual upload', type: 'MANUAL_IMPORT' },
      rows: {
        total: batch.totalRecords,
        processed: batch.processedRecords,
        /** Company rows accepted by the pipeline. */
        accepted: batch.successfulRecords,
        /** Company rows that failed validation or processing. */
        rejected: batch.failedRecords,
        duplicate: batch.duplicateRecords,
        byStatus,
      },
      people: people && {
        received: people.received,
        created: people.created,
        updated: people.updated,
        /** Already known: nothing changed. */
        skipped: people.unchanged,
        accepted: people.accepted,
        quarantined: people.quarantined,
        rejected: people.rejected,
        errors: people.errors,
      },
      outcome: batch.status === 'FAILED' ? 'FAILED' : batch.status !== 'COMPLETED' ? 'IN_PROGRESS' : hasIssues ? 'COMPLETED_WITH_ISSUES' : 'COMPLETED',
      hasIssues,
    };
  }
}

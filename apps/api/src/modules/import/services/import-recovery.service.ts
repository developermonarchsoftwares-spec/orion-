import { HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { BusinessException } from '../../../common/errors/business.exception';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { CsvSecurityUtil } from '../../../common/utils/csv-security.util';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { UPLOAD_LIMITS } from './upload-validation';
import { ImportPipelineService } from './import-pipeline.service';

/** Most failed rows one retry / report touches; keeps a single request bounded. */
export const MAX_RECOVERY_ROWS = 1000;
/** A batch left PROCESSING longer than this (a crashed run) may be claimed again. */
const STALE_PROCESSING_MS = 15 * 60 * 1000;
/** Row states a run passes through before the row is decided; a row still in one of them after the run died was never finished. */
const IN_FLIGHT = ['PENDING', 'NORMALIZED', 'VALIDATED'] as const;

const KEY_OK = /^[A-Za-z0-9_ .-]{1,100}$/;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
/** Aliases the importer adds next to the canonical column; they are left out of the "fix and re-upload" CSV. */
const ALIAS_OF: Record<string, string> = { name: 'business_name', address: 'address_line1', title: 'contact_title' };

export interface IActor {
  userId?: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface IIssue {
  rule: string;
  field: string;
  severity: string;
  message: string;
}

const rowsOf = (res: any): any[] => (Array.isArray(res) ? res : (res?.rows ?? []));

/**
 * Import validation reports and the recovery path for failed rows: a per-batch report, a CSV of the failed rows (with the reason, ready
 * to correct and re-upload), a retry of every failed row, and a correction of a single row. Admin-only (the controller guards).
 * Reports and the failed-rows CSV include cell text (a validation message names the bad value), so they stay with administrators;
 * the existing operations view still shows codes only.
 */
@Injectable()
export class ImportRecoveryService {
  private readonly logger = new Logger(ImportRecoveryService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDb,
    private readonly pipeline: ImportPipelineService,
    @Optional() private readonly audit?: AuditLogService,
  ) {}

  private async batchOrThrow(batchId: string) {
    const [b] = await this.db.select().from(schema.importBatches).where(eq(schema.importBatches.id, batchId)).limit(1);
    if (!b) throw new BusinessException('Import batch not found', 'IMPORT_BATCH_NOT_FOUND', HttpStatus.NOT_FOUND);
    return b;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Validation report
  // ---------------------------------------------------------------------------------------------------------------

  async report(batchId: string) {
    const batch = await this.batchOrThrow(batchId);
    const counts = rowsOf(
      await this.db.execute(sql`SELECT status::text AS status, count(*)::int AS n FROM import_records WHERE batch_id = ${batchId} GROUP BY status ORDER BY status`),
    );
    const byRule = rowsOf(
      await this.db.execute(sql`
        SELECT v.rule_name AS rule, v.field, v.severity::text AS severity, count(*)::int AS n
        FROM validation_logs v JOIN import_records r ON r.id = v.record_id
        WHERE r.batch_id = ${batchId} AND NOT v.passed
        GROUP BY v.rule_name, v.field, v.severity ORDER BY n DESC, v.rule_name, v.field`),
    );
    const records = rowsOf(
      await this.db.execute(sql`
        SELECT r.id, r.row_number, r.status::text AS status,
          COALESCE(r.normalized_payload->>'name', r.raw_payload->>'business_name', r.raw_payload->>'name') AS company
        FROM import_records r
        WHERE r.batch_id = ${batchId}
          AND (r.status = 'FAILED' OR EXISTS (SELECT 1 FROM validation_logs v WHERE v.record_id = r.id AND NOT v.passed))
        ORDER BY r.row_number ASC LIMIT ${MAX_RECOVERY_ROWS + 1}`),
    );
    const truncated = records.length > MAX_RECOVERY_ROWS;
    const shown = records.slice(0, MAX_RECOVERY_ROWS);
    const issues = shown.length
      ? rowsOf(
          await this.db.execute(sql`
            SELECT v.record_id, v.rule_name, v.field, v.severity::text AS severity, v.message
            FROM validation_logs v
            WHERE NOT v.passed AND v.record_id IN (${sql.join(shown.map((r) => sql`${r.id}::uuid`), sql`, `)})
            ORDER BY v.rule_name, v.field`),
        )
      : [];
    const byRecord = new Map<string, IIssue[]>();
    for (const i of issues) {
      const list = byRecord.get(i.record_id) ?? [];
      list.push({ rule: i.rule_name, field: i.field, severity: i.severity, message: i.message });
      byRecord.set(i.record_id, list);
    }
    const statusCounts: Record<string, number> = Object.fromEntries(counts.map((c) => [c.status, c.n]));
    return {
      batch: {
        id: batch.id,
        filename: batch.filename,
        status: batch.status,
        totalRecords: batch.totalRecords,
        successfulRecords: batch.successfulRecords,
        failedRecords: batch.failedRecords,
        duplicateRecords: batch.duplicateRecords,
        createdAt: batch.createdAt,
        completedAt: batch.completedAt,
      },
      recordStatus: statusCounts,
      recoverable: statusCounts.FAILED ?? 0,
      byRule: byRule.map((r) => ({ rule: r.rule, field: r.field, severity: r.severity, count: r.n })),
      rows: shown.map((r) => ({ recordId: r.id, rowNumber: r.row_number, status: r.status, company: r.company ?? null, issues: byRecord.get(r.id) ?? [] })),
      truncated,
    };
  }

  async reportCsv(batchId: string, actor: IActor) {
    const rep = await this.report(batchId);
    const headers = ['Row', 'Status', 'Company', 'Rule', 'Field', 'Severity', 'Message'];
    const lines = [CsvSecurityUtil.formatCsvRow(headers)];
    for (const r of rep.rows) {
      if (!r.issues.length) lines.push(CsvSecurityUtil.formatCsvRow([r.rowNumber, r.status, r.company ?? '', '', '', '', '']));
      for (const i of r.issues) lines.push(CsvSecurityUtil.formatCsvRow([r.rowNumber, r.status, r.company ?? '', i.rule, i.field, i.severity, i.message]));
    }
    await this.auditExport(actor, 'import-validation-report', batchId, rep.rows.length);
    return { csv: `﻿${lines.join('\n')}\n`, filename: `import-report-${batchId.slice(0, 8)}.csv`, rowCount: rep.rows.length };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Failed rows: download, retry, correct
  // ---------------------------------------------------------------------------------------------------------------

  /** The failed rows exactly as stored, plus `_row_number` and `_errors`, so they can be corrected and uploaded again. */
  async failedRowsCsv(batchId: string, actor: IActor) {
    await this.batchOrThrow(batchId);
    const failed = await this.db
      .select()
      .from(schema.importRecords)
      .where(and(eq(schema.importRecords.batchId, batchId), eq(schema.importRecords.status, 'FAILED')))
      .orderBy(asc(schema.importRecords.rowNumber))
      .limit(MAX_RECOVERY_ROWS);
    const logs = failed.length
      ? await this.db
          .select()
          .from(schema.validationLogs)
          .where(and(inArray(schema.validationLogs.recordId, failed.map((f) => f.id)), eq(schema.validationLogs.passed, false)))
      : [];
    const columns: string[] = [];
    const clean = (raw: Record<string, unknown>) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (/[A-Z]/.test(k) || (ALIAS_OF[k] && ALIAS_OF[k] in raw)) continue; // camelCase / alias duplicates
        out[k] = v === null || v === undefined ? '' : String(v);
        if (!columns.includes(k)) columns.push(k);
      }
      return out;
    };
    const rows = failed.map((f) => ({ f, data: clean(f.rawPayload as Record<string, unknown>) }));
    const headers = [...columns, '_row_number', '_errors'];
    const lines = [CsvSecurityUtil.formatCsvRow(headers)];
    for (const { f, data } of rows) {
      const errs = logs.filter((l) => l.recordId === f.id).map((l) => `${l.field}: ${l.message}`).join(' | ');
      lines.push(CsvSecurityUtil.formatCsvRow([...columns.map((c) => data[c] ?? ''), f.rowNumber, errs]));
    }
    await this.auditExport(actor, 'import-failed-rows', batchId, rows.length);
    return { csv: `﻿${lines.join('\n')}\n`, filename: `import-failed-rows-${batchId.slice(0, 8)}.csv`, rowCount: rows.length };
  }

  /** Brings the batch counters in line with its records' actual statuses. */
  private async recount(batchId: string) {
    const c = rowsOf(await this.db.execute(sql`SELECT status::text AS status, count(*)::int AS n FROM import_records WHERE batch_id = ${batchId} GROUP BY status`));
    const n = (s: string) => c.find((x) => x.status === s)?.n ?? 0;
    const total = c.reduce((a, x) => a + x.n, 0);
    const published = n('PUBLISHED');
    const duplicates = n('FLAGGED_DUPLICATE');
    const failed = n('FAILED');
    await this.db
      .update(schema.importBatches)
      .set({
        processedRecords: total,
        successfulRecords: published,
        failedRecords: failed,
        duplicateRecords: duplicates,
        status: failed === total && total > 0 ? 'FAILED' : 'COMPLETED',
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.importBatches.id, batchId));
    return { total, published, duplicates, failed };
  }

  /** Runs one record through the pipeline again, clearing its earlier validation results first so they are not counted twice. */
  private async rerun(recordId: string) {
    await this.db.delete(schema.validationLogs).where(eq(schema.validationLogs.recordId, recordId));
    try {
      return await this.pipeline.processRecord(recordId);
    } catch (err) {
      this.logger.warn(`Retry of record ${recordId} failed: ${(err as Error).message}`);
      await this.db.update(schema.importRecords).set({ status: 'FAILED', errorDetails: { retryError: ((err as Error).message || 'error').slice(0, 200) }, updatedAt: new Date() }).where(eq(schema.importRecords.id, recordId));
      return { status: 'FAILED', reason: 'Processing error' } as { status: string; reason?: string };
    }
  }

  /**
   * Re-runs every FAILED row of the batch (up to 1000). Rows that now pass are published; the rest stay FAILED with fresh reasons.
   *
   * A batch that is still PROCESSING but has not been touched for STALE_PROCESSING_MS is a run that died (the API process was killed
   * or restarted while it worked: processing happens inside the upload request). Its rows that were never reached are PENDING and
   * nothing else would ever run them, so for such a batch they are run too. Measured in Phase 29: a process killed 3.5 s into a
   * 5,000-row upload left 4,561 rows PENDING and the batch PROCESSING for good. A batch that finished normally never has its PENDING
   * rows touched.
   */
  async retryFailed(batchId: string, actor: IActor) {
    const batch = await this.batchOrThrow(batchId);
    const stale = new Date(Date.now() - STALE_PROCESSING_MS);
    const crashed = batch.status === 'PROCESSING' && new Date(batch.updatedAt as any).getTime() < stale.getTime();
    // claim the batch so two retries cannot run at once; a run that crashed long ago may be claimed again
    const claimed = await this.db
      .update(schema.importBatches)
      .set({ status: 'PROCESSING', updatedAt: new Date() })
      .where(and(eq(schema.importBatches.id, batchId), sql`(${schema.importBatches.status} <> 'PROCESSING' OR ${schema.importBatches.updatedAt} < ${stale.toISOString()})`))
      .returning({ id: schema.importBatches.id });
    if (!claimed.length) throw new BusinessException('This batch is being processed right now. Try again shortly.', 'IMPORT_BATCH_BUSY', HttpStatus.CONFLICT);

    try {
      const pick = (statuses: Array<'FAILED' | (typeof IN_FLIGHT)[number]>) =>
        this.db
          .select({ id: schema.importRecords.id })
          .from(schema.importRecords)
          .where(and(eq(schema.importRecords.batchId, batchId), inArray(schema.importRecords.status, statuses)))
          .orderBy(asc(schema.importRecords.rowNumber))
          .limit(MAX_RECOVERY_ROWS);
      // after a crash the rows that were never reached come first; the failed ones are retried once nothing is left unreached
      let failed = crashed ? await pick([...IN_FLIGHT]) : [];
      if (failed.length === 0) failed = await pick(['FAILED']);
      const outcome: Record<string, number> = {};
      for (const r of failed) {
        const res = await this.rerun(r.id);
        outcome[res.status] = (outcome[res.status] ?? 0) + 1;
      }
      const totals = await this.recount(batchId);
      // a dead run with more unreached rows than one call may run: keep the batch resumable (PROCESSING, with the time it was last
      // really active) instead of marking it COMPLETED while thousands of rows were never reached
      let unreached = 0;
      if (crashed) {
        unreached = rowsOf(await this.db.execute(sql`SELECT count(*)::int AS n FROM import_records WHERE batch_id = ${batchId} AND status::text IN ('PENDING', 'NORMALIZED', 'VALIDATED')`))[0]?.n ?? 0;
        if (unreached > 0) {
          await this.db.update(schema.importBatches).set({ status: 'PROCESSING', completedAt: null, updatedAt: batch.updatedAt as Date }).where(eq(schema.importBatches.id, batchId));
        }
      }
      await this.audit?.record({ userId: actor.userId, action: 'IMPORT_FAILED_ROWS_RETRIED', entityType: 'IMPORT_BATCH', entityId: batchId, newValues: { attempted: failed.length, outcome, stillFailed: totals.failed }, ipAddress: actor.ip, userAgent: actor.userAgent });
      return { batchId, filename: batch.filename, attempted: failed.length, outcome, recovered: outcome.PUBLISHED ?? 0, stillFailed: totals.failed, batch: totals, moreRemaining: unreached > 0 || (totals.failed > 0 && failed.length === MAX_RECOVERY_ROWS) };
    } catch (err) {
      await this.recount(batchId); // never leave the batch stuck in PROCESSING
      throw err;
    }
  }

  /** Corrects fields of ONE failed row (an empty value removes the field) and re-runs it. */
  async correctRecord(recordId: string, fields: Record<string, unknown>, actor: IActor) {
    if (!/^[0-9a-f-]{36}$/i.test(recordId)) throw new BusinessException('Record not found', 'IMPORT_RECORD_NOT_FOUND', HttpStatus.NOT_FOUND);
    const [rec] = await this.db.select().from(schema.importRecords).where(eq(schema.importRecords.id, recordId)).limit(1);
    if (!rec) throw new BusinessException('Record not found', 'IMPORT_RECORD_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (rec.status !== 'FAILED') throw new BusinessException('Only failed rows can be corrected', 'RECORD_NOT_FAILED', HttpStatus.CONFLICT);
    const keys = Object.keys(fields ?? {});
    if (!keys.length || keys.length > 50) throw new BusinessException('Provide between 1 and 50 fields to correct', 'INVALID_CORRECTION', HttpStatus.BAD_REQUEST);

    const next: Record<string, unknown> = { ...(rec.rawPayload as Record<string, unknown>) };
    for (const k of keys) {
      const v = fields[k];
      if (!KEY_OK.test(k) || UNSAFE_KEYS.has(k.trim().toLowerCase()) || (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean' && v !== null)) {
        throw new BusinessException('A field name or value is not allowed', 'INVALID_CORRECTION', HttpStatus.BAD_REQUEST);
      }
      const text = v === null ? '' : String(v).trim();
      if (text.length > UPLOAD_LIMITS.MAX_CELL_LENGTH) throw new BusinessException('A value is too long', 'INVALID_CORRECTION', HttpStatus.BAD_REQUEST);
      if (text === '') delete next[k];
      else next[k] = text;
    }
    await this.db.update(schema.importRecords).set({ rawPayload: next, updatedAt: new Date() }).where(eq(schema.importRecords.id, recordId));

    const res = await this.rerun(recordId);
    const totals = await this.recount(rec.batchId);
    // field NAMES only: the values are customer-provided data and stay out of the audit log
    await this.audit?.record({ userId: actor.userId, action: 'IMPORT_RECORD_CORRECTED', entityType: 'IMPORT_RECORD', entityId: recordId, newValues: { batchId: rec.batchId, rowNumber: rec.rowNumber, fields: keys, resultStatus: res.status }, ipAddress: actor.ip, userAgent: actor.userAgent });
    return { recordId, rowNumber: rec.rowNumber, status: res.status, reason: (res as any).reason ?? null, batch: totals };
  }

  private async auditExport(actor: IActor, dataset: string, batchId: string, rowCount: number) {
    await this.audit?.record({ userId: actor.userId, action: 'EXPORT_CREATED', entityType: 'EXPORT', entityId: batchId, newValues: { dataset, format: 'csv', source: 'ON_DEMAND', rowCount, batchId }, ipAddress: actor.ip, userAgent: actor.userAgent });
  }
}

import { HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { and, desc, eq, gte, inArray, like, lte, sql } from 'drizzle-orm';
import { presentCompanyContact } from '../../common/privacy/data-classification';
import { boundedPage } from '../../common/utils/pagination.util';
import { BusinessException } from '../../common/errors/business.exception';
import { CsvSecurityUtil } from '../../common/utils/csv-security.util';
import { buildXlsx } from '../../common/utils/xlsx-writer.util';
import { AuditLogService } from '../../common/services/audit-log.service';
import { MailService } from '../../auth/mail/mail.service';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';
import { PeopleExportService } from '../people/people-export.service';
import { IntegrationEventsService } from '../integrations/integration-events.service';

export const EXPORT_FORMATS = ['csv', 'xlsx'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const EXPORT_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;
export type ExportFrequency = (typeof EXPORT_FREQUENCIES)[number];

/** Most rows one export holds. Larger result sets are cut and flagged `truncated`. */
export const MAX_EXPORT_ROWS = 5000;
/** Most rows one account can take out by on-demand exports in any rolling 24 hours (many small exports add up to the same limit). */
export const MAX_EXPORT_ROWS_PER_DAY = 20_000;
/** Most on-demand exports one account may have running at the same time in this process. */
export const MAX_CONCURRENT_EXPORTS = 1;
/** How long the file of a scheduled export stays downloadable. */
export const EXPORT_RETENTION_DAYS = 7;
export const MAX_SCHEDULES_PER_USER = 10;
/** A schedule that fails this many runs in a row is switched off. */
export const MAX_CONSECUTIVE_FAILURES = 3;

export interface IExportTable {
  headers: string[];
  rows: unknown[][];
  truncated: boolean;
  /** Column indexes holding phone numbers (kept intact in CSV when they are plain numbers). */
  phoneColumns?: number[];
}

interface IDatasetDef {
  label: string;
  description: string;
  build(userId: string): Promise<IExportTable>;
}

export const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export interface IRequestContext {
  ip?: string | null;
  userAgent?: string | null;
  /** Correlation id of the request (x-request-id), recorded in the audit entry. */
  requestId?: string | null;
}

/** First run: the next occurrence of `hourUtc`, strictly after `from`. */
export function firstRunAt(hourUtc: number, from = new Date()): Date {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), hourUtc, 0, 0, 0));
  if (d.getTime() <= from.getTime()) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/**
 * The run after `planned`, stepping from the PLANNED time (not the actual run time, so schedules do not drift) and skipping any
 * missed runs: the result is always after `now`. Monthly keeps the day of month, clamped to the 28th so every month has it.
 */
export function advanceRun(planned: Date, frequency: string, now = new Date()): Date {
  const next = new Date(planned.getTime());
  const step = () => {
    if (frequency === 'WEEKLY') next.setUTCDate(next.getUTCDate() + 7);
    else if (frequency === 'MONTHLY') {
      next.setUTCDate(Math.min(next.getUTCDate(), 28));
      next.setUTCMonth(next.getUTCMonth() + 1);
    } else next.setUTCDate(next.getUTCDate() + 1);
  };
  do step();
  while (next.getTime() <= now.getTime());
  return next;
}

const dateStamp = () => new Date().toISOString().slice(0, 10);

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);
  /** Users with an on-demand export running in this process (per-process; a multi-instance deployment needs shared state, see P9-07). */
  private readonly running = new Set<string>();

  private readonly datasets: Record<string, IDatasetDef> = {
    'unlocked-leads': {
      label: 'Unlocked leads',
      description: 'Companies you have unlocked, with their contacts',
      build: (userId) => this.unlockedLeads(userId),
    },
    'unlocked-people': {
      label: 'Unlocked people',
      description: 'Decision makers you have unlocked, with verified contact details',
      build: async (userId) => {
        const t = await this.peopleExport.exportUnlockedPeopleTable(userId);
        return { headers: t.headers, rows: t.rows, truncated: t.truncated, phoneColumns: t.phoneColumns };
      },
    },
    'saved-leads': {
      label: 'Saved leads',
      description: 'Your saved companies with pipeline stage, tags and notes (no contact details)',
      build: (userId) => this.savedLeads(userId),
    },
  };

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDb,
    private readonly peopleExport: PeopleExportService,
    @Optional() private readonly audit?: AuditLogService,
    @Optional() private readonly mail?: MailService,
    @Optional() private readonly events?: IntegrationEventsService,
  ) {}

  listDatasets() {
    return Object.entries(this.datasets).map(([id, d]) => ({ id, label: d.label, description: d.description, formats: [...EXPORT_FORMATS], maxRows: MAX_EXPORT_ROWS }));
  }

  assertDataset(dataset: string) {
    if (!this.datasets[dataset]) {
      throw new BusinessException('Unknown export dataset', 'UNKNOWN_DATASET', HttpStatus.BAD_REQUEST, { datasets: Object.keys(this.datasets) });
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Datasets. Every one is derived from the caller's own data; contact details only for what they have unlocked.
  // ---------------------------------------------------------------------------------------------------------------

  private async unlockedLeads(userId: string): Promise<IExportTable> {
    const unlocks = await this.db
      .select({ businessId: schema.leadUnlocks.businessId, unlockedAt: schema.leadUnlocks.unlockedAt })
      .from(schema.leadUnlocks)
      .where(eq(schema.leadUnlocks.userId, userId))
      .orderBy(desc(schema.leadUnlocks.unlockedAt))
      .limit(MAX_EXPORT_ROWS + 1);
    const ids = unlocks.map((u) => u.businessId);
    // only published companies: an unpublished (withdrawn, draft, rejected) company and its contacts are not exported, even if once unlocked
    const businesses = ids.length ? await this.db.select().from(schema.businesses).where(and(inArray(schema.businesses.id, ids), eq(schema.businesses.status, 'PUBLISHED'))) : [];
    const publishedIds = businesses.map((b) => b.id);
    const contacts = publishedIds.length ? await this.db.select().from(schema.businessContacts).where(inArray(schema.businessContacts.businessId, publishedIds)) : [];
    const byBusiness = new Map(businesses.map((b) => [b.id, b]));

    const headers = ['Company', 'Legal Name', 'Employees', 'Revenue', 'Founded', 'Verified', 'Unlocked On', 'Contact', 'Title', 'Department', 'Email', 'Phone', 'LinkedIn'];
    const rows: unknown[][] = [];
    for (const u of unlocks) {
      const b = byBusiness.get(u.businessId);
      if (!b) continue;
      const base = [b.name, b.legalName ?? '', b.employeeCountRange ?? '', b.annualRevenueRange ?? '', b.foundingYear ?? '', b.isVerified ? 'Yes' : 'No', u.unlockedAt.toISOString().slice(0, 10)];
      const own = contacts.filter((c) => c.businessId === u.businessId);
      if (!own.length) rows.push([...base, '', '', '', '', '', '']);
      for (const c of own) {
        // same disclosure policy as the screens (Phase 10): an export can never show more than the unlocked company page
        const p = presentCompanyContact(c, { unlocked: true });
        rows.push([...base, c.fullName, c.title ?? '', c.department ?? '', p.email ?? '', p.phone ?? '', c.linkedinUrl ?? '']);
      }
    }
    return { headers, rows: rows.slice(0, MAX_EXPORT_ROWS), truncated: rows.length > MAX_EXPORT_ROWS, phoneColumns: [11] };
  }

  private async savedLeads(userId: string): Promise<IExportTable> {
    const saved = await this.db
      .select({ lead: schema.savedLeads, name: schema.businesses.name, unlockedAt: schema.leadUnlocks.unlockedAt })
      .from(schema.savedLeads)
      .innerJoin(schema.businesses, and(eq(schema.businesses.id, schema.savedLeads.businessId), eq(schema.businesses.status, 'PUBLISHED')))
      .leftJoin(schema.leadUnlocks, and(eq(schema.leadUnlocks.businessId, schema.savedLeads.businessId), eq(schema.leadUnlocks.userId, userId)))
      .where(eq(schema.savedLeads.userId, userId))
      .orderBy(desc(schema.savedLeads.createdAt))
      .limit(MAX_EXPORT_ROWS + 1);
    const headers = ['Company', 'Lead Type', 'Pipeline Stage', 'Tags', 'Notes', 'Saved On', 'Unlocked'];
    const rows = saved.map((s) => [s.name, s.lead.personId ? 'Person' : 'Company', s.lead.pipelineStage, ((s.lead.tags as string[]) ?? []).join('; '), s.lead.notes ?? '', s.lead.createdAt.toISOString().slice(0, 10), s.unlockedAt ? 'Yes' : 'No']);
    return { headers, rows: rows.slice(0, MAX_EXPORT_ROWS), truncated: rows.length > MAX_EXPORT_ROWS };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------------------------------------------

  render(table: IExportTable, format: ExportFormat, sheetName: string): Buffer {
    if (format === 'xlsx') return buildXlsx(table.headers, table.rows, sheetName);
    // BOM so Excel opens UTF-8 correctly; every cell goes through the formula-injection guard.
    const lines = [CsvSecurityUtil.formatCsvRow(table.headers), ...table.rows.map((r) => CsvSecurityUtil.formatCsvRow(r, table.phoneColumns))];
    return Buffer.from(`﻿${lines.join('\n')}\n`, 'utf8');
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Creating an export (on demand or scheduled) with its history row and audit entry
  // ---------------------------------------------------------------------------------------------------------------

  async createExport(
    userId: string,
    dataset: string,
    format: ExportFormat,
    opts: { source: 'ON_DEMAND' | 'SCHEDULED'; scheduleId?: string | null; ctx?: IRequestContext },
  ) {
    this.assertDataset(dataset);
    const onDemand = opts.source === 'ON_DEMAND';
    if (onDemand) {
      // claimed before any await, so two simultaneous requests cannot both pass the check
      if (this.running.has(userId)) await this.refuse(userId, dataset, format, opts, 'EXPORT_IN_PROGRESS', 'An export is already running for your account', HttpStatus.TOO_MANY_REQUESTS);
      this.running.add(userId);
    }
    try {
      if (onDemand) await this.assertDailyAllowance(userId, dataset, format, opts);
      return await this.runExport(userId, dataset, format, opts);
    } finally {
      if (onDemand) this.running.delete(userId);
    }
  }

  /** Rows this account already took out by on-demand exports in the last 24 hours. */
  private async rowsExportedToday(userId: string): Promise<number> {
    const [r] = await this.db
      .select({ n: sql<number>`coalesce(sum(${schema.exportJobs.rowCount}), 0)::int` })
      .from(schema.exportJobs)
      .where(and(eq(schema.exportJobs.userId, userId), eq(schema.exportJobs.source, 'ON_DEMAND'), eq(schema.exportJobs.status, 'COMPLETED'), gte(schema.exportJobs.createdAt, new Date(Date.now() - 86_400_000))));
    return Number(r?.n ?? 0);
  }

  private async assertDailyAllowance(userId: string, dataset: string, format: ExportFormat, opts: { source: string; ctx?: IRequestContext }) {
    const used = await this.rowsExportedToday(userId);
    if (used >= MAX_EXPORT_ROWS_PER_DAY) {
      await this.refuse(userId, dataset, format, opts, 'EXPORT_DAILY_LIMIT', 'Daily export limit reached; try again later', HttpStatus.TOO_MANY_REQUESTS, { rowsExportedLast24h: used, limit: MAX_EXPORT_ROWS_PER_DAY });
    }
  }

  private async refuse(userId: string, dataset: string, format: ExportFormat, opts: { source: string; ctx?: IRequestContext }, code: string, message: string, status: HttpStatus, extra: Record<string, unknown> = {}): Promise<never> {
    await this.audit?.record({
      userId,
      action: 'EXPORT_REFUSED',
      entityType: 'EXPORT',
      newValues: { dataset, format, source: opts.source, outcome: 'REFUSED', reason: code, requestId: opts.ctx?.requestId ?? null, ...extra },
      ipAddress: opts.ctx?.ip,
      userAgent: opts.ctx?.userAgent,
    });
    throw new BusinessException(message, code, status);
  }

  private async runExport(
    userId: string,
    dataset: string,
    format: ExportFormat,
    opts: { source: 'ON_DEMAND' | 'SCHEDULED'; scheduleId?: string | null; ctx?: IRequestContext },
  ) {
    const def = this.datasets[dataset];
    const fileName = `orion-${dataset}-${dateStamp()}.${format}`;
    let table: IExportTable;
    let buffer: Buffer;
    try {
      table = await def.build(userId);
      buffer = this.render(table, format, def.label);
    } catch (err) {
      const message = ((err as Error)?.message || 'Export failed').slice(0, 200);
      const [failed] = await this.db
        .insert(schema.exportJobs)
        .values({ userId, scheduleId: opts.scheduleId ?? null, dataset, format, source: opts.source, status: 'FAILED', error: message })
        .returning();
      await this.audit?.record({ userId, action: 'EXPORT_FAILED', entityType: 'EXPORT', entityId: failed.id, newValues: { dataset, format, source: opts.source, scheduleId: opts.scheduleId ?? null, outcome: 'FAILED', requestId: opts.ctx?.requestId ?? null }, ipAddress: opts.ctx?.ip, userAgent: opts.ctx?.userAgent });
      throw err;
    }

    const scheduled = opts.source === 'SCHEDULED';
    const [job] = await this.db
      .insert(schema.exportJobs)
      .values({
        userId,
        scheduleId: opts.scheduleId ?? null,
        dataset,
        format,
        source: opts.source,
        status: 'COMPLETED',
        rowCount: table.rows.length,
        truncated: table.truncated,
        fileName,
        contentType: CONTENT_TYPES[format],
        sizeBytes: buffer.length,
        // only scheduled exports are kept (so they can be fetched later); an on-demand export is delivered once, in the response
        content: scheduled ? buffer : null,
        expiresAt: scheduled ? new Date(Date.now() + EXPORT_RETENTION_DAYS * 86_400_000) : null,
      })
      .returning();
    await this.audit?.record({
      userId,
      action: 'EXPORT_CREATED',
      entityType: 'EXPORT',
      entityId: job.id,
      newValues: {
        dataset,
        format,
        source: opts.source,
        outcome: 'COMPLETED',
        // requested = what the account's data held (capped at one more than the limit), delivered = what the file contains
        requestedRows: table.truncated ? MAX_EXPORT_ROWS + 1 : table.rows.length,
        rowCount: table.rows.length,
        truncated: table.truncated,
        policy: { maxRowsPerExport: MAX_EXPORT_ROWS, maxRowsPerDay: MAX_EXPORT_ROWS_PER_DAY, publishedOnly: true },
        sizeBytes: buffer.length,
        scheduleId: opts.scheduleId ?? null,
        requestId: opts.ctx?.requestId ?? null,
      },
      ipAddress: opts.ctx?.ip,
      userAgent: opts.ctx?.userAgent,
    });
    await this.events?.emit(userId, 'export.completed', { exportId: job.id, dataset, format, rowCount: table.rows.length, truncated: table.truncated, source: opts.source });
    return { job: this.view(job), file: { buffer, fileName, contentType: CONTENT_TYPES[format] }, truncated: table.truncated, rowCount: table.rows.length };
  }

  private view(j: typeof schema.exportJobs.$inferSelect) {
    return {
      id: j.id,
      dataset: j.dataset,
      format: j.format,
      source: j.source,
      status: j.status,
      rowCount: j.rowCount,
      truncated: j.truncated,
      fileName: j.fileName,
      sizeBytes: j.sizeBytes,
      error: j.error,
      downloadable: j.status === 'COMPLETED' && j.expiresAt !== null && j.expiresAt > new Date(),
      downloadCount: j.downloadCount,
      scheduleId: j.scheduleId,
      createdAt: j.createdAt,
      expiresAt: j.expiresAt,
    };
  }

  async listJobs(userId: string, limit = 50) {
    const rows = await this.db.select().from(schema.exportJobs).where(eq(schema.exportJobs.userId, userId)).orderBy(desc(schema.exportJobs.createdAt)).limit(boundedPage(1, limit, { defaultLimit: 50, maxLimit: 200 }).limit);
    return rows.map((r) => this.view(r));
  }

  /** Fetches a stored (scheduled) export. Owner only; a missing or foreign id is a 404, an expired file a 410. */
  async download(userId: string, jobId: string, ctx?: IRequestContext) {
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) throw new BusinessException('Export not found', 'EXPORT_NOT_FOUND', HttpStatus.NOT_FOUND);
    const [job] = await this.db.select().from(schema.exportJobs).where(and(eq(schema.exportJobs.id, jobId), eq(schema.exportJobs.userId, userId))).limit(1);
    if (!job) throw new BusinessException('Export not found', 'EXPORT_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (job.status !== 'COMPLETED' || !job.content || (job.expiresAt && job.expiresAt <= new Date())) {
      throw new BusinessException('This export is no longer available. Run it again.', 'EXPORT_EXPIRED', HttpStatus.GONE);
    }
    await this.db.update(schema.exportJobs).set({ downloadCount: sql`${schema.exportJobs.downloadCount} + 1` }).where(eq(schema.exportJobs.id, job.id));
    await this.audit?.record({ userId, action: 'EXPORT_DOWNLOADED', entityType: 'EXPORT', entityId: job.id, newValues: { dataset: job.dataset, format: job.format, rowCount: job.rowCount }, ipAddress: ctx?.ip, userAgent: ctx?.userAgent });
    return { buffer: job.content, fileName: job.fileName ?? `export.${job.format}`, contentType: job.contentType ?? CONTENT_TYPES[job.format as ExportFormat] };
  }

  /** Removes the stored files of exports past retention. The history row (and its audit entry) stays, marked EXPIRED. */
  async purgeExpired(): Promise<number> {
    const rows = await this.db
      .update(schema.exportJobs)
      .set({ content: null, status: 'EXPIRED' })
      .where(and(eq(schema.exportJobs.status, 'COMPLETED'), lte(schema.exportJobs.expiresAt, new Date())))
      .returning({ id: schema.exportJobs.id });
    return rows.length;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Schedules
  // ---------------------------------------------------------------------------------------------------------------

  async createSchedule(userId: string, dto: { dataset: string; format: ExportFormat; frequency: ExportFrequency; hourUtc?: number }, ctx?: IRequestContext) {
    this.assertDataset(dto.dataset);
    const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(schema.exportSchedules).where(eq(schema.exportSchedules.userId, userId));
    if (Number(n) >= MAX_SCHEDULES_PER_USER) {
      throw new BusinessException(`You can have at most ${MAX_SCHEDULES_PER_USER} scheduled exports`, 'SCHEDULE_LIMIT', HttpStatus.CONFLICT);
    }
    const hourUtc = dto.hourUtc ?? 6;
    const [row] = await this.db
      .insert(schema.exportSchedules)
      .values({ userId, dataset: dto.dataset, format: dto.format, frequency: dto.frequency, hourUtc, nextRunAt: firstRunAt(hourUtc) })
      .returning();
    await this.audit?.record({ userId, action: 'EXPORT_SCHEDULE_CREATED', entityType: 'EXPORT_SCHEDULE', entityId: row.id, newValues: { dataset: row.dataset, format: row.format, frequency: row.frequency, hourUtc }, ipAddress: ctx?.ip, userAgent: ctx?.userAgent });
    return row;
  }

  listSchedules(userId: string) {
    return this.db.select().from(schema.exportSchedules).where(eq(schema.exportSchedules.userId, userId)).orderBy(desc(schema.exportSchedules.createdAt));
  }

  private async ownSchedule(userId: string, id: string) {
    const [row] = /^[0-9a-f-]{36}$/i.test(id) ? await this.db.select().from(schema.exportSchedules).where(and(eq(schema.exportSchedules.id, id), eq(schema.exportSchedules.userId, userId))).limit(1) : [];
    if (!row) throw new BusinessException('Schedule not found', 'SCHEDULE_NOT_FOUND', HttpStatus.NOT_FOUND);
    return row;
  }

  async updateSchedule(userId: string, id: string, dto: { enabled?: boolean; format?: ExportFormat; frequency?: ExportFrequency; hourUtc?: number }, ctx?: IRequestContext) {
    const cur = await this.ownSchedule(userId, id);
    const patch: Partial<typeof schema.exportSchedules.$inferInsert> = { updatedAt: new Date() };
    if (dto.format) patch.format = dto.format;
    if (dto.frequency) patch.frequency = dto.frequency;
    if (dto.hourUtc !== undefined) patch.hourUtc = dto.hourUtc;
    if (dto.enabled !== undefined) patch.enabled = dto.enabled;
    const reschedule = dto.frequency !== undefined || dto.hourUtc !== undefined || (dto.enabled === true && !cur.enabled);
    if (reschedule) patch.nextRunAt = firstRunAt(dto.hourUtc ?? cur.hourUtc);
    if (dto.enabled === true) patch.consecutiveFailures = 0; // switching it back on is a fresh start
    const [row] = await this.db.update(schema.exportSchedules).set(patch).where(eq(schema.exportSchedules.id, id)).returning();
    await this.audit?.record({ userId, action: 'EXPORT_SCHEDULE_UPDATED', entityType: 'EXPORT_SCHEDULE', entityId: id, oldValues: { enabled: cur.enabled, format: cur.format, frequency: cur.frequency, hourUtc: cur.hourUtc }, newValues: { enabled: row.enabled, format: row.format, frequency: row.frequency, hourUtc: row.hourUtc }, ipAddress: ctx?.ip, userAgent: ctx?.userAgent });
    return row;
  }

  async deleteSchedule(userId: string, id: string, ctx?: IRequestContext) {
    const cur = await this.ownSchedule(userId, id);
    await this.db.delete(schema.exportSchedules).where(eq(schema.exportSchedules.id, id));
    await this.audit?.record({ userId, action: 'EXPORT_SCHEDULE_DELETED', entityType: 'EXPORT_SCHEDULE', entityId: id, oldValues: { dataset: cur.dataset, format: cur.format, frequency: cur.frequency }, ipAddress: ctx?.ip, userAgent: ctx?.userAgent });
    return { success: true };
  }

  /**
   * Runs every schedule that is due. Each one is CLAIMED by moving its next_run_at (compare-and-set), so with several API
   * instances exactly one of them runs a given schedule. A failed run is recorded; three failures in a row switch the schedule
   * off and tell the owner.
   */
  async runDueSchedules(now = new Date()): Promise<{ ran: number; failed: number }> {
    const due = await this.db
      .select()
      .from(schema.exportSchedules)
      .where(and(eq(schema.exportSchedules.enabled, true), lte(schema.exportSchedules.nextRunAt, now)))
      .orderBy(schema.exportSchedules.nextRunAt)
      .limit(25);
    let ran = 0;
    let failed = 0;
    for (const s of due) {
      const claimed = await this.db
        .update(schema.exportSchedules)
        .set({ nextRunAt: advanceRun(s.nextRunAt, s.frequency, now) })
        .where(and(eq(schema.exportSchedules.id, s.id), eq(schema.exportSchedules.nextRunAt, s.nextRunAt), eq(schema.exportSchedules.enabled, true)))
        .returning({ id: schema.exportSchedules.id });
      if (!claimed.length) continue;

      const [user] = await this.db.select().from(schema.users).where(eq(schema.users.id, s.userId)).limit(1);
      if (!user || user.status !== 'ACTIVE') {
        await this.db.update(schema.exportSchedules).set({ enabled: false, lastStatus: 'FAILED', updatedAt: new Date() }).where(eq(schema.exportSchedules.id, s.id));
        continue;
      }
      try {
        const res = await this.createExport(s.userId, s.dataset, s.format as ExportFormat, { source: 'SCHEDULED', scheduleId: s.id });
        await this.db.update(schema.exportSchedules).set({ lastRunAt: new Date(), lastStatus: 'COMPLETED', consecutiveFailures: 0, updatedAt: new Date() }).where(eq(schema.exportSchedules.id, s.id));
        ran++;
        void this.mail?.send({
          to: user.email,
          subject: 'Your scheduled export is ready',
          text: `Your ${s.frequency.toLowerCase()} export "${s.dataset}" is ready: ${res.rowCount} row(s)${res.truncated ? ` (cut at ${MAX_EXPORT_ROWS})` : ''}. Download it from your Exports page within ${EXPORT_RETENTION_DAYS} days: ${this.mail.webUrl()}/exports`,
        });
      } catch (err) {
        failed++;
        const failures = s.consecutiveFailures + 1;
        const disable = failures >= MAX_CONSECUTIVE_FAILURES;
        await this.db.update(schema.exportSchedules).set({ lastRunAt: new Date(), lastStatus: 'FAILED', consecutiveFailures: failures, enabled: !disable, updatedAt: new Date() }).where(eq(schema.exportSchedules.id, s.id));
        this.logger.warn(`Scheduled export ${s.id} failed (${failures}/${MAX_CONSECUTIVE_FAILURES}): ${(err as Error).message}`);
        if (disable) {
          await this.audit?.record({ userId: s.userId, action: 'EXPORT_SCHEDULE_DISABLED', entityType: 'EXPORT_SCHEDULE', entityId: s.id, newValues: { reason: 'consecutive failures', failures } });
          void this.mail?.send({ to: user.email, subject: 'A scheduled export was switched off', text: `Your scheduled export "${s.dataset}" failed ${failures} times in a row and was switched off. You can turn it back on from your Exports page.` });
        }
      }
    }
    return { ran, failed };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Audit trail (administrators)
  // ---------------------------------------------------------------------------------------------------------------

  async auditTrail(q: { userId?: string; action?: string; from?: string; to?: string; limit?: number; offset?: number }) {
    const conds = [like(schema.auditLogs.action, 'EXPORT\\_%')];
    if (q.userId) conds.push(eq(schema.auditLogs.userId, q.userId));
    if (q.action) conds.push(eq(schema.auditLogs.action, q.action));
    if (q.from) conds.push(gte(schema.auditLogs.createdAt, new Date(q.from)));
    if (q.to) conds.push(lte(schema.auditLogs.createdAt, new Date(q.to)));
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
    const offset = Math.max(Number(q.offset) || 0, 0);
    const where = and(...conds);
    const [items, [{ n }]] = await Promise.all([
      this.db
        .select({
          id: schema.auditLogs.id,
          userId: schema.auditLogs.userId,
          userEmail: schema.users.email,
          action: schema.auditLogs.action,
          entityType: schema.auditLogs.entityType,
          entityId: schema.auditLogs.entityId,
          details: schema.auditLogs.newValues,
          previous: schema.auditLogs.oldValues,
          ipAddress: schema.auditLogs.ipAddress,
          createdAt: schema.auditLogs.createdAt,
        })
        .from(schema.auditLogs)
        .leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.userId))
        .where(where)
        .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
        .limit(limit)
        .offset(offset),
      this.db.select({ n: sql<number>`count(*)::int` }).from(schema.auditLogs).where(where),
    ]);
    return { total: Number(n), limit, offset, items };
  }
}

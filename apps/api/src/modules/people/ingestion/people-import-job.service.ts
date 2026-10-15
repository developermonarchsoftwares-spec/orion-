import { HttpStatus, Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { BusinessException } from '../../../common/errors/business.exception';
import type { Pool } from 'pg';
import { DRIZZLE_DATABASE, PG_POOL } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import { queueJobs } from '../../../database/schema/queue_jobs';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import { QueueService } from '../../queue/queue.service';
import { StorageService } from '../../storage/storage.service';
import {
  buildReconciliation,
  IImportCheckpoint,
  IImportReconciliation,
  IPeopleImportResult,
  IPreparedImport,
  PeopleExportImportService,
  PeopleImportFormat,
} from './people-export-import.service';

const JOB_NAME = 'import';
const PEOPLE_IMPORT_LOCK = 'orion:people-import-run';
const MAX_ATTEMPTS = 3;

/**
 * Set only on the part jobs of a Pipeline bundle import (Phase 9D): which Orion bundle import and which Pipeline bundle / part this
 * job is. Metadata only (no file content, no personal data); it rides in the existing queue payload, so there is no schema change.
 */
export interface IPeopleImportBundleRef {
  /** Orion's own id for this upload of a bundle (the same Pipeline bundle uploaded twice gets two). */
  bundleImportId: string;
  /** The Pipeline's bundle_id from manifest.json. */
  bundleId: string;
  format: 'csv' | 'json';
  exportedAt: string;
  partNumber: number;
  partCount: number;
  filename: string;
  /** Manifest totals, so the aggregate view can reconcile even when some parts were never queued. */
  manifestTotalRows: number;
  manifestPartRows: number;
}

/** The queue payload: references and metadata only. The file itself lives in private object storage. */
export interface IPeopleImportJobData {
  storageKey: string;
  format: PeopleImportFormat;
  dryRun: boolean;
  /** SHA-256 of the stored file: the worker refuses a payload that is not the one that was validated. */
  contentSha256: string;
  totalRows: number;
  batchRef: string;
  requestedBy?: string;
  bundle?: IPeopleImportBundleRef;
}

export interface IPeopleImportAccepted {
  jobId: string;
  status: 'QUEUED';
  dryRun: boolean;
  totalRows: number;
  batchRef: string;
  exportVersion: string;
}

type FinalState = IPeopleImportResult['status'] | 'FAILED';
/** What is kept in queue_jobs.result: progress while running, the final summary (or a safe failure) when done. */
interface IStoredResult extends Partial<IPeopleImportResult> {
  state?: 'RUNNING' | FinalState;
  final?: boolean;
  contentSha256?: string;
  checkpoint?: IImportCheckpoint;
  processedRows?: number;
  errorCode?: string;
}

/** Everything the status endpoint returns: counts and codes only. */
export interface IPeopleImportJobView {
  jobId: string;
  status: 'QUEUED' | 'RUNNING' | FinalState;
  dryRun: boolean;
  totalRows: number;
  processedRows: number;
  imported: number;
  updated: number;
  unchanged: number;
  valid: number;
  quarantined: number;
  failed: number;
  matched: number;
  unmatched: number;
  ambiguous: number;
  batchRef: string;
  exportVersion: string | null;
  acquiredAt: string | null;
  reasonCounts: Record<string, number>;
  rejectedRows: Array<{ row: number; code: string }>;
  observations: { recorded: number; duplicate: number; notRecorded: number } | null;
  /** How every row of the file is accounted for (derived from the counts above; nothing extra is stored). */
  reconciliation: IImportReconciliation;
  /** Present only on the part jobs of a bundle import. */
  bundle?: IPeopleImportBundleRef;
  source: { key: string; version: string } | null;
  errorSummary: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** Safe, fixed sentences for the failure codes the worker can record. */
const ERROR_SUMMARIES: Record<string, string> = {
  PAYLOAD_UNAVAILABLE: 'The stored import file could not be read.',
  PAYLOAD_INTEGRITY: 'The stored import file does not match the file that was accepted.',
  INVALID_PAYLOAD: 'The stored import file is no longer valid.',
  IMPORT_FAILED: 'The import could not be completed.',
};

class PermanentImportError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Background People import on the EXISTING Postgres queue (queue_jobs), nothing new:
 *
 *   POST  validate the file exactly as before -> private object storage -> queue job { storageKey, ... } -> 202 + jobId
 *   worker  read the stored file -> PeopleExportImportService.run (slices; checkpoint after each) -> final result -> discard file
 *   GET   safe status view of the job
 *
 * queue_jobs.data holds references only. Progress and the final summary are stored in queue_jobs.result (counts and codes only).
 * Retries resume from the checkpoint and are idempotent through the observation layer (same run id), so a retry or a redelivery
 * never duplicates People; a job whose result is already final is never processed again.
 */
@Injectable()
export class PeopleImportJobService implements OnModuleInit {
  private readonly logger = new Logger(PeopleImportJobService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDb,
    private readonly importer: PeopleExportImportService,
    @Optional() private readonly storage?: StorageService,
    @Optional() private readonly queue?: QueueService,
    @Optional() @Inject(PG_POOL) private readonly pool?: Pool,
  ) {}

  /**
   * One People import run at a time, across every API instance (Phase 9E). The queue gives first-in-first-out order inside one
   * process, but a second instance claims waiting jobs too, so two imports (or two parts of one bundle) can otherwise run at the same
   * time. Identity resolution is check-then-insert: two runs that meet the same person (by work e-mail or phone) at the same moment
   * both create them, and a LinkedIn match fails on the unique index. Sequential runs never do either (measured on real Postgres).
   *
   * A transaction-scoped advisory lock is held by a dedicated connection for the whole run. Transaction scope (not session scope) is
   * deliberate: it is released by COMMIT or by the connection closing, and it also works behind a transaction-mode pooler. Without a
   * pool (unit tests on a single in-process database) there is nothing to serialise and this is a no-op.
   */
  private async acquireRunLock(): Promise<() => Promise<void>> {
    if (!this.pool) return async () => undefined;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // This connection deliberately sits idle inside a transaction for the whole run, and a second import deliberately waits on the
      // lock for as long as the first one runs. The pool's server-side limits (statement, idle-in-transaction, lock wait) would end
      // both, so they are lifted for this one transaction only (SET LOCAL ends with the COMMIT).
      await client.query('SET LOCAL statement_timeout = 0');
      await client.query('SET LOCAL idle_in_transaction_session_timeout = 0');
      await client.query('SET LOCAL lock_timeout = 0');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [PEOPLE_IMPORT_LOCK]);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release(true);
      throw e;
    }
    return async () => {
      try {
        await client.query('COMMIT');
        client.release();
      } catch {
        client.release(true); // a broken connection is dropped; Postgres frees its lock
      }
    };
  }

  onModuleInit() {
    this.queue?.registerWorker(QUEUE_NAMES.PEOPLE_IMPORT, async (job) => this.execute(job.id));
  }

  // ------------------------------------------------------------------------------------------------------- enqueue
  async enqueue(input: { format: PeopleImportFormat; content: string; dryRun?: boolean; requestedBy?: string; bundle?: IPeopleImportBundleRef }): Promise<IPeopleImportAccepted> {
    const prepared = this.importer.prepare(input.format, input.content); // 400 / 413 exactly as the synchronous import; no side effect
    if (!this.queue) throw new BusinessException('The import queue is not available', 'IMPORT_QUEUE_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE);
    if (!this.storage) throw new BusinessException('The import file could not be stored; nothing was queued', 'IMPORT_STORAGE_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE);
    const dryRun = input.dryRun === true;
    const storageKey = `people-imports/${randomUUID()}.${input.format}`;
    const contentSha256 = sha256(input.content);
    try {
      await this.storage.uploadFile({
        key: storageKey,
        buffer: Buffer.from(input.content, 'utf8'),
        mimeType: input.format === 'csv' ? 'text/csv' : 'application/json',
        metadata: { sha256: contentSha256 },
        isPublic: false,
      });
    } catch (e) {
      this.logger.error(`Could not store a People import file: ${(e as Error)?.name}`);
      throw new BusinessException('The import file could not be stored; nothing was queued', 'IMPORT_STORAGE_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE);
    }
    const data: IPeopleImportJobData = {
      storageKey, format: input.format, dryRun, contentSha256, totalRows: prepared.totalRows, batchRef: prepared.batchRef,
      ...(input.requestedBy ? { requestedBy: input.requestedBy } : {}),
      ...(input.bundle ? { bundle: input.bundle } : {}),
    };
    try {
      const job = await this.queue.addJob(QUEUE_NAMES.PEOPLE_IMPORT, JOB_NAME, data, { attempts: MAX_ATTEMPTS });
      return { jobId: job.id, status: 'QUEUED', dryRun, totalRows: prepared.totalRows, batchRef: prepared.batchRef, exportVersion: prepared.parsed.exportVersion };
    } catch (e) {
      this.logger.error(`Could not queue a People import: ${(e as Error)?.name}`);
      await this.discard(storageKey);
      throw new BusinessException('The import could not be queued; nothing was imported', 'IMPORT_QUEUE_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  // ------------------------------------------------------------------------------------------------------- worker
  /** Queue entry point. Throws only to ask the queue for a retry (with a message that carries no data). */
  async execute(jobId: string): Promise<IStoredResult> {
    const row = await this.loadRow(jobId);
    if (!row) return { state: 'FAILED', final: true, errorCode: 'IMPORT_FAILED' };
    const stored = (row.result ?? undefined) as IStoredResult | undefined;
    if (stored?.final) return stored; // a redelivered job that already finished: nothing to do, nothing to write
    const data = row.data as IPeopleImportJobData;

    let releaseLock: (() => Promise<void>) | undefined;
    try {
      releaseLock = await this.acquireRunLock();
      const content = await this.readPayload(data);
      const prepared = this.prepareFromPayload(data, content);
      const resume = stored?.checkpoint && stored.contentSha256 === data.contentSha256 ? stored.checkpoint : undefined;
      const result = await this.importer.run(prepared, {
        dryRun: data.dryRun,
        resume,
        onProgress: (cp) => this.writeProgress(jobId, data, prepared, cp),
      });
      const final: IStoredResult = { ...result, state: result.status, final: true, contentSha256: data.contentSha256, processedRows: result.totalRows };
      await this.writeResult(jobId, final);
      await this.discard(data.storageKey);
      return final;
    } catch (e) {
      if (e instanceof PermanentImportError) return this.finishFailed(jobId, data, e.code); // no point retrying
      const lastAttempt = (row.attempts ?? 0) + 1 >= (row.maxAttempts ?? MAX_ATTEMPTS);
      this.logger.error(`People import job ${jobId} attempt failed (${(e as Error)?.name})`);
      if (lastAttempt) await this.finishFailed(jobId, data, 'IMPORT_FAILED');
      // the queue records this message in queue_jobs.error: a fixed code, never anything from the file or the database
      throw new Error('PEOPLE_IMPORT_ATTEMPT_FAILED');
    } finally {
      await releaseLock?.();
    }
  }

  private prepareFromPayload(data: IPeopleImportJobData, content: string): IPreparedImport {
    try {
      return this.importer.prepare(data.format, content);
    } catch (e) {
      if (e instanceof BusinessException) throw new PermanentImportError('INVALID_PAYLOAD');
      throw e;
    }
  }

  private async readPayload(data: IPeopleImportJobData): Promise<string> {
    let text: string;
    try {
      const stream = await this.storage!.getFileStream(data.storageKey);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      text = Buffer.concat(chunks).toString('utf8');
    } catch {
      throw new Error('payload read failed'); // transient: storage may recover; retried
    }
    if (sha256(text) !== data.contentSha256) throw new PermanentImportError('PAYLOAD_INTEGRITY');
    return text;
  }

  /**
   * Ends the job FAILED. Whatever earlier slices already wrote stays reported: the latest saved progress (counts, processed rows) is
   * carried into the final result. A failure before the first slice has no progress, so it correctly reports zero.
   */
  private async finishFailed(jobId: string, data: IPeopleImportJobData, errorCode: string): Promise<IStoredResult> {
    const latest = (await this.loadRow(jobId))?.result as IStoredResult | undefined;
    const kept = latest && latest.contentSha256 === data.contentSha256 && latest.checkpoint ? latest : undefined;
    const { checkpoint: _resume, ...progress } = kept ?? {}; // a final result is never resumed from
    const final: IStoredResult = {
      ...progress,
      state: 'FAILED', final: true, errorCode, batchRef: data.batchRef, dryRun: data.dryRun, totalRows: data.totalRows, contentSha256: data.contentSha256,
    };
    await this.writeResult(jobId, final);
    await this.discard(data.storageKey);
    return final;
  }

  private async writeProgress(jobId: string, data: IPeopleImportJobData, prepared: IPreparedImport, cp: IImportCheckpoint): Promise<void> {
    const c = cp.counters;
    const progress: IStoredResult = {
      state: 'RUNNING', contentSha256: data.contentSha256, checkpoint: cp, batchRef: data.batchRef, dryRun: data.dryRun, totalRows: data.totalRows,
      processedRows: prepared.rejected.length + cp.processedRecords,
      imported: c.created, updated: c.updated, unchanged: c.unchanged, valid: c.valid, quarantined: c.quarantined, unmatched: c.unmatched,
      ambiguous: c.ambiguous, failed: prepared.rejected.length, matched: c.created + c.updated + c.unchanged + c.valid,
    };
    await this.writeResult(jobId, progress);
  }

  private async writeResult(jobId: string, result: IStoredResult): Promise<void> {
    await this.db.update(queueJobs).set({ result: result as any, updatedAt: new Date() }).where(eq(queueJobs.id, jobId));
  }

  private async discard(storageKey: string): Promise<void> {
    try {
      await this.storage?.deleteFile(storageKey);
    } catch (e) {
      this.logger.warn(`Could not remove a processed People import file (${(e as Error)?.name})`); // never blocks or fails the job
    }
  }

  private async loadRow(jobId: string) {
    const [row] = await this.db.select().from(queueJobs).where(eq(queueJobs.id, jobId));
    return row && row.queueName === QUEUE_NAMES.PEOPLE_IMPORT ? row : undefined;
  }

  // ------------------------------------------------------------------------------------------------------- status
  async getJob(jobId: string): Promise<IPeopleImportJobView> {
    const row = await this.loadRow(jobId);
    if (!row) throw new BusinessException('Import job not found', 'IMPORT_JOB_NOT_FOUND', HttpStatus.NOT_FOUND);
    return this.toView(row);
  }

  /**
   * Import history: the People import jobs of the existing queue, newest first (ties by id), as the same safe view as a single job.
   * Nothing is stored for this: it is a read over queue_jobs, so it keeps whatever the queue keeps (finished jobs older than 7 days
   * are pruned by the existing queue maintenance).
   */
  async listJobs(page = 1, limit = 20): Promise<{ items: IPeopleImportJobView[]; pagination: { page: number; limit: number; totalItems: number; totalPages: number } }> {
    const where = eq(queueJobs.queueName, QUEUE_NAMES.PEOPLE_IMPORT);
    const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(queueJobs).where(where);
    const rows = await this.db.select().from(queueJobs).where(where).orderBy(desc(queueJobs.createdAt), desc(queueJobs.id)).limit(limit).offset((page - 1) * limit);
    return { items: rows.map((r) => this.toView(r)), pagination: { page, limit, totalItems: n, totalPages: Math.ceil(n / limit) || 1 } };
  }

  /** The part jobs of one bundle import, in part order (what the bundle aggregate is built from). */
  async getBundleJobs(bundleImportId: string): Promise<IPeopleImportJobView[]> {
    const rows = await this.db
      .select()
      .from(queueJobs)
      .where(and(eq(queueJobs.queueName, QUEUE_NAMES.PEOPLE_IMPORT), sql`${queueJobs.data}->'bundle'->>'bundleImportId' = ${bundleImportId}`))
      .orderBy(asc(queueJobs.createdAt), asc(queueJobs.id));
    return rows.map((r) => this.toView(r)).sort((a, b) => (a.bundle?.partNumber ?? 0) - (b.bundle?.partNumber ?? 0));
  }

  private toView(row: typeof queueJobs.$inferSelect): IPeopleImportJobView {
    const data = row.data as IPeopleImportJobData;
    const r = (row.result ?? {}) as IStoredResult;
    const status: IPeopleImportJobView['status'] =
      row.status === 'WAITING' ? 'QUEUED'
        : row.status === 'ACTIVE' ? 'RUNNING'
          : row.status === 'FAILED' ? 'FAILED'
            : ((r.state && r.state !== 'RUNNING' ? r.state : 'COMPLETED') as FinalState);
    const failed = status === 'FAILED';
    const counts = {
      totalRows: data.totalRows, failed: r.failed ?? 0, imported: r.imported ?? 0, updated: r.updated ?? 0, unchanged: r.unchanged ?? 0,
      valid: r.valid ?? 0, quarantined: r.quarantined ?? 0,
    };
    return {
      jobId: row.id,
      status,
      dryRun: data.dryRun,
      totalRows: data.totalRows,
      processedRows: r.processedRows ?? 0,
      imported: r.imported ?? 0,
      updated: r.updated ?? 0,
      unchanged: r.unchanged ?? 0,
      valid: r.valid ?? 0,
      quarantined: r.quarantined ?? 0,
      failed: r.failed ?? 0,
      matched: r.matched ?? 0,
      unmatched: r.unmatched ?? 0,
      ambiguous: r.ambiguous ?? 0,
      batchRef: data.batchRef,
      exportVersion: r.exportVersion ?? null,
      acquiredAt: r.acquiredAt ?? null,
      reasonCounts: r.reasonCounts ?? {},
      rejectedRows: r.rejectedRows ?? [],
      observations: r.observations ?? null,
      reconciliation: buildReconciliation(counts),
      ...(data.bundle ? { bundle: data.bundle } : {}),
      source: r.source ?? null,
      errorSummary: failed ? (ERROR_SUMMARIES[r.errorCode ?? ''] ?? ERROR_SUMMARIES.IMPORT_FAILED) : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      completedAt: row.processedAt ? row.processedAt.toISOString() : null,
    };
  }
}

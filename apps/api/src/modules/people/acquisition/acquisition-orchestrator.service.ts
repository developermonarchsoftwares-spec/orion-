import { HttpStatus, Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';
import { BusinessException } from '../../../common/errors/business.exception';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import { QueueService } from '../../queue/queue.service';
import type { IRawPersonRecord, IRecordResult } from '../ingestion/ingestion.types';
import { PeopleIngestionService } from '../ingestion/people-ingestion.service';
import { SourceRegistryService } from '../sources/source-registry.service';
import type { ISourceRecord } from '../sources/source.types';
import {
  ACQUISITION_HARD_CAPS,
  DEFAULT_ACQUISITION_LIMITS,
  IAcquisitionAdapter,
  IAcquisitionLimits,
  RETRYABLE_RECORD_CODE,
} from './acquisition.types';

type Run = typeof schema.peopleAcquisitionRuns.$inferSelect;

const bad = (message: string, code: string, status = HttpStatus.BAD_REQUEST) => new BusinessException(message, code, status);

/** Thrown inside a run when this worker no longer owns it (cancelled, taken over after an expired lease). It ends the worker silently. */
class RunNotOwned extends Error {}
/** A deterministic run-level failure: recorded on the run, never retried by the orchestrator. */
class RunFailure extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export interface IRunOutcome {
  runId: string;
  status: Run['status'];
  failureCode: string | null;
}

/**
 * Acquisition orchestration (Phase 6.9). It makes a registered source safe to run at scale:
 *
 *   adapter -> batch -> limits / budget -> ingestion (observations) -> result -> checkpoint
 *
 * It owns RUN STATE only. Record truth stays in people_observations: every record of a run is ingested with the run's
 * batch_ref, so Phase 6.2 identity (source, record, content, run) makes any retry or replay a no-op for records already
 * ingested. It writes people only through PeopleIngestionService, holds no credentials, stores no payload and makes no network call
 * itself. The Postgres queue is only the wake-up: the run table is the authoritative state, and every transition is an atomic
 * conditional UPDATE, so two workers can never process one run.
 */
@Injectable()
export class AcquisitionOrchestratorService implements OnModuleInit {
  private readonly logger = new Logger(AcquisitionOrchestratorService.name);
  private readonly adapters = new Map<string, IAcquisitionAdapter>();
  private sleeper: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDb,
    private readonly ingestion: PeopleIngestionService,
    private readonly registry: SourceRegistryService,
    @Optional() private readonly queue?: QueueService,
  ) {}

  onModuleInit() {
    // The existing Postgres queue only wakes a worker; the run row decides whether there is anything to do.
    this.queue?.registerWorker<{ runId: string }>(QUEUE_NAMES.PEOPLE_ACQUISITION, async (job) => ({ ...(await this.executeRunSafely(job.data.runId)) }));
  }

  registerAdapter(adapter: IAcquisitionAdapter): void {
    this.adapters.set(adapter.sourceKey, adapter);
  }

  /** Tests inject a no-op sleeper; production waits for real. */
  setSleeper(fn: (ms: number) => Promise<void>): void {
    this.sleeper = fn;
  }

  // ------------------------------------------------------------------ create / control
  /**
   * Creates a QUEUED run, or refuses safely: source not registered / disabled / terms not acknowledged, invalid or oversized
   * limits, or the source's per-hour run rate exceeded. The rate check and the insert share a per-source advisory lock.
   */
  async createRun(sourceKey: string, requested: Partial<IAcquisitionLimits> = {}, opts: { enqueue?: boolean } = {}): Promise<Run> {
    const def = await this.registry.assertUsable(sourceKey);
    const limits = this.resolveLimits(requested);
    const id = randomUUID();
    const run = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`acq:${sourceKey}`}))`);
      const since = new Date(Date.now() - 3_600_000);
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.peopleAcquisitionRuns)
        .where(and(eq(schema.peopleAcquisitionRuns.sourceKey, sourceKey), gte(schema.peopleAcquisitionRuns.createdAt, since)));
      if (n >= limits.maxRunsPerHour) {
        throw bad(`Source "${sourceKey}" reached its limit of ${limits.maxRunsPerHour} runs per hour`, 'SOURCE_RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS);
      }
      const [row] = await tx
        .insert(schema.peopleAcquisitionRuns)
        .values({
          id,
          sourceKey,
          sourceVersion: def.version,
          batchRef: `acq-${id}`,
          maxRecords: limits.maxRecords,
          batchSize: limits.batchSize,
          maxCostUnits: limits.maxCostUnits,
          maxRetries: limits.maxRetries,
          backoffBaseMs: limits.backoffBaseMs,
          batchIntervalMs: limits.batchIntervalMs,
        })
        .returning();
      return row;
    });
    if (opts.enqueue !== false) await this.enqueue(run.id);
    return run;
  }

  /** FAILED -> QUEUED, optionally with a raised record limit or budget. CANCELLED and COMPLETED runs are final. */
  async resumeRun(runId: string, raise: { maxRecords?: number; maxCostUnits?: number | null } = {}, opts: { enqueue?: boolean } = {}): Promise<Run> {
    const [cur] = await this.db.select().from(schema.peopleAcquisitionRuns).where(eq(schema.peopleAcquisitionRuns.id, runId));
    if (!cur) throw bad('Run not found', 'RUN_NOT_FOUND', HttpStatus.NOT_FOUND);
    const maxRecords = raise.maxRecords ?? cur.maxRecords;
    if (!Number.isInteger(maxRecords) || maxRecords < cur.batchSize || maxRecords > ACQUISITION_HARD_CAPS.maxRecords) {
      throw bad('Invalid maxRecords for resume', 'INVALID_RUN_LIMITS');
    }
    const maxCostUnits = raise.maxCostUnits === undefined ? cur.maxCostUnits : raise.maxCostUnits;
    if (maxCostUnits !== null && (!Number.isInteger(maxCostUnits) || maxCostUnits < 0)) throw bad('Invalid maxCostUnits for resume', 'INVALID_RUN_LIMITS');
    const [row] = await this.db
      .update(schema.peopleAcquisitionRuns)
      .set({ status: 'QUEUED', maxRecords, maxCostUnits, claimToken: null, leaseExpiresAt: null, failureCode: null, failureMessage: null, finishedAt: null, updatedAt: new Date() })
      .where(and(eq(schema.peopleAcquisitionRuns.id, runId), eq(schema.peopleAcquisitionRuns.status, 'FAILED')))
      .returning();
    if (!row) throw bad(`Run is ${cur.status}; only a FAILED run can be resumed`, 'RUN_NOT_RESUMABLE', HttpStatus.CONFLICT);
    if (opts.enqueue !== false) await this.enqueue(row.id);
    return row;
  }

  /** QUEUED or RUNNING -> CANCELLED. A running worker notices at its next checkpoint and stops; nothing already ingested is undone. */
  async cancelRun(runId: string): Promise<Run> {
    const [row] = await this.db
      .update(schema.peopleAcquisitionRuns)
      .set({ status: 'CANCELLED', claimToken: null, leaseExpiresAt: null, finishedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.peopleAcquisitionRuns.id, runId), inArray(schema.peopleAcquisitionRuns.status, ['QUEUED', 'RUNNING'])))
      .returning();
    if (!row) throw bad('Only a QUEUED or RUNNING run can be cancelled', 'RUN_NOT_CANCELLABLE', HttpStatus.CONFLICT);
    return row;
  }

  async getRun(runId: string): Promise<Run | null> {
    const [row] = await this.db.select().from(schema.peopleAcquisitionRuns).where(eq(schema.peopleAcquisitionRuns.id, runId));
    return row ?? null;
  }

  private async enqueue(runId: string): Promise<void> {
    if (!this.queue) return;
    try {
      await this.queue.addJob(QUEUE_NAMES.PEOPLE_ACQUISITION, 'run', { runId }, { attempts: 1 });
    } catch (e) {
      // the run stays QUEUED and can be started explicitly; creating it must not fail because the wake-up could not be queued
      this.logger.warn(`Could not enqueue acquisition run ${runId}: ${(e as Error).message}`);
    }
  }

  // ------------------------------------------------------------------ execute
  /** Queue entry point: never throws; a refused claim (already running / finished) is a normal no-op. */
  async executeRunSafely(runId: string): Promise<IRunOutcome | { runId: string; skipped: true }> {
    try {
      return await this.executeRun(runId);
    } catch (e) {
      if (e instanceof BusinessException && e.errorCode === 'RUN_NOT_STARTABLE') return { runId, skipped: true };
      this.logger.error(`Acquisition run ${runId} could not execute: ${(e as Error).message}`);
      return { runId, skipped: true };
    }
  }

  async executeRun(runId: string): Promise<IRunOutcome> {
    const token = randomUUID();
    const claimed = await this.claim(runId, token);
    const adapter = this.adapters.get(claimed.sourceKey);
    try {
      if (!adapter) throw new RunFailure('NO_ADAPTER', `No adapter is registered for source "${claimed.sourceKey}"`);
      await this.process(claimed, adapter, token);
      await this.finish(claimed.id, token, 'COMPLETED');
      return { runId, status: 'COMPLETED', failureCode: null };
    } catch (e) {
      if (e instanceof RunNotOwned) {
        const cur = await this.getRun(runId);
        return { runId, status: cur?.status ?? 'CANCELLED', failureCode: cur?.failureCode ?? null };
      }
      const code = e instanceof RunFailure ? e.code : e instanceof BusinessException ? e.errorCode : 'RUN_ERROR';
      const message = e instanceof Error ? e.message : 'Unexpected error';
      await this.finish(claimed.id, token, 'FAILED', code, message).catch(() => undefined);
      return { runId, status: 'FAILED', failureCode: code };
    }
  }

  /** The single atomic transition into RUNNING: QUEUED, or RUNNING with an expired lease (a dead worker). Exactly one caller wins. */
  private async claim(runId: string, token: string): Promise<Run> {
    const now = new Date();
    const [row] = await this.db
      .update(schema.peopleAcquisitionRuns)
      .set({
        status: 'RUNNING',
        claimToken: token,
        leaseExpiresAt: new Date(now.getTime() + ACQUISITION_HARD_CAPS.leaseMs),
        startedAt: sql`COALESCE(${schema.peopleAcquisitionRuns.startedAt}, ${now.toISOString()}::timestamptz)`,
        finishedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.peopleAcquisitionRuns.id, runId),
          or(eq(schema.peopleAcquisitionRuns.status, 'QUEUED'), and(eq(schema.peopleAcquisitionRuns.status, 'RUNNING'), lt(schema.peopleAcquisitionRuns.leaseExpiresAt, now))),
        ),
      )
      .returning();
    if (!row) {
      const cur = await this.getRun(runId);
      if (!cur) throw bad('Run not found', 'RUN_NOT_FOUND', HttpStatus.NOT_FOUND);
      throw bad(`Run is ${cur.status} and cannot be started`, 'RUN_NOT_STARTABLE', HttpStatus.CONFLICT);
    }
    return row;
  }

  /** Atomic, owner-checked write of progress. Zero rows = the run was cancelled or taken over: stop. */
  private async checkpoint(runId: string, token: string, patch: Record<string, unknown>): Promise<void> {
    const rows = await this.db
      .update(schema.peopleAcquisitionRuns)
      .set({ ...patch, leaseExpiresAt: new Date(Date.now() + ACQUISITION_HARD_CAPS.leaseMs), updatedAt: new Date() })
      .where(and(eq(schema.peopleAcquisitionRuns.id, runId), eq(schema.peopleAcquisitionRuns.claimToken, token), eq(schema.peopleAcquisitionRuns.status, 'RUNNING')))
      .returning({ id: schema.peopleAcquisitionRuns.id });
    if (!rows.length) throw new RunNotOwned();
  }

  private async finish(runId: string, token: string, status: 'COMPLETED' | 'FAILED', code?: string, message?: string): Promise<void> {
    await this.db
      .update(schema.peopleAcquisitionRuns)
      .set({
        status,
        failureCode: status === 'FAILED' ? (code ?? 'RUN_ERROR').slice(0, 40) : null,
        failureMessage: status === 'FAILED' ? (message ?? '').slice(0, 300) : null,
        claimToken: null,
        leaseExpiresAt: null,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(schema.peopleAcquisitionRuns.id, runId), eq(schema.peopleAcquisitionRuns.claimToken, token), eq(schema.peopleAcquisitionRuns.status, 'RUNNING')));
  }

  // ------------------------------------------------------------------ the run itself
  private async process(run: Run, adapter: IAcquisitionAdapter, token: string): Promise<void> {
    const unit = adapter.costUnitsPerRecord ?? 0;
    if (!Number.isInteger(unit) || unit < 0) throw new RunFailure('INVALID_COST_MODEL', 'costUnitsPerRecord must be a non-negative integer');
    let seen = run.recordsSeen;
    let spent = run.costUnits;
    let first = true;

    for await (const batch of this.batches(run, adapter, token)) {
      if (!first && run.batchIntervalMs > 0) await this.sleeper(run.batchIntervalMs);
      first = false;
      await this.checkpoint(run.id, token, {}); // still ours? (a cancelled run stops here, before touching more records)
      // the source may have been disabled or its terms withdrawn while the run was going: re-check before every batch
      try {
        await this.registry.assertUsable(run.sourceKey);
      } catch (e) {
        throw new RunFailure('SOURCE_NOT_USABLE', e instanceof Error ? e.message : 'Source is not usable');
      }
      if (seen + batch.records.length > run.maxRecords && !batch.alreadyCounted) {
        throw new RunFailure('RECORD_LIMIT_REACHED', `The run limit of ${run.maxRecords} records would be exceeded`);
      }

      // records already completed earlier in THIS run (a resumed run) are recognised through their observation and not processed again
      const done = await this.completedRecordIds(run, batch.records);
      const pending = batch.records.filter((r) => !done.has(recordIdOf(r) ?? ''));
      const cost = pending.length * unit;
      if (run.maxCostUnits !== null && spent + cost > run.maxCostUnits) {
        throw new RunFailure('BUDGET_EXHAUSTED', `The run budget of ${run.maxCostUnits} cost units would be exceeded`);
      }

      const tally = await this.ingestWithRetries(run, pending, batch.acquiredAt, token);
      spent += cost;
      seen += batch.alreadyCounted ? 0 : batch.records.length;
      await this.checkpoint(run.id, token, {
        recordsSeen: sql`${schema.peopleAcquisitionRuns.recordsSeen} + ${batch.alreadyCounted ? 0 : batch.records.length}`,
        recordsCreated: sql`${schema.peopleAcquisitionRuns.recordsCreated} + ${tally.created}`,
        recordsUpdated: sql`${schema.peopleAcquisitionRuns.recordsUpdated} + ${tally.updated}`,
        recordsUnchanged: sql`${schema.peopleAcquisitionRuns.recordsUnchanged} + ${tally.unchanged}`,
        recordsQuarantined: sql`${schema.peopleAcquisitionRuns.recordsQuarantined} + ${tally.quarantined}`,
        recordsFailed: sql`${schema.peopleAcquisitionRuns.recordsFailed} + ${tally.failed}`,
        recordsSkipped: sql`${schema.peopleAcquisitionRuns.recordsSkipped} + ${batch.records.length - pending.length}`,
        batchesDone: sql`${schema.peopleAcquisitionRuns.batchesDone} + 1`,
        retries: sql`${schema.peopleAcquisitionRuns.retries} + ${tally.retries}`,
        costUnits: sql`${schema.peopleAcquisitionRuns.costUnits} + ${cost}`,
        // the cursor moves only when a whole fetched page is done, so a replay never skips unprocessed records
        ...(batch.cursorAfter !== undefined ? { cursor: batch.cursorAfter } : {}),
      });
    }
  }

  /**
   * Yields batches of at most batchSize records. A source with paged fetch resumes from the stored cursor (exactly as the adapter
   * returned it). A source with only records() is read once and chunked; its resume relies on observation identity, not on a
   * position, so no unstable cursor is ever invented.
   */
  private async *batches(run: Run, adapter: IAcquisitionAdapter, token: string): AsyncGenerator<{ records: ISourceRecord[]; acquiredAt: Date; cursorAfter?: string | null; alreadyCounted?: boolean }> {
    const retry = <T>(label: string, fn: () => Promise<T>) => this.withBackoff(run, token, label, fn);
    const chunk = (records: ISourceRecord[]) => {
      const out: ISourceRecord[][] = [];
      for (let i = 0; i < records.length; i += run.batchSize) out.push(records.slice(i, i + run.batchSize));
      return out;
    };

    if (adapter.fetch) {
      let cursor: string | undefined = run.cursor ?? undefined;
      for (;;) {
        const page = await retry('fetch', () => adapter.fetch!(cursor));
        const records = page.records ?? [];
        const parts = chunk(records);
        for (let i = 0; i < parts.length; i++) {
          yield { records: parts[i], acquiredAt: page.acquiredAt ?? new Date(), cursorAfter: i === parts.length - 1 ? (page.cursor ?? null) : undefined };
        }
        if (!page.cursor) return;
        if (page.cursor === cursor) throw new RunFailure('CURSOR_NOT_ADVANCING', 'The source returned the same cursor again');
        cursor = page.cursor;
      }
    }

    const all: ISourceRecord[] = await retry('records', async () => {
      const out: ISourceRecord[] = [];
      for await (const r of adapter.records() as AsyncIterable<IRawPersonRecord> | Iterable<IRawPersonRecord>) {
        out.push({ mapped: r, sourceRecordId: ((r as any)?.source?.recordId as string | undefined) });
        if (out.length > run.maxRecords) break;
      }
      return out;
    });
    // refuse an oversized run BEFORE processing anything
    if (all.length > run.maxRecords) throw new RunFailure('OVERSIZED_RUN', `The source supplies more than the limit of ${run.maxRecords} records; split the run`);
    if (run.recordsSeen === 0) await this.checkpoint(run.id, token, { recordsSeen: all.length });
    const acquiredAt = new Date();
    for (const part of chunk(all)) yield { records: part, acquiredAt, alreadyCounted: true };
  }

  /** Bounded retries with deterministic backoff of a TRANSIENT failure. A BusinessException (a deterministic decision) is never retried. */
  private async withBackoff<T>(run: Run, token: string, label: string, fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        if (e instanceof RunNotOwned || e instanceof RunFailure || e instanceof BusinessException) throw e;
        if (attempt >= run.maxRetries) throw new RunFailure('TRANSIENT_FAILURE_EXHAUSTED', `${label} failed after ${attempt + 1} attempts: ${(e as Error).message}`);
        await this.checkpoint(run.id, token, { retries: sql`${schema.peopleAcquisitionRuns.retries} + 1` }); // also proves we still own the run
        await this.sleeper(backoffMs(run, attempt + 1));
      }
    }
  }

  /**
   * Ingests a batch through the canonical ingestion service. One bad record never aborts the batch (ingestion isolates each
   * record). Only an unexpected PROCESSING_ERROR is retried, record by record; quarantine decisions (invalid, ambiguous,
   * suppressed, company not found) are final.
   */
  private async ingestWithRetries(run: Run, records: ISourceRecord[], acquiredAt: Date, token: string) {
    const tally = { created: 0, updated: 0, unchanged: 0, quarantined: 0, failed: 0, retries: 0 };
    let todo = records.map(toRaw);
    for (let attempt = 0; todo.length > 0; attempt++) {
      const report = await this.withBackoff(run, token, 'ingest', () => this.ingestion.ingest(todo, { sourceKey: run.sourceKey, batchRef: run.batchRef, acquiredAt }));
      const retry: IRawPersonRecord[] = [];
      report.results.forEach((r: IRecordResult, i: number) => {
        const retryable = r.outcome === 'QUARANTINED' && (r.reasons ?? []).some((x) => x.code === RETRYABLE_RECORD_CODE);
        if (retryable) {
          retry.push(todo[i]);
          return;
        }
        if (r.outcome === 'CREATED') tally.created++;
        else if (r.outcome === 'UPDATED') tally.updated++;
        else if (r.outcome === 'UNCHANGED') tally.unchanged++;
        else if (r.outcome === 'QUARANTINED') tally.quarantined++;
      });
      if (retry.length === 0) break;
      if (attempt >= run.maxRetries) {
        tally.failed += retry.length; // survives every retry: counted, resumable, never aborts the batch
        break;
      }
      tally.retries++;
      await this.checkpoint(run.id, token, {}); // still ours?
      await this.sleeper(backoffMs(run, attempt + 1));
      todo = retry;
    }
    return tally;
  }

  /** Source record ids of this batch already finished in this run: INGESTED, or QUARANTINED for a deterministic reason. */
  private async completedRecordIds(run: Run, records: ISourceRecord[]): Promise<Set<string>> {
    const ids = [...new Set(records.map(recordIdOf).filter((x): x is string => !!x))];
    if (ids.length === 0) return new Set();
    const o = schema.peopleObservations;
    const rows = await this.db
      .select({ id: o.sourceRecordId, outcome: o.outcome, reasons: o.reasonCodes })
      .from(o)
      .where(and(eq(o.sourceKey, run.sourceKey), eq(o.batchRef, run.batchRef), inArray(o.sourceRecordId, ids)));
    const done = new Set<string>();
    for (const r of rows) {
      if (r.outcome === 'INGESTED' || !(r.reasons ?? []).includes(RETRYABLE_RECORD_CODE)) done.add(r.id);
    }
    // a record that has BOTH a transient failure and a later success is done; one with only transient failures is not
    return done;
  }

  // ------------------------------------------------------------------ limits
  private resolveLimits(requested: Partial<IAcquisitionLimits>): IAcquisitionLimits {
    const l: IAcquisitionLimits = { ...DEFAULT_ACQUISITION_LIMITS, ...Object.fromEntries(Object.entries(requested).filter(([, v]) => v !== undefined)) } as IAcquisitionLimits;
    const int = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
    if (!int(l.maxRecords, 1, ACQUISITION_HARD_CAPS.maxRecords)) throw bad(`maxRecords must be 1..${ACQUISITION_HARD_CAPS.maxRecords}`, 'INVALID_RUN_LIMITS');
    if (!int(l.batchSize, 1, ACQUISITION_HARD_CAPS.batchSize) || l.batchSize > l.maxRecords) throw bad('batchSize must be 1..1000 and not above maxRecords', 'INVALID_RUN_LIMITS');
    if (l.maxCostUnits !== null && !int(l.maxCostUnits, 0, 2_000_000_000)) throw bad('maxCostUnits must be a non-negative integer or null', 'INVALID_RUN_LIMITS');
    if (!int(l.maxRetries, 0, ACQUISITION_HARD_CAPS.maxRetries)) throw bad(`maxRetries must be 0..${ACQUISITION_HARD_CAPS.maxRetries}`, 'INVALID_RUN_LIMITS');
    if (!int(l.backoffBaseMs, 0, ACQUISITION_HARD_CAPS.backoffMaxMs) || !int(l.batchIntervalMs, 0, ACQUISITION_HARD_CAPS.backoffMaxMs)) throw bad('backoffBaseMs / batchIntervalMs out of range', 'INVALID_RUN_LIMITS');
    if (!int(l.maxRunsPerHour, 1, 10_000)) throw bad('maxRunsPerHour must be 1..10000', 'INVALID_RUN_LIMITS');
    return l;
  }
}

const backoffMs = (run: Pick<Run, 'backoffBaseMs'>, attempt: number) => Math.min(run.backoffBaseMs * 2 ** (attempt - 1), ACQUISITION_HARD_CAPS.backoffMaxMs);

const recordIdOf = (r: ISourceRecord): string | undefined => r.sourceRecordId ?? ((r.mapped as any)?.source?.recordId as string | undefined);

/** The source's record id and observed date travel inside the canonical record's `source` block (the existing ingestion contract). */
function toRaw(r: ISourceRecord): IRawPersonRecord {
  const m: any = { ...r.mapped };
  if (r.sourceRecordId !== undefined || r.observedAt !== undefined) {
    m.source = { ...(m.source ?? {}), ...(r.sourceRecordId !== undefined ? { recordId: r.sourceRecordId } : {}), ...(r.observedAt !== undefined ? { observedAt: r.observedAt } : {}) };
  }
  return m as IRawPersonRecord;
}

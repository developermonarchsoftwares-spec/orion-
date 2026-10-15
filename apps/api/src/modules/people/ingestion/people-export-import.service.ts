import { HttpStatus, Injectable } from '@nestjs/common';
import { BusinessException } from '../../../common/errors/business.exception';
import { OBSERVATION_LIMITS } from '../observations/observation-policy';
import { BUILT_IN_SOURCE_KEYS } from '../sources/built-in-sources';
import type { IIngestionReport, IRawPersonRecord } from './ingestion.types';
import { PeopleIngestionService } from './people-ingestion.service';
import {
  exportBatchRef,
  IParsedExport,
  IRowRejection,
  mapExportRows,
  parseExportCsv,
  parseExportJson,
  PeopleExportFormatError,
} from './sources/people-export.mapper';

export type PeopleImportFormat = 'csv' | 'json';
export const MAX_IMPORT_CONTENT_CHARS = 20_000_000;
const MAX_LISTED_REJECTIONS = 50;
/** Records handed to PeopleIngestionService per call. Only a progress granularity: every record is processed exactly as before. */
export const IMPORT_SLICE_SIZE = 250;

/**
 * How the rows of one file are accounted for. Derived only from counts the import already keeps (no second report, nothing stored):
 *
 *   rowsInFile  = rejectedBeforeIngestion + receivedByIngestion
 *   receivedByIngestion = accepted + quarantined + unaccounted        (accepted = imported + updated + unchanged, or valid in a dry run)
 *
 * `unaccounted` is 0 for a finished job. While a job runs (or after it failed part-way) it is the rows not yet processed, so
 * `balanced` is only true when every row has exactly one outcome.
 */
export interface IImportReconciliation {
  /** Data rows in the file (for JSON this equals the validated record_count; the export the Pipeline produced). */
  rowsInFile: number;
  /** Rows refused before ingestion: no / invalid / repeated relationship_id, malformed GSTIN / CIN / PAN. */
  rejectedBeforeIngestion: number;
  /** Rows handed to the People ingestion layer. */
  receivedByIngestion: number;
  /** Stored by the People layer: imported + updated + unchanged (valid, in a dry run). */
  accepted: number;
  imported: number;
  updated: number;
  unchanged: number;
  valid: number;
  /** Held in the existing quarantine (unmatched / ambiguous company, invalid person data, ...). */
  quarantined: number;
  /** Rows with no outcome yet. Always 0 for a completed import. */
  unaccounted: number;
  balanced: boolean;
}

export function buildReconciliation(c: {
  totalRows: number; failed: number; imported: number; updated: number; unchanged: number; valid: number; quarantined: number;
}): IImportReconciliation {
  const received = Math.max(0, c.totalRows - c.failed);
  const accepted = c.imported + c.updated + c.unchanged + c.valid;
  const unaccounted = received - accepted - c.quarantined;
  return {
    rowsInFile: c.totalRows,
    rejectedBeforeIngestion: c.failed,
    receivedByIngestion: received,
    accepted,
    imported: c.imported,
    updated: c.updated,
    unchanged: c.unchanged,
    valid: c.valid,
    quarantined: c.quarantined,
    unaccounted,
    balanced: unaccounted === 0,
  };
}

/** Everything the import reports: counts and machine codes only, never a name, contact value, payload or internal id. */
export interface IPeopleImportResult {
  batchRef: string;
  status: 'COMPLETED' | 'COMPLETED_WITH_ISSUES' | 'DRY_RUN';
  dryRun: boolean;
  exportVersion: string;
  acquiredAt: string;
  source: { key: string; version: string } | null;
  totalRows: number;
  /** Rows whose company was identified and that were accepted (imported, updated, unchanged, or valid in a dry run). */
  matched: number;
  /** Rows quarantined because no existing company matched. */
  unmatched: number;
  /** Rows quarantined because several companies matched or identifiers disagreed. */
  ambiguous: number;
  imported: number;
  updated: number;
  unchanged: number;
  /** Dry run only: rows that would be accepted. */
  valid: number;
  /** All rows the ingestion layer put in quarantine, for any reason (includes unmatched and ambiguous). */
  quarantined: number;
  /** Rows rejected before ingestion because they could not be keyed or carried a malformed statutory identifier. */
  failed: number;
  reasonCounts: Record<string, number>;
  rejectedRows: Array<{ row: number; code: string }>;
  observations: { recorded: number; duplicate: number; notRecorded: number } | null;
  reconciliation: IImportReconciliation;
}

/** A validated, mapped file, ready to run. */
export interface IPreparedImport {
  parsed: IParsedExport;
  records: IRawPersonRecord[];
  rejected: IRowRejection[];
  batchRef: string;
  totalRows: number;
}

/** Running totals of an import; also the resumable checkpoint stored with a background job (counts only). */
export interface IImportCounters {
  created: number;
  updated: number;
  unchanged: number;
  valid: number;
  quarantined: number;
  unmatched: number;
  ambiguous: number;
  reasonCounts: Record<string, number>;
  observations: { recorded: number; duplicate: number; notRecorded: number } | null;
  source: { key: string; version: string } | null;
}
export interface IImportCheckpoint {
  /** How many of the mapped records have been handed to ingestion (in order). */
  processedRecords: number;
  counters: IImportCounters;
}

export const emptyCounters = (): IImportCounters => ({
  created: 0, updated: 0, unchanged: 0, valid: 0, quarantined: 0, unmatched: 0, ambiguous: 0, reasonCounts: {}, observations: null, source: null,
});

/**
 * People-only import of the frozen People Pipeline export. parse -> validate -> map -> PeopleIngestionService.ingest. It writes
 * nothing itself, creates no company and publishes nothing: every accepted person is the ingestion layer's DRAFT / PENDING /
 * unpublished / unverified record, and every unresolved company is quarantined by the existing mechanism.
 *
 * `prepare` validates a file (what the endpoint does before it queues anything); `run` processes a prepared file in slices,
 * reporting progress and able to resume from a checkpoint (what the background worker does). `import` is both in one call.
 */
@Injectable()
export class PeopleExportImportService {
  constructor(private readonly ingestion: PeopleIngestionService) {}

  /** Parse, validate and map. Throws a BusinessException (400 / 413) and has no side effect. */
  prepare(format: PeopleImportFormat, content: string): IPreparedImport {
    const parsed = this.parse(format, content);

    // The existing keyed-run ceiling. A larger file is refused whole: nothing is imported, nothing is split silently.
    if (parsed.rows.length > OBSERVATION_LIMITS.MAX_RECORDS_PER_RUN) {
      throw new BusinessException(
        `The export has ${parsed.rows.length} rows; one import accepts at most ${OBSERVATION_LIMITS.MAX_RECORDS_PER_RUN}. Nothing was imported.`,
        'BATCH_TOO_LARGE',
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    const mapped = mapExportRows(parsed.rows);
    return { parsed, records: mapped.records, rejected: mapped.rejected, batchRef: exportBatchRef(parsed), totalRows: parsed.rows.length };
  }

  async import(input: { format: PeopleImportFormat; content: string; dryRun?: boolean }): Promise<IPeopleImportResult> {
    return this.run(this.prepare(input.format, input.content), { dryRun: input.dryRun === true });
  }

  /**
   * Run a prepared import. Records go to ingestion in order, IMPORT_SLICE_SIZE at a time, under one run id, so re-running (a retry,
   * or the same file again) is recognised record by record by the observation layer. `resume` skips what a checkpoint says was done.
   */
  async run(
    prepared: IPreparedImport,
    opts: { dryRun?: boolean; resume?: IImportCheckpoint; onProgress?: (cp: IImportCheckpoint) => Promise<void> | void } = {},
  ): Promise<IPeopleImportResult> {
    const dryRun = opts.dryRun === true;
    const counters: IImportCounters = opts.resume ? JSON.parse(JSON.stringify(opts.resume.counters)) : emptyCounters();
    let done = opts.resume ? Math.min(opts.resume.processedRecords, prepared.records.length) : 0;
    while (done < prepared.records.length) {
      const slice = prepared.records.slice(done, done + IMPORT_SLICE_SIZE);
      const report = await this.ingestion.ingest(slice, {
        sourceKey: BUILT_IN_SOURCE_KEYS.JSON, // existing MANUAL_IMPORT source for structured, already-mapped records
        batchRef: prepared.batchRef,
        acquiredAt: prepared.parsed.exportedAt,
        dryRun,
      });
      this.accumulate(counters, report);
      done += slice.length;
      if (opts.onProgress) await opts.onProgress({ processedRecords: done, counters });
    }
    return this.summarise(prepared, counters, dryRun);
  }

  private parse(format: PeopleImportFormat, content: string): IParsedExport {
    try {
      return format === 'csv' ? parseExportCsv(content) : parseExportJson(content);
    } catch (e) {
      if (e instanceof PeopleExportFormatError) {
        throw new BusinessException(e.message, e.code, HttpStatus.BAD_REQUEST, e.details);
      }
      throw e;
    }
  }

  private accumulate(c: IImportCounters, report: IIngestionReport): void {
    c.created += report.created;
    c.updated += report.updated;
    c.unchanged += report.unchanged;
    c.valid += report.valid;
    c.quarantined += report.quarantined;
    if (report.source) c.source = report.source;
    if (report.observations) {
      c.observations = c.observations ?? { recorded: 0, duplicate: 0, notRecorded: 0 };
      c.observations.recorded += report.observations.recorded;
      c.observations.duplicate += report.observations.duplicate;
      c.observations.notRecorded += report.observations.notRecorded;
    }
    for (const r of report.results) {
      const codes = new Set((r.reasons ?? []).map((x) => x.code));
      for (const code of codes) c.reasonCounts[code] = (c.reasonCounts[code] ?? 0) + 1; // once per record
      if (codes.has('BUSINESS_NOT_FOUND')) c.unmatched++;
      if (codes.has('AMBIGUOUS_COMPANY_MATCH')) c.ambiguous++;
    }
  }

  private summarise(prepared: IPreparedImport, c: IImportCounters, dryRun: boolean): IPeopleImportResult {
    const reasonCounts: Record<string, number> = { ...c.reasonCounts };
    for (const r of prepared.rejected) reasonCounts[r.code] = (reasonCounts[r.code] ?? 0) + 1;
    const issues = c.quarantined + prepared.rejected.length;
    const reconciliation = buildReconciliation({
      totalRows: prepared.totalRows, failed: prepared.rejected.length, imported: c.created, updated: c.updated, unchanged: c.unchanged,
      valid: c.valid, quarantined: c.quarantined,
    });
    return {
      batchRef: prepared.batchRef,
      status: dryRun ? 'DRY_RUN' : issues ? 'COMPLETED_WITH_ISSUES' : 'COMPLETED',
      dryRun,
      exportVersion: prepared.parsed.exportVersion,
      acquiredAt: prepared.parsed.exportedAt.toISOString(),
      source: c.source,
      totalRows: prepared.totalRows,
      matched: c.created + c.updated + c.unchanged + c.valid,
      unmatched: c.unmatched,
      ambiguous: c.ambiguous,
      imported: c.created,
      updated: c.updated,
      unchanged: c.unchanged,
      valid: c.valid,
      quarantined: c.quarantined,
      failed: prepared.rejected.length,
      reasonCounts,
      rejectedRows: prepared.rejected.slice(0, MAX_LISTED_REJECTIONS),
      observations: c.observations,
      reconciliation,
    };
  }
}

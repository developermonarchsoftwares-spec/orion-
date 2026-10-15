import { createHash, randomUUID } from 'crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { BusinessException } from '../../../../common/errors/business.exception';
import { PeopleExportImportService } from '../people-export-import.service';
import { IPeopleImportBundleRef, IPeopleImportJobView, PeopleImportJobService } from '../people-import-job.service';
import { BUNDLE_LIMITS, BundleError, BundleFormat, IBundleManifest, MANIFEST_NAME, parseManifest } from './people-bundle.manifest';
import { readZip, ZipFormatError } from './safe-zip';

/** A bundle that passed every structural check; `content` is the part text, held in memory only until it is queued. */
export interface IValidatedBundle {
  manifest: IBundleManifest;
  parts: Array<{ partNumber: number; filename: string; rowCount: number; bytes: number; content: string }>;
}

/** What validation tells the admin: metadata only. */
export interface IBundleSummary {
  valid: true;
  bundleId: string;
  format: BundleFormat;
  exportedAt: string;
  partCount: number;
  totalRows: number;
  maxPartRows: number;
  parts: Array<{ partNumber: number; filename: string; rowCount: number; bytes: number }>;
}

export interface IBundleAccepted {
  bundleImportId: string;
  bundleId: string;
  dryRun: boolean;
  format: BundleFormat;
  partCount: number;
  totalRows: number;
  parts: Array<{ partNumber: number; filename: string; jobId: string; batchRef: string; totalRows: number }>;
}

export type BundlePartStatus = IPeopleImportJobView['status'] | 'NOT_QUEUED';
export type BundleStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'COMPLETED_WITH_ISSUES' | 'DRY_RUN' | 'FAILED';

export interface IBundlePartView {
  partNumber: number;
  filename: string;
  status: BundlePartStatus;
  /** Rows the manifest promises for this part. */
  expectedRows: number;
  /** Used only to open the part's own import job; the screen does not display it. */
  jobId: string | null;
  /** The part's run id (content-derived); the same file always gets the same one. */
  batchRef: string | null;
  totalRows: number;
  processedRows: number;
  imported: number;
  updated: number;
  unchanged: number;
  valid: number;
  quarantined: number;
  /** Rows refused before ingestion (no / invalid / repeated relationship_id, malformed company identifier). */
  rejected: number;
  /** Rows of this part with no outcome (not reached by a failed job, or still to be processed). */
  notProcessed: number;
  errorSummary: string | null;
}

export interface IBundleView {
  bundleImportId: string;
  bundleId: string;
  format: BundleFormat;
  exportedAt: string;
  dryRun: boolean;
  status: BundleStatus;
  /** When the first part was queued, and when the last part finished (null while anything is unfinished). */
  importedAt: string;
  completedAt: string | null;
  partCount: number;
  completedParts: number;
  failedParts: number[];
  pendingParts: number[];
  notImportedParts: number[];
  parts: IBundlePartView[];
  reconciliation: {
    manifest: { totalRows: number; parts: number };
    orion: {
      totalRows: number;
      parts: number;
      completedParts: number;
      imported: number;
      updated: number;
      unchanged: number;
      valid: number;
      quarantined: number;
      rejected: number;
      /** Rows in failed parts that were not processed, plus all rows of parts that were never queued. */
      failed: number;
      /** Rows of parts that are still queued or running. */
      pending: number;
    };
    /** True only when every part finished and every manifest row has exactly one outcome. */
    balanced: boolean;
  };
}

const FINISHED = ['COMPLETED', 'COMPLETED_WITH_ISSUES', 'DRY_RUN'] as const;
const PENDING = ['QUEUED', 'RUNNING'] as const;
const STRICT_BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Pipeline bundle import (Phase 9D): an orchestration layer ONLY. It checks the ZIP and manifest, then hands every part, in manifest
 * order, to the existing People import job (PeopleImportJobService -> PeopleExportImportService -> PeopleIngestionService), unchanged:
 * company matching, identity resolution, deduplication, quarantine, evidence, review state and idempotency are all the existing ones.
 * It adds no table and no queue: the bundle reference rides in each part job's payload, and the aggregate view is built from those jobs.
 */
@Injectable()
export class PeopleBundleImportService {
  constructor(
    private readonly importer: PeopleExportImportService,
    private readonly jobs: PeopleImportJobService,
  ) {}

  // ----------------------------------------------------------------------------------------------------- validation
  /** Everything that can be checked without importing: ZIP, manifest, member list, and every part's bytes, hash and rows. */
  validate(contentBase64: string): IValidatedBundle {
    if (typeof contentBase64 === 'string' && contentBase64.length > Math.ceil(BUNDLE_LIMITS.MAX_ZIP_BYTES / 3) * 4) {
      throw new BundleError('BUNDLE_TOO_LARGE', 'The bundle is larger than the allowed size', HttpStatus.PAYLOAD_TOO_LARGE);
    }
    if (typeof contentBase64 !== 'string' || contentBase64.length === 0 || contentBase64.length % 4 !== 0 || !STRICT_BASE64.test(contentBase64)) {
      throw new BundleError('BUNDLE_NOT_BASE64', 'The bundle must be sent as base64');
    }
    const zip = Buffer.from(contentBase64, 'base64');
    if (zip.length > BUNDLE_LIMITS.MAX_ZIP_BYTES) {
      throw new BundleError('BUNDLE_TOO_LARGE', 'The bundle is larger than the allowed size', HttpStatus.PAYLOAD_TOO_LARGE);
    }

    let entries;
    try {
      entries = readZip(zip, {
        maxZipBytes: BUNDLE_LIMITS.MAX_ZIP_BYTES,
        maxEntries: BUNDLE_LIMITS.MAX_PARTS + 1,
        maxEntryBytes: (name) => (name === MANIFEST_NAME ? BUNDLE_LIMITS.MAX_MANIFEST_BYTES : BUNDLE_LIMITS.MAX_PART_BYTES),
        maxTotalBytes: BUNDLE_LIMITS.MAX_TOTAL_BYTES,
      });
    } catch (e) {
      if (e instanceof ZipFormatError) {
        throw new BundleError(`BUNDLE_${e.code}`, e.message, e.code === 'ZIP_TOO_LARGE' || e.code === 'ZIP_TOO_MANY_ENTRIES' ? HttpStatus.PAYLOAD_TOO_LARGE : HttpStatus.BAD_REQUEST);
      }
      throw e;
    }

    const at = entries.findIndex((x) => x.name === MANIFEST_NAME);
    if (at < 0) throw new BundleError('BUNDLE_MANIFEST_MISSING', 'The archive has no manifest.json');
    if (at !== 0) throw new BundleError('BUNDLE_MANIFEST_NOT_FIRST', 'manifest.json must be the first entry of the archive');
    const manifest = parseManifest(entries[0].data);

    const members = entries.slice(1);
    const wanted = manifest.parts.map((p) => p.filename);
    const present = new Set(members.map((x) => x.name));
    const unexpected = members.filter((x) => !wanted.includes(x.name));
    if (unexpected.length) throw new BundleError('BUNDLE_UNEXPECTED_ENTRY', 'The archive contains entries that are not listed in the manifest', HttpStatus.BAD_REQUEST, { count: unexpected.length });
    const missing = manifest.parts.find((p) => !present.has(p.filename));
    if (missing) throw new BundleError('BUNDLE_PART_MISSING', 'A part listed in the manifest is not in the archive', HttpStatus.BAD_REQUEST, { partNumber: missing.part_number });
    if (members.some((x, i) => x.name !== wanted[i])) throw new BundleError('BUNDLE_PART_ORDER_MISMATCH', 'The archive entries are not in the manifest order');
    if (manifest.part_count === 0) throw new BundleError('BUNDLE_EMPTY', 'The bundle has no parts, so there is nothing to import');

    const exportedAtMs = Date.parse(manifest.exported_at);
    const parts: IValidatedBundle['parts'] = [];
    manifest.parts.forEach((p, i) => {
      const where = { partNumber: p.part_number };
      const bytes = members[i].data;
      if (bytes.length !== p.bytes) throw new BundleError('BUNDLE_PART_BYTES_MISMATCH', 'A part does not have the byte length the manifest states', HttpStatus.BAD_REQUEST, where);
      if (createHash('sha256').update(bytes).digest('hex') !== p.sha256) {
        throw new BundleError('BUNDLE_PART_HASH_MISMATCH', 'A part does not match the SHA-256 the manifest states', HttpStatus.BAD_REQUEST, where);
      }
      let content: string;
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        throw new BundleError('BUNDLE_PART_INVALID', 'A part is not valid UTF-8 text', HttpStatus.BAD_REQUEST, { ...where, partCode: 'MALFORMED_ENCODING' });
      }
      let prepared;
      try {
        prepared = this.importer.prepare(manifest.format, content); // the existing People export validation: columns, version, rows, limits
      } catch (e) {
        if (e instanceof BusinessException) {
          throw new BundleError('BUNDLE_PART_INVALID', 'A part is not a valid People Pipeline export', HttpStatus.BAD_REQUEST, { ...where, partCode: e.errorCode });
        }
        throw e;
      }
      if (prepared.totalRows !== p.row_count) throw new BundleError('BUNDLE_PART_ROWS_MISMATCH', 'A part does not have the row count the manifest states', HttpStatus.BAD_REQUEST, where);
      if (prepared.totalRows > manifest.max_part_rows) throw new BundleError('BUNDLE_PART_ROWS_MISMATCH', 'A part has more rows than the manifest allows per part', HttpStatus.BAD_REQUEST, where);
      if (prepared.parsed.exportedAt.getTime() !== exportedAtMs) {
        throw new BundleError('BUNDLE_PART_EXPORT_MISMATCH', 'A part was exported at a different time than the manifest states', HttpStatus.BAD_REQUEST, where);
      }
      parts.push({ partNumber: p.part_number, filename: p.filename, rowCount: p.row_count, bytes: p.bytes, content });
    });
    return { manifest, parts };
  }

  summary(v: IValidatedBundle): IBundleSummary {
    return {
      valid: true,
      bundleId: v.manifest.bundle_id,
      format: v.manifest.format,
      exportedAt: new Date(v.manifest.exported_at).toISOString(),
      partCount: v.manifest.part_count,
      totalRows: v.manifest.total_rows,
      maxPartRows: v.manifest.max_part_rows,
      parts: v.parts.map((p) => ({ partNumber: p.partNumber, filename: p.filename, rowCount: p.rowCount, bytes: p.bytes })),
    };
  }

  // ------------------------------------------------------------------------------------------------------ import
  /**
   * Validates the whole bundle (nothing is queued if anything is wrong), then queues every part in manifest order as a normal People
   * import job. A bundle already imported can be imported again: nothing here blocks it, the record-level idempotency of the import does.
   */
  async enqueue(input: { content: string; dryRun?: boolean; requestedBy?: string }): Promise<IBundleAccepted> {
    const v = this.validate(input.content);
    const dryRun = input.dryRun === true;
    const bundleImportId = randomUUID();
    const queued: IBundleAccepted['parts'] = [];
    for (const part of v.parts) {
      const bundle: IPeopleImportBundleRef = {
        bundleImportId,
        bundleId: v.manifest.bundle_id,
        format: v.manifest.format,
        exportedAt: new Date(v.manifest.exported_at).toISOString(),
        partNumber: part.partNumber,
        partCount: v.manifest.part_count,
        filename: part.filename,
        manifestTotalRows: v.manifest.total_rows,
        manifestPartRows: part.rowCount,
      };
      try {
        const a = await this.jobs.enqueue({ format: v.manifest.format, content: part.content, dryRun, requestedBy: input.requestedBy, bundle });
        queued.push({ partNumber: part.partNumber, filename: part.filename, jobId: a.jobId, batchRef: a.batchRef, totalRows: a.totalRows });
      } catch (e) {
        if (e instanceof BusinessException && (e.errorCode === 'IMPORT_STORAGE_UNAVAILABLE' || e.errorCode === 'IMPORT_QUEUE_UNAVAILABLE')) {
          // earlier parts are already queued and will import; the aggregate view reports the rest as "not imported"
          throw new BundleError(
            'BUNDLE_ENQUEUE_INCOMPLETE',
            'The bundle could not be fully queued. Parts already queued will import; import the same bundle again to complete it.',
            HttpStatus.SERVICE_UNAVAILABLE,
            { bundleImportId, queuedParts: queued.length, partCount: v.manifest.part_count },
          );
        }
        throw e;
      }
    }
    return {
      bundleImportId,
      bundleId: v.manifest.bundle_id,
      dryRun,
      format: v.manifest.format,
      partCount: v.manifest.part_count,
      totalRows: v.manifest.total_rows,
      parts: queued,
    };
  }

  // -------------------------------------------------------------------------------------------------- aggregate
  async getBundle(bundleImportId: string): Promise<IBundleView> {
    const jobs = await this.jobs.getBundleJobs(bundleImportId);
    const ref = jobs.find((j) => j.bundle)?.bundle;
    if (!ref) throw new BundleError('BUNDLE_IMPORT_NOT_FOUND', 'Bundle import not found', HttpStatus.NOT_FOUND);
    return this.aggregate(ref.bundleImportId, jobs);
  }

  /** Pure over the part jobs: the aggregate status and the manifest-vs-Orion reconciliation. */
  aggregate(bundleImportId: string, jobs: IPeopleImportJobView[]): IBundleView {
    const ref = jobs.find((j) => j.bundle)!.bundle!;
    const byPart = new Map(jobs.map((j) => [j.bundle!.partNumber, j]));
    const parts: IBundlePartView[] = [];
    for (let n = 1; n <= ref.partCount; n++) {
      const j = byPart.get(n);
      if (!j) {
        parts.push({ partNumber: n, filename: '', status: 'NOT_QUEUED', expectedRows: 0, jobId: null, batchRef: null, totalRows: 0, processedRows: 0, imported: 0, updated: 0, unchanged: 0, valid: 0, quarantined: 0, rejected: 0, notProcessed: 0, errorSummary: null });
        continue;
      }
      parts.push({
        partNumber: n,
        filename: j.bundle!.filename,
        status: j.status,
        expectedRows: j.bundle!.manifestPartRows,
        jobId: j.jobId,
        batchRef: j.batchRef,
        totalRows: j.totalRows,
        processedRows: j.processedRows,
        imported: j.imported,
        updated: j.updated,
        unchanged: j.unchanged,
        valid: j.valid,
        quarantined: j.quarantined,
        rejected: j.failed,
        notProcessed: j.reconciliation.unaccounted,
        errorSummary: j.errorSummary,
      });
    }
    // part rows are only known for a part that was queued; a part that never was is promised by the manifest
    const known = parts.filter((p) => p.status !== 'NOT_QUEUED').reduce((s, p) => s + p.expectedRows, 0);
    const missingRows = Math.max(0, ref.manifestTotalRows - known);

    const queuedParts = parts.filter((p) => p.status !== 'NOT_QUEUED');
    const finished = queuedParts.filter((p) => (FINISHED as readonly string[]).includes(p.status));
    const failed = queuedParts.filter((p) => p.status === 'FAILED');
    const pending = queuedParts.filter((p) => (PENDING as readonly string[]).includes(p.status));
    const notQueued = parts.filter((p) => p.status === 'NOT_QUEUED');
    const sum = (k: 'imported' | 'updated' | 'unchanged' | 'valid' | 'quarantined' | 'rejected') => queuedParts.reduce((s, p) => s + p[k], 0);
    const dryRun = jobs.every((j) => j.dryRun);

    let status: BundleStatus;
    if (pending.length) status = pending.some((p) => p.status === 'RUNNING') || finished.length || failed.length ? 'RUNNING' : 'QUEUED';
    else if (failed.length || notQueued.length) status = 'FAILED';
    else if (queuedParts.some((p) => p.status === 'COMPLETED_WITH_ISSUES')) status = 'COMPLETED_WITH_ISSUES';
    else status = dryRun ? 'DRY_RUN' : 'COMPLETED';

    const orion = {
      totalRows: queuedParts.reduce((s, p) => s + p.totalRows, 0),
      parts: queuedParts.length,
      completedParts: finished.length,
      imported: sum('imported'),
      updated: sum('updated'),
      unchanged: sum('unchanged'),
      valid: sum('valid'),
      quarantined: sum('quarantined'),
      rejected: sum('rejected'),
      failed: failed.reduce((s, p) => s + p.notProcessed, 0) + missingRows,
      pending: pending.reduce((s, p) => s + p.notProcessed, 0),
    };
    const outcomes = orion.imported + orion.updated + orion.unchanged + orion.valid + orion.quarantined + orion.rejected;
    const created = jobs.map((j) => Date.parse(j.createdAt)).filter((t) => !Number.isNaN(t));
    return {
      bundleImportId,
      bundleId: ref.bundleId,
      format: ref.format,
      exportedAt: ref.exportedAt,
      dryRun,
      status,
      importedAt: new Date(Math.min(...created)).toISOString(),
      completedAt: pending.length ? null : new Date(Math.max(...jobs.map((j) => Date.parse(j.completedAt ?? j.updatedAt)))).toISOString(),
      partCount: ref.partCount,
      completedParts: finished.length,
      failedParts: failed.map((p) => p.partNumber),
      pendingParts: pending.map((p) => p.partNumber),
      notImportedParts: notQueued.map((p) => p.partNumber),
      parts,
      reconciliation: {
        manifest: { totalRows: ref.manifestTotalRows, parts: ref.partCount },
        orion,
        balanced: finished.length === ref.partCount && orion.failed === 0 && orion.pending === 0 && outcomes === ref.manifestTotalRows,
      },
    };
  }
}

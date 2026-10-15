/**
 * People export import (admin): the pure logic behind the "People Import" screen. No React, no DOM, no network of its own: the
 * screen hands in a `request` function, so every rule here is testable.
 *
 * What the screen may show is decided HERE, not in the component: `toImportJob` keeps an allow-list of counts, codes and
 * timestamps from whatever the API returns. A name, e-mail, phone, LinkedIn URL, row, file content, hash, storage key or any other
 * field simply cannot reach the screen, even if an API response were to contain one.
 */

export const PEOPLE_IMPORT_MAX_FILE_BYTES = 15 * 1024 * 1024;
export const PEOPLE_IMPORT_MAX_ROWS = 10_000;
export const PEOPLE_IMPORT_BASE = '/admin/people/import';

export type ImportFormat = 'csv' | 'json';
export type ImportStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'COMPLETED_WITH_ISSUES' | 'DRY_RUN' | 'FAILED';

export const IMPORT_STATUSES: readonly ImportStatus[] = ['QUEUED', 'RUNNING', 'COMPLETED', 'COMPLETED_WITH_ISSUES', 'DRY_RUN', 'FAILED'];
export const TERMINAL_STATUSES: readonly ImportStatus[] = ['COMPLETED', 'COMPLETED_WITH_ISSUES', 'DRY_RUN', 'FAILED'];

export interface ImportJob {
  /** Used only to poll and reopen a job; never displayed. */
  jobId: string;
  status: ImportStatus;
  dryRun: boolean;
  totalRows: number;
  processedRows: number;
  imported: number;
  updated: number;
  unchanged: number;
  valid: number;
  quarantined: number;
  /** Rows rejected before ingestion. */
  failed: number;
  matched: number;
  unmatched: number;
  ambiguous: number;
  reasonCounts: Record<string, number>;
  rejectedRows: Array<{ row: number; code: string }>;
  errorSummary: string | null;
  createdAt: string | null;
  completedAt: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Z0-9_]{1,60}$/;
export const isJobId = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
export const isTerminal = (s: ImportStatus): boolean => (TERMINAL_STATUSES as readonly string[]).includes(s);

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const iso = (v: unknown): string | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);

/** Allow-list projection of an API job object; null when it is not a job at all. */
export function toImportJob(raw: unknown): ImportJob | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isJobId(r.jobId) || !(IMPORT_STATUSES as readonly unknown[]).includes(r.status)) return null;
  const reasonCounts: Record<string, number> = {};
  if (r.reasonCounts && typeof r.reasonCounts === 'object') {
    for (const [code, n] of Object.entries(r.reasonCounts as Record<string, unknown>)) {
      if (CODE.test(code) && typeof n === 'number') reasonCounts[code] = count(n);
    }
  }
  const rejectedRows: Array<{ row: number; code: string }> = [];
  if (Array.isArray(r.rejectedRows)) {
    for (const x of r.rejectedRows.slice(0, 50)) {
      const o = x as Record<string, unknown>;
      if (o && typeof o.row === 'number' && typeof o.code === 'string' && CODE.test(o.code)) rejectedRows.push({ row: count(o.row), code: o.code });
    }
  }
  const summary = typeof r.errorSummary === 'string' ? r.errorSummary.trim().slice(0, 200) : '';
  return {
    jobId: r.jobId,
    status: r.status as ImportStatus,
    dryRun: r.dryRun === true,
    totalRows: count(r.totalRows),
    processedRows: count(r.processedRows),
    imported: count(r.imported),
    updated: count(r.updated),
    unchanged: count(r.unchanged),
    valid: count(r.valid),
    quarantined: count(r.quarantined),
    failed: count(r.failed),
    matched: count(r.matched),
    unmatched: count(r.unmatched),
    ambiguous: count(r.ambiguous),
    reasonCounts,
    rejectedRows,
    errorSummary: summary || null,
    createdAt: iso(r.createdAt),
    completedAt: iso(r.completedAt),
  };
}

// --------------------------------------------------------------------------------------------------------------- file
export function detectFormat(fileName: string): ImportFormat | null {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(fileName ?? '').trim());
  const ext = m ? m[1].toLowerCase() : '';
  return ext === 'csv' ? 'csv' : ext === 'json' ? 'json' : null;
}

/** A message when the chosen file cannot be imported, else null. Checked before anything is read or sent. */
export function validateFile(file: { name: string; size: number } | null | undefined): string | null {
  if (!file) return 'Choose the People export file (CSV or JSON).';
  if (!detectFormat(file.name)) return 'Only CSV and JSON files can be imported.';
  if (file.size <= 0) return 'The file is empty.';
  if (file.size > PEOPLE_IMPORT_MAX_FILE_BYTES) return 'The file is larger than 15 MB.';
  return null;
}

// -------------------------------------------------------------------------------------------------------------- errors
export class ImportApiError extends Error {
  status: number;
  code: string | null;
  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const CODE_MESSAGES: Record<string, string> = {
  MISSING_COLUMNS: 'The file is not a People Pipeline export: required columns are missing.',
  DUPLICATE_HEADERS: 'The file is not a People Pipeline export: a column is repeated.',
  UNSUPPORTED_EXPORT_VERSION: 'This export version is not supported (version 1 is expected).',
  MALFORMED_CSV: 'The CSV file is malformed.',
  MALFORMED_JSON: 'The JSON file is malformed.',
  INVALID_EXPORTED_AT: 'The export timestamp in the file is not valid.',
  RECORD_COUNT_MISMATCH: 'The record count in the file does not match its contents.',
  INCONSISTENT_ENVELOPE: 'The export header values differ between rows.',
  EMPTY_EXPORT: 'The file has no rows.',
  INVALID_FIELD_TYPE: 'The file contains a value of the wrong type.',
  BATCH_TOO_LARGE: `The file has more than ${PEOPLE_IMPORT_MAX_ROWS.toLocaleString('en-US')} rows. Split the export and import it in parts.`,
  IMPORT_STORAGE_UNAVAILABLE: 'The import service could not stage the file. Nothing was imported. Try again shortly.',
  IMPORT_QUEUE_UNAVAILABLE: 'The import queue is unavailable. Nothing was imported. Try again shortly.',
  IMPORT_JOB_NOT_FOUND: 'This import is no longer available.',
  // Pipeline bundle (ZIP) import: fixed sentences by machine code, never the response text
  BUNDLE_NOT_BASE64: 'The bundle could not be read.',
  BUNDLE_TOO_LARGE: 'The bundle is too large to import.',
  BUNDLE_ZIP_MALFORMED: 'The file is not a valid ZIP archive.',
  BUNDLE_ZIP_UNSUPPORTED: 'This kind of ZIP archive is not supported.',
  BUNDLE_ZIP_UNSAFE_PATH: 'The archive contains an entry with an unsafe name, so it was rejected.',
  BUNDLE_ZIP_DUPLICATE_ENTRY: 'The archive contains the same entry twice, so it was rejected.',
  BUNDLE_ZIP_TOO_MANY_ENTRIES: 'The archive has too many entries.',
  BUNDLE_ZIP_TOO_LARGE: 'The archive expands beyond the allowed size.',
  BUNDLE_ZIP_CORRUPT: 'The archive is damaged.',
  BUNDLE_MANIFEST_MISSING: 'The archive has no manifest.json. It is not a People Pipeline bundle.',
  BUNDLE_MANIFEST_NOT_FIRST: 'manifest.json must be the first entry of the archive.',
  BUNDLE_MANIFEST_MALFORMED: 'manifest.json is not a valid People Pipeline manifest.',
  BUNDLE_UNSUPPORTED_EXPORT_VERSION: 'This bundle version is not supported (version 1 is expected).',
  BUNDLE_UNSUPPORTED_FORMAT: 'The bundle format is not supported (CSV or JSON parts are expected).',
  BUNDLE_TOO_MANY_PARTS: 'The bundle has too many parts.',
  BUNDLE_PART_COUNT_MISMATCH: 'The part count in the manifest does not match the parts listed.',
  BUNDLE_TOTAL_ROWS_MISMATCH: 'The total row count in the manifest does not match its parts.',
  BUNDLE_PART_MISSING: 'A part listed in the manifest is missing from the archive.',
  BUNDLE_UNEXPECTED_ENTRY: 'The archive contains files that are not listed in the manifest.',
  BUNDLE_PART_ORDER_MISMATCH: 'The parts are not in the order the manifest lists.',
  BUNDLE_PART_BYTES_MISMATCH: 'A part does not have the size the manifest states.',
  BUNDLE_PART_HASH_MISMATCH: 'A part does not match its checksum: the bundle was modified or damaged.',
  BUNDLE_PART_ROWS_MISMATCH: 'A part does not have the number of rows the manifest states.',
  BUNDLE_PART_EXPORT_MISMATCH: 'A part was exported at a different time than the manifest states.',
  BUNDLE_PART_INVALID: 'A part is not a valid People Pipeline export.',
  BUNDLE_EMPTY: 'The bundle has no parts, so there is nothing to import.',
  BUNDLE_ENQUEUE_INCOMPLETE: 'The bundle could not be fully queued. Parts already queued will import. Import the same bundle again to complete it.',
  BUNDLE_IMPORT_NOT_FOUND: 'This bundle import is no longer available.',
};

/** What an admin sees for a failed request: derived from the status and the machine code only, never from the response text. */
export function describeFailure(status: number, body: unknown): string {
  const code = body && typeof body === 'object' && typeof (body as Record<string, unknown>).errorCode === 'string' ? ((body as Record<string, string>).errorCode) : null;
  if (code && Object.prototype.hasOwnProperty.call(CODE_MESSAGES, code)) {
    // a bundle problem that concerns one part names it (the number only, taken from the structured details)
    const part = (body as { details?: { partNumber?: unknown } }).details?.partNumber;
    return typeof part === 'number' && Number.isInteger(part) && part > 0 && code.startsWith('BUNDLE_') ? `${CODE_MESSAGES[code]} (part ${part})` : CODE_MESSAGES[code];
  }
  if (status === 0) return 'Could not reach the server. Check your connection and try again.';
  if (status === 400) return 'The file was rejected as invalid. Check that it is an unmodified People export.';
  if (status === 401) return 'Your admin session has expired. Sign in again.';
  if (status === 403) return 'You do not have permission to import People.';
  if (status === 404) return 'This import is no longer available.';
  if (status === 413) return 'The file is too large to import.';
  if (status === 503) return 'The import service is temporarily unavailable. Nothing was imported. Try again shortly.';
  return 'The request failed. Try again.';
}

// ------------------------------------------------------------------------------------------------------------ requests
export interface ImportResponse {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- parsed JSON of an API response
}
export type ImportRequest = (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<ImportResponse>;

async function send(request: ImportRequest, method: 'GET' | 'POST', path: string, body?: unknown): Promise<ImportResponse> {
  let res: ImportResponse;
  try {
    res = await request(method, path, body);
  } catch {
    throw new ImportApiError(0, null, describeFailure(0, null));
  }
  if (res.status < 200 || res.status >= 300) {
    const code = res.body && typeof res.body.errorCode === 'string' ? res.body.errorCode : null;
    throw new ImportApiError(res.status, code, describeFailure(res.status, res.body));
  }
  return res;
}

/** Validate-and-queue. The file text is sent exactly once, in the body of this request. */
export async function submitImport(request: ImportRequest, input: { format: ImportFormat; content: string; dryRun: boolean }): Promise<{ jobId: string; dryRun: boolean; totalRows: number }> {
  const res = await send(request, 'POST', PEOPLE_IMPORT_BASE, { format: input.format, content: input.content, dryRun: input.dryRun });
  const d = res.body?.data ?? res.body;
  if (!d || !isJobId(d.jobId)) throw new ImportApiError(res.status, null, 'The import service returned an unexpected answer.');
  return { jobId: d.jobId, dryRun: d.dryRun === true, totalRows: count(d.totalRows) };
}

export async function fetchJob(request: ImportRequest, jobId: string): Promise<ImportJob> {
  if (!isJobId(jobId)) throw new ImportApiError(404, 'IMPORT_JOB_NOT_FOUND', describeFailure(404, null));
  const res = await send(request, 'GET', `${PEOPLE_IMPORT_BASE}/${jobId}`);
  const job = toImportJob(res.body?.data ?? res.body);
  if (!job) throw new ImportApiError(res.status, null, 'The import service returned an unexpected answer.');
  return job;
}

export interface ImportHistory {
  items: ImportJob[];
  page: number;
  totalPages: number;
  totalItems: number;
}

export async function fetchHistory(request: ImportRequest, page = 1, limit = 10): Promise<ImportHistory> {
  const res = await send(request, 'GET', `${PEOPLE_IMPORT_BASE}?page=${Math.max(1, Math.floor(page))}&limit=${Math.min(100, Math.max(1, Math.floor(limit)))}`);
  const list = Array.isArray(res.body?.data) ? res.body.data : [];
  const p = res.body?.pagination ?? {};
  return {
    items: list.map(toImportJob).filter((j: ImportJob | null): j is ImportJob => j !== null),
    page: count(p.page) || 1,
    totalPages: count(p.totalPages) || 1,
    totalItems: count(p.totalItems),
  };
}

// -------------------------------------------------------------------------------------------------------------- polling
/** Conservative: quick at first, then every 5 seconds. */
export const POLL_DELAYS_MS = [1000, 1000, 2000, 2000, 3000, 5000];
export const pollDelay = (attempt: number): number => POLL_DELAYS_MS[Math.min(Math.max(0, attempt), POLL_DELAYS_MS.length - 1)];

export interface PollOptions {
  onUpdate: (job: ImportJob) => void;
  sleep?: (ms: number) => Promise<void>;
  /** Return true to stop quietly (the screen was closed or another job was opened). */
  shouldStop?: () => boolean;
  maxPolls?: number;
  maxConsecutiveErrors?: number;
}
export type PollOutcome =
  | { reason: 'terminal'; job: ImportJob }
  | { reason: 'stopped'; job: ImportJob | null }
  | { reason: 'max'; job: ImportJob | null }
  | { reason: 'error'; job: ImportJob | null; error: ImportApiError };

/**
 * Polls one job until it reaches a terminal status. Transient failures (network, 5xx) are retried a few times; a lost session or a
 * vanished job stops at once. The job is delivered through `onUpdate` on every successful poll, including the terminal one.
 */
export async function pollImportJob(load: (jobId: string) => Promise<ImportJob>, jobId: string, opts: PollOptions): Promise<PollOutcome> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxPolls = opts.maxPolls ?? 2000;
  const maxErrors = opts.maxConsecutiveErrors ?? 5;
  let last: ImportJob | null = null;
  let errors = 0;
  for (let attempt = 0; attempt < maxPolls; attempt++) {
    if (opts.shouldStop?.()) return { reason: 'stopped', job: last };
    try {
      last = await load(jobId);
      errors = 0;
      if (opts.shouldStop?.()) return { reason: 'stopped', job: last };
      opts.onUpdate(last);
      if (isTerminal(last.status)) return { reason: 'terminal', job: last };
    } catch (e) {
      const err = e instanceof ImportApiError ? e : new ImportApiError(0, null, describeFailure(0, null));
      const fatal = err.status === 401 || err.status === 403 || err.status === 404 || err.status === 400;
      if (fatal || ++errors >= maxErrors) return { reason: 'error', job: last, error: err };
    }
    await sleep(pollDelay(attempt));
  }
  return { reason: 'max', job: last };
}

// ------------------------------------------------------------------------------------------------------ reload / resume
export const ACTIVE_JOB_KEY = 'orion_people_import_active_job';
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
/** Only the job reference is kept (in session storage), so a reload can pick the job up again; never file content. */
export function rememberActiveJob(store: KeyValueStore | null | undefined, jobId: string): void {
  try {
    if (store && isJobId(jobId)) store.setItem(ACTIVE_JOB_KEY, jobId);
  } catch {
    /* storage unavailable: the job still runs, it just cannot be resumed after a reload */
  }
}
export function recallActiveJob(store: KeyValueStore | null | undefined): string | null {
  try {
    const v = store?.getItem(ACTIVE_JOB_KEY) ?? null;
    return isJobId(v) ? v : null;
  } catch {
    return null;
  }
}
export function forgetActiveJob(store: KeyValueStore | null | undefined): void {
  try {
    store?.removeItem(ACTIVE_JOB_KEY);
  } catch {
    /* nothing to do */
  }
}

// -------------------------------------------------------------------------------------------------------- presentation
export const STATUS_LABELS: Record<ImportStatus, string> = {
  QUEUED: 'Queued',
  RUNNING: 'Running',
  COMPLETED: 'Completed',
  COMPLETED_WITH_ISSUES: 'Completed with issues',
  DRY_RUN: 'Dry run complete',
  FAILED: 'Failed',
};

export function progressPercent(job: Pick<ImportJob, 'totalRows' | 'processedRows' | 'status'>): number {
  if (job.status === 'COMPLETED' || job.status === 'COMPLETED_WITH_ISSUES' || job.status === 'DRY_RUN') return 100;
  if (job.totalRows <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((job.processedRows / job.totalRows) * 100)));
}

export interface SummaryItem {
  label: string;
  value: string;
}

/** The counts the screen shows, in order. Dry-run jobs show "would be imported" instead of "imported". */
export function jobSummary(job: ImportJob): SummaryItem[] {
  const n = (v: number) => v.toLocaleString('en-US');
  const items: SummaryItem[] = [
    { label: 'Rows processed', value: `${n(job.processedRows)} of ${n(job.totalRows)}` },
    job.dryRun ? { label: 'Would be imported', value: n(job.valid) } : { label: 'Imported', value: n(job.imported) },
  ];
  if (!job.dryRun) {
    items.push({ label: 'Updated', value: n(job.updated) }, { label: 'Unchanged', value: n(job.unchanged) });
  }
  items.push(
    { label: 'Matched to a company', value: n(job.matched) },
    { label: 'Company not found', value: n(job.unmatched) },
    { label: 'Company ambiguous', value: n(job.ambiguous) },
    { label: 'Quarantined', value: n(job.quarantined) },
    { label: 'Rejected rows', value: n(job.failed) },
  );
  return items;
}

export const HISTORY_PAGE_SIZE = 10;

// ======================================================================================================================
// Pipeline bundle (ZIP) import, Phase 9D. Same rules as above: the screen shows only what these functions let through.
// ======================================================================================================================
export const BUNDLE_BASE = `${PEOPLE_IMPORT_BASE}/bundle`;
/**
 * What the screen accepts. The API itself takes a ZIP of up to 11 MiB, but the web gateway (Next.js) refuses any request body above
 * 10 MiB, and a ZIP travels as base64 inside JSON (4/3 larger), so only a ZIP of about 7.5 MiB or less can arrive. The screen stops at
 * 7 MiB, with a margin, and says so, instead of letting the gateway answer with a bare 413. (A real 50,000-row export is about 5.4 MB.)
 */
export const BUNDLE_MAX_ZIP_BYTES = 7 * 1024 * 1024;

export type BundlePartStatus = ImportStatus | 'NOT_QUEUED';
const PART_STATUSES: readonly BundlePartStatus[] = [...IMPORT_STATUSES, 'NOT_QUEUED'];
const PART_FILE = /^orion_published_people_\d{8}T\d{6}Z_[0-9a-f]{8}_part-\d{4}-of-\d{4}\.(csv|json)$/;
const BUNDLE_ID = /^\d{8}T\d{6}Z-[0-9a-f]{12}$/;
const RUN_REF = /^people-export-v1-[0-9a-f]{24}$/;

export interface BundleSummary {
  bundleId: string;
  format: ImportFormat;
  exportedAt: string | null;
  partCount: number;
  totalRows: number;
  maxPartRows: number;
  parts: Array<{ partNumber: number; filename: string; rowCount: number; bytes: number }>;
}

export interface BundlePart {
  partNumber: number;
  filename: string;
  status: BundlePartStatus;
  expectedRows: number;
  /** Used only to open the part's own import; never displayed. */
  jobId: string | null;
  /** The part's run reference (content-derived, no personal data). */
  runRef: string | null;
  totalRows: number;
  imported: number;
  updated: number;
  unchanged: number;
  valid: number;
  quarantined: number;
  rejected: number;
  notProcessed: number;
  errorSummary: string | null;
}

export interface BundleResult {
  /** Used only to poll and reopen the bundle import; never displayed. */
  bundleImportId: string;
  bundleId: string;
  format: ImportFormat;
  exportedAt: string | null;
  importedAt: string | null;
  completedAt: string | null;
  dryRun: boolean;
  status: ImportStatus;
  partCount: number;
  completedParts: number;
  failedParts: number[];
  pendingParts: number[];
  notImportedParts: number[];
  parts: BundlePart[];
  reconciliation: {
    manifest: { totalRows: number; parts: number };
    orion: { totalRows: number; parts: number; completedParts: number; imported: number; updated: number; unchanged: number; valid: number; quarantined: number; rejected: number; failed: number; pending: number };
    balanced: boolean;
  };
}

const partNumbers = (v: unknown): number[] => (Array.isArray(v) ? v.slice(0, 500).filter((n) => typeof n === 'number' && Number.isInteger(n) && n > 0) : []);
const formatOf = (v: unknown): ImportFormat | null => (v === 'csv' || v === 'json' ? v : null);

export function toBundleSummary(raw: unknown): BundleSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const format = formatOf(r.format);
  if (r.valid !== true || !format || typeof r.bundleId !== 'string' || !BUNDLE_ID.test(r.bundleId) || !Array.isArray(r.parts)) return null;
  const parts = r.parts.slice(0, 500).flatMap((p: unknown) => {
    const o = p as Record<string, unknown>;
    return o && typeof o.filename === 'string' && PART_FILE.test(o.filename) ? [{ partNumber: count(o.partNumber), filename: o.filename, rowCount: count(o.rowCount), bytes: count(o.bytes) }] : [];
  });
  return { bundleId: r.bundleId, format, exportedAt: iso(r.exportedAt), partCount: count(r.partCount), totalRows: count(r.totalRows), maxPartRows: count(r.maxPartRows), parts };
}

export function toBundleResult(raw: unknown): BundleResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const format = formatOf(r.format);
  if (!isJobId(r.bundleImportId) || !(IMPORT_STATUSES as readonly unknown[]).includes(r.status) || !format || typeof r.bundleId !== 'string' || !BUNDLE_ID.test(r.bundleId) || !Array.isArray(r.parts)) return null;
  const parts: BundlePart[] = r.parts.slice(0, 500).flatMap((p: unknown) => {
    const o = p as Record<string, unknown>;
    if (!o || !(PART_STATUSES as readonly unknown[]).includes(o.status)) return [];
    const summary = typeof o.errorSummary === 'string' ? o.errorSummary.trim().slice(0, 200) : '';
    return [{
      partNumber: count(o.partNumber),
      filename: typeof o.filename === 'string' && PART_FILE.test(o.filename) ? o.filename : '',
      status: o.status as BundlePartStatus,
      expectedRows: count(o.expectedRows),
      jobId: isJobId(o.jobId) ? o.jobId : null,
      runRef: typeof o.batchRef === 'string' && RUN_REF.test(o.batchRef) ? o.batchRef : null,
      totalRows: count(o.totalRows), imported: count(o.imported), updated: count(o.updated), unchanged: count(o.unchanged), valid: count(o.valid),
      quarantined: count(o.quarantined), rejected: count(o.rejected), notProcessed: count(o.notProcessed), errorSummary: summary || null,
    }];
  });
  const rec = (r.reconciliation ?? {}) as { manifest?: Record<string, unknown>; orion?: Record<string, unknown>; balanced?: unknown };
  const m = rec.manifest ?? {};
  const o = rec.orion ?? {};
  return {
    bundleImportId: r.bundleImportId,
    bundleId: r.bundleId,
    format,
    exportedAt: iso(r.exportedAt),
    importedAt: iso(r.importedAt),
    completedAt: iso(r.completedAt),
    dryRun: r.dryRun === true,
    status: r.status as ImportStatus,
    partCount: count(r.partCount),
    completedParts: count(r.completedParts),
    failedParts: partNumbers(r.failedParts),
    pendingParts: partNumbers(r.pendingParts),
    notImportedParts: partNumbers(r.notImportedParts),
    parts,
    reconciliation: {
      manifest: { totalRows: count(m.totalRows), parts: count(m.parts) },
      orion: {
        totalRows: count(o.totalRows), parts: count(o.parts), completedParts: count(o.completedParts), imported: count(o.imported), updated: count(o.updated),
        unchanged: count(o.unchanged), valid: count(o.valid), quarantined: count(o.quarantined), rejected: count(o.rejected), failed: count(o.failed), pending: count(o.pending),
      },
      balanced: rec.balanced === true,
    },
  };
}

/** A message when the chosen file cannot be a bundle, else null. Checked before anything is read or sent. */
export function validateBundleFile(file: { name: string; size: number } | null | undefined): string | null {
  if (!file) return 'Choose the People Pipeline bundle (a .zip file).';
  if (!/\.zip$/i.test(String(file.name ?? '').trim())) return 'Only a .zip bundle can be imported here.';
  if (file.size <= 0) return 'The file is empty.';
  if (file.size > BUNDLE_MAX_ZIP_BYTES) return 'The bundle is larger than 7 MB.';
  return null;
}

/** Base64 of raw bytes, in chunks (a spread over a large array would overflow the call stack). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export async function validateBundle(request: ImportRequest, contentBase64: string): Promise<BundleSummary> {
  const res = await send(request, 'POST', `${BUNDLE_BASE}/validate`, { content: contentBase64 });
  const summary = toBundleSummary(res.body?.data ?? res.body);
  if (!summary) throw new ImportApiError(res.status, null, 'The import service returned an unexpected answer.');
  return summary;
}

export async function submitBundle(request: ImportRequest, input: { content: string; dryRun: boolean }): Promise<{ bundleImportId: string; partCount: number; totalRows: number }> {
  const res = await send(request, 'POST', BUNDLE_BASE, { content: input.content, dryRun: input.dryRun });
  const d = res.body?.data ?? res.body;
  if (!d || !isJobId(d.bundleImportId)) throw new ImportApiError(res.status, null, 'The import service returned an unexpected answer.');
  return { bundleImportId: d.bundleImportId, partCount: count(d.partCount), totalRows: count(d.totalRows) };
}

export async function fetchBundle(request: ImportRequest, bundleImportId: string): Promise<BundleResult> {
  if (!isJobId(bundleImportId)) throw new ImportApiError(404, 'BUNDLE_IMPORT_NOT_FOUND', describeFailure(404, { errorCode: 'BUNDLE_IMPORT_NOT_FOUND' }));
  const res = await send(request, 'GET', `${BUNDLE_BASE}/${bundleImportId}`);
  const result = toBundleResult(res.body?.data ?? res.body);
  if (!result) throw new ImportApiError(res.status, null, 'The import service returned an unexpected answer.');
  return result;
}

export type BundlePollOutcome =
  | { reason: 'terminal'; bundle: BundleResult }
  | { reason: 'stopped'; bundle: BundleResult | null }
  | { reason: 'max'; bundle: BundleResult | null }
  | { reason: 'error'; bundle: BundleResult | null; error: ImportApiError };

/** Follows a bundle import until every part has finished: the same retry rules as `pollImportJob`. */
export async function pollBundle(
  load: (bundleImportId: string) => Promise<BundleResult>,
  bundleImportId: string,
  opts: { onUpdate: (b: BundleResult) => void; sleep?: (ms: number) => Promise<void>; shouldStop?: () => boolean; maxPolls?: number; maxConsecutiveErrors?: number },
): Promise<BundlePollOutcome> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxPolls = opts.maxPolls ?? 4000;
  const maxErrors = opts.maxConsecutiveErrors ?? 5;
  let last: BundleResult | null = null;
  let errors = 0;
  for (let attempt = 0; attempt < maxPolls; attempt++) {
    if (opts.shouldStop?.()) return { reason: 'stopped', bundle: last };
    try {
      last = await load(bundleImportId);
      errors = 0;
      if (opts.shouldStop?.()) return { reason: 'stopped', bundle: last };
      opts.onUpdate(last);
      if (isTerminal(last.status)) return { reason: 'terminal', bundle: last };
    } catch (e) {
      const err = e instanceof ImportApiError ? e : new ImportApiError(0, null, describeFailure(0, null));
      const fatal = err.status === 401 || err.status === 403 || err.status === 404 || err.status === 400;
      if (fatal || ++errors >= maxErrors) return { reason: 'error', bundle: last, error: err };
    }
    await sleep(pollDelay(attempt));
  }
  return { reason: 'max', bundle: last };
}

export const ACTIVE_BUNDLE_KEY = 'orion_people_import_active_bundle';
export function rememberActiveBundle(store: KeyValueStore | null | undefined, id: string): void {
  try {
    if (store && isJobId(id)) store.setItem(ACTIVE_BUNDLE_KEY, id);
  } catch {
    /* storage unavailable: the import still runs */
  }
}
export function recallActiveBundle(store: KeyValueStore | null | undefined): string | null {
  try {
    const v = store?.getItem(ACTIVE_BUNDLE_KEY) ?? null;
    return isJobId(v) ? v : null;
  } catch {
    return null;
  }
}
export function forgetActiveBundle(store: KeyValueStore | null | undefined): void {
  try {
    store?.removeItem(ACTIVE_BUNDLE_KEY);
  } catch {
    /* nothing to do */
  }
}

export const BUNDLE_STATUS_LABELS: Record<ImportStatus, string> = { ...STATUS_LABELS, FAILED: 'Failed (not all parts imported)' };
export const PART_STATUS_LABELS: Record<BundlePartStatus, string> = { ...STATUS_LABELS, NOT_QUEUED: 'Not imported' };

export function bundleProgressPercent(b: Pick<BundleResult, 'partCount' | 'completedParts' | 'status'>): number {
  if (b.partCount <= 0) return 0;
  if (isTerminal(b.status) && b.status !== 'FAILED') return 100;
  return Math.max(0, Math.min(100, Math.round((b.completedParts / b.partCount) * 100)));
}

/** The counts the result card shows, in order. A dry run shows "would be imported". */
export function bundleSummaryItems(b: BundleResult): SummaryItem[] {
  const n = (v: number) => v.toLocaleString('en-US');
  const o = b.reconciliation.orion;
  const items: SummaryItem[] = [{ label: 'Parts completed', value: `${n(b.completedParts)} / ${n(b.partCount)}` }];
  items.push(b.dryRun ? { label: 'Would be imported', value: n(o.valid) } : { label: 'Imported', value: n(o.imported) });
  if (!b.dryRun) items.push({ label: 'Updated', value: n(o.updated) }, { label: 'Unchanged', value: n(o.unchanged) });
  items.push({ label: 'Quarantined', value: n(o.quarantined) }, { label: 'Rejected', value: n(o.rejected) });
  if (o.failed > 0) items.push({ label: 'Failed (not imported)', value: n(o.failed) });
  return items;
}

export interface ReconciliationRow {
  metric: string;
  manifest: string;
  orion: string;
}

/** Manifest versus Orion, row by row. Outcomes are not in the manifest, so its column says so. */
export function bundleReconciliationRows(b: BundleResult): ReconciliationRow[] {
  const n = (v: number) => v.toLocaleString('en-US');
  const { manifest, orion } = b.reconciliation;
  const dash = '-';
  const rows: ReconciliationRow[] = [
    { metric: 'Total rows', manifest: n(manifest.totalRows), orion: n(orion.totalRows) },
    { metric: 'Parts', manifest: n(manifest.parts), orion: `${n(orion.completedParts)} completed of ${n(orion.parts)} queued` },
    b.dryRun ? { metric: 'Would be imported', manifest: dash, orion: n(orion.valid) } : { metric: 'Imported', manifest: dash, orion: n(orion.imported) },
  ];
  if (!b.dryRun) rows.push({ metric: 'Updated', manifest: dash, orion: n(orion.updated) }, { metric: 'Unchanged', manifest: dash, orion: n(orion.unchanged) });
  rows.push({ metric: 'Quarantined', manifest: dash, orion: n(orion.quarantined) }, { metric: 'Rejected', manifest: dash, orion: n(orion.rejected) }, { metric: 'Failed (not imported)', manifest: dash, orion: n(orion.failed) });
  return rows;
}

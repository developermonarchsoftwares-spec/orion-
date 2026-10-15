import { createHash } from 'crypto';
import type { IRawPersonRecord } from '../ingestion.types';
import { parseCsv } from './people-sources';

/**
 * Mapper for the frozen "Published People export" of the separate People Pipeline (export_version "1", CSV or JSON).
 *
 * This is a mapper only: it parses and validates the FILE and turns each row into the existing `IRawPersonRecord`. Everything
 * else (normalisation, company resolution, identity resolution, deduplication, role classification, contacts, evidence,
 * quarantine, observation / idempotency) stays in PeopleIngestionService, which is not duplicated here.
 *
 * What crosses the boundary, and what deliberately does not:
 *   - company: company_name / company_city / company_state and the statutory identifiers (GSTIN, CIN, PAN) -> `company`.
 *     business_id, business_slug and master_business_id belong to the SOURCE database and are never sent to the resolver.
 *   - person: full_name, job_title, email, phone, mobile, linkedin_url, person_city / person_state / person_country.
 *   - department, seniority_level, decision_maker_type are NOT sent as hints: the vocabularies differ from Orion's, and the
 *     existing classifier derives them from job_title.
 *   - the five verification-status fields, confidence_level, published_at and last_verified_at are never imported: nothing is
 *     verified or published by this import (everything lands DRAFT / PENDING / unpublished).
 *   - provenance: relationship_id -> source.recordId (the idempotency key with the source key); last_seen_at (else
 *     source_acquired_at) -> source.observedAt; exported_at -> the run's acquiredAt; source_provider -> source.label.
 */
export const PEOPLE_EXPORT_VERSION = '1';

/** The frozen export's 38 fields, in the frozen order. */
export const PEOPLE_EXPORT_COLUMNS = [
  'export_version', 'exported_at', 'relationship_id', 'person_id', 'business_id', 'master_business_id', 'business_slug',
  'company_name', 'gstin', 'cin', 'pan', 'company_city', 'company_state', 'full_name', 'first_name', 'last_name', 'job_title',
  'department', 'seniority_level', 'decision_maker_type', 'person_city', 'person_state', 'person_country', 'email',
  'email_verification_status', 'phone', 'phone_verification_status', 'mobile', 'mobile_verification_status', 'linkedin_url',
  'linkedin_url_verification_status', 'verification_status', 'confidence_level', 'published_at', 'last_verified_at',
  'last_seen_at', 'source_provider', 'source_acquired_at',
] as const;
/** The per-person fields (the envelope fields export_version and exported_at are file-level). */
export const PEOPLE_EXPORT_RECORD_FIELDS = PEOPLE_EXPORT_COLUMNS.slice(2);

export const PEOPLE_EXPORT_SOURCE_LABEL = 'people-pipeline-export';

export type ExportRow = Record<string, string | null>;
export interface IParsedExport {
  exportVersion: string;
  exportedAt: Date;
  rows: ExportRow[];
}
export interface IRowRejection {
  /** 1-based position of the row within the file's data rows. */
  row: number;
  /** Machine code only; never any content of the row. */
  code: string;
}
export interface IMappedExport {
  records: IRawPersonRecord[];
  /** The export row number (1-based) of each entry of `records`. */
  rowNumbers: number[];
  rejected: IRowRejection[];
}

/** A problem with the file as a whole. Carries a code and a message that never contain row content. */
export class PeopleExportFormatError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENTIFIER_FORMATS: Record<'GSTIN' | 'CIN' | 'PAN', RegExp> = {
  GSTIN: /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
  CIN: /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/,
  PAN: /^[A-Z]{5}\d{4}[A-Z]$/,
};
const PROVIDER_RE = /^[A-Za-z0-9_.-]{1,40}$/;
const MAX_LISTED = 5;

const fail = (code: string, message: string, details?: Record<string, unknown>): never => {
  throw new PeopleExportFormatError(code, message, details);
};

/** Trim; empty -> null; undo the export's CSV formula-injection guard (a leading apostrophe added before = @ + -). */
const clean = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return fail('INVALID_FIELD_TYPE', 'A field holds an object or array where a scalar value is expected');
  let s = String(v).trim();
  if (s.startsWith("'") && /^'[=@+-]/.test(s)) s = s.slice(1);
  return s === '' ? null : s;
};

const parseExportedAt = (value: string | null): Date => {
  if (!value) return fail('INVALID_EXPORTED_AT', 'exported_at is required');
  const t = Date.parse(value);
  if (Number.isNaN(t)) return fail('INVALID_EXPORTED_AT', 'exported_at is not a valid date');
  if (t > Date.now() + 86_400_000) return fail('INVALID_EXPORTED_AT', 'exported_at is in the future');
  return new Date(t);
};

const checkVersion = (version: string | null): string => {
  if (version !== PEOPLE_EXPORT_VERSION) {
    return fail('UNSUPPORTED_EXPORT_VERSION', `Unsupported export_version; this import accepts version "${PEOPLE_EXPORT_VERSION}"`);
  }
  return version;
};

// ------------------------------------------------------------------------------------------------------------- CSV
export function parseExportCsv(text: string): IParsedExport {
  if (text.includes('\u0000')) fail('MALFORMED_CSV', 'The file contains NUL characters');
  const [header, ...body] = parseCsv(text);
  if (!header) return fail('EMPTY_EXPORT', 'The file has no header row');
  const names = header.map((h) => h.trim());
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  if (dup.length) fail('DUPLICATE_HEADERS', 'The header row repeats a column', { columns: [...new Set(dup)].slice(0, MAX_LISTED) });
  const missing = PEOPLE_EXPORT_COLUMNS.filter((c) => !names.includes(c));
  if (missing.length) fail('MISSING_COLUMNS', 'The file is not the People export: required columns are missing', { columns: missing });
  if (body.length === 0) fail('EMPTY_EXPORT', 'The file has no data rows');
  const bad: number[] = [];
  body.forEach((cells, i) => {
    if (cells.length !== names.length) bad.push(i + 1);
  });
  if (bad.length) fail('MALFORMED_CSV', 'Some rows do not have the same number of fields as the header', { rows: bad.slice(0, MAX_LISTED), count: bad.length });
  const rows: ExportRow[] = body.map((cells) => {
    const row: ExportRow = {};
    names.forEach((n, i) => {
      row[n] = clean(cells[i]);
    });
    return row;
  });
  const versions = new Set(rows.map((r) => r.export_version));
  const stamps = new Set(rows.map((r) => r.exported_at));
  if (versions.size !== 1) fail('INCONSISTENT_ENVELOPE', 'export_version differs between rows');
  if (stamps.size !== 1) fail('INCONSISTENT_ENVELOPE', 'exported_at differs between rows');
  return { exportVersion: checkVersion(rows[0].export_version), exportedAt: parseExportedAt(rows[0].exported_at), rows };
}

// ------------------------------------------------------------------------------------------------------------ JSON
export function parseExportJson(text: string): IParsedExport {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return fail('MALFORMED_JSON', 'The file is not valid JSON');
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return fail('MALFORMED_JSON', 'The JSON must be an object with export_version, exported_at, record_count and people');
  const d = doc as Record<string, unknown>;
  const version = checkVersion(typeof d.export_version === 'string' ? d.export_version.trim() : null);
  const exportedAt = parseExportedAt(typeof d.exported_at === 'string' ? d.exported_at.trim() : null);
  if (!Array.isArray(d.people)) return fail('MALFORMED_JSON', 'people must be an array');
  if (d.people.length === 0) return fail('EMPTY_EXPORT', 'The file has no people');
  if (!Number.isInteger(d.record_count) || d.record_count !== d.people.length) {
    return fail('RECORD_COUNT_MISMATCH', 'record_count does not match the number of people');
  }
  const badShape: number[] = [];
  const missingKeys = new Set<string>();
  const rows: ExportRow[] = d.people.map((p: unknown, i: number) => {
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      badShape.push(i + 1);
      return {};
    }
    const o = p as Record<string, unknown>;
    for (const k of PEOPLE_EXPORT_RECORD_FIELDS) if (!(k in o)) missingKeys.add(k);
    const row: ExportRow = {};
    for (const k of PEOPLE_EXPORT_RECORD_FIELDS) row[k] = clean(o[k]);
    return row;
  });
  if (badShape.length) fail('MALFORMED_JSON', 'Every entry of people must be an object', { rows: badShape.slice(0, MAX_LISTED), count: badShape.length });
  if (missingKeys.size) fail('MISSING_COLUMNS', 'The file is not the People export: required keys are missing', { columns: PEOPLE_EXPORT_RECORD_FIELDS.filter((k) => missingKeys.has(k)) });
  return { exportVersion: version, exportedAt, rows };
}

// -------------------------------------------------------------------------------------------------------- row mapping
/**
 * One export row -> the existing raw record, or a rejection when the row cannot even be keyed or has a malformed statutory
 * identifier. Nothing else is judged here (missing name / title, bad contacts, bad dates are the ingestion layer's job).
 */
export function mapExportRow(row: ExportRow): IRawPersonRecord | string {
  const relationshipId = row.relationship_id;
  if (!relationshipId) return 'MISSING_RELATIONSHIP_ID';
  if (!UUID_RE.test(relationshipId)) return 'INVALID_RELATIONSHIP_ID';

  const identifiers: Array<{ type: string; value: string }> = [];
  for (const [type, column] of [['GSTIN', 'gstin'], ['CIN', 'cin'], ['PAN', 'pan']] as const) {
    const raw = row[column];
    if (!raw) continue;
    const value = raw.toUpperCase().replace(/[\s-]+/g, '');
    if (!IDENTIFIER_FORMATS[type].test(value)) return 'INVALID_COMPANY_IDENTIFIER';
    identifiers.push({ type, value });
  }

  const provider = row.source_provider && PROVIDER_RE.test(row.source_provider) ? row.source_provider : undefined;
  const rec: IRawPersonRecord = {
    company: {
      ...(row.company_name ? { name: row.company_name } : {}),
      ...(row.company_city ? { city: row.company_city } : {}),
      ...(row.company_state ? { state: row.company_state } : {}),
      ...(identifiers.length ? { identifiers } : {}),
    },
    ...(row.full_name ? { personName: row.full_name } : {}),
    ...(row.job_title ? { jobTitle: row.job_title } : {}),
    ...(row.email ? { email: row.email } : {}),
    ...(row.phone ? { phone: row.phone } : {}),
    ...(row.mobile ? { mobile: row.mobile } : {}),
    ...(row.linkedin_url ? { linkedinUrl: row.linkedin_url } : {}),
    ...(row.person_city ? { city: row.person_city } : {}),
    ...(row.person_state ? { state: row.person_state } : {}),
    ...(row.person_country ? { country: row.person_country } : {}),
    source: {
      type: 'MANUAL_IMPORT',
      label: provider ? `${PEOPLE_EXPORT_SOURCE_LABEL}:${provider}` : PEOPLE_EXPORT_SOURCE_LABEL,
      recordId: relationshipId.toLowerCase(),
      ...(row.last_seen_at || row.source_acquired_at ? { observedAt: (row.last_seen_at ?? row.source_acquired_at) as string } : {}),
    },
  };
  return rec;
}

export function mapExportRows(rows: ExportRow[]): IMappedExport {
  const out: IMappedExport = { records: [], rowNumbers: [], rejected: [] };
  const seen = new Set<string>();
  rows.forEach((row, i) => {
    const mapped = mapExportRow(row);
    if (typeof mapped === 'string') {
      out.rejected.push({ row: i + 1, code: mapped });
      return;
    }
    const id = mapped.source!.recordId as string;
    if (seen.has(id)) {
      out.rejected.push({ row: i + 1, code: 'DUPLICATE_RELATIONSHIP_ID' });
      return;
    }
    seen.add(id);
    out.records.push(mapped);
    out.rowNumbers.push(i + 1);
  });
  return out;
}

/**
 * Deterministic run id: the same file (same rows, same exported_at) always gets the same batchRef, so re-importing it is
 * recognised by the observation layer (UNCHANGED, nothing recorded twice); a different export gets its own run.
 */
export function exportBatchRef(parsed: IParsedExport): string {
  const h = createHash('sha256');
  h.update(`${parsed.exportVersion}|${parsed.exportedAt.toISOString()}|${parsed.rows.length}\n`);
  for (const row of parsed.rows) h.update(JSON.stringify(PEOPLE_EXPORT_RECORD_FIELDS.map((k) => row[k] ?? null)) + '\n');
  return `people-export-v${parsed.exportVersion}-${h.digest('hex').slice(0, 24)}`;
}

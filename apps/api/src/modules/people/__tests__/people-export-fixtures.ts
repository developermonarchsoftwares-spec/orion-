import { randomUUID } from 'crypto';
import { PEOPLE_EXPORT_COLUMNS } from '../ingestion/sources/people-export.mapper';

export type ExportRowInput = Record<string, string | null>;

/** One frozen-export row (all 38 fields) with the envelope fields, as the People Pipeline writes it. */
export function exportRow(over: Partial<ExportRowInput> = {}): ExportRowInput {
  const row: ExportRowInput = {};
  for (const c of PEOPLE_EXPORT_COLUMNS) row[c] = null;
  Object.assign(row, {
    export_version: '1',
    exported_at: '2026-10-01T10:00:00+00:00',
    relationship_id: cryptoUuid(),
    person_id: cryptoUuid(),
    business_id: cryptoUuid(), // belongs to the SOURCE database
    master_business_id: cryptoUuid(),
    business_slug: 'source-local-slug',
    full_name: 'Arun Kumar',
    job_title: 'Chief Executive Officer',
    department: 'EXECUTIVE',
    seniority_level: 'EXECUTIVE',
    decision_maker_type: 'FOUNDER_CEO',
    verification_status: 'VERIFIED',
    confidence_level: 'HIGH',
    published_at: '2026-09-30T10:00:00+00:00',
    last_verified_at: '2026-09-29T10:00:00+00:00',
    last_seen_at: '2026-09-30T09:00:00+00:00',
    source_provider: 'PEOPLE_FILE',
    source_acquired_at: '2026-09-28T09:00:00+00:00',
    email_verification_status: null,
    ...over,
  });
  return row;
}

const cryptoUuid = (): string => randomUUID();

const csvCell = (v: string | null) => {
  const s = v ?? '';
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (rows: ExportRowInput[], columns: readonly string[] = PEOPLE_EXPORT_COLUMNS) =>
  [columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c] ?? null)).join(','))].join('\r\n') + '\r\n';

export const toJson = (rows: ExportRowInput[], over: Record<string, unknown> = {}) =>
  JSON.stringify({
    export_version: rows[0]?.export_version ?? '1',
    exported_at: rows[0]?.exported_at ?? '2026-10-01T10:00:00+00:00',
    record_count: rows.length,
    people: rows.map((r) => {
      const { export_version: _v, exported_at: _e, ...rest } = r;
      return rest;
    }),
    ...over,
  });

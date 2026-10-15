/**
 * People columns in an admin company upload (degraded-mode importer).
 *
 * The primary importer (Nest) hands `person_*` columns to the People ingestion service. The
 * gateway's fallback importer runs only when Nest is unreachable and does NOT ingest people: it
 * must (a) never let a person column leak into a company field (a substring header match on
 * "email"/"phone" would do exactly that) and (b) tell the operator the people columns were not
 * processed so they can re-upload once the API is available.
 *
 * The column names below are the same contract as PEOPLE_TEMPLATE_COLUMNS in
 * apps/api/src/modules/import/people/import-people.types.ts (person 1: person_*, people 2-5:
 * person_<n>_*).
 */

const FIELDS = 'name|title|email|phone|mobile|linkedin';
const PERSON_COLUMN = new RegExp(`^person_(?:[2-5]_)?(?:${FIELDS})$`);

/** "Person 2 Email", "person-2-email", "PERSON_2_EMAIL" -> "person_2_email". */
export function normalizePersonHeader(header: string): string {
  return String(header ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-.]+/g, '_')
    .replace(/_+/g, '_');
}

/** The canonical person column for a header, or null when it is not a people column. */
export function canonicalPersonColumn(header: string): string | null {
  const key = normalizePersonHeader(header);
  return PERSON_COLUMN.test(key) ? key : null;
}

export function isPersonColumn(header: string): boolean {
  return canonicalPersonColumn(header) !== null;
}

/** The row without any people column (used by scans that look at "any value" for company fields). */
export function withoutPersonColumns<T>(row: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(row)) if (!isPersonColumn(k)) out[k] = v;
  return out;
}

const isFilled = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== '';

/** Rows that carry at least one filled people column; these were not processed by the fallback. */
export function countRowsWithPeopleData(rows: Array<Record<string, unknown>>): number {
  return rows.reduce((n, row) => n + (Object.entries(row).some(([k, v]) => isPersonColumn(k) && isFilled(v)) ? 1 : 0), 0);
}

export const FALLBACK_PEOPLE_NOTICE =
  'People columns (person_*) were not processed: the People ingestion service is unavailable in fallback mode. ' +
  'Company data was imported. Re-upload the file when the API is available to load people for review.';

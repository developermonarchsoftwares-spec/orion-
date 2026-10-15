/**
 * Input limits for the gateway's natively handled search and export routes. The SQL there is parameterised, so these are not about
 * injection: they bound the work one request can ask for (a 100 KB `q` run through nine ILIKE columns, a list of 50,000 values, a
 * `page` of NaN that the database rejects) and make `%` and `_` mean themselves instead of acting as wildcards.
 *
 * Values are CLAMPED, not refused: the gateway has always been tolerant of sloppy client input, and the NestJS API (which refuses with
 * a 400) is the strict path. Legitimate input is returned unchanged.
 */
export const MAX_QUERY_LENGTH = 200;
export const MAX_FILTER_TEXT = 100;
export const MAX_LIST_ITEMS = 50;
export const MAX_LIST_ITEM_LENGTH = 100;
export const MAX_PAGE = 100_000;
export const MAX_EXPORT_ROWS = 5000;
export const MAX_EXPORT_IDS = 1000;

// eslint-disable-next-line no-control-regex -- stripping control characters (including NUL, which PostgreSQL rejects) is the point
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Trimmed text without control characters, cut to `max`. */
export function clampText(raw: string | null | undefined, max: number): string {
  return String(raw ?? '').replace(CONTROL, '').trim().slice(0, max);
}

/** A whole page number from 1 to MAX_PAGE; anything else (NaN, negative, fractional garbage, huge) is page 1 or the cap. */
export function parsePage(raw: string | null | undefined): number {
  const n = parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_PAGE) : 1;
}

export function parseLimit(raw: string | null | undefined, fallback = 25, max = 100): number {
  const n = parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : fallback;
}

/** Makes `%`, `_` and the escape character match themselves in a LIKE / ILIKE pattern (PostgreSQL's default escape is a backslash). */
export const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** A comma-separated list as clean items: trimmed, control characters removed, each cut to MAX_LIST_ITEM_LENGTH, at most MAX_LIST_ITEMS. */
export function splitList(raw: string | null | undefined, maxItems = MAX_LIST_ITEMS, maxLen = MAX_LIST_ITEM_LENGTH): string[] {
  return String(raw ?? '')
    .split(',')
    .map((s) => s.replace(CONTROL, '').trim().slice(0, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

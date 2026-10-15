/**
 * Bounded pagination for list endpoints that read `page` / `limit` / `offset` as raw query values. A raw `Number(limit)` lets a caller
 * ask for the whole table (`limit=1000000000`), and a non-numeric value becomes NaN, which the database rejects with a 500. These
 * helpers turn any input into safe whole numbers: garbage and out-of-range values fall back to the default or the cap instead of
 * reaching the query. Legitimate values are returned unchanged.
 */
export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;
/** A page number beyond this is never a real request (it would also push the offset towards integer overflow). */
export const MAX_PAGE_NUMBER = 100_000;

const whole = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? Math.floor(n) : null;
};

export function boundedPage(
  page: unknown,
  limit: unknown,
  opts: { defaultLimit?: number; maxLimit?: number } = {},
): { page: number; limit: number; offset: number } {
  const defaultLimit = opts.defaultLimit ?? DEFAULT_PAGE_LIMIT;
  const maxLimit = opts.maxLimit ?? MAX_PAGE_LIMIT;
  const p = whole(page);
  const l = whole(limit);
  const safePage = p !== null && p >= 1 ? Math.min(p, MAX_PAGE_NUMBER) : 1;
  const safeLimit = l !== null && l >= 1 ? Math.min(l, maxLimit) : defaultLimit;
  return { page: safePage, limit: safeLimit, offset: (safePage - 1) * safeLimit };
}

/** For `limit` / `offset` style endpoints. */
export function boundedWindow(
  limit: unknown,
  offset: unknown,
  opts: { defaultLimit?: number; maxLimit?: number } = {},
): { limit: number; offset: number } {
  const defaultLimit = opts.defaultLimit ?? DEFAULT_PAGE_LIMIT;
  const maxLimit = opts.maxLimit ?? MAX_PAGE_LIMIT;
  const l = whole(limit);
  const o = whole(offset);
  return {
    limit: l !== null && l >= 1 ? Math.min(l, maxLimit) : defaultLimit,
    offset: o !== null && o >= 0 ? Math.min(o, MAX_PAGE_NUMBER * maxLimit) : 0,
  };
}

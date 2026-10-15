import type { IBusinessSearchQuery } from './interfaces/search-provider.interface';

/**
 * Typesense query strings are a small language (`field:=value && ...`, `field:dir,field:dir`). A user-supplied value placed into them
 * unquoted can end its own clause and add others (`x && status:=DRAFT`), which would widen results past `status:=PUBLISHED`. Every
 * user value therefore goes through {@link typesenseValue} (backtick-quoted, with the characters that could end the quote or break the
 * clause removed), numbers are coerced to finite numbers, and the sort string is rebuilt from an allowlist instead of being passed on.
 * The `status:=PUBLISHED` clause is fixed and comes first; no user value can remove it.
 */
export const typesenseValue = (v: unknown): string => `\`${String(v).replace(/[`\\\u0000-\u001f]/g, '').trim()}\``;

const bool = (v: unknown): string => (v === true || v === 'true' ? 'true' : 'false');
const score = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : fallback;
};

export function buildTypesenseFilter(query: IBusinessSearchQuery): string {
  const c: string[] = ['status:=PUBLISHED'];
  const str = (field: string, value: unknown) => {
    if (typeof value === 'string' && value.trim() !== '') c.push(`${field}:=${typesenseValue(value)}`);
  };
  str('industry_id', query.industryId);
  str('category_id', query.categoryId);
  str('business_type', query.businessType);
  str('msme_category', query.msmeCategory);
  str('state', query.state);
  str('district', query.district);
  str('city', query.city);
  str('pincode', query.pincode);
  if (query.hasWebsite !== undefined) c.push(`has_website:=${bool(query.hasWebsite)}`);
  if (query.hasEmail !== undefined) c.push(`has_email:=${bool(query.hasEmail)}`);
  if (query.hasPhone !== undefined) c.push(`has_phone:=${bool(query.hasPhone)}`);
  if (query.hasGstin !== undefined) c.push(`has_gstin:=${bool(query.hasGstin)}`);
  str('opportunity_tier', query.opportunityTier);
  if (query.minOrionScore !== undefined || query.maxOrionScore !== undefined) {
    c.push(`orion_score:[${score(query.minOrionScore, 0)}..${score(query.maxOrionScore, 100)}]`);
  }
  return c.join(' && ');
}

export const DEFAULT_TYPESENSE_SORT = 'orion_score:desc,created_at:desc';
const SORT_FIELDS = new Set(['orion_score', 'created_at', 'updated_at', 'name']);
const SORT_ALIASES: Record<string, string> = {
  newest: 'created_at:desc',
  oldest: 'created_at:asc',
  name_asc: 'name:asc',
  name_desc: 'name:desc',
  recently_updated: 'updated_at:desc',
};

/** Only sortable fields and asc/desc survive; anything else yields the default order (the request is not failed). */
export function safeTypesenseSort(sortBy?: string): string {
  const raw = typeof sortBy === 'string' ? sortBy.trim().toLowerCase() : '';
  if (!raw) return DEFAULT_TYPESENSE_SORT;
  if (SORT_ALIASES[raw]) return SORT_ALIASES[raw];
  const parts = raw.split(',');
  if (parts.length > 3) return DEFAULT_TYPESENSE_SORT;
  const out: string[] = [];
  for (const part of parts) {
    const [field, dir = 'desc', extra] = part.split(':');
    if (extra !== undefined || !SORT_FIELDS.has(field) || (dir !== 'asc' && dir !== 'desc')) return DEFAULT_TYPESENSE_SORT;
    out.push(`${field}:${dir}`);
  }
  return out.join(',');
}

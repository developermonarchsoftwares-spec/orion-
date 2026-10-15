import { StringUtil } from '../../../common/utils/string.util';

/**
 * Deterministic normalisers for company matching. Pure. Conservative on purpose: they only remove formatting differences,
 * they never "correct" or approximate. There is no fuzzy matching anywhere in company resolution.
 *
 * The NAME normaliser exists twice (JavaScript here, SQL in `normalizedNameSql`) because stored names are not normalised
 * in the database; a test asserts the two always agree.
 */

/** Identifier types that may identify a company. OTHER is too vague to be trusted. */
export const IDENTIFYING_IDENTIFIER_TYPES = ['CIN', 'GSTIN', 'PAN', 'UDYAM', 'LEI', 'TAN', 'REG_NO'] as const;

/** Same shape the import pipeline stores in business_identifiers.normalized_value: upper case, letters and digits only. */
export function normalizeIdentifierValue(value: string): string {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Hosts that belong to a platform, not to the company that mentions them: they never identify a company. (E-mail domains
 * are never offered to the resolver at all, this list is the second line of defence.)
 */
export const NON_IDENTIFYING_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.in', 'outlook.com', 'hotmail.com', 'live.com', 'rediffmail.com', 'icloud.com', 'proton.me', 'protonmail.com',
  'linkedin.com', 'facebook.com', 'fb.com', 'instagram.com', 'twitter.com', 'x.com', 'youtube.com', 'wa.me', 'whatsapp.com', 'telegram.me', 't.me',
  'google.com', 'sites.google.com', 'business.site', 'blogspot.com', 'wordpress.com', 'wixsite.com', 'weebly.com', 'godaddysites.com', 'squarespace.com',
  'indiamart.com', 'justdial.com', 'tradeindia.com', 'sulekha.com', 'github.io', 'linktr.ee', 'carrd.co',
]);

/** Website / domain -> bare lower-case host: no protocol, `www.`, port, path, query, fragment or trailing dot. null = unusable. */
export function normalizeDomain(input: string | undefined | null): string | null {
  const raw = String(input ?? '').trim().toLowerCase(); // also makes an upper-case scheme (HTTPS://) harmless
  if (!raw || /\s/.test(raw) || raw.includes('@')) return null; // an e-mail address is not a website
  const host = StringUtil.extractDomain(raw);
  if (!host) return null;
  const clean = host.replace(/\.+$/, '').replace(/:\d+$/, '').replace(/^www\./, '');
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(clean)) return null;
  return clean;
}

/** True when the domain (or a parent of it) is a public platform rather than a company website. */
export function isNonIdentifyingDomain(domain: string): boolean {
  const parts = domain.split('.');
  for (let i = 0; i < parts.length - 1; i++) if (NON_IDENTIFYING_DOMAINS.has(parts.slice(i).join('.'))) return true;
  return false;
}

/** Company name -> comparison key. Formatting only: case, punctuation, spacing, "&", and the two legal abbreviations. */
export function normalizeCompanyName(name: string | undefined | null): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bpvt\b/g, 'private')
    .replace(/\bltd\b/g, 'limited')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Too short to identify anything. */
export const MIN_NAME_LENGTH = 3;

/** Free text (city etc.) -> comparison key. */
export function normalizeText(value: string | undefined | null): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizePincode(value: string | undefined | null): string | null {
  const digits = String(value ?? '').replace(/\s+/g, '');
  return /^[1-9][0-9]{5}$/.test(digits) ? digits : null;
}

/**
 * The SQL twin of `normalizeCompanyName`, applied to a column, so names can be compared without a normalised column.
 * `col` must be a trusted column reference (never user input).
 */
export function normalizedNameSql(col: string): string {
  return (
    `trim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(` +
    `lower(${col}), '&', ' and ', 'g'), '[^a-z0-9]+', ' ', 'g'), '\\mpvt\\M', 'private', 'g'), '\\mltd\\M', 'limited', 'g'), '\\s+', ' ', 'g'))`
  );
}

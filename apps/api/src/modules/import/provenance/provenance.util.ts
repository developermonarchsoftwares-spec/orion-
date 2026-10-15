/**
 * Provenance and verification vocabulary for imported business data (Phase 15). Pure functions, no I/O.
 *
 * Verification is a LADDER, and Orion states the highest rung it actually reached, never a higher one:
 *   UNVERIFIED       nothing was checked, or the value failed its format rule
 *   FORMAT_VALID     the value has a valid shape (syntactic). Says nothing about whether it is real, reachable or owned by the business
 *   STRUCTURE_VALID  the value satisfies the known structural rules of its kind (state code, embedded PAN structure, check character).
 *                    Says nothing about whether the register contains it
 *   SOURCE_SUPPORTED a named, approved source states the value. Requires a source record; not produced by this module
 *   CONTROL_VERIFIED the party demonstrated control (for example by answering a message sent to the address). Orion has no such flow
 * Importing a row never produces more than FORMAT_VALID / STRUCTURE_VALID. `isVerified`, `isEmailVerified` and `isPhoneVerified` stay false.
 */

export const SOURCE_TRUST_STATUSES = ['UNREVIEWED', 'APPROVED', 'RESTRICTED', 'REVOKED'] as const;
export type SourceTrustStatus = (typeof SOURCE_TRUST_STATUSES)[number];

export const VERIFICATION_LEVELS = ['UNVERIFIED', 'FORMAT_VALID', 'STRUCTURE_VALID', 'SOURCE_SUPPORTED', 'CONTROL_VERIFIED'] as const;
export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number];

/** The highest level an import can honestly assign. */
export const IMPORT_MAX_LEVEL: VerificationLevel = 'STRUCTURE_VALID';

export type Freshness = 'CURRENT' | 'STALE' | 'UNKNOWN';
/** A check older than this is reported as STALE (never deleted for it). */
export const DEFAULT_FRESHNESS_DAYS = 365;

export function freshness(checkedAt: Date | string | null | undefined, now = new Date(), maxAgeDays = DEFAULT_FRESHNESS_DAYS): Freshness {
  if (!checkedAt) return 'UNKNOWN';
  const t = new Date(checkedAt).getTime();
  if (!Number.isFinite(t)) return 'UNKNOWN';
  return now.getTime() - t > maxAgeDays * 86_400_000 ? 'STALE' : 'CURRENT';
}

// ---------------------------------------------------------------------------------------------------------------------
// Format and structure checks
// ---------------------------------------------------------------------------------------------------------------------

const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}$/;

export function emailLevel(email: string | null | undefined): VerificationLevel {
  const v = (email ?? '').trim();
  return v.length <= 254 && !v.includes('..') && EMAIL.test(v) ? 'FORMAT_VALID' : 'UNVERIFIED';
}

/** An Indian phone number shape: optional +91/91/0 prefix and ten digits starting 6-9, or a landline with a 2-5 digit STD code. */
export function phoneLevel(phone: string | null | undefined): VerificationLevel {
  const digits = (phone ?? '').replace(/[^0-9]/g, '');
  if (!digits) return 'UNVERIFIED';
  let national = digits;
  if (national.length === 12 && national.startsWith('91')) national = national.slice(2);
  else if (national.length === 11 && national.startsWith('0')) national = national.slice(1);
  if (/^[6-9]\d{9}$/.test(national)) return 'FORMAT_VALID';
  if (/^[1-5]\d{9}$/.test(national) || /^1[89]00\d{6,7}$/.test(digits)) return 'FORMAT_VALID';
  return 'UNVERIFIED';
}

const GST_CODE_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const PAN_ENTITY = new Set('ABCFGHLJPT'.split(''));
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CIN_RE = /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;

/** GSTIN check character (mod-36 weighted sum over the first 14 characters). */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GST_CODE_CHARS.indexOf(first14[i]);
    if (v < 0) return '';
    const prod = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(prod / 36) + (prod % 36);
  }
  return GST_CODE_CHARS[(36 - (sum % 36)) % 36];
}

/** State codes in use for GST (01 to 38, plus 97 and 99). */
const gstStateOk = (code: string) => {
  const n = Number(code);
  return (n >= 1 && n <= 38) || n === 97 || n === 99;
};

export function identifierLevel(type: string, value: string | null | undefined): VerificationLevel {
  const v = (value ?? '').trim().toUpperCase();
  if (!v) return 'UNVERIFIED';
  switch (type) {
    case 'GSTIN': {
      if (!GSTIN_RE.test(v)) return 'UNVERIFIED';
      const structural = gstStateOk(v.slice(0, 2)) && PAN_RE.test(v.slice(2, 12)) && PAN_ENTITY.has(v[5]) && gstinCheckChar(v.slice(0, 14)) === v[14];
      return structural ? 'STRUCTURE_VALID' : 'FORMAT_VALID';
    }
    case 'PAN':
      return PAN_RE.test(v) ? (PAN_ENTITY.has(v[3]) ? 'STRUCTURE_VALID' : 'FORMAT_VALID') : 'UNVERIFIED';
    case 'CIN':
      return CIN_RE.test(v) ? 'FORMAT_VALID' : 'UNVERIFIED'; // no published check character: the shape is all that can be checked
    default:
      return 'UNVERIFIED'; // other identifier kinds are stored as supplied, with no claim
  }
}

export function websiteLevel(url: string | null | undefined): VerificationLevel {
  try {
    const u = new URL(String(url));
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.') ? 'FORMAT_VALID' : 'UNVERIFIED';
  } catch {
    return 'UNVERIFIED';
  }
}

/** A level may be recorded only if an import could really have reached it; anything higher is refused. */
export function capImportLevel(level: VerificationLevel): VerificationLevel {
  return VERIFICATION_LEVELS.indexOf(level) > VERIFICATION_LEVELS.indexOf(IMPORT_MAX_LEVEL) ? IMPORT_MAX_LEVEL : level;
}

// ---------------------------------------------------------------------------------------------------------------------
// Provenance record
// ---------------------------------------------------------------------------------------------------------------------

export interface IProvenanceOrigin {
  /** Registered data source, or null when the batch named none (unknown provenance: stated, never invented). */
  sourceId: string | null;
  sourceName: string | null;
  /** Trust status of the source AT THE TIME of publication. A later change does not rewrite history. */
  sourceTrust: SourceTrustStatus | 'NONE';
  collectionMethod: string | null;
  batchId: string;
  recordId: string;
  rowNumber: number | null;
  importedAt: string;
  publishedAt: string;
  publishedById: string | null;
  publishMode: 'CREATE' | 'MERGE' | 'UPDATE';
  /** True when an administrator knowingly published from a source that was not approved. */
  overrideUsed: boolean;
}

export interface IMergeEntry {
  at: string;
  mode: 'MERGE' | 'UPDATE';
  batchId: string;
  recordId: string;
  sourceId: string | null;
  sourceTrust: SourceTrustStatus | 'NONE';
  publishedById: string | null;
  fieldsAdded: string[];
  conflictFields: string[];
}

export interface IConflict {
  field: string;
  recordId: string;
  batchId: string;
  at: string;
  /** For public business facts the incoming value is kept here for the reviewer; contact values are NOT copied (they remain in the import record). */
  incoming?: string;
}

export interface IProvenanceMetadata {
  schema: 1;
  origin: IProvenanceOrigin;
  history: IMergeEntry[];
}

export function buildOrigin(input: Omit<IProvenanceOrigin, 'publishedAt'> & { now?: Date }): IProvenanceOrigin {
  const { now, ...rest } = input;
  return { ...rest, publishedAt: (now ?? new Date()).toISOString() };
}

/** Public business facts whose disagreement is worth keeping for a reviewer. */
export const COMPARABLE_FACTS = ['name', 'legalName', 'description', 'foundingYear'] as const;

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * What a merge may do, decided without writing anything:
 *  - a value the published business lacks is ADDED;
 *  - a value equal to the published one is ignored;
 *  - a value that differs is NEVER written over the published one: it is returned as a conflict for review.
 */
export function planFactMerge(existing: Record<string, unknown>, incoming: Record<string, unknown>) {
  const add: Record<string, unknown> = {};
  const conflicts: string[] = [];
  for (const f of COMPARABLE_FACTS) {
    const inc = incoming[f];
    if (inc === undefined || inc === null || String(inc).trim() === '') continue;
    const cur = existing[f];
    if (cur === undefined || cur === null || String(cur).trim() === '') add[f] = inc;
    else if (norm(cur) !== norm(inc)) conflicts.push(f);
  }
  return { add, conflicts };
}

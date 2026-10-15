import { classifyRole } from '../classification/role-classifier';
import { FUNCTIONAL_RULES, SENIORITY_RANK } from '../classification/role-taxonomy.config';
import type { EvidenceSourceType, IContactInput, IEvidenceInput } from '../contracts/people-ingestion.contract';
import {
  DECISION_MAKER_TYPES,
  DEPARTMENTS,
  SENIORITY_LEVELS,
  VERIFICATION_STATUSES,
  type DecisionMakerType,
  type Department,
  type SeniorityLevel,
  type VerificationStatus,
} from '../people.constants';
import { isGenericMailbox, isValidEmail, normalizeLinkedinUrl, normalizePersonName, parsePhone } from '../people.utils';
import { parsePublicUrl } from '../../../common/utils/public-url.util';
import type { ICompanyRef, IRawPersonRecord, IReason, NormalizeResult } from './ingestion.types';

const SOURCE_TYPES: readonly EvidenceSourceType[] = [
  'GOVERNMENT_REGISTRY',
  'WEB_SCRAPING',
  'MANUAL_IMPORT',
  'API_INTEGRATION',
  'USER_SUBMISSION',
  'PARTNER_FEED',
];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACEHOLDER_RE = /^(n\/?a|na|none|null|nil|unknown|tbd|test|xxx+|-+|\.+)$/i;
/** A name made only of filler words ("Unknown Person", "Test User", "Contact Name") is not a person. */
const PLACEHOLDER_WORDS = new Set([
  'unknown', 'anonymous', 'unnamed', 'na', 'n/a', 'none', 'null', 'nil', 'tbd', 'test', 'sample', 'dummy', 'demo',
  'person', 'contact', 'name', 'user', 'owner', 'director', 'manager', 'admin', 'no', 'not', 'available', 'provided',
  'first', 'last', 'full', 'customer', 'client',
]);
const isPlaceholderName = (name: string) => {
  const words = name.toLowerCase().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => PLACEHOLDER_WORDS.has(w));
};
const HONORIFIC_RE = /^(mr|mrs|ms|miss|dr|prof|shri|smt|sri|er|ca|cs|adv)\.?\s+/i;
const QUALIFICATION_RE = /^(ca|cs|cma|mba|phd|b\.?e|b\.?tech|m\.?tech|llb|llm|fca|aca|mca|bba|b\.?com|m\.?com|jr\.?|sr\.?)$/i;
const IDENTIFIER_TYPES = ['CIN', 'GSTIN', 'PAN', 'UDYAM', 'LEI', 'TAN', 'REG_NO', 'OTHER'];

/** Which department a decision-maker type belongs to (used to reject contradictory hints). */
const TYPE_DEPARTMENT: Record<string, Department> = {
  FOUNDER_CEO: 'EXECUTIVE',
  MANAGING_DIRECTOR: 'EXECUTIVE',
  DIRECTOR_PARTNER: 'EXECUTIVE',
  GENERAL_MANAGER: 'EXECUTIVE',
  ...Object.fromEntries(Object.entries(FUNCTIONAL_RULES).map(([dept, rule]) => [rule!.type, dept as Department])),
};

/**
 * Consistency of a (department, seniority, decision-maker type) triple; any part may be empty.
 * Shared by ingestion hints and reviewer edits. Returns a message, or null when consistent.
 */
export function checkRoleCombination(department: string, seniority: string, type: string): string | null {
  if (type && seniority && SENIORITY_RANK[seniority as SeniorityLevel] < SENIORITY_RANK.MANAGER) {
    return `A ${seniority} cannot be a ${type}`;
  }
  if (type && department && TYPE_DEPARTMENT[type] && TYPE_DEPARTMENT[type] !== department) {
    return `${type} does not belong to the ${department} department`;
  }
  return null;
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();
const str = (v: unknown): string => (typeof v === 'string' ? collapse(v) : v === null || v === undefined ? '' : collapse(String(v)));

const titleCase = (s: string) =>
  s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, sep: string, ch: string) => `${sep}${ch.toUpperCase()}`);
const fixCase = (s: string) => (s === s.toUpperCase() || s === s.toLowerCase() ? titleCase(s) : s);

/**
 * "Mr. Arun Kumar - CEO" -> { name: "Arun Kumar", embeddedTitle: "CEO" }.
 * Splits only on a spaced dash/pipe or a comma, so "Lakshmi-Devi" is untouched, and drops
 * pure qualification suffixes ("Anil Kumar, CA").
 */
export function parseNameField(raw: string): { name: string; embeddedTitle: string } {
  const s = collapse(raw);
  const parts = s.split(/\s+[-–—|]\s+|\s*,\s*/).map(collapse).filter(Boolean);
  let name = parts[0] ?? '';
  while (HONORIFIC_RE.test(name)) name = name.replace(HONORIFIC_RE, '');
  const rest = parts.slice(1).filter((p) => !QUALIFICATION_RE.test(p));
  return { name: fixCase(name.trim()), embeddedTitle: rest.join(' ') };
}

function parseDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function parseBool(v: unknown): boolean | undefined | 'invalid' {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (['true', 'yes', 'y', '1', 'current'].includes(s)) return true;
  if (['false', 'no', 'n', '0', 'former', 'past'].includes(s)) return false;
  return 'invalid';
}

const normEnum = (v: string) => v.trim().toUpperCase().replace(/[\s-]+/g, '_');

/**
 * Pure validation + normalisation of one raw record into a PeopleWriteService input.
 * Fatal problems (identity, company association, provenance, impossible combinations) reject the
 * record so it is quarantined; contact-level problems drop just that contact with a warning.
 * Nothing is guessed: missing information stays missing.
 */
export function normalizeRawPerson(raw: IRawPersonRecord, now: Date = new Date()): NormalizeResult {
  const reasons: IReason[] = [];
  const warnings: IReason[] = [];
  const fail = (code: string, message: string) => reasons.push({ code, message });
  const warn = (code: string, message: string) => warnings.push({ code, message });

  // ---- company association ------------------------------------------------------------------
  const businessRef: ICompanyRef = {};
  if (raw.businessId) {
    if (UUID_RE.test(str(raw.businessId))) businessRef.id = str(raw.businessId);
    else fail('INVALID_BUSINESS_ID', 'businessId is not a valid UUID');
  }
  if (raw.businessSlug && str(raw.businessSlug)) businessRef.slug = str(raw.businessSlug).toLowerCase();
  if (raw.businessIdentifier?.value) {
    const type = normEnum(str(raw.businessIdentifier.type));
    if (!IDENTIFIER_TYPES.includes(type)) fail('INVALID_BUSINESS_IDENTIFIER', `Unknown identifier type "${raw.businessIdentifier.type}"`);
    else businessRef.identifier = { type, value: str(raw.businessIdentifier.value).toUpperCase().replace(/\s+/g, '') };
  }
  // Phase 6.3: optional company hints for the shared resolver (exact, normalised matching only; never guessed here)
  if (raw.company && typeof raw.company === 'object') {
    const c = raw.company;
    const short = (v: unknown, max: number) => (typeof v === 'string' && str(v) ? str(v).slice(0, max) : undefined);
    const name = short(c.name, 255);
    const legalName = short(c.legalName, 255);
    const website = short(c.website, 500);
    const domain = short(c.domain, 255);
    const city = short(c.city, 100);
    const state = short(c.state, 100);
    const pincode = short(c.pincode, 20);
    if (name) businessRef.name = name;
    if (legalName) businessRef.legalName = legalName;
    if (website) businessRef.website = website;
    if (domain) businessRef.domain = domain;
    if (city) businessRef.city = city;
    if (state) businessRef.state = state;
    if (pincode) businessRef.pincode = pincode;
    if (Array.isArray(c.identifiers)) {
      const list = c.identifiers
        .filter((i) => i && typeof i.type === 'string' && typeof i.value === 'string' && str(i.value))
        .slice(0, 10)
        .map((i) => ({ type: normEnum(str(i.type)), value: str(i.value).toUpperCase().replace(/\s+/g, '') }));
      if (list.length) businessRef.identifiers = list;
    }
  }
  const hasCompanySignal = !!(businessRef.id || businessRef.slug || businessRef.identifier || businessRef.identifiers || businessRef.name || businessRef.legalName || businessRef.website || businessRef.domain);
  if (!hasCompanySignal && !reasons.some((r) => r.code.startsWith('INVALID_BUSINESS'))) {
    fail('MISSING_BUSINESS', 'A company association is required (businessId, businessSlug, businessIdentifier or company details)');
  }

  // ---- name ----------------------------------------------------------------------------------
  const rawName = str(raw.personName);
  const parsed = parseNameField(rawName);
  if (!rawName || PLACEHOLDER_RE.test(rawName)) {
    fail('MISSING_NAME', 'Person name is required');
  } else if (/[0-9@]|https?:|www\./i.test(parsed.name) || parsed.name.length > 200 || PLACEHOLDER_RE.test(parsed.name) || isPlaceholderName(parsed.name)) {
    fail('INVALID_NAME', 'Person name contains digits, an email/URL or a placeholder');
  } else if (normalizePersonName(parsed.name).split(' ').filter(Boolean).length < 2 || (parsed.name.match(/\p{L}/gu) ?? []).length < 3) {
    fail('NAME_INCOMPLETE', 'A first and last name are required to identify a person reliably');
  }

  // ---- title / classification ----------------------------------------------------------------
  let jobTitle = str(raw.jobTitle);
  if (PLACEHOLDER_RE.test(jobTitle)) jobTitle = '';
  if (!jobTitle && parsed.embeddedTitle) {
    jobTitle = parsed.embeddedTitle;
    warn('TITLE_FROM_NAME', 'Job title was taken from the name field');
  } else if (jobTitle && parsed.embeddedTitle) {
    warn('NAME_TITLE_SUFFIX_IGNORED', 'Title text inside the name field was ignored in favour of jobTitle');
  }
  if (!jobTitle) fail('MISSING_TITLE', 'A job title is required to record a company role');
  else if (jobTitle.length > 200) fail('INVALID_TITLE', 'Job title is longer than 200 characters');

  const classification = jobTitle ? classifyRole(jobTitle) : null;
  if (classification && classification.seniorityLevel === 'UNKNOWN' && classification.department === 'UNKNOWN') {
    warn('UNCLASSIFIED_TITLE', 'Title could not be classified; stored without seniority, department or decision-maker type');
  }

  // Hints: validated for consistency, never adopted.
  const hintDept = raw.department ? normEnum(str(raw.department)) : '';
  const hintSen = raw.seniority ? normEnum(str(raw.seniority)) : '';
  const hintType = raw.decisionMakerType ? normEnum(str(raw.decisionMakerType)) : '';
  if (hintDept && !(DEPARTMENTS as readonly string[]).includes(hintDept)) fail('INVALID_HINT', `Unknown department "${raw.department}"`);
  if (hintSen && !(SENIORITY_LEVELS as readonly string[]).includes(hintSen)) fail('INVALID_HINT', `Unknown seniority "${raw.seniority}"`);
  if (hintType && !(DECISION_MAKER_TYPES as readonly string[]).includes(hintType)) fail('INVALID_HINT', `Unknown decisionMakerType "${raw.decisionMakerType}"`);
  if (!reasons.some((r) => r.code === 'INVALID_HINT')) {
    const combo = checkRoleCombination(hintDept, hintSen, hintType);
    if (combo) fail('INVALID_ROLE_COMBINATION', combo);
    if (classification) {
      if (hintDept && hintDept !== classification.department) warn('HINT_CONFLICT_DEPARTMENT', `Classifier says ${classification.department}, hint said ${hintDept}; classifier used`);
      if (hintSen && hintSen !== classification.seniorityLevel) warn('HINT_CONFLICT_SENIORITY', `Classifier says ${classification.seniorityLevel}, hint said ${hintSen}; classifier used`);
      if (hintType && hintType !== (classification.decisionMakerType ?? '')) warn('HINT_CONFLICT_DECISION_MAKER', `Classifier says ${classification.decisionMakerType ?? 'none'}, hint said ${hintType}; classifier used`);
    }
  }

  // ---- dates / current flag ------------------------------------------------------------------
  const current = parseBool(raw.isCurrent);
  if (current === 'invalid') fail('INVALID_CURRENT_FLAG', 'isCurrent must be true/false');
  const start = parseDate(raw.startDate);
  const end = parseDate(raw.endDate);
  if ((raw.startDate && !start) || (raw.endDate && !end)) fail('INVALID_DATES', 'startDate/endDate are not valid dates');
  if (start && end && end < start) fail('INVALID_DATES', 'endDate is before startDate');
  if (start && start.getTime() > now.getTime() + 366 * 86_400_000) fail('INVALID_DATES', 'startDate is more than a year in the future');
  let isCurrent: boolean | undefined = current === 'invalid' ? undefined : current;
  if (end && end.getTime() < now.getTime()) {
    if (isCurrent === true) fail('CONFLICTING_CURRENT_FLAG', 'Role is marked current but has an end date in the past');
    else isCurrent = false; // an explicit past end date states the role has ended
  }

  // ---- provenance ----------------------------------------------------------------------------
  const sourceType = normEnum(str(raw.source?.type)) as EvidenceSourceType;
  if (!raw.source?.type) fail('MISSING_SOURCE', 'source.type is required: every claim needs provenance');
  else if (!SOURCE_TYPES.includes(sourceType)) fail('INVALID_SOURCE_TYPE', `Unknown source type "${raw.source.type}"`);
  let sourceUrl: string | undefined;
  if (raw.source?.url && str(raw.source.url)) {
    // an explicit http(s) URL on a public host, without credentials (a bare name is not accepted here, as before)
    const parsed = /^https?:\/\//i.test(str(raw.source.url)) ? parsePublicUrl(str(raw.source.url)) : null;
    if (parsed && parsed.ok) sourceUrl = new URL(parsed.url).toString();
    else fail('INVALID_SOURCE_URL', 'source.url must be a valid public http(s) URL without credentials');
  }
  const evidenceType = raw.source?.evidenceType ? normEnum(str(raw.source.evidenceType)).slice(0, 40) : 'ROLE_CLAIM';
  const observedAt = parseDate(raw.source?.observedAt);
  if (raw.source?.observedAt && !observedAt) fail('INVALID_OBSERVED_AT', 'source.observedAt is not a valid date');
  else if (observedAt && observedAt.getTime() > now.getTime() + 86_400_000) fail('INVALID_OBSERVED_AT', 'source.observedAt is in the future');
  const sourceReference = raw.source?.reference ? str(raw.source.reference).slice(0, 255) : undefined;

  // ---- verification (only if it actually happened) -------------------------------------------
  let verificationStatus: VerificationStatus | undefined;
  let verifiedAt: Date | undefined;
  let verifiedBy = '';
  if (raw.verification && (raw.verification.status || raw.verification.verifiedAt)) {
    const status = normEnum(str(raw.verification.status)) as VerificationStatus;
    if (!(VERIFICATION_STATUSES as readonly string[]).includes(status) || status === 'STALE') {
      fail('INVALID_VERIFICATION', 'verification.status must be UNVERIFIED, PARTIALLY_VERIFIED, VERIFIED or CONFLICTED');
    } else if (status === 'VERIFIED' || status === 'PARTIALLY_VERIFIED') {
      const at = parseDate(raw.verification.verifiedAt);
      verifiedBy = str(raw.verification.verifiedBy);
      if (!at || at.getTime() > now.getTime() + 86_400_000) fail('INVALID_VERIFICATION', `${status} needs a valid, non-future verifiedAt`);
      else if (!verifiedBy) fail('INVALID_VERIFICATION', `${status} needs verifiedBy (who verified it)`);
      else {
        verificationStatus = status;
        verifiedAt = at;
      }
    } else {
      verificationStatus = status;
    }
  }

  if (raw.confidenceScore !== undefined && raw.confidenceScore !== null) {
    const c = Number(raw.confidenceScore);
    if (!Number.isFinite(c) || c < 0 || c > 100) fail('INVALID_CONFIDENCE', 'confidenceScore must be a number from 0 to 100');
  }

  // ---- contacts (non-fatal) ------------------------------------------------------------------
  const contacts: IContactInput[] = [];
  const email = str(raw.email).toLowerCase();
  if (email) {
    if (!isValidEmail(email)) warn('INVALID_EMAIL', 'Email was malformed and was dropped');
    else if (isGenericMailbox(email)) warn('GENERIC_MAILBOX', 'Shared mailbox (info@, sales@...) is not a personal work email and was dropped');
    else contacts.push({ type: 'WORK_EMAIL', value: email, isPrimary: true, sourceType: SOURCE_TYPES.includes(sourceType) ? sourceType : undefined });
  }
  for (const [field, type] of [['phone', 'PHONE'], ['mobile', 'MOBILE']] as const) {
    const value = str(raw[field]);
    if (!value) continue;
    const p = parsePhone(value);
    if (!p.ok) warn('INVALID_PHONE', `${field} dropped: ${p.reason}`);
    else if (!contacts.some((c) => c.type !== 'WORK_EMAIL' && c.value === p.e164)) {
      contacts.push({ type, value: p.e164!, isPrimary: true, sourceType: SOURCE_TYPES.includes(sourceType) ? sourceType : undefined });
    }
  }

  let linkedinUrl: string | undefined;
  if (str(raw.linkedinUrl)) {
    const norm = normalizeLinkedinUrl(str(raw.linkedinUrl));
    if (!norm) warn('INVALID_LINKEDIN', 'LinkedIn URL is not a personal profile URL and was dropped');
    else linkedinUrl = `https://www.${norm}`;
  }

  // ---- location ------------------------------------------------------------------------------
  let city = str(raw.city);
  let state = str(raw.state);
  let country = str(raw.country);
  if (!city && !state && !country && str(raw.location)) {
    const parts = str(raw.location).split(',').map(collapse).filter(Boolean);
    if (parts.length === 1) [city] = parts;
    else if (parts.length === 2) [city, state] = parts;
    else if (parts.length >= 3) [city, state, country] = [parts[0], parts[1], parts[parts.length - 1]];
  }
  const loc = (v: string) => (v ? fixCase(v).slice(0, 100) : undefined);

  if (reasons.length > 0 || !classification) return { ok: false, reasons };

  // ---- evidence: one row per claim kind so reviewers can see what each source supports --------
  const base = { sourceType, sourceUrl, sourceReference, observedAt: observedAt ?? undefined };
  const evidence: IEvidenceInput[] = [{ ...base, evidenceType, scope: 'ROLE' }];
  if (linkedinUrl) evidence.push({ ...base, evidenceType: 'IDENTITY_CLAIM', scope: 'PERSON' });
  for (const c of contacts) {
    evidence.push({ ...base, evidenceType: 'CONTACT_CLAIM', scope: 'CONTACT', contact: { type: c.type, value: c.value } });
  }
  if (verifiedAt) {
    evidence.push({
      sourceType,
      evidenceType: 'MANUAL_VERIFICATION',
      sourceReference: `verified-by:${verifiedBy}`.slice(0, 255),
      observedAt: verifiedAt,
      verifiedAt,
      scope: 'ROLE',
    });
  }

  return {
    ok: true,
    record: {
      businessRef,
      warnings,
      upsert: {
        person: {
          fullName: parsed.name,
          linkedinUrl,
          city: loc(city),
          state: loc(state),
          country: loc(country),
        },
        role: {
          jobTitle,
          isCurrent,
          startDate: start ? isoDay(start) : undefined,
          endDate: end ? isoDay(end) : undefined,
        },
        contacts,
        evidence,
        verificationStatus,
        confidenceScore: raw.confidenceScore === undefined || raw.confidenceScore === null ? undefined : Number(raw.confidenceScore),
        lastVerifiedAt: verifiedAt,
      },
    },
  };
}

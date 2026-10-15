/**
 * Data classification and contact disclosure (Phase 10).
 *
 * A logical layer over the existing columns: nothing is stored. A class is derived from the value and the context
 * available at the moment of use, and every derived class is an INFERENCE (`inferred: true`), never a verification.
 * When the evidence is not enough the class is `UNKNOWN`, and `UNKNOWN` is treated as restricted before unlock.
 *
 * Pure functions only (no database, no I/O), so every serializer (discover, unlock, export) applies identical rules.
 * See docs/DATA_CLASSIFICATION.md for the definitions and the field map.
 */

export const DATA_CLASSES = [
  'PUBLIC_BUSINESS_DATA',
  'BUSINESS_CONTACT_DATA',
  'INDIVIDUAL_WORK_CONTACT',
  'PERSONAL_CONTACT_DATA',
  'SENSITIVE_INTERNAL_DATA',
  'CUSTOMER_ACCOUNT_DATA',
  'PAYMENT_DATA',
  'SECURITY_DATA',
] as const;
export type DataClass = (typeof DATA_CLASSES)[number] | 'UNKNOWN';

export type ClassificationConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface IClassification {
  dataClass: DataClass;
  confidence: ClassificationConfidence;
  /** Short machine-readable reason. Internal: never returned to customers. */
  basis: string;
  /** Always true: a classification is an inference from the value and its context, not a verified fact. */
  inferred: true;
}

/** The coarse label customers see. The reason and the confidence stay internal. */
export type ContactKind = 'BUSINESS' | 'INDIVIDUAL_WORK' | 'PERSONAL' | 'UNKNOWN';

const result = (dataClass: DataClass, confidence: ClassificationConfidence, basis: string): IClassification => ({ dataClass, confidence, basis, inferred: true });

export function contactKind(c: IClassification): ContactKind {
  switch (c.dataClass) {
    case 'PUBLIC_BUSINESS_DATA':
    case 'BUSINESS_CONTACT_DATA':
      return 'BUSINESS';
    case 'INDIVIDUAL_WORK_CONTACT':
      return 'INDIVIDUAL_WORK';
    case 'PERSONAL_CONTACT_DATA':
      return 'PERSONAL';
    default:
      return 'UNKNOWN';
  }
}

// -------------------------------------------------------------------------------------------------------------------
// Disclosure policy: the product and legal decisions in one place. Changing a value here changes every path at once.
// -------------------------------------------------------------------------------------------------------------------

export const DISCLOSURE_POLICY = {
  /** Contact values classified PERSONAL_CONTACT_DATA are shown in full to a customer who unlocked the company. OPEN POLICY DECISION. */
  personalContactAfterUnlock: true,
  /** Contact values that could not be classified are shown in full after unlock (they are masked strongly before). */
  unknownContactAfterUnlock: true,
  /** The PAN of an individual (and the PAN inside such a GSTIN) is never shown in full, unlocked or not. */
  individualPanAfterUnlock: false,
} as const;

// -------------------------------------------------------------------------------------------------------------------
// E-mail
// -------------------------------------------------------------------------------------------------------------------

const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.in', 'yahoo.co.in', 'yahoo.co.uk', 'ymail.com', 'outlook.com', 'outlook.in', 'hotmail.com',
  'hotmail.co.uk', 'live.com', 'live.in', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me',
  'rediffmail.com', 'rediff.com', 'zoho.com', 'gmx.com', 'gmx.net', 'mail.com', 'yandex.com', 'yandex.ru', 'qq.com', '163.com', '126.com', 'sify.com',
]);

/** Local parts that name a team or function rather than a person. */
const ROLE_MAILBOXES = new Set([
  'info', 'contact', 'contactus', 'sales', 'support', 'admin', 'hello', 'hi', 'office', 'enquiry', 'enquiries', 'inquiry', 'inquiries', 'mail',
  'accounts', 'accounting', 'billing', 'finance', 'hr', 'careers', 'jobs', 'recruitment', 'marketing', 'service', 'services', 'help', 'team',
  'press', 'media', 'legal', 'orders', 'purchase', 'purchasing', 'procurement', 'reception', 'webmaster', 'postmaster', 'noreply', 'no-reply', 'donotreply',
  'customercare', 'care', 'feedback', 'general', 'business', 'works', 'export', 'exports', 'import', 'imports', 'dispatch',
]);

export function isFreeMailDomain(domain: string): boolean {
  return FREE_MAIL_DOMAINS.has(domain.trim().toLowerCase());
}

const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'er', 'ca', 'cs', 'shri', 'smt', 'sri', 'prof', 'adv']);

function nameTokens(fullName?: string | null): string[] {
  return (fullName ?? '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length > 0 && !TITLES.has(t));
}

/** True when the local part is built from the person's own name (first, last, both, an initial plus a name, or contains a long name part). */
function localMatchesName(local: string, fullName?: string | null): boolean {
  const tokens = nameTokens(fullName);
  if (!tokens.length) return false;
  const lc = local.toLowerCase().replace(/\+.*$/, '').replace(/[^a-z]/g, '');
  if (lc.length < 2) return false;
  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  const candidates = new Set<string>([first, last, first + last, last + first, first[0] + last, first + last[0], last[0] + first].filter((x) => x.length >= 2));
  if (candidates.has(lc)) return true;
  if (first.length >= 4 && lc.includes(first)) return true;
  if (tokens.length > 1 && last.length >= 4 && lc.includes(last)) return true;
  return false;
}

export interface IEmailContext {
  /** The contact's name, when the e-mail belongs to a named person. */
  contactName?: string | null;
  /** Domains known to belong to the company (its websites). Corroborates, never decides alone. */
  companyDomains?: readonly string[];
}

export function parseEmail(email: string | null | undefined): { local: string; domain: string } | null {
  const v = (email ?? '').trim();
  const m = v.match(/^([^@\s]+)@([^@\s]+\.[^@\s]+)$/);
  return m ? { local: m[1], domain: m[2].toLowerCase() } : null;
}

export function classifyEmail(email: string | null | undefined, ctx: IEmailContext = {}): IClassification {
  const p = parseEmail(email);
  if (!p) return result('UNKNOWN', 'LOW', 'INVALID_FORMAT');
  const local = p.local.toLowerCase().replace(/\+.*$/, '');
  const ownDomain = (ctx.companyDomains ?? []).some((d) => {
    const dom = d.toLowerCase().replace(/^www\./, '');
    return p.domain === dom || p.domain.endsWith(`.${dom}`);
  });

  if (isFreeMailDomain(p.domain)) {
    // a free-mail address says nothing about who owns it, unless the name ties it to a person
    if (localMatchesName(local, ctx.contactName)) return result('PERSONAL_CONTACT_DATA', 'MEDIUM', 'FREE_MAIL_NAME_MATCH');
    return result('UNKNOWN', 'LOW', ROLE_MAILBOXES.has(local) ? 'FREE_MAIL_ROLE_LOCAL' : 'FREE_MAIL_NO_CONTEXT');
  }
  if (ROLE_MAILBOXES.has(local)) return result('BUSINESS_CONTACT_DATA', ownDomain ? 'HIGH' : 'MEDIUM', 'ROLE_MAILBOX');
  if (localMatchesName(local, ctx.contactName)) return result('INDIVIDUAL_WORK_CONTACT', ownDomain ? 'HIGH' : 'MEDIUM', 'NAME_MATCH');
  if (/^[a-z]{2,}[._-][a-z]{2,}$/.test(local)) return result('INDIVIDUAL_WORK_CONTACT', 'LOW', 'NAME_SHAPE');
  return result('UNKNOWN', 'LOW', 'CORPORATE_NO_PATTERN');
}

// -------------------------------------------------------------------------------------------------------------------
// Phone
// -------------------------------------------------------------------------------------------------------------------

export interface IPhoneContext {
  isDirectDial?: boolean;
}

/** Splits a phone value into its dialling prefix and national digits, without guessing beyond India (+91). */
function splitPhone(phone: string): { prefix: string; national: string; foreign: boolean; trunkZero: boolean } {
  const raw = phone.trim();
  const plus = raw.startsWith('+') || raw.startsWith('00');
  let digits = raw.replace(/\D/g, '');
  if (raw.startsWith('00')) digits = digits.slice(2);
  if (plus && digits.startsWith('91') && digits.length >= 12) return { prefix: '+91 ', national: digits.slice(2), foreign: false, trunkZero: false };
  if (plus) return { prefix: '+', national: digits, foreign: true, trunkZero: false };
  if (digits.length === 12 && digits.startsWith('91')) return { prefix: '+91 ', national: digits.slice(2), foreign: false, trunkZero: false };
  if (digits.length === 11 && digits.startsWith('0')) return { prefix: '', national: digits.slice(1), foreign: false, trunkZero: true };
  return { prefix: '', national: digits, foreign: false, trunkZero: false };
}

export function classifyPhone(phone: string | null | undefined, ctx: IPhoneContext = {}): IClassification {
  const v = (phone ?? '').trim();
  if (!v) return result('UNKNOWN', 'LOW', 'EMPTY');
  const s = splitPhone(v);
  if (s.foreign) return result('UNKNOWN', 'LOW', 'FOREIGN_FORMAT_NOT_ASSESSED');
  const n = s.national;
  if (/^(1800|1860)\d{6,7}$/.test(n)) return result('BUSINESS_CONTACT_DATA', 'HIGH', 'TOLL_FREE');
  if (n.length !== 10) return result('UNKNOWN', 'LOW', 'UNEXPECTED_LENGTH');
  if (s.trunkZero) return result('BUSINESS_CONTACT_DATA', 'MEDIUM', 'LANDLINE_STD_FORMAT');
  if (/^[6-9]/.test(n)) {
    // a mobile line belongs to a person; whether it is a work or a private line is not knowable from the number
    return result('INDIVIDUAL_WORK_CONTACT', ctx.isDirectDial ? 'MEDIUM' : 'LOW', ctx.isDirectDial ? 'MOBILE_FORMAT_DIRECT_DIAL' : 'MOBILE_FORMAT_OWNER_UNVERIFIED');
  }
  return result('BUSINESS_CONTACT_DATA', 'MEDIUM', 'LANDLINE_FORMAT');
}

// -------------------------------------------------------------------------------------------------------------------
// Identifiers
// -------------------------------------------------------------------------------------------------------------------

/** Company PAN entity codes (4th character). `P` is a person; anything else that is not a known company code is treated as sensitive. */
const COMPANY_PAN_ENTITY = /^[A-Z]{3}[ABCFGHLJT][A-Z][0-9]{4}[A-Z]$/;
const GSTIN_FORMAT = /^[0-9]{2}([A-Z]{3}[ABCFGHLJPT][A-Z][0-9]{4}[A-Z])[0-9A-Z]Z[0-9A-Z]$/;

export function classifyIdentifier(type: string, value: string): IClassification {
  const v = (value ?? '').trim().toUpperCase();
  switch (type) {
    case 'CIN':
    case 'LEI':
    case 'REG_NO':
    case 'UDYAM':
      return result('PUBLIC_BUSINESS_DATA', 'HIGH', 'REGISTRY_NUMBER');
    case 'GSTIN': {
      const g = v.match(GSTIN_FORMAT);
      if (!g) return result('UNKNOWN', 'LOW', 'GSTIN_UNPARSEABLE');
      return g[1][3] === 'P' ? result('PERSONAL_CONTACT_DATA', 'HIGH', 'GSTIN_EMBEDS_INDIVIDUAL_PAN') : result('PUBLIC_BUSINESS_DATA', 'HIGH', 'GSTIN_COMPANY_PAN');
    }
    case 'PAN':
      if (COMPANY_PAN_ENTITY.test(v)) return result('BUSINESS_CONTACT_DATA', 'HIGH', 'PAN_COMPANY_ENTITY');
      if (/^[A-Z]{3}P[A-Z][0-9]{4}[A-Z]$/.test(v)) return result('PERSONAL_CONTACT_DATA', 'HIGH', 'PAN_INDIVIDUAL');
      return result('PERSONAL_CONTACT_DATA', 'LOW', 'PAN_UNPARSEABLE_TREATED_AS_SENSITIVE');
    case 'TAN':
      return result('BUSINESS_CONTACT_DATA', 'MEDIUM', 'TAN');
    default:
      return result('UNKNOWN', 'LOW', 'OTHER_IDENTIFIER');
  }
}

/** Masks an identifier for a customer. `unlocked` = the customer unlocked the company. */
export function discloseIdentifier(type: string, value: string, unlocked: boolean): string {
  const v = value ?? '';
  const cls = classifyIdentifier(type, v);
  if (type === 'CIN') return v; // a public registry number, shown before unlock as before
  if (!unlocked) {
    // before unlock: only the GSTIN state code is shown; nothing of a PAN or other number
    return type === 'GSTIN' ? `${v.slice(0, 2)}${'*'.repeat(Math.max(4, v.length - 2))}` : '*'.repeat(Math.max(4, v.length));
  }
  if (cls.dataClass === 'PERSONAL_CONTACT_DATA' && !DISCLOSURE_POLICY.individualPanAfterUnlock) {
    if (type === 'GSTIN') return `${v.slice(0, 2)}${'*'.repeat(10)}${v.slice(12)}`; // the PAN inside the GSTIN is positions 3 to 12
    return `${'*'.repeat(Math.max(4, v.length - 1))}${v.slice(-1)}`;
  }
  return v;
}

// -------------------------------------------------------------------------------------------------------------------
// Masking
// -------------------------------------------------------------------------------------------------------------------

const maskDomainName = (domain: string): string => {
  const parts = domain.split('.');
  const first = parts[0];
  const masked = first.length > 2 ? `${first[0]}***${first[first.length - 1]}` : '***';
  return parts.length > 1 ? `${masked}.${parts.slice(1).join('.')}` : masked;
};

/** Always contains "***". A role mailbox keeps its name; every other local part keeps only its first character. Free-mail providers keep the provider. */
export function maskEmail(email: string | null | undefined, cls: IClassification): string | null {
  if (!email) return null;
  const p = parseEmail(email);
  if (!p) return '***@***.com';
  const local = p.local;
  const roleKept = cls.dataClass === 'BUSINESS_CONTACT_DATA' && ROLE_MAILBOXES.has(local.toLowerCase());
  const maskedLocal = roleKept ? local : local.length > 1 ? `${local[0]}*****` : '*****';
  const domain = isFreeMailDomain(p.domain) ? p.domain : maskDomainName(p.domain);
  return `${maskedLocal}@${domain}`;
}

/** Always contains "***" for any value of 6 digits or more. A business line shows 2 digits at each end; everything else shows only the last 2. */
export function maskPhone(phone: string | null | undefined, cls: IClassification): string | null {
  if (!phone) return null;
  const s = splitPhone(phone);
  const n = s.national;
  if (n.length < 6) return '***-***-****';
  const prefix = s.prefix || (phone.trim().startsWith('+') ? '+' : '');
  if (cls.dataClass === 'BUSINESS_CONTACT_DATA' && n.length >= 8) return `${prefix}${n.slice(0, 2)}${'*'.repeat(n.length - 4)}${n.slice(-2)}`;
  return `${prefix}${'*'.repeat(n.length - 2)}${n.slice(-2)}`;
}

// -------------------------------------------------------------------------------------------------------------------
// Disclosure
// -------------------------------------------------------------------------------------------------------------------

function mayShow(cls: IClassification, unlocked: boolean): boolean {
  if (!unlocked) return false;
  if (cls.dataClass === 'PERSONAL_CONTACT_DATA') return DISCLOSURE_POLICY.personalContactAfterUnlock;
  if (cls.dataClass === 'UNKNOWN') return DISCLOSURE_POLICY.unknownContactAfterUnlock;
  return true;
}

export function discloseEmail(email: string | null | undefined, cls: IClassification, unlocked: boolean): string | null {
  if (!email) return null;
  return mayShow(cls, unlocked) ? email : maskEmail(email, cls);
}

export function disclosePhone(phone: string | null | undefined, cls: IClassification, unlocked: boolean): string | null {
  if (!phone) return null;
  return mayShow(cls, unlocked) ? phone : maskPhone(phone, cls);
}

export interface ICompanyContactRow {
  fullName: string;
  title?: string | null;
  department?: string | null;
  email?: string | null;
  isEmailVerified?: boolean | null;
  phone?: string | null;
  isPhoneVerified?: boolean | null;
  isDirectDial?: boolean | null;
  linkedinUrl?: string | null;
  isPrimary?: boolean | null;
  isDecisionMaker?: boolean | null;
}

/** The customer-facing shape of one company contact. Built field by field: a new database column can never leak through it. */
export function presentCompanyContact(c: ICompanyContactRow, opts: { unlocked: boolean; companyDomains?: readonly string[] }) {
  const emailClass = classifyEmail(c.email, { contactName: c.fullName, companyDomains: opts.companyDomains });
  const phoneClass = classifyPhone(c.phone, { isDirectDial: !!c.isDirectDial });
  const email = discloseEmail(c.email, emailClass, opts.unlocked);
  const phone = disclosePhone(c.phone, phoneClass, opts.unlocked);
  const emailShown = !!c.email && email === c.email;
  const phoneShown = !!c.phone && phone === c.phone;
  const base = {
    title: opts.unlocked ? c.title : c.title || 'Executive',
    department: c.department,
    isEmailVerified: c.isEmailVerified,
    isPhoneVerified: c.isPhoneVerified,
    isPrimary: c.isPrimary,
    isDecisionMaker: c.isDecisionMaker,
  };
  if (opts.unlocked) {
    return {
      fullName: c.fullName,
      ...base,
      email,
      phone,
      linkedinUrl: c.linkedinUrl,
      emailKind: contactKind(emailClass),
      phoneKind: contactKind(phoneClass),
      // false when policy keeps a value masked even after unlock
      isLocked: false,
      ...(c.email && !emailShown ? { emailRestricted: true } : {}),
      ...(c.phone && !phoneShown ? { phoneRestricted: true } : {}),
    };
  }
  return {
    fullName: c.fullName ? `${c.fullName.split(' ')[0]} ***` : 'Decision Maker',
    ...base,
    email,
    phone,
    linkedinUrl: c.linkedinUrl ? 'https://linkedin.com/in/***' : null,
    emailKind: contactKind(emailClass),
    phoneKind: contactKind(phoneClass),
    isLocked: true,
  };
}

// -------------------------------------------------------------------------------------------------------------------
// Field map (documentation as code; asserted by tests and mirrored in docs/DATA_CLASSIFICATION.md)
// -------------------------------------------------------------------------------------------------------------------

export const FIELD_CLASSIFICATION: Readonly<Record<string, DataClass>> = {
  'businesses.name': 'PUBLIC_BUSINESS_DATA',
  'businesses.legal_name': 'PUBLIC_BUSINESS_DATA',
  'businesses.description': 'PUBLIC_BUSINESS_DATA',
  'businesses.metadata': 'SENSITIVE_INTERNAL_DATA',
  'businesses.source_id': 'SENSITIVE_INTERNAL_DATA',
  'business_contacts.full_name': 'INDIVIDUAL_WORK_CONTACT',
  'business_contacts.title': 'INDIVIDUAL_WORK_CONTACT',
  'business_contacts.email': 'UNKNOWN', // decided per value: classifyEmail
  'business_contacts.phone': 'UNKNOWN', // decided per value: classifyPhone
  'business_contacts.linkedin_url': 'INDIVIDUAL_WORK_CONTACT',
  'business_contacts.metadata': 'SENSITIVE_INTERNAL_DATA',
  'business_locations.address_line1': 'BUSINESS_CONTACT_DATA',
  'business_identifiers.CIN': 'PUBLIC_BUSINESS_DATA',
  'business_identifiers.GSTIN': 'PUBLIC_BUSINESS_DATA', // PERSONAL when it embeds an individual PAN
  'business_identifiers.PAN': 'BUSINESS_CONTACT_DATA', // PERSONAL for an individual PAN
  'person_contacts.contact_value': 'INDIVIDUAL_WORK_CONTACT', // work e-mail and phones only; personal e-mail is not modelled
  'people_evidence.source_url': 'SENSITIVE_INTERNAL_DATA',
  'users.email': 'CUSTOMER_ACCOUNT_DATA',
  'users.password_hash': 'SECURITY_DATA',
  'users.two_factor_secret': 'SECURITY_DATA',
  'payment_orders.*': 'PAYMENT_DATA',
  'audit_logs.*': 'SECURITY_DATA',
};

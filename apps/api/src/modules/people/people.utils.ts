import { createHash } from 'crypto';
import type { ContactType } from './people.constants';

const HONORIFICS = /^(mr|mrs|ms|miss|dr|shri|smt|sri|prof|er|ca|cs|adv)\.?\s+/i;

export function normalizePersonName(fullName: string): string {
  return (fullName ?? '')
    .toLowerCase()
    .replace(HONORIFICS, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitPersonName(fullName: string): {
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
} {
  const parts = (fullName ?? '')
    .replace(HONORIFICS, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return { firstName: null, middleName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0], middleName: null, lastName: null };
  return {
    firstName: parts[0],
    middleName: parts.length > 2 ? parts.slice(1, -1).join(' ') : null,
    lastName: parts[parts.length - 1],
  };
}

/** "https://in.linkedin.com/in/John-Doe/?trk=x" -> "linkedin.com/in/john-doe". Non-profile URLs -> null. */
export function normalizeLinkedinUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.trim().match(/^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/(in|pub)\/([^/?#\s]+)/i);
  if (!match) return null;
  try {
    return `linkedin.com/in/${decodeURIComponent(match[2]).toLowerCase()}`;
  } catch {
    return null;
  }
}

export interface IPhoneParse {
  ok: boolean;
  /** E.164, e.g. +919876543210. Only set when ok. */
  e164?: string;
  reason?: string;
}

/**
 * Strict phone parsing. Never invents digits and never guesses a country for ambiguous input:
 * - "+" / "00" prefixed numbers keep their own country code (8-15 digits; +91 needs 10 national digits)
 * - bare Indian formats are accepted: 10 digits, 0 + 10 digits, 91 + 10 digits (national part starts 2-9)
 * - anything else without a "+" is rejected as ambiguous instead of guessed
 */
export function parsePhone(raw: string | null | undefined): IPhoneParse {
  const cleaned = (raw ?? '').trim().split(/\b(?:ext|extn|x)\b\.?/i)[0];
  if (!cleaned) return { ok: false, reason: 'empty' };
  if (/[a-z]/i.test(cleaned)) return { ok: false, reason: 'contains letters' };
  let digits = cleaned.replace(/\D/g, '');
  let intl = cleaned.startsWith('+');
  if (!intl && digits.startsWith('00')) {
    intl = true;
    digits = digits.slice(2);
  }
  if (digits.length < 8 || digits.length > 15) return { ok: false, reason: 'bad length' };
  if (/^(\d)\1+$/.test(digits) || digits === '1234567890' || digits === '0123456789') {
    return { ok: false, reason: 'placeholder number' };
  }
  if (intl) {
    if (digits.startsWith('91')) {
      const national = digits.slice(2);
      return /^[2-9]\d{9}$/.test(national)
        ? { ok: true, e164: `+91${national}` }
        : { ok: false, reason: 'invalid Indian number' };
    }
    return digits.startsWith('0') ? { ok: false, reason: 'invalid country code' } : { ok: true, e164: `+${digits}` };
  }
  if (digits.length === 10 && /^[2-9]/.test(digits)) return { ok: true, e164: `+91${digits}` };
  if (digits.length === 11 && digits.startsWith('0') && /^[2-9]/.test(digits[1])) {
    return { ok: true, e164: `+91${digits.slice(1)}` };
  }
  if (digits.length === 12 && digits.startsWith('91') && /^[2-9]/.test(digits[2])) {
    return { ok: true, e164: `+${digits}` };
  }
  return { ok: false, reason: 'ambiguous format (add a + country code)' };
}

export function normalizeContactValue(type: ContactType, value: string): string {
  const v = (value ?? '').trim();
  if (type === 'WORK_EMAIL') return v.toLowerCase();
  const parsed = parsePhone(v);
  return parsed.ok ? parsed.e164! : `+${v.replace(/\D/g, '')}`;
}

export function isValidEmail(value: string): boolean {
  const v = (value ?? '').trim();
  if (v.length > 254 || /\s/.test(v) || v.includes('..')) return false;
  const m = v.match(/^([^@]+)@([^@]+)$/);
  if (!m || m[1].length > 64) return false;
  const [, local, domain] = m;
  if (local.startsWith('.') || local.endsWith('.')) return false;
  return /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain);
}

export function isValidPhone(value: string): boolean {
  return parsePhone(value).ok;
}

const GENERIC_MAILBOXES = new Set([
  'info', 'contact', 'contactus', 'sales', 'support', 'admin', 'hello', 'office', 'enquiry', 'enquiries',
  'inquiry', 'mail', 'accounts', 'hr', 'careers', 'jobs', 'marketing', 'service', 'noreply', 'no-reply', 'donotreply',
]);

/** Shared / role mailboxes identify a team, not a person: never stored as a person's email or used to match identity. */
export function isGenericMailbox(email: string): boolean {
  return GENERIC_MAILBOXES.has(email.trim().toLowerCase().split('@')[0]);
}

/**
 * Conservative name compatibility for matching on a strong shared identifier (e.g. the same work email):
 * equal, or same surname with a first name that is an initial / prefix of the other ("A. Kumar" ~ "Arun Kumar").
 * Different surnames never match.
 */
export function namesCompatible(a: string, b: string): boolean {
  if (a === b) return true;
  const ta = a.split(' ').filter(Boolean);
  const tb = b.split(' ').filter(Boolean);
  if (ta.length < 2 || tb.length < 2) return false;
  if (ta[ta.length - 1] !== tb[tb.length - 1]) return false;
  const [fa, fb] = [ta[0], tb[0]];
  return fa === fb || (fa.length === 1 && fb.startsWith(fa)) || (fb.length === 1 && fa.startsWith(fb));
}

export function clampScore(score: number | null | undefined): number {
  if (score === null || score === undefined || Number.isNaN(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** Stable identity of an evidence row: same person + target + source + evidence type + source locator = same row. */
export function evidenceFingerprint(parts: Array<string | null | undefined>): string {
  return createHash('sha256').update(parts.map((p) => p ?? '').join('|')).digest('hex');
}

export function normalizeSourceLocator(url?: string | null, ref?: string | null): string {
  return (url ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/#?]+$/, '') || (ref ?? '').trim();
}

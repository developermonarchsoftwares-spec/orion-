import { scrubText } from './scrub';

/**
 * Structured redaction (Phase 13) for values that are logged, audited or reported as OBJECTS.
 *
 * `scrubText` cleans text. This function walks nested objects and arrays and decides by KEY as well as by value:
 *  - a key that names a secret or credential (matched by meaning, not by an exact list) loses its value entirely;
 *  - a key that names a personal contact detail (e-mail, phone, profile link, address, name of a person) is replaced by a marker;
 *  - every remaining string goes through `scrubText` (tokens, e-mail addresses, connection strings, long digit runs);
 *  - size is bounded (depth, keys, array length, string length), cycles are cut, binary data is never copied.
 *
 * It is deliberately blunt: it would rather hide a harmless value than ship a credential. The numeric and boolean
 * fields that make a log line useful for an investigation (counts, status codes, durations, flags, ids) are kept.
 */
export interface IRedactOptions {
  maxDepth?: number;
  maxKeys?: number;
  maxItems?: number;
  maxString?: number;
}

/** Key fragments (after lower-casing and removing separators) whose value is a secret. Matched as a substring. */
const SECRET_KEY_PARTS = [
  'password', 'passwd', 'pwd', 'secret', 'token', 'otp', 'passcode', 'apikey', 'authorization', 'auth', 'cookie', 'session', 'credential',
  'signature', 'privatekey', 'privkey', 'accesskey', 'secretkey', 'bearer', 'jwt', 'cvv', 'cvc', 'cardnumber', 'cardno', 'aadhaar', 'aadhar',
  'ssn', 'recoverycode', 'totp', 'mfa', 'captcha', 'hash', 'salt', 'seed', 'dsn', 'connectionstring', 'databaseurl', 'webhooksecret', 'encryptionkey',
  'masterkey', 'signingkey', 'sealed', 'ciphertext',
];
/** Substrings that look secret-like but are not (kept so the diagnostics stay useful). */
const SECRET_KEY_EXCEPTIONS = new Set([
  'expiresat', 'authenticated', 'author', 'authoremail', 'authmethod', 'authenticationmethod', 'hashed', 'sessioncount', 'tokencount', 'tokenfamily',
  'pannumberlength', 'panel', 'company', 'companyname', 'companies', 'expansion', 'spanish', 'company_id', 'tokensrevoked', 'sessionsrevoked',
  'sessionid', 'familyid', 'requestid', 'traceid', 'spanid',
]);
/** Key fragments whose value is a personal contact detail or a person's name. */
const PERSONAL_KEY_PARTS = ['email', 'mail', 'phone', 'mobile', 'msisdn', 'whatsapp', 'linkedin', 'address', 'fullname', 'firstname', 'lastname', 'displayname', 'contactname', 'dob', 'birth'];
/** Contact-ish keys that are structural, not personal. */
const PERSONAL_KEY_EXCEPTIONS = new Set(['emailverified', 'isemailverified', 'phoneverified', 'isphoneverified', 'emailkind', 'phonekind', 'emailclass', 'phoneclass', 'ipaddress', 'hasemail', 'hasphone', 'emaildigest', 'emailhash', 'mailtransport', 'mailservice']);

const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Exact normalised names of identifiers that are secret on their own (a substring test would also hit company, panel, span, japan ...). */
const SECRET_KEY_EXACT = new Set(['pan', 'pannumber', 'panno', 'pancard', 'panvalue', 'pin', 'otpcode']);

export function isSecretKey(key: string): boolean {
  const n = norm(key);
  if (!n || SECRET_KEY_EXCEPTIONS.has(n)) return false;
  if (SECRET_KEY_EXACT.has(n)) return true;
  return SECRET_KEY_PARTS.some((p) => n.includes(p));
}

export function isPersonalKey(key: string): boolean {
  const n = norm(key);
  if (!n || PERSONAL_KEY_EXCEPTIONS.has(n)) return false;
  return PERSONAL_KEY_PARTS.some((p) => n.includes(p));
}

/** Identifier keys (requestId, traceId, userId, entityId ...): their short, plain values are kept exactly, or a 13-digit timestamp inside a request id would be mistaken for a card number. */
const isIdKey = (k: string) => /(^|[a-z])id$/i.test(k.replace(/[^A-Za-z0-9]/g, ''));
const PLAIN_ID = /^[A-Za-z0-9._:-]{1,80}$/;

export const REDACTED = '[redacted]';
export const REDACTED_PERSONAL = '[personal-data]';

export function redactDeep(value: unknown, opts: IRedactOptions = {}): unknown {
  const o = { maxDepth: opts.maxDepth ?? 6, maxKeys: opts.maxKeys ?? 60, maxItems: opts.maxItems ?? 50, maxString: opts.maxString ?? 500 };
  const seen = new WeakSet<object>();
  const walk = (v: unknown, depth: number): unknown => {
    if (v === null || v === undefined) return v;
    switch (typeof v) {
      case 'string':
        return scrubText(v, o.maxString);
      case 'number':
        return Number.isFinite(v) ? v : String(v);
      case 'boolean':
        return v;
      case 'bigint':
        return v.toString();
      case 'function':
      case 'symbol':
        return '[unsupported]';
    }
    const obj = v as object;
    if (Buffer.isBuffer(obj) || obj instanceof Uint8Array || obj instanceof ArrayBuffer) return `[binary ${(obj as { byteLength: number }).byteLength} bytes]`;
    if (obj instanceof Date) return Number.isNaN(obj.getTime()) ? '[invalid-date]' : obj.toISOString();
    if (obj instanceof Error) return { name: obj.name, message: scrubText(obj.message, o.maxString) };
    if (seen.has(obj)) return '[circular]';
    if (depth >= o.maxDepth) return '[truncated]';
    seen.add(obj);
    try {
      if (Array.isArray(obj)) {
        const out = obj.slice(0, o.maxItems).map((x) => walk(x, depth + 1));
        if (obj.length > o.maxItems) out.push(`[+${obj.length - o.maxItems} more]`);
        return out;
      }
      const out: Record<string, unknown> = {};
      let n = 0;
      for (const [k, val] of Object.entries(obj as Record<string, unknown>)) {
        if (n++ >= o.maxKeys) {
          out['[more]'] = `${Object.keys(obj).length - o.maxKeys} keys omitted`;
          break;
        }
        if (val === undefined) continue;
        // a secret or personal KEY hides its string or object value; counts, flags and ids under such a key (otpAttempts, mfaRequired) stay useful
        const hideable = typeof val === 'string' ? val !== '' : typeof val === 'object' && val !== null;
        if (hideable && isSecretKey(k)) out[k] = REDACTED;
        else if (hideable && isPersonalKey(k)) out[k] = REDACTED_PERSONAL;
        else if (typeof val === 'string' && isIdKey(k) && PLAIN_ID.test(val) && !isSecretKey(k)) out[k] = val;
        else out[k] = walk(val, depth + 1);
      }
      return out;
    } finally {
      seen.delete(obj);
    }
  };
  return walk(value, 0);
}

/** Headers for a log or audit line: a drop list is not enough, so sensitive names are removed by meaning and every value is scrubbed. */
export function redactHeaders(headers: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (isSecretKey(k) || /^(x-)?forwarded-for$|^x-real-ip$/i.test(k)) continue;
    out[k.toLowerCase()] = scrubText(Array.isArray(v) ? v.join(', ') : v, 200);
  }
  return out;
}

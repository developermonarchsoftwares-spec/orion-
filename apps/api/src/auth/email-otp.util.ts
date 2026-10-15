import * as crypto from 'crypto';

/**
 * Sign-up e-mail verification codes: pure helpers (no I/O). The web gateway has a twin of this file (`ownus/src/lib/email-otp.ts`); both must give
 * the same hash for the same input, which a known-answer test in each package pins.
 */

export type EmailOtpPurpose = 'REGISTER';
export const EMAIL_OTP_PURPOSES: readonly EmailOtpPurpose[] = ['REGISTER'];

export const EMAIL_OTP_TTL_SECONDS = 5 * 60;
export const EMAIL_OTP_MAX_ATTEMPTS = 5;
export const EMAIL_OTP_RESEND_COOLDOWN_SECONDS = 60;
export const EMAIL_OTP_DAILY_LIMIT_PER_EMAIL = 10;
export const EMAIL_OTP_HOURLY_LIMIT_PER_IP = 20;
/** How long a correct code stays exchangeable for an account (the user is filling in the rest of the form). */
export const EMAIL_OTP_PROOF_TTL_SECONDS = 15 * 60;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Trimmed, lower-case, or null when it is not a plausible address (one @, no spaces, bounded length). */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  if (e.length < 5 || e.length > 254 || !EMAIL_RE.test(e) || e.split('@').length !== 2) return null;
  return e;
}

/** Exactly six digits (a pasted code may contain spaces or a dash; those are stripped). Null otherwise. */
export function normalizeOtp(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const s = String(raw).replace(/[\s-]/g, '');
  return /^\d{6}$/.test(s) ? s : null;
}

/** Uniformly random six-digit code from the operating system's CSPRNG (no modulo bias: `randomInt`). */
export function generateOtp(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function otpKey(env: NodeJS.ProcessEnv): string {
  const base = (env.EMAIL_OTP_SECRET || env.JWT_ACCESS_SECRET || '').trim();
  return crypto.createHmac('sha256', base || 'orion-email-otp').update('orion:email-otp').digest('hex');
}

/** HMAC-SHA256 of purpose, address and code, bound together, so a hash cannot be replayed for another address or purpose. */
export function hashEmailOtp(email: string, purpose: string, otp: string, env: NodeJS.ProcessEnv = process.env): string {
  return crypto.createHmac('sha256', otpKey(env)).update(`${purpose}:${email}:${otp}`).digest('hex');
}

/** Keyed digest of a client address for rate limiting; the address itself is not stored. */
export function hashClientAddress(ip: string | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!ip) return null;
  return crypto.createHmac('sha256', otpKey(env)).update(`ip:${ip}`).digest('hex').slice(0, 32);
}

export function hashProof(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

/** A new one-time proof: the token the client keeps, and the hash that is stored. */
export function newProof(challengeId: string): { token: string; hash: string } {
  const secret = crypto.randomBytes(32).toString('base64url');
  return { token: `${challengeId}.${secret}`, hash: hashProof(secret) };
}

/** Splits `<uuid>.<secret>`; null when malformed. */
export function parseProof(token: unknown): { id: string; hash: string } | null {
  if (typeof token !== 'string' || token.length > 200) return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const id = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[A-Za-z0-9_-]{20,100}$/.test(secret)) return null;
  return { id, hash: hashProof(secret) };
}

/** Constant-time comparison of two hex strings; never throws. */
export function safeEqualHex(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(String(a), 'utf8');
    const bb = Buffer.from(String(b), 'utf8');
    return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

/** `a***e@g***l.com`: enough for the user to recognise the address, not enough to reconstruct it. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  const dot = domain.lastIndexOf('.');
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  const m = (s: string) => (s.length <= 1 ? `${s}***` : `${s[0]}***${s.length > 2 ? s[s.length - 1] : ''}`);
  return `${m(local)}@${m(host)}${tld}`;
}

/**
 * Whether registration must present a verified-address proof. ALWAYS true in production: there is no setting that turns it off there.
 * Outside production it can be switched off (REQUIRE_REGISTRATION_OTP=false) so local development without a mail relay, and the existing
 * test suites that register accounts directly, keep working.
 */
export function registrationOtpRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env.NODE_ENV || '').trim() === 'production') return true;
  return !/^(0|false|no|off)$/i.test((env.REQUIRE_REGISTRATION_OTP || '').trim());
}

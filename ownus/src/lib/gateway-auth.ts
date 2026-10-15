/* eslint-disable @typescript-eslint/no-explicit-any -- decoded JWT payloads are untyped by nature */
import crypto from 'crypto';

/**
 * Authentication for the gateway's native routes (Phase 6.17). The NestJS API stays the single source of truth; these helpers make
 * the native handlers no weaker than it:
 *  - secrets come ONLY from the environment. There is no built-in default: a missing secret means "authentication is not
 *    configured" and the caller fails closed (503), never "use a well-known key";
 *  - a token is accepted only with a valid HS256 signature, an unexpired `exp`, a `sub`, a matching `iss` / `aud` when present, and
 *    the right purpose (`typ`): an access token is never a refresh or password-reset token and vice versa;
 *  - identity is derived only from such a token. Never from an unsigned token, a request body, a query string or a default account.
 */

export const sanitizeEnvValue = (val?: string): string => {
  if (!val) return '';
  let cleaned = String(val).replace(/[\r\n]+/g, '').trim();
  cleaned = cleaned.replace(/^["'`]|["'`]$/g, '').trim();
  return cleaned.replace(/^[A-Za-z0-9_]+=\s*/, '').trim().replace(/^["'`]|["'`]$/g, '').trim();
};

/** Secrets shorter than this are refused as "not configured" (a placeholder is not a secret). */
export const MIN_SECRET_LENGTH = 16;

/** Example and placeholder shapes from the committed .env examples; the same pattern as apps/api/src/config/secrets.ts. */
const PLACEHOLDER_SECRET = /^(orion_|your[_-]|change[_-]?me|generate|example|placeholder|replace[_-]|xyz123)/i;
// digests (never values) of signing secrets published in the docker-compose development setup; same list as apps/api/src/config/secrets.ts
const KNOWN_PUBLIC_SECRET_SHA256 = new Set<string>([
  '694d62f43cc94705bb5b68d065501cd00e76017c3c92ccc8721a7b67a8e0c2bc',
  '301b7918a05559e399a15a7dd75522aa77720076698685a7266b032df93cb13b',
]);

const configured = (v: string, env: NodeJS.ProcessEnv = process.env): string | null => {
  if (v.length < MIN_SECRET_LENGTH) return null;
  // a public example value is not a secret: in production it counts as not configured (the gateway then refuses to sign or verify)
  if (env.NODE_ENV === 'production' && (PLACEHOLDER_SECRET.test(v) || KNOWN_PUBLIC_SECRET_SHA256.has(crypto.createHash('sha256').update(v).digest('hex')))) return null;
  return v;
};

// The same two variables the NestJS API reads (config/index.ts), so a token signed by one verifies in the other. There is no
// generic JWT_SECRET fallback: two different secrets for one purpose is how a token "valid" in one place is rejected in the other.
export const accessSecret = (env = process.env): string | null => configured(sanitizeEnvValue(env.JWT_ACCESS_SECRET), env);
export const refreshSecret = (env = process.env): string | null => configured(sanitizeEnvValue(env.JWT_REFRESH_SECRET), env);

/** Purpose-bound keys derived from the access secret, so a leaked reset / OTP value can never be replayed as an access token. */
const derive = (secret: string | null, purpose: string): string | null => (secret ? crypto.createHmac('sha256', secret).update(`orion:${purpose}`).digest('hex') : null);
export const resetSecret = (env = process.env): string | null => derive(accessSecret(env), 'password-reset');
export const otpSecret = (env = process.env): string | null => derive(accessSecret(env), 'admin-otp');

export type TokenPurpose = 'access' | 'refresh' | 'password_reset';

export function signToken(payload: Record<string, any>, secret: string, expiresInSec: number, env = process.env, nowSec = Math.floor(Date.now() / 1000)): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const full = { ...payload, iat: nowSec, exp: nowSec + expiresInSec, iss: env.JWT_ISSUER || 'orion-api', aud: env.JWT_AUDIENCE || 'orion-client' };
  const h = Buffer.from(JSON.stringify(header)).toString('base64url');
  const p = Buffer.from(JSON.stringify(full)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

/** Returns the payload of a valid token of the given purpose, or null for anything else. Never throws. */
export function verifyToken(
  token: string,
  secret: string | null,
  purpose: TokenPurpose,
  env = process.env,
  nowSec = Math.floor(Date.now() / 1000),
): Record<string, any> | null {
  try {
    if (!secret || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, sig] = parts;
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    if (header?.alg !== 'HS256') return null;
    const expected = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest();
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    if (!payload || typeof payload !== 'object') return null;
    if (typeof payload.exp !== 'number' || payload.exp <= nowSec) return null;
    if (typeof payload.nbf === 'number' && payload.nbf > nowSec + 5) return null;
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
    if (payload.iss !== undefined && payload.iss !== (env.JWT_ISSUER || 'orion-api')) return null;
    if (payload.aud !== undefined && payload.aud !== (env.JWT_AUDIENCE || 'orion-client')) return null;
    const typ = payload.type ?? 'access';
    if (purpose === 'access' ? typ !== 'access' && typ !== undefined && typ !== 'ACCESS' : typ !== purpose) return null;
    return payload;
  } catch {
    return null;
  }
}

export interface IAuthContext {
  /** Verified subject (a user id, or an admin-session id for OTP admins). */
  sub: string;
  email: string | null;
  role: string;
  payload: Record<string, any>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID.test(s);

export type AuthResult = { ok: true; auth: IAuthContext } | { ok: false; reason: 'NOT_CONFIGURED' | 'MISSING' | 'INVALID' };

/** Authenticates a request from its Authorization: Bearer header only. */
export function authenticate(headers: { get(name: string): string | null }, env = process.env, nowSec = Math.floor(Date.now() / 1000)): AuthResult {
  const secret = accessSecret(env);
  if (!secret) return { ok: false, reason: 'NOT_CONFIGURED' };
  const header = headers.get('authorization') || '';
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  if (!m) return { ok: false, reason: 'MISSING' };
  const payload = verifyToken(m[1], secret, 'access', env, nowSec);
  if (!payload) return { ok: false, reason: 'INVALID' };
  return { ok: true, auth: { sub: payload.sub, email: typeof payload.email === 'string' ? payload.email : null, role: String(payload.role ?? 'USER'), payload } };
}

export const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN'] as const;

// ---------------------------------------------------------------------------------------------- route policy
/**
 * Who may call a route the gateway handles itself. Routes not listed here are proxied to the NestJS API, which authenticates
 * them. PUBLIC routes carry their own credential checks (login, refresh and reset verify their own token or password).
 */
const PUBLIC_NATIVE = new Set([
  'auth/login', 'auth/jwt/login', 'auth/register', 'auth/send-otp', 'auth/verify-otp', 'auth/refresh', 'auth/forgot-password', 'auth/reset-password', 'auth/google', 'auth/google/callback',
  'health/liveness', 'health/readiness',
  'admin/auth/send-otp', 'admin/auth/verify-otp', 'admin/auth/logout', 'admin/import/template', 'admin/template/csv',
  'discover/filter-options', 'discover/search', 'discover/businesses', 'credit/packages', 'credit/config',
]);

/** Handled natively BEFORE any upstream attempt (always native). */
const ADMIN_PRE = new Set([
  'admin/import/preview', 'admin/import/submit', 'admin/import/batches', 'admin/filter-options', 'admin/businesses', 'admin/users',
  'admin/transactions', 'admin/activity-logs',
]);
const USER_PRE = new Set([
  'auth/me', 'user/profile', 'user/avatar', 'user/upload-avatar', 'user/settings', 'user/change-password', 'auth/change-password',
  'settings', 'settings/company', 'settings/notifications', 'settings/preferences', 'settings/change-password',
  'discover/export', 'export/unlocked-leads',
]);

/** Handled natively ONLY when the NestJS API cannot be reached (normally proxied, and authenticated there). */
const ADMIN_FALLBACK = new Set(['admin/duplicates', 'credit/admin/packages']);
const USER_FALLBACK = new Set([
  'credit/wallet', 'credit/transactions', 'payments/history', 'payments/create-order', 'payments/verify',
  'dashboard/summary', 'unlock/user-leads', 'unlock/business', 'saved-leads', 'saved-searches',
]);

export type RoutePolicy = 'PUBLIC' | 'USER' | 'ADMIN' | 'UPSTREAM';
export type RoutePhase = 'pre' | 'fallback';

/**
 * `pre`: before an upstream attempt (only the always-native routes are checked, so a normally proxied route is never blocked by
 * the gateway's own configuration). `fallback`: after the upstream failed, when the gateway answers itself.
 */
export function routePolicy(fullPath: string, method: string, phase: RoutePhase = 'pre'): RoutePolicy {
  if (fullPath === 'discover/filter-options' && method === 'POST') return 'ADMIN';
  if (PUBLIC_NATIVE.has(fullPath)) return 'PUBLIC';
  if (ADMIN_PRE.has(fullPath)) return 'ADMIN';
  if (USER_PRE.has(fullPath)) return 'USER';
  if (phase === 'fallback') {
    if (ADMIN_FALLBACK.has(fullPath) || fullPath.startsWith('admin/invoices')) return 'ADMIN';
    if (USER_FALLBACK.has(fullPath) || fullPath.startsWith('unlock/status/') || fullPath.startsWith('payments/invoice') || fullPath.startsWith('invoices/')) return 'USER';
  }
  return 'UPSTREAM';
}

export type AccessDecision = { allow: true; auth: IAuthContext | null } | { allow: false; status: 401 | 403 | 503; errorCode: string; message: string };

/** The single access decision for a natively handled route. */
export function decideAccess(policy: RoutePolicy, headers: { get(name: string): string | null }, env = process.env, nowSec?: number): AccessDecision {
  if (policy === 'UPSTREAM') return { allow: true, auth: null };
  const r = authenticate(headers, env, nowSec);
  if (policy === 'PUBLIC') return { allow: true, auth: r.ok ? r.auth : null }; // identity is optional and only ever the verified one
  if (!r.ok) {
    if (r.reason === 'NOT_CONFIGURED') return { allow: false, status: 503, errorCode: 'AUTH_NOT_CONFIGURED', message: 'Authentication is not configured on this gateway.' };
    return { allow: false, status: 401, errorCode: 'UNAUTHORIZED', message: 'A valid session is required.' };
  }
  if (policy === 'ADMIN' && !(ADMIN_ROLES as readonly string[]).includes(r.auth.role)) {
    return { allow: false, status: 403, errorCode: 'FORBIDDEN', message: 'You do not have permission to do this.' };
  }
  if (policy === 'USER' && !isUuid(r.auth.sub)) {
    // an admin-session token (OTP login) is not a customer account: it has no wallet and cannot spend or buy credits
    return { allow: false, status: 403, errorCode: 'FORBIDDEN', message: 'This action requires a customer account.' };
  }
  return { allow: true, auth: r.auth };
}

/**
 * Lifetime of an administrator session (the OTP-issued token and its cookie). Default 12 hours, replacing the earlier 7 days; settable
 * with ADMIN_SESSION_TTL_SECONDS and always kept between 15 minutes and 7 days. The console returns to its sign-in screen on expiry.
 */
export const adminSessionTtlSeconds = (env: NodeJS.ProcessEnv = process.env): number => {
  const raw = Math.floor(Number(env.ADMIN_SESSION_TTL_SECONDS));
  const v = Number.isFinite(raw) && raw > 0 ? raw : 12 * 3600;
  return Math.min(Math.max(v, 15 * 60), 7 * 24 * 3600);
};

/**
 * Whether an answer from the NestJS API is final for a credential endpoint (login, register, refresh, reset, admin code). The gateway
 * keeps a native fallback for when the API is unreachable, but a definitive refusal (wrong password, account lockout 429, bad code,
 * conflict) must be returned as is: falling back to the native handler on a 401/403/429 would re-run the attempt there and bypass the
 * API's lockout, rate limits and MFA step. Only a server error or a missing route (404) counts as "API unavailable".
 */
export const isDefinitiveUpstream = (status: number): boolean => status < 500 && status !== 404;

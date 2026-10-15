/**
 * Removal of personal data and secrets from anything that leaves the process towards a log aggregator, an error tracker or a trace
 * backend. Applied to log messages, error messages, stack text and request headers. It is deliberately blunt: it would rather hide a
 * harmless value than ship a credential.
 */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g;
const SECRET_KV = /\b(password|passwd|pwd|secret|token|api[_-]?key|apikey|authorization|signature|credential|otp|captcha|refresh[_-]?token|access[_-]?token)(["']?\s*[:=]\s*["']?)([^\s"',;&}]{3,})/gi;
const LONG_DIGITS = /\b\d{12,19}\b/g; // card / account numbers
const DB_URL = /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s'"]+/gi;
const LONG_HEX = /\b(whsec_|sk_live_|rzp_live_|pk_live_|orn_live_)[A-Za-z0-9_-]{6,}\b/g;

export function scrubText(input: unknown, max = 2000): string {
  let s = typeof input === 'string' ? input : input instanceof Error ? input.message : safeStringify(input);
  s = s
    .replace(DB_URL, '[connection-string]')
    .replace(BEARER, '$1 [token]')
    .replace(JWT, '[token]')
    .replace(LONG_HEX, '[secret]')
    .replace(SECRET_KV, '$1$2[redacted]')
    .replace(EMAIL, '[email]')
    .replace(LONG_DIGITS, '[number]');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
function safeStringify(v: unknown): string {
  try {
    return typeof v === 'string' ? v : (JSON.stringify(v) ?? String(v));
  } catch {
    return String(v);
  }
}

const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-refresh-token', 'x-api-key', 'x-captcha-token', 'x-razorpay-signature', 'x-orion-signature', 'proxy-authorization', 'x-csrf-token']);

/** Headers safe to attach to an error report: sensitive ones are dropped entirely, the rest are scrubbed and bounded. */
export function scrubHeaders(headers: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    const key = k.toLowerCase();
    if (SENSITIVE_HEADERS.has(key)) continue;
    out[key] = scrubText(Array.isArray(v) ? v.join(', ') : v, 200);
  }
  return out;
}

const SENSITIVE_QUERY = /^(token|password|code|secret|key|signature|sig|otp|auth|authorization|api_?key|access_?token|refresh_?token|captcha|email)$/i;

/** A URL path with the query string reduced to parameter names (values may hold search text, ids, tokens or e-mail addresses). */
export function scrubUrl(url: string | undefined): { path: string; queryKeys: string[] } {
  const raw = String(url ?? '');
  const i = raw.indexOf('?');
  const path = (i === -1 ? raw : raw.slice(0, i)).replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, ':id');
  const keys = i === -1 ? [] : raw.slice(i + 1).split('&').map((p) => decodeURIComponentSafe(p.split('=')[0])).filter(Boolean);
  return { path: scrubText(path, 300), queryKeys: keys.filter((k) => !SENSITIVE_QUERY.test(k)).slice(0, 20) };
}

function decodeURIComponentSafe(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

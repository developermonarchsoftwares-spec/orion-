import * as net from 'net';
import { isBlockedAddress } from '../../modules/integrations/net/safe-http';

/**
 * Imported and enriched URLs (a company website, a LinkedIn page, a source link) are untrusted text that Orion stores and later shows
 * to customers as links. This turns such a value into a safe public web address or refuses it, with the reason:
 *  - only http and https (a `javascript:`, `data:`, `file:`, `ftp:` or `mailto:` value is never stored as a link);
 *  - no credentials in the URL, no control characters or whitespace inside it, a bounded length;
 *  - a real public host: not `localhost`, not a single-label name, not an IP address from a private, loopback, link-local or
 *    otherwise non-public range (so that a future fetcher can never be pointed at an internal address through stored data).
 * Nothing here makes a network request: it cannot prove that a name resolves to a public address (DNS can change), so any code that
 * FETCHES a stored URL must still use `safeRequest`, which checks the address it actually connects to.
 */
export type UrlRejection = 'EMPTY' | 'TOO_LONG' | 'INVALID' | 'SCHEME' | 'CREDENTIALS' | 'HOST_NOT_PUBLIC' | 'NOT_LINKEDIN';

export type PublicUrlResult = { ok: true; url: string; host: string } | { ok: false; reason: UrlRejection };

export const MAX_STORED_URL_LENGTH = 500;
// eslint-disable-next-line no-control-regex -- control characters and whitespace anywhere in a URL are rejected on purpose
const FORBIDDEN_CHARS = /[\u0000- \u007f]/;
const HAS_AUTHORITY_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const NON_PUBLIC_NAME = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp)$/i;

export function parsePublicUrl(raw: unknown): PublicUrlResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'INVALID' };
  const text = raw.trim();
  if (!text) return { ok: false, reason: 'EMPTY' };
  if (text.length > MAX_STORED_URL_LENGTH) return { ok: false, reason: 'TOO_LONG' };
  if (FORBIDDEN_CHARS.test(text)) return { ok: false, reason: 'INVALID' };

  // A bare address ("example.com/about") gets https. Anything else with a scheme must be http or https. A value such as
  // "javascript:alert(1)" has no "//", so it is treated as a bare host, becomes "https://javascript:alert(1)", and fails to parse.
  const candidate = text.startsWith('//') ? `https:${text}` : HAS_AUTHORITY_SCHEME.test(text) ? text : `https://${text}`;
  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    return { ok: false, reason: 'INVALID' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'SCHEME' };
  if (u.username || u.password) return { ok: false, reason: 'CREDENTIALS' };
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return { ok: false, reason: 'INVALID' };

  if (net.isIP(host)) {
    if (isBlockedAddress(host)) return { ok: false, reason: 'HOST_NOT_PUBLIC' };
  } else {
    if (!host.includes('.') || NON_PUBLIC_NAME.test(host.replace(/\.$/, ''))) return { ok: false, reason: 'HOST_NOT_PUBLIC' };
    if (!/^[a-z0-9.-]+$/.test(host)) return { ok: false, reason: 'INVALID' }; // the URL parser has already converted a non-ASCII name to punycode
  }

  // keep the shape people typed ("https://example.com", not "https://example.com/") when there is nothing after the host
  const bare = u.pathname === '/' && !u.search && !u.hash;
  return { ok: true, url: bare ? `${u.protocol}//${u.host}` : u.href, host };
}

/** A LinkedIn page: the same rules, and the host must be LinkedIn's. */
export function parseLinkedinPageUrl(raw: unknown): PublicUrlResult {
  const r = parsePublicUrl(raw);
  if (!r.ok) return r;
  if (!(r.host === 'linkedin.com' || r.host.endsWith('.linkedin.com') || r.host === 'lnkd.in')) return { ok: false, reason: 'NOT_LINKEDIN' };
  return r;
}

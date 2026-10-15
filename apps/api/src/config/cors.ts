/**
 * Browser origins allowed to call the API with credentials (Phase 14).
 *
 * Development: the local web app by default. Production: NOTHING by default. The earlier default allowed http://localhost:3000 in production
 * too, so a page served from a developer's machine (or any process on a visitor's own computer) could make credentialed calls to the
 * production API. The web app reaches the API through its own server-side gateway, which is not a cross-origin browser call, so an empty
 * production list is a valid configuration; set CORS_ORIGINS only for a browser origin that genuinely calls the API directly.
 *
 * An explicit production value must be a comma-separated list of exact https origins: no wildcard, no localhost or loopback, no plain http,
 * no path, query or credentials.
 */
export const DEV_CORS_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

export interface ICorsResult {
  origins: string[];
  problems: string[];
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);

export function parseCorsOrigins(raw: string | undefined, production: boolean): ICorsResult {
  const text = (raw ?? '').trim();
  if (!text) return { origins: production ? [] : [...DEV_CORS_ORIGINS], problems: [] };
  const origins: string[] = [];
  const problems: string[] = [];
  for (const piece of text.split(',')) {
    const o = piece.trim();
    if (!o) continue;
    if (o === '*' || o.includes('*')) {
      problems.push('a wildcard origin is not allowed with credentials');
      continue;
    }
    let u: URL;
    try {
      u = new URL(o);
    } catch {
      problems.push(`"${o.slice(0, 60)}" is not a valid origin`);
      continue;
    }
    if (u.origin !== o.replace(/\/+$/, '') || u.username || u.password) {
      problems.push(`"${o.slice(0, 60)}" must be an exact origin (scheme, host and optional port only)`);
      continue;
    }
    if (production) {
      if (u.protocol !== 'https:') problems.push(`"${u.origin}" is not https`);
      else if (LOOPBACK.has(u.hostname) || u.hostname.endsWith('.localhost')) problems.push(`"${u.origin}" is a local address`);
      else origins.push(u.origin);
    } else origins.push(u.origin);
  }
  return { origins: [...new Set(origins)], problems };
}

/**
 * TLS settings for every direct database connection made by tooling (migrations, seeding, audits, maintenance scripts) and by
 * the API pool.
 *
 * Certificate verification is never disabled: a remote database is reached over TLS with the server certificate verified against
 * the system trust store, and only a local database (development, a disposable container) is allowed to run without TLS.
 *
 * The connection string must not decide this. `pg` lets query parameters such as `sslmode=no-verify` or `sslmode=disable` override
 * the `ssl` option, so those parameters are removed before the explicit setting is applied.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function isLocalDatabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return LOCAL_HOSTS.has(host) || host.endsWith('.localhost');
  } catch {
    return false;
  }
}

export interface VerifiedConnection {
  connectionString: string;
  ssl: false | { rejectUnauthorized: true };
}

export function verifiedConnection(url: string): VerifiedConnection {
  const local = isLocalDatabaseUrl(url);
  let connectionString = url;
  try {
    const parsed = new URL(url);
    for (const key of ['sslmode', 'ssl', 'uselibpqcompat']) parsed.searchParams.delete(key);
    connectionString = parsed.toString();
  } catch {
    // an unparsable URL is left for the driver to reject; TLS stays verified
  }
  return { connectionString, ssl: local ? false : { rejectUnauthorized: true } };
}

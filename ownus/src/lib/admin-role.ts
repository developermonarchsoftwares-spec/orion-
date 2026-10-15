export interface IAdminAccount {
  id: string;
  email: string;
  role: 'ADMIN' | 'SUPER_ADMIN';
  firstName: string;
  lastName: string;
}

const ADMIN = new Set(['ADMIN', 'SUPER_ADMIN']);

/** Maps a users row to an admin account, or null when it is not an ACTIVE ADMIN / SUPER_ADMIN. Pure: the persisted row decides. */
export function toAdminAccount(row: Record<string, unknown> | null | undefined): IAdminAccount | null {
  if (!row || row.status !== 'ACTIVE' || !ADMIN.has(String(row.role))) return null;
  return { id: String(row.id), email: String(row.email), role: row.role as IAdminAccount["role"], firstName: String(row.first_name || "Admin"), lastName: String(row.last_name || "Administrator") };
}

const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** True only for a database URL whose host is local (so a well-known test credential can never reach a remote/production DB). */
function isLocalDbUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return LOCAL_DB_HOSTS.has(host) || host.endsWith('.localhost');
  } catch {
    return false;
  }
}

/**
 * S-03: the fixed development OTP is permitted ONLY under automated tests (NODE_ENV=test) AND when the
 * configured database is local. This makes it impossible for the well-known code to authenticate against
 * a remote or production database even if NODE_ENV were mis-set. `development` no longer enables it.
 */
export const fixedOtpAllowed = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.NODE_ENV === 'test' && isLocalDbUrl(env.GATEWAY_DATABASE_URL || env.DATABASE_URL);

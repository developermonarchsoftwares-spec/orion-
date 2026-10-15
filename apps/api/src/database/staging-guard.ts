/**
 * Guard for running the API test suites against a Neon rehearsal branch ("staging"). It fails closed:
 *  - STAGING_DATABASE_URL (a variable that is NOT DATABASE_URL, so a production URL left in .env or the shell is never picked up by accident)
 *  - STAGING_CONFIRM_HOST must equal the URL's host exactly
 *  - the host must not be any known production host (parsed from apps/api/.env and STAGING_FORBIDDEN_HOSTS), in pooler or direct form
 * Only host names are ever reported, never the URL, user or password.
 */
export interface IStagingTarget {
  host: string;
  database: string;
}

const norm = (h: string) => h.trim().toLowerCase().replace('-pooler.', '.');

export function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function assertStagingTarget(env: NodeJS.ProcessEnv, forbiddenHosts: string[]): IStagingTarget {
  const url = env.STAGING_DATABASE_URL;
  if (!url) throw new Error('STAGING_DATABASE_URL is not set. Refusing to guess a database.');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('STAGING_DATABASE_URL is not a valid connection URL');
  }
  const host = parsed.hostname.toLowerCase();
  if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) throw new Error('STAGING_DATABASE_URL must point at the Neon rehearsal branch, not a local database');
  const confirmed = (env.STAGING_CONFIRM_HOST ?? '').trim().toLowerCase();
  if (!confirmed || norm(confirmed) !== norm(host)) {
    throw new Error(`Refusing to use staging database host "${host}": set STAGING_CONFIRM_HOST to exactly that host to confirm the target.`);
  }
  const denied = [...forbiddenHosts, ...(env.STAGING_FORBIDDEN_HOSTS ?? '').split(',')].map(norm).filter(Boolean);
  if (denied.includes(norm(host))) throw new Error(`Refusing: host "${host}" is a production host. The staging suite only runs against the isolated rehearsal branch.`);
  if (denied.length === 0) throw new Error('No production host is known to compare against (apps/api/.env has no DATABASE_URL and STAGING_FORBIDDEN_HOSTS is empty): isolation cannot be proven.');
  return { host, database: parsed.pathname.replace(/^\//, '') };
}

/** Second, positive proof after connecting: the branch has the full migrated history that production does not have yet. */
export function assertMigratedBranch(appliedHistoryRows: number, journalEntries: number): void {
  if (appliedHistoryRows !== journalEntries) {
    throw new Error(`Connected database has ${appliedHistoryRows} recorded migrations; the migrated rehearsal branch must have exactly ${journalEntries}. Refusing to run (it may not be the rehearsal branch).`);
  }
}

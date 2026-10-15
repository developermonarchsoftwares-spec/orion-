/**
 * A migration run against a non-local database must name its target host explicitly (MIGRATION_CONFIRM_HOST=<host>), so a
 * DATABASE_URL left in a shell or .env can never migrate a database the operator did not intend. Only the host and database name
 * are ever reported; the URL, user and password never are.
 */
export interface IMigrationTarget {
  host: string;
  database: string;
  local: boolean;
}

export function parseTarget(url: string): IMigrationTarget {
  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  return { host, database: u.pathname.replace(/^\//, ''), local: ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host) };
}

export function assertMigrationTarget(url: string, env: NodeJS.ProcessEnv = process.env): IMigrationTarget {
  let target: IMigrationTarget;
  try {
    target = parseTarget(url);
  } catch {
    throw new Error('DATABASE_URL is not a valid connection URL');
  }
  if (target.local) return target;
  const confirmed = (env.MIGRATION_CONFIRM_HOST ?? '').trim().toLowerCase().replace('-pooler.', '.'); // the runner always uses the direct endpoint
  const direct = target.host.replace('-pooler.', '.');
  if (!confirmed || confirmed !== direct) {
    throw new Error(
      `Refusing to migrate remote database host "${target.host}" (database "${target.database}"): set MIGRATION_CONFIRM_HOST to exactly that host to confirm the target.`,
    );
  }
  return target;
}

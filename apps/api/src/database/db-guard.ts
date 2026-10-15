import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Safeguards for tooling (maintenance scripts, seeding, migrations, schema push) that connects to a database on the developer's own
 * PostgreSQL server. That server can host unrelated databases, and Orion's connection role may be a superuser, so the tooling itself
 * must refuse to touch anything that is not an Orion database. Nothing here prints a password or a full connection URL.
 *
 *  1. assertLocalDatabaseAllowed   a LOCAL target must be `orion_db` or a disposable Orion scratch / test / verify database.
 *                                  A remote target is not judged here (migrations have their own host confirmation).
 *  2. assertDestructiveAllowed     a script that deletes or rewrites data runs only against a LOCAL, allowed database, only with
 *                                  an explicit apply flag, an exact database-name confirmation, and a recent VERIFIED backup.
 *  3. findLatestVerifiedBackup     reads manifest.json files written by scripts/backup-local-db.ts (outside the repository).
 */

export const PRIMARY_DATABASE = 'orion_db';
export const DEFAULT_BACKUP_MAX_AGE_HOURS = 24;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Names that are clearly disposable Orion databases: orion_scratch, orion_test_x, orion_db_restore_verify_..., orion_x_scratch. */
export function isDisposableOrionDatabase(name: string): boolean {
  return /^orion_(scratch|test|verify)[a-z0-9_]*$/.test(name) || /^orion_[a-z0-9_]*_(scratch|test|verify)[a-z0-9_]*$/.test(name);
}

export interface IDbTarget {
  host: string;
  port: string;
  database: string;
  local: boolean;
}

export function parseDbTarget(url: string | undefined): IDbTarget {
  if (!url) throw new Error('DATABASE_URL is not set.');
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error('DATABASE_URL is not a valid connection URL.');
  }
  const host = u.hostname.toLowerCase();
  return {
    host,
    port: u.port || '5432',
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
    local: LOCAL_HOSTS.has(host) || host.endsWith('.localhost'),
  };
}

/** Only host, port and database name are ever shown. */
export const describeTarget = (t: IDbTarget): string => `host ${t.host}:${t.port}, database "${t.database}"`;

export function allowedLocalDatabases(env: NodeJS.ProcessEnv = process.env): string[] {
  const extra = (env.ORION_ALLOWED_LOCAL_DATABASES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [PRIMARY_DATABASE, ...extra];
}

export function isAllowedLocalDatabase(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return allowedLocalDatabases(env).includes(name) || isDisposableOrionDatabase(name);
}

/** Throws when the URL points at a database on a local server that is not an Orion database. Returns the parsed target. */
export function assertLocalDatabaseAllowed(url: string | undefined, env: NodeJS.ProcessEnv = process.env): IDbTarget {
  const t = parseDbTarget(url);
  if (t.local && !isAllowedLocalDatabase(t.database, env)) {
    throw new Error(
      `Refusing to connect: ${describeTarget(t)} is not an Orion database. ` +
        `Only "${PRIMARY_DATABASE}" and disposable orion_scratch/orion_test/orion_verify databases are allowed on the local server ` +
        `(extra names can be allowed explicitly with ORION_ALLOWED_LOCAL_DATABASES).`,
    );
  }
  return t;
}

// ------------------------------------------------------------------------------------------------ backups

export interface IBackupInfo {
  dir: string;
  createdAt: Date;
  database: string;
  verified: boolean;
  ageHours: number;
}

export function defaultBackupDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.ORION_BACKUP_DIR?.trim() || path.join(os.homedir(), 'orion-db-backups');
}

/** Newest backup folder whose manifest says it was verified for `database`. Returns null when there is none. */
export function findLatestVerifiedBackup(
  database: string,
  opts: { dir?: string; now?: Date; env?: NodeJS.ProcessEnv } = {},
): IBackupInfo | null {
  const dir = opts.dir ?? defaultBackupDir(opts.env);
  const now = opts.now ?? new Date();
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  let best: IBackupInfo | null = null;
  for (const name of entries) {
    const manifestPath = path.join(dir, name, 'manifest.json');
    try {
      const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (m?.verified !== true || m?.source?.database !== database) continue;
      if (!fs.existsSync(path.join(dir, name, String(m.dump_file ?? 'orion_db.dump')))) continue;
      const createdAt = new Date(m.created_at);
      if (Number.isNaN(createdAt.getTime())) continue;
      if (!best || createdAt > best.createdAt) {
        best = { dir: path.join(dir, name), createdAt, database, verified: true, ageHours: (now.getTime() - createdAt.getTime()) / 3_600_000 };
      }
    } catch {
      // not a backup folder
    }
  }
  return best;
}

// ------------------------------------------------------------------------------------------------ destructive scripts

export interface IDestructiveCheck {
  label: string;
  url: string | undefined;
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  now?: Date;
  backupDir?: string;
  /** `needsApplyFlag: false` is for tools that cannot dry-run (schema push); the confirmation and backup still apply. */
  needsApplyFlag?: boolean;
}

export interface IDestructiveDecision {
  target: IDbTarget;
  /** true: the script may change data. false: dry run, change nothing and say what would happen. */
  apply: boolean;
  backup: IBackupInfo | null;
}

/**
 * Decides whether a data-changing script may run. A dry run (no `--apply`) is always allowed on an allowed local database; it must
 * not change anything. Applying requires all of: a local allowed database, `--apply`, CONFIRM_DESTRUCTIVE_DATABASE equal to the
 * database name, and a verified backup of that database no older than ORION_BACKUP_MAX_AGE_HOURS (default 24).
 */
export function assertDestructiveAllowed(c: IDestructiveCheck): IDestructiveDecision {
  const env = c.env ?? process.env;
  const target = assertLocalDatabaseAllowed(c.url, env);
  if (!target.local) {
    throw new Error(`"${c.label}" changes or deletes data and only runs against a local database; refusing ${describeTarget(target)}.`);
  }
  const needsApply = c.needsApplyFlag !== false;
  const apply = needsApply ? (c.argv ?? []).includes('--apply') : true;
  if (!apply) return { target, apply: false, backup: null };

  if ((env.CONFIRM_DESTRUCTIVE_DATABASE ?? '').trim() !== target.database) {
    throw new Error(`"${c.label}" would change data in "${target.database}". Set CONFIRM_DESTRUCTIVE_DATABASE=${target.database} to confirm.`);
  }
  const maxAge = Number(env.ORION_BACKUP_MAX_AGE_HOURS ?? DEFAULT_BACKUP_MAX_AGE_HOURS);
  const backup = findLatestVerifiedBackup(target.database, { dir: c.backupDir, now: c.now, env });
  if (!backup) {
    throw new Error(`No verified backup of "${target.database}" found in ${c.backupDir ?? defaultBackupDir(env)}. Run "npm run db:backup" first.`);
  }
  if (backup.ageHours > maxAge) {
    throw new Error(
      `The newest verified backup of "${target.database}" is ${backup.ageHours.toFixed(1)} hours old (limit ${maxAge}). Run "npm run db:backup" first.`,
    );
  }
  return { target, apply: true, backup };
}

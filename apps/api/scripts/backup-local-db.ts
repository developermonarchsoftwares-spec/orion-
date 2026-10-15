/**
 * Consistent, verified backup of the LOCAL Orion database, written OUTSIDE the repository.
 *
 *   npm run db:backup                      backup + restore-verify into a temporary database (kept, so you can inspect it)
 *   npm run db:backup -- --drop-verify-db  also drop the temporary verification database this run created
 *   npm run db:backup -- --no-restore-verify   dump only; the manifest stays "verified: false" and does not satisfy the guards
 *
 * How it stays consistent: one exported snapshot is shared by the row counts and by pg_dump, so the manifest's counts describe exactly
 * the data in the dump even while the application is writing. Verification: file checksum, archive readable, restore into a NEW
 * database (never into orion_db), identical table list, identical row counts, identical schema fingerprint, migration journal present.
 *
 * Only the database "orion_db" (or an allowed disposable Orion database) on a local server is accepted. The password is passed to
 * the PostgreSQL tools through the environment and is never printed. Nothing in the source database is changed.
 */
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { Client } from 'pg';
import { assertLocalDatabaseAllowed, defaultBackupDir, describeTarget } from '../src/database/db-guard';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const REPO_ROOT = path.resolve(__dirname, '../../..');

function pgBinDir(): string {
  const fromEnv = process.env.PG_BIN_DIR?.trim();
  const exe = process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump';
  if (fromEnv && fs.existsSync(path.join(fromEnv, exe))) return fromEnv;
  const roots = process.platform === 'win32' ? ['C:/Program Files/PostgreSQL'] : ['/usr/lib/postgresql'];
  for (const root of roots) {
    try {
      const versions = fs.readdirSync(root).filter((v) => /^\d+/.test(v)).sort((a, b) => Number.parseInt(b, 10) - Number.parseInt(a, 10));
      for (const v of versions) {
        const bin = path.join(root, v, 'bin');
        if (fs.existsSync(path.join(bin, exe))) return bin;
      }
    } catch {
      // try the next location
    }
  }
  return ''; // fall back to PATH
}

const tool = (bin: string, name: string) => (bin ? path.join(bin, process.platform === 'win32' ? `${name}.exe` : name) : name);

async function main() {
  const args = new Set(process.argv.slice(2));
  const target = assertLocalDatabaseAllowed(process.env.DATABASE_URL);
  if (!target.local) throw new Error('db:backup only backs up a local database.');
  const url = new URL(process.env.DATABASE_URL!);
  const backupRoot = path.resolve(defaultBackupDir());
  const rel = path.relative(REPO_ROOT, backupRoot);
  const inside = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); // another drive gives an absolute path: outside
  if (inside) throw new Error('The backup folder must be outside the repository.');

  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const penv = { ...process.env, PGHOST: target.host, PGPORT: target.port, PGUSER: user, PGPASSWORD: password, PGDATABASE: target.database };
  const conn = { host: target.host, port: Number(target.port), user, password };
  const bin = pgBinDir();

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
  const dir = path.join(backupRoot, `${target.database}_${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  const dumpFile = path.join(dir, `${target.database}.dump`);
  console.log(`Backing up ${describeTarget(target)} (credentials hidden)`);

  const src = new Client({ ...conn, database: target.database });
  await src.connect();
  const counts: Record<string, number> = {};
  let fingerprint: Record<string, number> = {};
  let version = '';
  const FP = `select (select count(*) from information_schema.columns where table_schema='public') cols,
    (select count(*) from pg_indexes where schemaname='public') idx,
    (select count(*) from information_schema.table_constraints where table_schema='public') cons,
    (select count(*) from pg_sequences where schemaname='public') seqs`;
  const tableList = `select table_schema s, table_name t from information_schema.tables where table_type='BASE TABLE' and table_schema in ('public','drizzle') order by 1,2`;
  const toNum = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v)]));
  try {
    await src.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = (await src.query('select pg_export_snapshot() as s')).rows[0].s as string;
    version = String((await src.query('select version() as v')).rows[0].v).split(' on ')[0];
    for (const t of (await src.query(tableList)).rows) counts[`${t.s}.${t.t}`] = Number((await src.query(`select count(*) n from "${t.s}"."${t.t}"`)).rows[0].n);
    fingerprint = toNum((await src.query(FP)).rows[0]);
    const r = spawnSync(tool(bin, 'pg_dump'), ['--format=custom', '--compress=9', '--no-password', `--snapshot=${snapshot}`, `--file=${dumpFile}`], { env: penv, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`pg_dump failed: ${(r.stderr || '').split('\n')[0]}`);
  } finally {
    await src.query('COMMIT').catch(() => undefined);
    await src.end();
  }
  spawnSync(tool(bin, 'pg_dumpall'), ['--globals-only', '--no-role-passwords', '--no-password', '-f', path.join(dir, 'globals_no_passwords.sql')], { env: penv, encoding: 'utf8' });

  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(dumpFile)).digest('hex');
  const manifest: Record<string, any> = {
    created_at: new Date().toISOString(),
    source: { host: target.host, port: target.port, database: target.database },
    server_version: version,
    tool: 'pg_dump custom format, snapshot-consistent (scripts/backup-local-db.ts)',
    dump_file: path.basename(dumpFile),
    dump_bytes: fs.statSync(dumpFile).size,
    sha256,
    snapshot_counts: counts,
    schema_fingerprint: fingerprint,
    verified: false,
  };
  const writeManifest = () => fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeManifest();
  console.log(`Dump written: ${dumpFile} (${manifest.dump_bytes} bytes, sha256 ${sha256.slice(0, 16)}...)`);
  console.log(`Tables counted: ${Object.keys(counts).length}, rows: ${Object.values(counts).reduce((a, b) => a + b, 0)}`);

  if (args.has('--no-restore-verify')) {
    console.log('Restore verification skipped: this backup is NOT marked verified and will not satisfy the safety checks.');
    return;
  }

  const checks: Array<{ check: string; pass: boolean; detail?: string }> = [];
  const ok = (check: string, pass: boolean, detail = '') => {
    checks.push({ check, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${check}${detail ? ` - ${detail}` : ''}`);
  };
  ok('dump checksum matches', crypto.createHash('sha256').update(fs.readFileSync(dumpFile)).digest('hex') === sha256);
  const list = spawnSync(tool(bin, 'pg_restore'), ['--list', dumpFile], { encoding: 'utf8' });
  const entries = (list.stdout || '').split('\n').filter((l) => l && !l.startsWith(';')).length;
  ok('archive is readable', list.status === 0 && entries > 0, `${entries} entries`);

  const tmpName = `orion_db_restore_verify_${stamp.toLowerCase()}`;
  if (!/^orion_db_restore_verify_[0-9a-z]+$/.test(tmpName)) throw new Error('unexpected temporary database name');
  const admin = new Client({ ...conn, database: 'postgres' });
  await admin.connect();
  try {
    if ((await admin.query('select 1 from pg_database where datname = $1', [tmpName])).rowCount) throw new Error('temporary database already exists');
    await admin.query(`CREATE DATABASE "${tmpName}"`);
  } finally {
    await admin.end();
  }
  const rs = spawnSync(tool(bin, 'pg_restore'), ['--no-password', '--exit-on-error', `--dbname=${tmpName}`, dumpFile], { env: penv, encoding: 'utf8' });
  ok('restore into a separate temporary database completed', rs.status === 0, rs.status === 0 ? tmpName : (rs.stderr || '').split('\n')[0]);
  if (rs.status === 0) {
    const t = new Client({ ...conn, database: tmpName });
    await t.connect();
    try {
      const restored: Record<string, number> = {};
      for (const x of (await t.query(tableList)).rows) restored[`${x.s}.${x.t}`] = Number((await t.query(`select count(*) n from "${x.s}"."${x.t}"`)).rows[0].n);
      ok('same table list', Object.keys(restored).sort().join() === Object.keys(counts).sort().join(), `${Object.keys(restored).length} tables`);
      const diff = Object.keys(counts).filter((k) => restored[k] !== counts[k]);
      ok('every table row count equals the snapshot', diff.length === 0, diff.length ? `differs: ${diff.join(', ')}` : `${Object.values(restored).reduce((a, b) => a + b, 0)} rows`);
      const fp = toNum((await t.query(FP)).rows[0]);
      ok('schema fingerprint equals the source', JSON.stringify(fp) === JSON.stringify(fingerprint), JSON.stringify(fp));
      ok('migration journal restored', 'drizzle.__drizzle_migrations' in restored && restored['drizzle.__drizzle_migrations'] === counts['drizzle.__drizzle_migrations']);
    } finally {
      await t.end();
    }
  }
  manifest.verified = checks.every((c) => c.pass);
  manifest.restore_verification = { temp_database: tmpName, checks, verified_at: new Date().toISOString() };
  writeManifest();

  if (args.has('--drop-verify-db')) {
    const a2 = new Client({ ...conn, database: 'postgres' });
    await a2.connect();
    try {
      await a2.query(`DROP DATABASE "${tmpName}"`); // only the verification database this run created (name checked above)
      manifest.restore_verification.temp_database_dropped = true;
      writeManifest();
      console.log(`Temporary verification database ${tmpName} dropped.`);
    } finally {
      await a2.end();
    }
  } else {
    console.log(`Temporary verification database kept: ${tmpName} (remove it with DROP DATABASE when you no longer need it).`);
  }
  console.log(manifest.verified ? `\nBACKUP VERIFIED: ${dir}` : '\nBACKUP NOT VERIFIED: see the failed checks above.');
  if (!manifest.verified) process.exit(1);
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? err.message : 'Backup failed'}`);
  process.exit(1);
});

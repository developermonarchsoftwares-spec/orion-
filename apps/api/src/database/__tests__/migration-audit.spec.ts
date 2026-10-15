import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { auditDatabase, IMigrationAudit, readJournal } from '../migration-audit';

/**
 * Compatibility matrix for the 0003 / 0017 repair, on disposable in-memory databases. Each scenario models a database whose history
 * or tables differ, runs the read-only audit, then runs the REAL migrator to confirm the audit predicted what happens.
 */
const MIGRATIONS = path.resolve(__dirname, '../migrations');
const journal = readJournal(MIGRATIONS);
const tagNo = (t: string) => Number(t.slice(0, 4));

function folderWith(keep: (tag: string) => boolean): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-audit-'));
  fs.mkdirSync(path.join(dir, 'meta'));
  const raw = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8'));
  raw.entries = raw.entries.filter((e: any) => keep(e.tag));
  fs.writeFileSync(path.join(dir, 'meta/_journal.json'), JSON.stringify(raw));
  for (const e of raw.entries) fs.copyFileSync(path.join(MIGRATIONS, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
  return dir;
}
const dbAt = async (keep: (tag: string) => boolean) => {
  const client = new PGlite();
  await migrate(drizzle(client), { migrationsFolder: folderWith(keep) });
  return client;
};
const audit = (c: PGlite): Promise<IMigrationAudit> => auditDatabase(async (t, p) => (await c.query<any>(t, p as any[])).rows, MIGRATIONS);
const count = async (c: PGlite, table: string) => Number((await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);

const QUEUE_OK = `CREATE TABLE queue_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, queue_name varchar(100) NOT NULL, job_name varchar(100) NOT NULL, data jsonb NOT NULL,
  status varchar(20) DEFAULT 'WAITING' NOT NULL, attempts integer DEFAULT 0 NOT NULL, max_attempts integer DEFAULT 3 NOT NULL, error text, result jsonb,
  locked_at timestamptz, processed_at timestamptz, created_at timestamptz DEFAULT now() NOT NULL, updated_at timestamptz DEFAULT now() NOT NULL);`;
const OTP_OK = `CREATE TABLE admin_otps (id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, email varchar(255) NOT NULL, otp varchar(255) NOT NULL, attempts integer DEFAULT 0 NOT NULL,
  max_attempts integer DEFAULT 5 NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz DEFAULT now() NOT NULL);`;

describe('migration audit: history', () => {
  it('applied through 0002 -> will apply 0003..latest, nothing skipped, SAFE', async () => {
    const c = await dbAt((t) => tagNo(t) <= 2);
    const r = await audit(c);
    expect(r.verdict).toBe('SAFE_TO_MIGRATE');
    expect(r.history.willApply).toEqual(journal.filter((e) => tagNo(e.tag) >= 3).map((e) => e.tag));
    expect(r.history.skippedNeverApplied).toEqual([]);
    expect(r.hardenedTables).toEqual({ queue_jobs: 'ABSENT', admin_otps: 'ABSENT' });
    await migrate(drizzle(c), { migrationsFolder: MIGRATIONS }); // prediction holds
    expect((await audit(c)).history.willApply).toEqual([]);
    expect(await count(c, 'credit_packages')).toBe(5);
    await c.close();
  }, 120_000);

  it('applied through 0016 (no 0003, no 0017) -> will apply 0017 onwards, 0003 skipped for good, SAFE with a note', async () => {
    const c = await dbAt((t) => tagNo(t) !== 3 && tagNo(t) < 17);
    const r = await audit(c);
    expect(r.verdict).toBe('SAFE_TO_MIGRATE');
    expect(r.history.willApply).toEqual(journal.filter((e) => tagNo(e.tag) >= 17).map((e) => e.tag));
    expect(r.history.skippedNeverApplied).toEqual(['0003_seed_packages']);
    expect(r.notes.join(' ')).toContain('0003_seed_packages will be skipped');
    await migrate(drizzle(c), { migrationsFolder: MIGRATIONS });
    expect(await count(c, 'credit_packages')).toBe(0); // nothing seeded: the application seed (or an operator) must do it
    expect((await audit(c)).hardenedTables).toEqual({ queue_jobs: 'COMPATIBLE', admin_otps: 'COMPATIBLE' });
    await c.close();
  }, 120_000);

  it('fully applied -> nothing to do', async () => {
    const c = await dbAt(() => true);
    const r = await audit(c);
    expect(r).toMatchObject({ verdict: 'SAFE_TO_MIGRATE', history: { willApply: [], unknownRows: 0, hashMismatches: [] } });
    expect(r.schema).toEqual({ publicTables: expect.any(Number), missingTables: [], drift: {} });
    await c.close();
  }, 120_000);

  it('history recorded from a different journal (unknown timestamps) or a newer one -> BLOCKED', async () => {
    const c = await dbAt((t) => tagNo(t) <= 2);
    await c.exec(`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('x', 1789200000123)`);
    const unknown = await audit(c);
    expect(unknown.verdict).toBe('BLOCKED');
    expect(unknown.history.unknownRows).toBe(1);
    await c.exec(`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('y', 1999999999999)`);
    expect((await audit(c)).findings.join(' ')).toContain('newer than the newest journal entry');
    await c.close();
  }, 120_000);

  it('an applied migration whose file was edited afterwards is reported (Drizzle itself never compares hashes)', async () => {
    const c = await dbAt(() => true);
    await c.exec(`UPDATE drizzle.__drizzle_migrations SET hash = 'edited' WHERE created_at = ${journal.find((e) => tagNo(e.tag) === 5)!.when}`);
    const r = await audit(c);
    expect(r.history.hashMismatches).toEqual(['0005_people_ingestion']);
    expect(r.verdict).toBe('SAFE_TO_MIGRATE');
    await c.close();
  }, 120_000);

  it('a schema with no migration history (e.g. created by push) -> BLOCKED, and the real migrator indeed fails atomically', async () => {
    const c = new PGlite();
    await migrate(drizzle(c), { migrationsFolder: folderWith((t) => tagNo(t) <= 2) });
    await c.exec('DELETE FROM drizzle.__drizzle_migrations');
    const r = await audit(c);
    expect(r.verdict).toBe('BLOCKED');
    expect(r.findings.join(' ')).toContain('no migration history');
    await expect(migrate(drizzle(c), { migrationsFolder: MIGRATIONS })).rejects.toThrow();
    expect(await count(c, 'drizzle.__drizzle_migrations')).toBe(0); // one transaction: nothing recorded, nothing half-applied
    expect(await count(c, 'credit_packages')).toBe(0);
    await c.close();
  }, 120_000);
});

describe('migration audit: pre-existing queue_jobs / admin_otps', () => {
  const base = () => dbAt((t) => tagNo(t) < 17);

  it('identical tables -> COMPATIBLE; 0017 changes nothing and keeps the rows', async () => {
    const c = await base();
    await c.exec(`${QUEUE_OK} ${OTP_OK} INSERT INTO queue_jobs (queue_name, job_name, data) VALUES ('q','j','{}'); CREATE INDEX idx_queue_jobs_queue_status ON queue_jobs (queue_name, status);
      CREATE INDEX idx_queue_jobs_created_at ON queue_jobs (created_at); CREATE INDEX idx_admin_otps_email ON admin_otps (email); CREATE INDEX idx_admin_otps_expires_at ON admin_otps (expires_at);`);
    const r = await audit(c);
    expect(r.hardenedTables).toEqual({ queue_jobs: 'COMPATIBLE', admin_otps: 'COMPATIBLE' });
    expect(r.verdict).toBe('SAFE_TO_MIGRATE');
    await migrate(drizzle(c), { migrationsFolder: MIGRATIONS });
    expect(await count(c, 'queue_jobs')).toBe(1);
    await c.close();
  }, 120_000);

  it('right columns but indexes missing -> REPAIRABLE_BY_0017 (the migration adds only the indexes)', async () => {
    const c = await base();
    await c.exec(`${QUEUE_OK} ${OTP_OK}`);
    const r = await audit(c);
    expect(r.hardenedTables).toEqual({ queue_jobs: 'REPAIRABLE_BY_0017', admin_otps: 'REPAIRABLE_BY_0017' });
    expect(r.verdict).toBe('SAFE_TO_MIGRATE');
    await migrate(drizzle(c), { migrationsFolder: MIGRATIONS });
    expect((await audit(c)).hardenedTables).toEqual({ queue_jobs: 'COMPATIBLE', admin_otps: 'COMPATIBLE' });
    await c.close();
  }, 120_000);

  it.each([
    ['a column has the wrong type', `${QUEUE_OK.replace('status varchar(20)', 'status varchar(5)')} ${OTP_OK}`, 'queue_jobs', 'status type'],
    ['a NOT NULL column is nullable', `${QUEUE_OK.replace('data jsonb NOT NULL', 'data jsonb')} ${OTP_OK}`, 'queue_jobs', 'data is nullable'],
    ['an extra NOT NULL column has no default', `${QUEUE_OK.replace('error text,', 'error text, tenant text NOT NULL,')} ${OTP_OK}`, 'queue_jobs', 'extra column tenant'],
    ['a defaulted column lost its default', `${QUEUE_OK.replace("DEFAULT 'WAITING' ", '')} ${OTP_OK}`, 'queue_jobs', 'status has no default'],
    ['the primary key is missing', `${QUEUE_OK} ${OTP_OK.replace('id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL', 'id uuid DEFAULT gen_random_uuid() NOT NULL')}`, 'admin_otps', 'primary key'],
  ])('mismatch: %s -> NEEDS_MANUAL_REPAIR, verdict BLOCKED', async (_label, ddl, table, fragment) => {
    const c = await base();
    await c.exec(ddl);
    const r = await audit(c);
    expect(r.hardenedTables[table]).toBe('NEEDS_MANUAL_REPAIR');
    expect(r.verdict).toBe('BLOCKED');
    expect(r.schema.drift[table].join(' ')).toContain(fragment);
    // and the migrator would NOT have fixed it: it succeeds silently and leaves the table wrong (why the audit must gate the run)
    await migrate(drizzle(c), { migrationsFolder: MIGRATIONS });
    expect((await audit(c)).hardenedTables[table]).toBe('NEEDS_MANUAL_REPAIR');
    await c.close();
  }, 120_000);

  it('a missing column breaks the migration loudly (index creation fails) and rolls everything back', async () => {
    const c = await base();
    await c.exec(`${QUEUE_OK} ${OTP_OK.replace('expires_at timestamptz NOT NULL, ', '')}`);
    const r = await audit(c);
    expect(r.hardenedTables.admin_otps).toBe('NEEDS_MANUAL_REPAIR');
    await expect(migrate(drizzle(c), { migrationsFolder: MIGRATIONS })).rejects.toThrow();
    expect(await count(c, 'drizzle.__drizzle_migrations')).toBe(journal.filter((e) => tagNo(e.tag) < 17).length); // none of 0017 onwards recorded
    await c.close();
  }, 120_000);

  it('an index with the expected name on the wrong column is flagged; IF NOT EXISTS would silently keep it', async () => {
    const c = await base();
    await c.exec(`${QUEUE_OK} ${OTP_OK} CREATE INDEX idx_queue_jobs_created_at ON queue_jobs (updated_at);`);
    const r = await audit(c);
    expect(r.schema.drift.queue_jobs.join(' ')).toContain('index idx_queue_jobs_created_at is (updated_at)');
    expect(r.hardenedTables.queue_jobs).toBe('NEEDS_MANUAL_REPAIR');
    await c.close();
  }, 120_000);

  it('the report holds structure only: no row values and no connection details', async () => {
    const c = await base();
    await c.exec(`${QUEUE_OK} ${OTP_OK} INSERT INTO admin_otps (email, otp, expires_at) VALUES ('secret.person@example.com', 'OTP-VALUE-987', now());`);
    const text = JSON.stringify(await audit(c));
    expect(text).not.toContain('secret.person');
    expect(text).not.toContain('OTP-VALUE-987');
    expect(text).not.toMatch(/postgres(ql)?:\/\//i);
    await c.close();
  }, 120_000);

  it('the audit issues only SELECTs', async () => {
    const c = await base();
    const seen: string[] = [];
    await auditDatabase(async (t, p) => {
      seen.push(t);
      return (await c.query<any>(t, p as any[])).rows;
    }, MIGRATIONS);
    expect(seen.length).toBeGreaterThan(0);
    for (const q of seen) expect(q.trim()).toMatch(/^SELECT/i);
    await c.close();
  }, 120_000);

  it('the CLI wrapper is read-only, hides the connection string and has no write statements', () => {
    const cli = fs.readFileSync(path.resolve(__dirname, '../audit-migrations.ts'), 'utf8');
    expect(cli).toContain("BEGIN READ ONLY");
    expect(cli).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE)\b\s/);
    expect(cli).not.toMatch(/console\.(log|error)\([^)]*\burl\b/);
  });
});

describe('0003 seed on an existing installation', () => {
  const seedSql = fs.readFileSync(path.join(MIGRATIONS, '0003_seed_packages.sql'), 'utf8').split('--> statement-breakpoint');
  const run = async (c: PGlite) => {
    for (const s of seedSql) await c.exec(s);
  };

  it('is DO NOTHING per slug / key: admin-edited packages and settings are never overwritten', async () => {
    const c = await dbAt((t) => tagNo(t) !== 3 && tagNo(t) < 17);
    await c.exec(`INSERT INTO credit_packages (slug, name, price_inr, credits, is_active) VALUES ('starter', 'Custom Starter', 149, 120, false);
      INSERT INTO pricing_settings (key, value, description) VALUES ('DAILY_FREE_CREDITS', '{"amount": 9}'::jsonb, 'edited');`);
    await run(c);
    const starter = (await c.query<any>(`SELECT name, price_inr, credits, is_active FROM credit_packages WHERE slug = 'starter'`)).rows;
    expect(starter).toEqual([{ name: 'Custom Starter', price_inr: 149, credits: 120, is_active: false }]);
    expect((await c.query<any>(`SELECT value FROM pricing_settings WHERE key = 'DAILY_FREE_CREDITS'`)).rows[0].value).toEqual({ amount: 9 });
    expect(await count(c, 'credit_packages')).toBe(5); // the four missing plans were added
    await run(c);
    expect(await count(c, 'credit_packages')).toBe(5);
    expect(await count(c, 'pricing_settings')).toBe(3);
    await c.close();
  }, 120_000);

  it('MANUAL CASE: a different package already holding one of the fixed ids makes the seed (and so the whole run) fail', async () => {
    const c = await dbAt((t) => tagNo(t) <= 2);
    await c.exec(`INSERT INTO credit_packages (id, slug, name, price_inr, credits) VALUES ('5b11b41d-4451-4ea3-9ace-be33b7a18ad4', 'legacy-free', 'Legacy', 0, 1)`);
    const r = await audit(c);
    expect(r.history.willApply).toContain('0003_seed_packages'); // the audit cannot see row-level conflicts: see the runbook preflight query
    await expect(migrate(drizzle(c), { migrationsFolder: MIGRATIONS })).rejects.toThrow();
    expect(await count(c, 'drizzle.__drizzle_migrations')).toBe(3); // rolled back to the pre-run state
    await c.close();
  }, 120_000);
});

describe('columns the schema does not define', () => {
  it('are reported as informational notes (not drift, verdict unchanged), with names only', async () => {
    const c = await dbAt(() => true);
    await c.exec(`ALTER TABLE import_batches ADD COLUMN r2_object_key varchar(255), ADD COLUMN sha256_checksum varchar(64) DEFAULT 'x'`);
    const r = await audit(c);
    expect(r.verdict).toBe('SAFE_TO_MIGRATE');
    expect(r.schema.drift).toEqual({});
    expect(r.notes.join(' ')).toContain('import_batches has 2 column(s) the schema does not define');
    expect(r.notes.join(' ')).toContain('r2_object_key, sha256_checksum');
    await c.close();
  }, 120_000);
});

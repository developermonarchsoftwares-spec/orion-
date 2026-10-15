import { PGlite } from '@electric-sql/pglite';
import { and, eq, gt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as schema from '../schema';
import { QueueService } from '../../modules/queue/queue.service';
import { assertMigrationTarget } from '../migration-target';
import { auditDatabase, readJournal } from '../migration-audit';
import { compareSnapshots, takeSnapshot } from '../rehearsal-checks';

/**
 * Rehearses the intended production situation on a disposable database, exactly as the runbook prescribes for a Neon branch:
 * history stops at 0002, queue_jobs / admin_otps already exist (out of band), the five plans are already seeded (some edited),
 * import_batches.file_key is nullable and holds NULLs. Then: snapshot, audit, REAL migrator, snapshot, compare, audit, smoke checks.
 * No real database is involved.
 */
const MIGRATIONS = path.resolve(__dirname, '../migrations');
const journal = readJournal(MIGRATIONS);
const tagNo = (t: string) => Number(t.slice(0, 4));
const q = (c: PGlite) => async (t: string, p?: unknown[]) => (await c.query<any>(t, p as any[])).rows;

function folderThrough(maxNo: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-reh-'));
  fs.mkdirSync(path.join(dir, 'meta'));
  const raw = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8'));
  raw.entries = raw.entries.filter((e: any) => tagNo(e.tag) <= maxNo);
  fs.writeFileSync(path.join(dir, 'meta/_journal.json'), JSON.stringify(raw));
  for (const e of raw.entries) fs.copyFileSync(path.join(MIGRATIONS, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
  return dir;
}

const OUT_OF_BAND = `
CREATE TABLE queue_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, queue_name varchar(100) NOT NULL, job_name varchar(100) NOT NULL, data jsonb NOT NULL,
  status varchar(20) DEFAULT 'WAITING' NOT NULL, attempts integer DEFAULT 0 NOT NULL, max_attempts integer DEFAULT 3 NOT NULL, error text, result jsonb,
  locked_at timestamptz, processed_at timestamptz, created_at timestamptz DEFAULT now() NOT NULL, updated_at timestamptz DEFAULT now() NOT NULL);
CREATE INDEX idx_queue_jobs_queue_status ON queue_jobs (queue_name, status);
CREATE INDEX idx_queue_jobs_created_at ON queue_jobs (created_at);
CREATE TABLE admin_otps (id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, email varchar(255) NOT NULL, otp varchar(255) NOT NULL, attempts integer DEFAULT 0 NOT NULL,
  max_attempts integer DEFAULT 5 NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz DEFAULT now() NOT NULL);
CREATE INDEX idx_admin_otps_email ON admin_otps (email);
CREATE INDEX idx_admin_otps_expires_at ON admin_otps (expires_at);
ALTER TABLE import_batches ALTER COLUMN file_key DROP NOT NULL;`;

describe('rehearsal of 0003-0017 on a production-shaped disposable database', () => {
  let c: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    c = new PGlite();
    db = drizzle(c, { schema });
    await migrate(db, { migrationsFolder: folderThrough(2) });
    await c.exec(OUT_OF_BAND);
    // seeded by the application seed, then edited by an admin
    await c.exec(`INSERT INTO credit_packages (id, slug, name, price_inr, credits, is_active, sort_order, billing_type) VALUES
      ('5b11b41d-4451-4ea3-9ace-be33b7a18ad4','free','Free Plan',0,5,true,1,'DAILY_FREE'),
      ('30ad3ee3-f861-4a59-b374-5af11f820194','starter','Starter Pack (edited)',149,120,false,2,'ONE_TIME'),
      ('cdcc091d-282c-4bd6-93d2-2f5aa1955110','growth','Growth Pack',299,350,true,3,'ONE_TIME'),
      ('b8dfcad5-f348-40b7-801d-38124b909425','agency','Agency Pack',999,1500,true,4,'ONE_TIME'),
      ('c31b8ca8-a484-46cb-b30d-675acfaefdb8','enterprise','Enterprise Plan',NULL,0,true,5,'CUSTOM');
      INSERT INTO pricing_settings (key, value) VALUES ('DAILY_FREE_CREDITS','{"amount": 5}'),('ANNUAL_DISCOUNT_PERCENTAGE','{"percentage": 20}'),('DEFAULT_CURRENCY','{"currency":"INR"}');
      INSERT INTO import_batches (filename, file_key, file_size, mime_type, status) VALUES ('a.csv', NULL, 1, 'text/csv', 'COMPLETED'), ('b.csv', NULL, 1, 'text/csv', 'COMPLETED'), ('c.csv', 'imports/c', 1, 'text/csv', 'COMPLETED');`);
  }, 120_000);
  afterAll(async () => {
    await c.close();
  });

  let before: Awaited<ReturnType<typeof takeSnapshot>>;

  it('preflight: the audit predicts 0003-0017, flags only what pending migrations resolve, and leaves file_key as known drift', async () => {
    before = await takeSnapshot(q(c));
    const r = await auditDatabase(q(c), MIGRATIONS);
    expect(r.verdict).toBe('SAFE_TO_MIGRATE');
    expect(r.history.willApply).toEqual(journal.filter((e) => tagNo(e.tag) >= 3).map((e) => e.tag));
    expect(r.hardenedTables).toEqual({ queue_jobs: 'COMPATIBLE', admin_otps: 'COMPATIBLE' });
    expect(before.importBatchesNullFileKey).toBe(2);
    expect(before.migrations).toHaveLength(3);
  });

  it('runs the real migrator: package edits, NULL file_key rows and out-of-band tables are untouched; People tables appear', async () => {
    await migrate(db, { migrationsFolder: MIGRATIONS });
    const after = await takeSnapshot(q(c));
    const cmp = compareSnapshots(before, after);
    expect(cmp.problems).toEqual([]);
    expect(cmp.ok).toBe(true);
    expect(after.migrations).toHaveLength(journal.length);
    for (const t of ['people', 'company_people', 'person_contacts', 'people_evidence', 'people_sources', 'people_verifications', 'people_acquisition_runs', 'person_unlocks']) {
      expect(after.tables).toHaveProperty(t);
    }
    expect(after.packages.find((p) => p.slug === 'starter')).toMatchObject({ name: 'Starter Pack (edited)', price_inr: 149, credits: 120, is_active: false });
    expect(after.importBatchesNullFileKey).toBe(2);
  }, 120_000);

  it('post-migration audit: nothing pending; the only remaining differences are the known file_key drift', async () => {
    const r = await auditDatabase(q(c), MIGRATIONS);
    expect(r.history.willApply).toEqual([]);
    expect(r.schema.missingTables).toEqual([]);
    expect(r.schema.drift).toEqual({ import_batches: ['column file_key is nullable (expected NOT NULL)'] });
    expect(r.hardenedTables).toEqual({ queue_jobs: 'COMPATIBLE', admin_otps: 'COMPATIBLE' });
    expect(r.verdict).toBe('REVIEW_REQUIRED'); // the known drift keeps the audit from reporting SAFE: an explicit decision, not a surprise
  });

  it('smoke: queue jobs and admin OTP persistence work on the migrated database', async () => {
    const pool: any = { query: async (t: string, p?: unknown[]) => ({ rows: (await c.query<any>(t, p as any[])).rows }), connect: async () => ({ query: async (t: string, p?: unknown[]) => ({ rows: (await c.query<any>(t, p as any[])).rows }), release: () => undefined }) };
    const queue = new QueueService(db as any, pool);
    queue.registerWorker('rehearsal', async () => ({ ok: true }));
    const job = await queue.addJob('rehearsal', 'smoke', {});
    for (let i = 0; i < 100; i++) {
      const [row] = await db.select().from(schema.queueJobs).where(eq(schema.queueJobs.id, job.id));
      if (row?.status === 'COMPLETED') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect((await db.select().from(schema.queueJobs).where(eq(schema.queueJobs.id, job.id)))[0].status).toBe('COMPLETED');
    queue.unregisterWorker('rehearsal');
    await queue.onModuleDestroy();

    await db.insert(schema.adminOtps).values({ email: 'rehearsal@monarchsoftwares.com', otp: '111111', expiresAt: new Date(Date.now() + 60_000) });
    expect(await db.select().from(schema.adminOtps).where(and(eq(schema.adminOtps.email, 'rehearsal@monarchsoftwares.com'), gt(schema.adminOtps.expiresAt, new Date())))).toHaveLength(1);
  });

  it('the comparison catches what a bad run would change', async () => {
    const after = await takeSnapshot(q(c));
    const tampered = JSON.parse(JSON.stringify(after));
    tampered.packages[1].price_inr = 99; // packages overwritten (what drizzle:seed would do)
    tampered.tables.users = tampered.tables.users + 1;
    delete tampered.tables.businesses;
    tampered.importBatchesNullFileKey = 0;
    tampered.migrations[0].hash8 = 'deadbeef';
    const cmp = compareSnapshots(before, tampered);
    expect(cmp.ok).toBe(false);
    expect(cmp.problems.join('|')).toEqual(expect.stringContaining('credit_packages rows changed'));
    expect(cmp.problems.join('|')).toEqual(expect.stringContaining('table users row count changed'));
    expect(cmp.problems.join('|')).toEqual(expect.stringContaining('table businesses disappeared'));
    expect(cmp.problems.join('|')).toEqual(expect.stringContaining('NULL file_key count changed'));
    expect(cmp.problems.join('|')).toEqual(expect.stringContaining('migration history row 0'));
  });

  it('snapshots contain no connection details and no personal data', async () => {
    const text = JSON.stringify(await takeSnapshot(q(c)));
    expect(text).not.toMatch(/postgres(ql)?:\/\//i);
    expect(text).not.toContain('rehearsal@monarchsoftwares.com');
    expect(text).not.toContain('111111');
  });
});

describe('migration target guard', () => {
  const neon = 'postgresql://user:pw@ep-example-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require';
  it('local targets need no confirmation', () => {
    expect(assertMigrationTarget('postgresql://postgres:postgres@localhost:5432/orion_db', {}).local).toBe(true);
  });
  it('a remote target is refused without MIGRATION_CONFIRM_HOST, or with the wrong host', () => {
    expect(() => assertMigrationTarget(neon, {})).toThrow(/Refusing to migrate remote database host/);
    expect(() => assertMigrationTarget(neon, { MIGRATION_CONFIRM_HOST: 'ep-other.c-2.us-east-2.aws.neon.tech' })).toThrow(/Refusing/);
  });
  it('the exact host (pooler or direct form) confirms the target', () => {
    expect(assertMigrationTarget(neon.replace('-pooler.', '.'), { MIGRATION_CONFIRM_HOST: 'ep-example.c-2.us-east-2.aws.neon.tech' }).database).toBe('neondb');
    expect(assertMigrationTarget(neon.replace('-pooler.', '.'), { MIGRATION_CONFIRM_HOST: 'EP-EXAMPLE-pooler.c-2.us-east-2.aws.neon.tech' }).host).toBe('ep-example.c-2.us-east-2.aws.neon.tech');
  });
  it('error messages never contain credentials', () => {
    try {
      assertMigrationTarget(neon, {});
    } catch (e: any) {
      expect(e.message).not.toContain('pw');
      expect(e.message).not.toContain('user:');
    }
    expect(() => assertMigrationTarget('not a url', {})).toThrow('DATABASE_URL is not a valid connection URL');
  });
});

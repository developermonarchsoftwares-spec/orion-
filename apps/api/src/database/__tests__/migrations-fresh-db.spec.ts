import { PGlite } from '@electric-sql/pglite';
import { and, eq, gt, lt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as schema from '../schema';
import { QueueService } from '../../modules/queue/queue.service';

/**
 * Fresh-install validation: the REAL migration journal, applied by Drizzle's own migrator to an empty in-memory PGlite database.
 * Nothing in this file creates an application table or seed row, so a gap in the migrations fails these tests.
 */
const MIGRATIONS = path.resolve(__dirname, '../migrations');
const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as {
  entries: Array<{ idx: number; tag: string; when: number }>;
};
const snapshot = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, `meta/${journal.entries[journal.entries.length - 1].tag.slice(0, 4)}_snapshot.json`), 'utf8'));

const fresh = async (folder = MIGRATIONS) => {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: folder });
  return { client, db };
};
const count = async (client: PGlite, table: string) => Number((await client.query<{ n: string }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);

/** A copy of the migrations folder with a chosen subset of journal entries: models a database whose applied history stops there. */
function partialFolder(keep: (tag: string) => boolean): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-mig-'));
  fs.mkdirSync(path.join(dir, 'meta'));
  const entries = journal.entries.filter((e) => keep(e.tag));
  fs.writeFileSync(path.join(dir, 'meta/_journal.json'), JSON.stringify({ version: '7', dialect: 'postgresql', entries }));
  for (const e of entries) fs.copyFileSync(path.join(MIGRATIONS, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
  return dir;
}

describe('migration journal integrity', () => {
  it('every entry has a file, every sql file is journaled, and idx equals position and file number (no duplicate numbers)', () => {
    const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).map((f) => f.replace(/\.sql$/, ''));
    expect([...files].sort()).toEqual(journal.entries.map((e) => e.tag).sort());
    journal.entries.forEach((e, i) => {
      expect(e.idx).toBe(i);
      expect(Number(e.tag.slice(0, 4))).toBe(i);
    });
  });

  it('timestamps are strictly increasing (Drizzle skips any entry that is not newer than the latest applied one)', () => {
    for (let i = 1; i < journal.entries.length; i++) expect(journal.entries[i].when).toBeGreaterThan(journal.entries[i - 1].when);
  });

  it('0003 sits between 0002 and 0004 in time, and every snapshot after it chains to the previous one', () => {
    const t = (tag: string) => journal.entries.find((e) => e.tag.startsWith(tag))!.when;
    expect(t('0003')).toBeGreaterThan(t('0002'));
    expect(t('0003')).toBeLessThan(t('0004'));
    const snaps = journal.entries.map((e) => e.tag.slice(0, 4)).filter((n) => fs.existsSync(path.join(MIGRATIONS, `meta/${n}_snapshot.json`)));
    const parsed = snaps.map((n) => JSON.parse(fs.readFileSync(path.join(MIGRATIONS, `meta/${n}_snapshot.json`), 'utf8')));
    for (let i = 1; i < parsed.length; i++) expect(parsed[i].prevId).toBe(parsed[i - 1].id);
  });
});

describe('fresh database (empty PGlite + the real journal)', () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    ({ client, db } = await fresh());
  }, 120_000);
  afterAll(async () => {
    await client.close();
  });

  it('applies every journaled migration exactly once and is a no-op when run again', async () => {
    const rows = (await client.query<{ hash: string }>('SELECT hash FROM drizzle.__drizzle_migrations')).rows;
    expect(rows).toHaveLength(journal.entries.length);
    expect(new Set(rows.map((r) => r.hash)).size).toBe(journal.entries.length);
    await migrate(db, { migrationsFolder: MIGRATIONS });
    expect(await count(client, 'drizzle.__drizzle_migrations')).toBe(journal.entries.length);
  });

  it('every table, column (type, nullability) and index in the latest snapshot exists', async () => {
    const problems: string[] = [];
    for (const [key, table] of Object.entries<any>(snapshot.tables)) {
      const name = key.split('.').pop() as string;
      const cols = (await client.query<{ column_name: string; is_nullable: string }>(
        `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
        [name],
      )).rows;
      if (cols.length === 0) {
        problems.push(`missing table ${name}`);
        continue;
      }
      for (const c of Object.values<any>(table.columns)) {
        const found = cols.find((x) => x.column_name === c.name);
        if (!found) problems.push(`${name}.${c.name} missing`);
        else if ((found.is_nullable === 'NO') !== !!c.notNull) problems.push(`${name}.${c.name} nullability differs`);
      }
      const idx = (await client.query<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1`, [name])).rows.map((r) => r.indexname);
      for (const i of Object.keys(table.indexes)) if (!idx.includes(i)) problems.push(`${name} index ${i} missing`);
    }
    expect(problems).toEqual([]);
  });

  it('queue_jobs and admin_otps match the Drizzle schema (defaults, primary keys, index columns)', async () => {
    const def = async (table: string, col: string) =>
      (await client.query<{ column_default: string | null }>(`SELECT column_default FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`, [table, col])).rows[0].column_default;
    expect(await def('queue_jobs', 'status')).toContain('WAITING');
    expect(await def('queue_jobs', 'attempts')).toBe('0');
    expect(await def('queue_jobs', 'max_attempts')).toBe('3');
    expect(await def('admin_otps', 'max_attempts')).toBe('5');
    expect(await def('admin_otps', 'attempts')).toBe('0');
    const pk = async (table: string) =>
      (await client.query<{ column_name: string }>(
        `SELECT kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu USING (constraint_name, table_schema)
         WHERE tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'`, [table])).rows.map((r) => r.column_name);
    expect(await pk('queue_jobs')).toEqual(['id']);
    expect(await pk('admin_otps')).toEqual(['id']);
    const idxDef = async (name: string) => (await client.query<{ indexdef: string }>(`SELECT indexdef FROM pg_indexes WHERE indexname = $1`, [name])).rows[0].indexdef;
    expect(await idxDef('idx_queue_jobs_queue_status')).toContain('(queue_name, status)');
    expect(await idxDef('idx_queue_jobs_created_at')).toContain('(created_at)');
    expect(await idxDef('idx_admin_otps_email')).toContain('(email)');
    expect(await idxDef('idx_admin_otps_expires_at')).toContain('(expires_at)');
  });

  describe('package seeding (0003) ran once', () => {
    it('installs the five plans and the default pricing settings, with no duplicates', async () => {
      const pkgs = await db.select().from(schema.creditPackages);
      expect(pkgs.map((p) => p.slug).sort()).toEqual(['agency', 'enterprise', 'free', 'growth', 'starter']);
      const price = (slug: string) => pkgs.find((p) => p.slug === slug)!;
      expect([price('starter').priceInr, price('starter').credits]).toEqual([99, 100]);
      expect([price('growth').priceInr, price('growth').credits]).toEqual([299, 350]);
      expect([price('agency').priceInr, price('agency').credits]).toEqual([999, 1500]);
      const settings = (await db.select().from(schema.pricingSettings)).map((s) => s.key).sort();
      expect(settings).toEqual(['ANNUAL_DISCOUNT_PERCENTAGE', 'DAILY_FREE_CREDITS', 'DEFAULT_CURRENCY']);
    });

    it('re-running the seed SQL changes nothing (idempotent), and the journal has exactly one 0003 row', async () => {
      await client.exec(fs.readFileSync(path.join(MIGRATIONS, '0003_seed_packages.sql'), 'utf8'));
      expect(await count(client, 'credit_packages')).toBe(5);
      expect(await count(client, 'pricing_settings')).toBe(3);
      expect(journal.entries.filter((e) => e.tag.startsWith('0003'))).toHaveLength(1);
    });
  });

  describe('queue operations on the migrated queue_jobs', () => {
    const pool = (c: PGlite): any => {
      const run = async (text: string, values?: unknown[]) => {
        const res = await c.query<any>(text, values as any[]);
        return { rows: res.rows, rowCount: res.rows.length, fields: [] };
      };
      return { query: run, connect: async () => ({ query: run, release: () => undefined }) };
    };
    const waitFor = async (check: () => Promise<boolean>) => {
      for (let i = 0; i < 100; i++) {
        if (await check()) return;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error('timed out');
    };

    it('enqueues, claims, runs a handler, completes, retries a failure to FAILED, reports stats and prunes', async () => {
      const queue = new QueueService(db as any, pool(client));
      const seen: unknown[] = [];
      queue.registerWorker('mig-test', async (job) => {
        if (job.name === 'boom') throw new Error('handler failed');
        seen.push(job.data);
        return { done: true };
      });
      const ok = await queue.addJob('mig-test', 'work', { n: 1 });
      const bad = await queue.addJob('mig-test', 'boom', {}, { attempts: 2 });
      await waitFor(async () => {
        const rows = await db.select().from(schema.queueJobs).where(eq(schema.queueJobs.queueName, 'mig-test'));
        return rows.length === 2 && rows.every((r) => r.status === 'COMPLETED' || r.status === 'FAILED');
      });
      const rows = await db.select().from(schema.queueJobs).where(eq(schema.queueJobs.queueName, 'mig-test'));
      expect(rows.find((r) => r.id === ok.id)).toMatchObject({ status: 'COMPLETED', result: { done: true } });
      expect(rows.find((r) => r.id === bad.id)).toMatchObject({ status: 'FAILED', attempts: 2, error: 'handler failed' });
      expect(seen).toEqual([{ n: 1 }]);
      expect(await queue.getQueueStats('mig-test')).toMatchObject({ completed: 1, failed: 1, waiting: 0 });
      expect(await queue.ping()).toBe(true);

      await client.query(`UPDATE queue_jobs SET created_at = now() - interval '30 days' WHERE queue_name = 'mig-test'`);
      await queue.pruneOldJobs(7);
      expect(await db.select().from(schema.queueJobs).where(eq(schema.queueJobs.queueName, 'mig-test'))).toHaveLength(0);
      queue.unregisterWorker('mig-test');
      await queue.onModuleDestroy();
    });
  });

  describe('admin OTP persistence on the migrated admin_otps', () => {
    it('stores, finds the active code, counts attempts, expires and deletes', async () => {
      const email = 'otp.persist@monarchsoftwares.com';
      const [row] = await db.insert(schema.adminOtps).values({ email, otp: '654321', expiresAt: new Date(Date.now() + 300_000) }).returning();
      expect(row).toMatchObject({ email, otp: '654321', attempts: 0, maxAttempts: 5 });
      const active = () => db.select().from(schema.adminOtps).where(and(eq(schema.adminOtps.email, email), gt(schema.adminOtps.expiresAt, new Date())));
      expect(await active()).toHaveLength(1);
      await db.update(schema.adminOtps).set({ attempts: 2 }).where(eq(schema.adminOtps.id, row.id));
      expect((await active())[0].attempts).toBe(2);
      await db.update(schema.adminOtps).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.adminOtps.id, row.id));
      expect(await active()).toHaveLength(0);
      await db.delete(schema.adminOtps).where(lt(schema.adminOtps.expiresAt, new Date()));
      expect(await count(client, 'admin_otps')).toBe(0);
    });
  });
});

describe('compatibility with databases whose applied history differs', () => {
  it('a database that stopped at 0002 gets 0003 (seed), 0004..0016 and 0017 in one pass', async () => {
    const dir = partialFolder((t) => Number(t.slice(0, 3 + 1)) <= 2);
    const { client, db } = await fresh(dir);
    expect(await count(client, 'credit_packages')).toBe(0); // 0003 not yet part of that history
    await migrate(db, { migrationsFolder: MIGRATIONS });
    expect(await count(client, 'drizzle.__drizzle_migrations')).toBe(journal.entries.length);
    expect(await count(client, 'credit_packages')).toBe(5);
    expect(await count(client, 'queue_jobs')).toBe(0);
    await client.close();
  }, 120_000);

  it('a database that already applied through 0016 without 0003 skips it, applies 0017 onwards, and errors on nothing', async () => {
    const dir = partialFolder((t) => !t.startsWith('0003') && Number(t.slice(0, 4)) < 17);
    const { client, db } = await fresh(dir);
    await client.exec(`INSERT INTO credit_packages (slug, name, price_inr, credits) VALUES ('starter', 'Seeded by seed.ts', 99, 100)`);
    await migrate(db, { migrationsFolder: MIGRATIONS });
    expect(await count(client, 'drizzle.__drizzle_migrations')).toBe(journal.entries.length - 1); // 0003 never runs there
    expect(await count(client, 'credit_packages')).toBe(1); // the existing row is untouched
    expect(await count(client, 'queue_jobs')).toBe(0);
    expect(await count(client, 'admin_otps')).toBe(0);
    await client.close();
  }, 120_000);

  it('a database whose queue_jobs / admin_otps were created out of band keeps its data when 0017 runs', async () => {
    const dir = partialFolder((t) => Number(t.slice(0, 4)) < 17);
    const { client, db } = await fresh(dir);
    await client.exec(`CREATE TABLE queue_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), queue_name varchar(100) NOT NULL, job_name varchar(100) NOT NULL, data jsonb NOT NULL,
      status varchar(20) DEFAULT 'WAITING' NOT NULL, attempts integer DEFAULT 0 NOT NULL, max_attempts integer DEFAULT 3 NOT NULL, error text, result jsonb,
      locked_at timestamptz, processed_at timestamptz, created_at timestamptz DEFAULT now() NOT NULL, updated_at timestamptz DEFAULT now() NOT NULL);
      INSERT INTO queue_jobs (queue_name, job_name, data) VALUES ('q', 'j', '{}');
      CREATE TABLE admin_otps (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email varchar(255) NOT NULL, otp varchar(255) NOT NULL, attempts integer DEFAULT 0 NOT NULL,
      max_attempts integer DEFAULT 5 NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz DEFAULT now() NOT NULL);
      CREATE INDEX idx_admin_otps_email ON admin_otps (email);`);
    await migrate(db, { migrationsFolder: MIGRATIONS });
    expect(await count(client, 'queue_jobs')).toBe(1);
    const idx = (await client.query<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE tablename IN ('queue_jobs','admin_otps')`)).rows.map((r) => r.indexname);
    expect(idx).toEqual(expect.arrayContaining(['idx_queue_jobs_queue_status', 'idx_queue_jobs_created_at', 'idx_admin_otps_email', 'idx_admin_otps_expires_at']));
    await client.close();
  }, 120_000);
});

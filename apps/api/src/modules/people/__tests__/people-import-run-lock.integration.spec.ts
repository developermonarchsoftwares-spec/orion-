import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { DynamicModule, Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DATABASE, PG_POOL } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { TransactionService } from '../../../database/transaction.service';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import { QueueService } from '../../queue/queue.service';
import { StorageService } from '../../storage/storage.service';
import { PeopleExportImportService } from '../ingestion/people-export-import.service';
import { PeopleImportJobService } from '../ingestion/people-import-job.service';
import { PeopleIngestionService } from '../ingestion/people-ingestion.service';
import { ObservationService } from '../observations/observation.service';
import { PeopleWriteService } from '../people-write.service';
import { SourceRegistryService } from '../sources/source-registry.service';
import { exportRow, toCsv } from './people-export-fixtures';
import { createTestDb, JOURNALED_MIGRATIONS, seedBusiness } from './pglite-test-db';

/**
 * Phase 9E: People import runs are mutually exclusive across API instances.
 *
 * Measured on a real local PostgreSQL (two job runs started at the same time, as two API instances would): the same people met by
 * work e-mail or phone in two runs were created TWICE (8-40 duplicate people per 40), and a LinkedIn match failed on the unique index
 * (whole parts quarantined as PROCESSING_ERROR). One at a time, the same files gave exactly 40 people. The job service therefore holds
 * a transaction-scoped advisory lock for the whole run. A single in-process database cannot interleave transactions, so these tests
 * check what the lock is for: the runs never overlap, the lock is always released, and the key is the one fixed key.
 */
class FakeStorage {
  files = new Map<string, Buffer>();
  async uploadFile(o: { key: string; buffer: Buffer }) { this.files.set(o.key, o.buffer); return { key: o.key } as any; }
  async getFileStream(k: string) { const b = this.files.get(k); if (!b) throw new Error('NoSuchKey'); return Readable.from([b]); }
  async deleteFile(k: string) { return this.files.delete(k); }
}
const poolOver = (client: { query: (t: string, p?: unknown[]) => Promise<{ rows: any[] }> }) => {
  const query = async (text: string, params?: unknown[]) => { const r = await client.query(text, params); return { rows: r.rows, rowCount: r.rows.length }; };
  return { query, connect: async () => ({ query, release: () => undefined }) };
};

/** A pool whose advisory lock is a real mutex: it is held from the lock statement until COMMIT / ROLLBACK / release. */
class MutexPool {
  log: string[] = [];
  keys: unknown[] = [];
  connects = 0;
  releases = 0;
  failConnect = false;
  private tail: Promise<void> = Promise.resolve();
  async connect() {
    if (this.failConnect) throw new Error('pool exhausted: postgres://u:p@h/db');
    this.connects++;
    let unlock: (() => void) | null = null;
    const done = () => { if (unlock) { unlock(); unlock = null; } };
    return {
      query: async (text: string, params?: unknown[]) => {
        this.log.push(text.split('(')[0].trim());
        if (/pg_advisory_xact_lock/.test(text)) {
          this.keys.push(params?.[0]);
          const previous = this.tail;
          let release!: () => void;
          this.tail = new Promise<void>((r) => (release = r));
          await previous; // wait until the holder commits
          unlock = release;
        }
        if (/^(COMMIT|ROLLBACK)/.test(text)) done();
        return { rows: [], rowCount: 0 };
      },
      release: () => { this.releases++; done(); },
    };
  }
}

@Global()
@Module({})
class TestDbModule {
  static forDb(db: DrizzleDb, pool: unknown): DynamicModule {
    return {
      module: TestDbModule, global: true,
      providers: [{ provide: DRIZZLE_DATABASE, useValue: db }, { provide: PG_POOL, useValue: pool }, TransactionService],
      exports: [DRIZZLE_DATABASE, PG_POOL, TransactionService],
    };
  }
}

describe('People import run lock (Phase 9E)', () => {
  let db: DrizzleDb;
  let close: () => Promise<void>;
  let jobs: PeopleImportJobService;
  let unlocked: PeopleImportJobService;
  let ingestion: PeopleIngestionService;
  let queue: QueueService;
  let stop: () => Promise<void>;
  const pool = new MutexPool();
  const storage = new FakeStorage();
  let n = 0;
  const letters = (k: number) => { let s = ''; let v = k + 1; while (v > 0) { s = String.fromCharCode(97 + ((v - 1) % 26)) + s; v = Math.floor((v - 1) / 26); } return s; };
  const csv = (company: string, k = 3) =>
    toCsv(Array.from({ length: k }, () => exportRow({ company_name: `${company} Pvt Ltd`, company_city: 'Pune', company_state: 'Maharashtra', full_name: `Lock${letters(++n)} Persona${letters(n * 5)}`, relationship_id: randomUUID() })));
  const people = async () => (await db.select({ n: sql<number>`count(*)::int` }).from(schema.people))[0].n as number;

  /** Run ingestion with a delay and report how many runs were inside it at once. */
  const overlap = async (body: () => Promise<unknown>) => {
    const real = ingestion.ingest.bind(ingestion);
    let active = 0;
    let max = 0;
    (ingestion as any).ingest = async (recs: any, opts: any) => {
      active++; max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 40));
      try { return await real(recs, opts); } finally { active--; }
    };
    try { await body(); } finally { (ingestion as any).ingest = real; }
    return max;
  };

  beforeAll(async () => {
    const t = await createTestDb([...JOURNALED_MIGRATIONS, '0017_queue_jobs_admin_otps.sql']);
    db = t.db;
    close = () => t.client.close();
    const module = await Test.createTestingModule({
      imports: [TestDbModule.forDb(db, pool)],
      providers: [PeopleWriteService, PeopleIngestionService, PeopleExportImportService, SourceRegistryService, ObservationService, PeopleImportJobService,
        { provide: StorageService, useValue: storage }, { provide: QueueService, useFactory: () => new QueueService(t.db, poolOver(t.client as any) as any) }],
    }).compile();
    await module.init();
    stop = () => module.close(); // QueueService starts a maintenance timer on init
    jobs = module.get(PeopleImportJobService);
    ingestion = module.get(PeopleIngestionService);
    queue = module.get(QueueService);
    queue.unregisterWorker(QUEUE_NAMES.PEOPLE_IMPORT); // the tests run the jobs themselves
    // the same service WITHOUT a pool: what an unlocked run looks like (proves the overlap check can see an overlap)
    unlocked = new PeopleImportJobService(db, module.get(PeopleExportImportService), storage as any, queue, undefined);
    await seedBusiness(db, 'lock-alpha', { city: 'Pune', state: 'Maharashtra' });
    await seedBusiness(db, 'lock-bravo', { city: 'Pune', state: 'Maharashtra' });
  }, 120_000);

  afterAll(async () => { await stop?.(); await close?.(); });

  it('two runs started at the same time never overlap; without the lock they do', async () => {
    const a = await jobs.enqueue({ format: 'csv', content: csv('lock-alpha') });
    const b = await jobs.enqueue({ format: 'csv', content: csv('lock-bravo') });
    expect(await overlap(() => Promise.all([jobs.execute(a.jobId), jobs.execute(b.jobId)]))).toBe(1);
    expect((await jobs.getJob(a.jobId)).reconciliation.balanced).toBe(true);
    expect(await people()).toBe(6);

    const c = await unlocked.enqueue({ format: 'csv', content: csv('lock-alpha') });
    const d = await unlocked.enqueue({ format: 'csv', content: csv('lock-bravo') });
    expect(await overlap(() => Promise.all([unlocked.execute(c.jobId), unlocked.execute(d.jobId)]))).toBe(2);
  });

  it('many runs queue up behind the lock one at a time, in any order, and all complete', async () => {
    const ids = [] as string[];
    for (let i = 0; i < 5; i++) ids.push((await jobs.enqueue({ format: 'csv', content: csv(i % 2 ? 'lock-alpha' : 'lock-bravo', 2) })).jobId);
    const before = await people();
    expect(await overlap(() => Promise.all(ids.map((id) => jobs.execute(id))))).toBe(1);
    expect(await people()).toBe(before + 10);
  });

  it('uses one fixed transaction-scoped advisory lock, held on its own connection and always released', async () => {
    pool.log = []; pool.keys = []; pool.connects = 0; pool.releases = 0;
    const a = await jobs.enqueue({ format: 'csv', content: csv('lock-alpha') });
    await jobs.execute(a.jobId);
    // Phase 27: the pool's server-side limits would end this deliberately idle, deliberately waiting transaction, so they are lifted for it alone
    expect(pool.log).toEqual([
      'BEGIN',
      'SET LOCAL statement_timeout = 0',
      'SET LOCAL idle_in_transaction_session_timeout = 0',
      'SET LOCAL lock_timeout = 0',
      'SELECT pg_advisory_xact_lock',
      'COMMIT',
    ]);
    expect(pool.keys).toEqual(['orion:people-import-run']);
    expect([pool.connects, pool.releases]).toEqual([1, 1]);
  });

  it('the lock is released when the run fails, so the next run is not blocked', async () => {
    pool.connects = 0; pool.releases = 0;
    const real = ingestion.ingest.bind(ingestion);
    (ingestion as any).ingest = async () => { throw new Error('boom: SELECT secret'); };
    const a = await jobs.enqueue({ format: 'csv', content: csv('lock-alpha') });
    try {
      await expect(jobs.execute(a.jobId)).rejects.toThrow('PEOPLE_IMPORT_ATTEMPT_FAILED');
    } finally {
      (ingestion as any).ingest = real;
    }
    expect([pool.connects, pool.releases]).toEqual([1, 1]);
    const b = await jobs.enqueue({ format: 'csv', content: csv('lock-bravo') });
    const out = await Promise.race([jobs.execute(b.jobId), new Promise((_, rej) => setTimeout(() => rej(new Error('blocked behind a leaked lock')), 15_000))]);
    expect((out as any).final).toBe(true);
  });

  it('a job that is already final does not take the lock, and a pool failure is a plain retryable attempt failure that writes nothing', async () => {
    const a = await jobs.enqueue({ format: 'csv', content: csv('lock-alpha') });
    await jobs.execute(a.jobId);
    pool.connects = 0;
    await jobs.execute(a.jobId); // redelivery of a finished job
    expect(pool.connects).toBe(0);

    const before = await people();
    const b = await jobs.enqueue({ format: 'csv', content: csv('lock-bravo') });
    pool.failConnect = true;
    try {
      const err = await jobs.execute(b.jobId).catch((e) => e as Error);
      expect((err as Error).message).toBe('PEOPLE_IMPORT_ATTEMPT_FAILED');
      expect(String((err as Error).message)).not.toMatch(/postgres|pool/);
    } finally {
      pool.failConnect = false;
    }
    expect(await people()).toBe(before);
    expect((await jobs.execute(b.jobId)).final).toBe(true); // the retry succeeds
    expect(await people()).toBe(before + 3);
  });
});

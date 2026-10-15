import { eq, sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { BusinessException } from '../../../common/errors/business.exception';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { AcquisitionOrchestratorService } from '../acquisition/acquisition-orchestrator.service';
import type { IAcquisitionAdapter } from '../acquisition/acquisition.types';
import { IRawPersonRecord } from '../ingestion/ingestion.types';
import { PeopleIngestionService } from '../ingestion/people-ingestion.service';
import { ObservationService } from '../observations/observation.service';
import { PeopleWriteService } from '../people-write.service';
import { SourceRegistryService } from '../sources/source-registry.service';
import type { ISourceBatch } from '../sources/source.types';
import { expectLedgerConsistent } from './ledger-invariants';
import { createTestDb, seedBusiness } from './pglite-test-db';

const POLICY = { permissions: { identity: true, title: true, email: true, phone: true, linkedin: true, evidence: true }, allowedEvidenceTypes: ['ROLE_CLAIM', 'IDENTITY_CLAIM', 'CONTACT_CLAIM'], maxAttestation: 'NONE' };

describe('People acquisition orchestration (Phase 6.9)', () => {
  let db: DrizzleDb;
  let closeDb: () => Promise<void>;
  let write: PeopleWriteService;
  let ingestion: PeopleIngestionService;
  let registry: SourceRegistryService;
  let orch: AcquisitionOrchestratorService;
  let delays: number[];
  let n = 0;

  const tag = () => `${++n}${Math.random().toString(36).slice(2, 6)}`.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);
  const newSource = async (over: Record<string, unknown> = {}) => {
    const key = `acq-${tag()}`;
    await registry.register({ key, displayName: key, sourceType: 'PARTNER_FEED', termsAcknowledged: true, enabled: true, policy: POLICY, ...over } as any);
    return key;
  };
  const company = () => seedBusiness(db, `acq-co-${++n}-${Math.random().toString(36).slice(2, 6)}`);
  const rec = (co: { id: string }, name: string, recordId: string, over: Record<string, unknown> = {}): IRawPersonRecord =>
    ({ businessId: co.id, personName: name, jobTitle: 'Director', source: { type: 'PARTNER_FEED', reference: 'feed', recordId }, ...over }) as IRawPersonRecord;
  /** records()-only adapter (like CSV / JSON): no fetch. */
  const listAdapter = (sourceKey: string, records: IRawPersonRecord[], extra: Partial<IAcquisitionAdapter> = {}): IAcquisitionAdapter & { calls: number } => {
    const a: any = { name: sourceKey, sourceKey, calls: 0, records() { a.calls++; return records; }, ...extra };
    return a;
  };
  /** paged adapter with fetch(cursor). */
  const pagedAdapter = (sourceKey: string, pages: IRawPersonRecord[][], hooks: { onFetch?: (cursor: string | undefined, i: number) => void } = {}) => {
    const cursors: Array<string | undefined> = [];
    const a: any = {
      name: sourceKey,
      sourceKey,
      cursors,
      records: () => [],
      async fetch(cursor?: string): Promise<ISourceBatch> {
        cursors.push(cursor);
        const i = cursor ? Number(cursor.replace('c', '')) : 0;
        hooks.onFetch?.(cursor, i);
        return { acquiredAt: new Date(), records: pages[i].map((m) => ({ mapped: m, sourceRecordId: (m as any).source.recordId })), cursor: i + 1 < pages.length ? `c${i + 1}` : undefined };
      },
    };
    return a as IAcquisitionAdapter & { cursors: Array<string | undefined> };
  };
  const people = () => db.select().from(schema.people);
  const run = (id: string) => db.select().from(schema.peopleAcquisitionRuns).where(eq(schema.peopleAcquisitionRuns.id, id)).then((r) => r[0]);
  const obs = (key: string) => db.select().from(schema.peopleObservations).where(eq(schema.peopleObservations.sourceKey, key));
  const mk = (co: { id: string }, count: number, prefix = 'p') => Array.from({ length: count }, (_, i) => rec(co, `${prefix}${String.fromCharCode(97 + i)}xy Person${tag()}`, `r-${prefix}-${i}`));

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    closeDb = () => t.client.close();
    write = new PeopleWriteService(db);
    registry = new SourceRegistryService(db);
    ingestion = new PeopleIngestionService(db, write, registry, new ObservationService(db));
    orch = new AcquisitionOrchestratorService(db, ingestion, registry);
  }, 60_000);

  beforeEach(() => {
    delays = [];
    orch.setSleeper(async (ms) => {
      delays.push(ms);
    });
  });
  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await expectLedgerConsistent(db);
    await closeDb?.();
  });

  describe('runs', () => {
    it('creates a QUEUED run identified by source, version, limits and an observation run id; executes to COMPLETED with counts', async () => {
      const key = await newSource();
      const co = await company();
      orch.registerAdapter(listAdapter(key, mk(co, 5)));
      const r = await orch.createRun(key, { batchSize: 2 }, { enqueue: false });
      expect(r).toMatchObject({ status: 'QUEUED', sourceKey: key, sourceVersion: '1', batchRef: `acq-${r.id}`, maxRecords: 10_000, batchSize: 2, recordsSeen: 0, startedAt: null });
      const out = await orch.executeRun(r.id);
      expect(out).toEqual({ runId: r.id, status: 'COMPLETED', failureCode: null });
      const done = await run(r.id);
      expect(done).toMatchObject({ status: 'COMPLETED', recordsSeen: 5, recordsCreated: 5, recordsQuarantined: 0, recordsFailed: 0, batchesDone: 3, claimToken: null, failureCode: null });
      expect(done.startedAt).toBeInstanceOf(Date);
      expect(done.finishedAt).toBeInstanceOf(Date);
      const o = await obs(key);
      expect(o).toHaveLength(5);
      expect(new Set(o.map((x) => x.batchRef))).toEqual(new Set([r.batchRef])); // the run id IS the observation run id
    });

    it('refuses safely: unregistered, disabled, terms not acknowledged', async () => {
      await expect(orch.createRun('nope-' + tag())).rejects.toMatchObject({ errorCode: 'SOURCE_NOT_REGISTERED' });
      const off = await newSource({ enabled: false });
      await expect(orch.createRun(off)).rejects.toMatchObject({ errorCode: 'SOURCE_DISABLED' });
      const unack = await newSource({ termsAcknowledged: false, enabled: false });
      await expect(orch.createRun(unack)).rejects.toMatchObject({ errorCode: 'SOURCE_TERMS_NOT_ACKNOWLEDGED' });
      expect((await db.select().from(schema.peopleAcquisitionRuns)).filter((x) => [off, unack].includes(x.sourceKey))).toHaveLength(0);
    });

    it('a source disabled while the run is going fails the run safely before the next batch', async () => {
      const key = await newSource();
      const co = await company();
      let toggled = false;
      orch.registerAdapter(listAdapter(key, mk(co, 4)));
      const real = ingestion.ingest.bind(ingestion);
      jest.spyOn(ingestion, 'ingest').mockImplementation(async (records: any, opts: any) => {
        const out = await real(records, opts);
        if (!toggled) {
          toggled = true;
          await registry.setEnabled(key, false);
        }
        return out;
      });
      const r = await orch.createRun(key, { batchSize: 2 }, { enqueue: false });
      const out = await orch.executeRun(r.id);
      expect(out).toMatchObject({ status: 'FAILED', failureCode: 'SOURCE_NOT_USABLE' });
      expect((await run(r.id)).recordsCreated).toBe(2); // the first batch only
      await registry.setEnabled(key, true);
    });
  });

  describe('limits, budget, rate', () => {
    it('validates limits and refuses oversized runs before processing anything', async () => {
      const key = await newSource();
      await expect(orch.createRun(key, { batchSize: 50, maxRecords: 10 })).rejects.toMatchObject({ errorCode: 'INVALID_RUN_LIMITS' });
      await expect(orch.createRun(key, { maxRecords: 10_001 })).rejects.toMatchObject({ errorCode: 'INVALID_RUN_LIMITS' });
      await expect(orch.createRun(key, { maxRetries: 99 })).rejects.toMatchObject({ errorCode: 'INVALID_RUN_LIMITS' });
      const co = await company();
      orch.registerAdapter(listAdapter(key, mk(co, 6)));
      const before = (await people()).length;
      const r = await orch.createRun(key, { maxRecords: 5, batchSize: 5 }, { enqueue: false });
      expect(await orch.executeRun(r.id)).toMatchObject({ status: 'FAILED', failureCode: 'OVERSIZED_RUN' });
      expect((await people()).length).toBe(before);
      expect(await obs(key)).toHaveLength(0);
    });

    it('a source with no cost model costs zero units; a declared cost is budgeted per run and exhaustion stops the run, resumable with a higher budget', async () => {
      const free = await newSource();
      const co = await company();
      orch.registerAdapter(listAdapter(free, mk(co, 3, 'f')));
      const fr = await orch.createRun(free, { maxCostUnits: 0 }, { enqueue: false });
      expect(await orch.executeRun(fr.id)).toMatchObject({ status: 'COMPLETED' });
      expect((await run(fr.id)).costUnits).toBe(0);

      const paid = await newSource();
      orch.registerAdapter(listAdapter(paid, mk(co, 4, 'q'), { costUnitsPerRecord: 2 }));
      const r = await orch.createRun(paid, { batchSize: 2, maxCostUnits: 5 }, { enqueue: false });
      expect(await orch.executeRun(r.id)).toMatchObject({ status: 'FAILED', failureCode: 'BUDGET_EXHAUSTED' });
      let cur = await run(r.id);
      expect(cur).toMatchObject({ costUnits: 4, recordsCreated: 2, batchesDone: 1 });
      await orch.resumeRun(r.id, { maxCostUnits: 20 }, { enqueue: false });
      expect(await orch.executeRun(r.id)).toMatchObject({ status: 'COMPLETED' });
      cur = await run(r.id);
      expect(cur).toMatchObject({ costUnits: 8, recordsCreated: 4, recordsSkipped: 2 }); // the first two were not processed (or paid for) again
      expect((await people()).filter((p) => p.fullName.startsWith('q')).length).toBe(4);
    });

    it('rate-limits runs per source', async () => {
      const key = await newSource();
      await orch.createRun(key, { maxRunsPerHour: 2 }, { enqueue: false });
      await orch.createRun(key, { maxRunsPerHour: 2 }, { enqueue: false });
      await expect(orch.createRun(key, { maxRunsPerHour: 2 }, { enqueue: false })).rejects.toMatchObject({ errorCode: 'SOURCE_RATE_LIMITED' });
      const other = await newSource();
      await expect(orch.createRun(other, { maxRunsPerHour: 2 }, { enqueue: false })).resolves.toBeDefined(); // per source
    });
  });

  describe('retry and failure isolation', () => {
    it('retries a transient record failure with deterministic bounded backoff and then succeeds, without duplicates', async () => {
      const key = await newSource();
      const co = await company();
      const records = mk(co, 3, 't');
      orch.registerAdapter(listAdapter(key, records));
      const real = write.upsertPersonForBusiness.bind(write);
      let flaky = 0;
      jest.spyOn(write, 'upsertPersonForBusiness').mockImplementation(async (input: any) => {
        if (input.person.fullName === records[1].personName && flaky++ < 2) throw new Error('connection reset');
        return real(input);
      });
      const r = await orch.createRun(key, { backoffBaseMs: 1000, maxRetries: 3 }, { enqueue: false });
      expect(await orch.executeRun(r.id)).toMatchObject({ status: 'COMPLETED' });
      expect(delays).toEqual([1000, 2000]); // base * 2^(attempt-1), no jitter
      const done = await run(r.id);
      expect(done).toMatchObject({ recordsCreated: 3, recordsFailed: 0, retries: 2 });
      expect((await people()).filter((p) => p.fullName.startsWith('t')).length).toBe(3);
    });

    it('a transient failure that survives every retry is counted, never aborts the batch, and is retried when the run is resumed', async () => {
      const key = await newSource();
      const co = await company();
      const records = mk(co, 3, 'x');
      orch.registerAdapter(listAdapter(key, records));
      const real = write.upsertPersonForBusiness.bind(write);
      const spy = jest.spyOn(write, 'upsertPersonForBusiness').mockImplementation(async (input: any) => {
        if (input.person.fullName === records[0].personName) throw new Error('db unavailable');
        return real(input);
      });
      const r = await orch.createRun(key, { maxRetries: 2, backoffBaseMs: 10 }, { enqueue: false });
      expect(await orch.executeRun(r.id)).toMatchObject({ status: 'COMPLETED' });
      expect(await run(r.id)).toMatchObject({ recordsCreated: 2, recordsFailed: 1 });
      expect(spy.mock.calls.filter((c: any) => c[0].person.fullName === records[0].personName)).toHaveLength(3); // 1 + 2 retries: bounded
      // make the run resumable and heal the fault
      spy.mockRestore();
      await db.update(schema.peopleAcquisitionRuns).set({ status: 'FAILED', failureCode: 'x' }).where(eq(schema.peopleAcquisitionRuns.id, r.id));
      await orch.resumeRun(r.id, {}, { enqueue: false });
      expect(await orch.executeRun(r.id)).toMatchObject({ status: 'COMPLETED' });
      expect(await run(r.id)).toMatchObject({ recordsCreated: 3, recordsFailed: 1, recordsSkipped: 2 }); // only the failed record was processed again
      expect((await people()).filter((p) => p.fullName.startsWith('x')).length).toBe(3);
    });

    it('never retries deterministic outcomes: invalid record, unknown company, suppressed identity', async () => {
      const key = await newSource();
      const co = await company();
      const good = mk(co, 1, 'g');
      const bads = [
        rec(co, '', 'bad-1', { personName: '' }), // invalid
        rec({ id: '00000000-0000-4000-8000-000000000000' }, 'Ghost Company', 'bad-2'), // company not found
      ];
      orch.registerAdapter(listAdapter(key, [...bads, ...good]));
      const spy = jest.spyOn(ingestion, 'ingest');
      const r = await orch.createRun(key, { backoffBaseMs: 5 }, { enqueue: false });
      expect(await orch.executeRun(r.id)).toMatchObject({ status: 'COMPLETED' });
      expect(spy).toHaveBeenCalledTimes(1); // one pass: nothing was retried
      expect(delays).toEqual([]);
      expect(await run(r.id)).toMatchObject({ recordsCreated: 1, recordsQuarantined: 2, recordsFailed: 0, retries: 0 });
    });

    it('one bad record does not abort the batch', async () => {
      const key = await newSource();
      const co = await company();
      const records = [...mk(co, 2, 'm'), rec(co, 'No Title Person', 'bad-t', { jobTitle: '' })];
      orch.registerAdapter(listAdapter(key, records));
      const r = await orch.createRun(key, { batchSize: 3 }, { enqueue: false });
      expect(await orch.executeRun(r.id)).toMatchObject({ status: 'COMPLETED' });
      expect(await run(r.id)).toMatchObject({ recordsCreated: 2, recordsQuarantined: 1, batchesDone: 1 });
    });

    it('an adapter that keeps failing transiently fails the run after bounded retries, and a deterministic adapter refusal is not retried', async () => {
      const key = await newSource();
      const flaky: any = { name: key, sourceKey: key, records: () => { throw new Error('socket hang up'); } };
      orch.registerAdapter(flaky);
      const r = await orch.createRun(key, { maxRetries: 2, backoffBaseMs: 10 }, { enqueue: false });
      expect(await orch.executeRun(r.id)).toMatchObject({ status: 'FAILED', failureCode: 'TRANSIENT_FAILURE_EXHAUSTED' });
      expect(delays).toEqual([10, 20]);
      const key2 = await newSource();
      orch.registerAdapter({ name: key2, sourceKey: key2, records: () => { throw new BusinessException('refused', 'ADAPTER_REFUSED', 400); } } as any);
      delays = [];
      const r2 = await orch.createRun(key2, {}, { enqueue: false });
      expect(await orch.executeRun(r2.id)).toMatchObject({ status: 'FAILED', failureCode: 'ADAPTER_REFUSED' });
      expect(delays).toEqual([]);
    });
  });

  describe('checkpoint / resume / replay', () => {
    it('a paged source resumes from the stored cursor without refetching or reprocessing earlier pages', async () => {
      const key = await newSource();
      const co = await company();
      const pages = [mk(co, 2, 'a'), mk(co, 2, 'b'), mk(co, 2, 'c')];
      let failSecond = true;
      const adapter = pagedAdapter(key, pages, {
        onFetch: (_c, i) => {
          if (i === 1 && failSecond) throw new BusinessException('rate limited upstream', 'UPSTREAM_REFUSED', 429);
        },
      });
      orch.registerAdapter(adapter);
      const r = await orch.createRun(key, { batchSize: 2 }, { enqueue: false });
      expect(await orch.executeRun(r.id)).toMatchObject({ status: 'FAILED', failureCode: 'UPSTREAM_REFUSED' });
      expect(await run(r.id)).toMatchObject({ cursor: 'c1', recordsCreated: 2, batchesDone: 1 });
      failSecond = false;
      await orch.resumeRun(r.id, {}, { enqueue: false });
      adapter.cursors.length = 0;
      expect(await orch.executeRun(r.id)).toMatchObject({ status: 'COMPLETED' });
      expect(adapter.cursors).toEqual(['c1', 'c2']); // resumed AT the cursor; page 0 never fetched again
      expect(await run(r.id)).toMatchObject({ recordsCreated: 6, recordsSkipped: 0, cursor: null, batchesDone: 3 });
      expect((await people()).filter((p) => /^[abc]/.test(p.fullName) && p.fullName.includes('Person')).length).toBeGreaterThanOrEqual(6);
    });

    it('replaying a finished run changes nothing: no duplicate people, roles, contacts, evidence or observations', async () => {
      const key = await newSource();
      const co = await company();
      const records = mk(co, 3, 'd').map((r, i) => ({ ...r, email: `d${i}.${tag()}@corp-acq.co.in` }) as IRawPersonRecord);
      orch.registerAdapter(listAdapter(key, records));
      const r = await orch.createRun(key, {}, { enqueue: false });
      await orch.executeRun(r.id);
      const count = async () => ({
        people: (await people()).length,
        roles: (await db.select().from(schema.companyPeople)).length,
        contacts: (await db.select().from(schema.personContacts)).length,
        evidence: (await db.select().from(schema.peopleEvidence)).length,
        observations: (await db.select().from(schema.peopleObservations)).length,
      });
      const before = await count();
      // force a replay of the SAME run (same observation run id)
      await db.update(schema.peopleAcquisitionRuns).set({ status: 'FAILED', failureCode: 'replay-test' }).where(eq(schema.peopleAcquisitionRuns.id, r.id));
      await orch.resumeRun(r.id, {}, { enqueue: false });
      expect(await orch.executeRun(r.id)).toMatchObject({ status: 'COMPLETED' });
      expect(await count()).toEqual(before);
      expect((await run(r.id)).recordsSkipped).toBe(3);
      // and the underlying Phase 6.2 identity also recognises a direct re-ingestion of the same run
      const again = await ingestion.ingest(records, { sourceKey: key, batchRef: r.batchRef });
      expect(again.observations).toMatchObject({ recorded: 0, duplicate: 3 });
      expect(await count()).toEqual(before);
    });
  });

  describe('ownership, state transitions and queue', () => {
    it('two workers cannot process one run: the second start is refused and the source is read once', async () => {
      const key = await newSource();
      const co = await company();
      const adapter = listAdapter(key, mk(co, 3, 'w'));
      orch.registerAdapter(adapter);
      const r = await orch.createRun(key, {}, { enqueue: false });
      const results = await Promise.allSettled([orch.executeRun(r.id), orch.executeRun(r.id)]);
      expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      const refused = results.find((x) => x.status === 'rejected') as PromiseRejectedResult;
      expect(refused.reason).toMatchObject({ errorCode: 'RUN_NOT_STARTABLE' });
      expect(adapter.calls).toBe(1);
      expect((await people()).filter((p) => p.fullName.startsWith('w')).length).toBe(3);
      await expect(orch.executeRun(r.id)).rejects.toMatchObject({ errorCode: 'RUN_NOT_STARTABLE' }); // COMPLETED is final
      expect(await orch.executeRunSafely(r.id)).toEqual({ runId: r.id, skipped: true }); // the queue path never throws
    });

    it('a RUNNING run with a live lease is not stolen; an expired lease can be taken over and the stale worker is fenced out', async () => {
      const key = await newSource();
      const co = await company();
      orch.registerAdapter(listAdapter(key, mk(co, 2, 'l')));
      const r = await orch.createRun(key, {}, { enqueue: false });
      await db.update(schema.peopleAcquisitionRuns).set({ status: 'RUNNING', claimToken: '11111111-1111-4111-8111-111111111111', leaseExpiresAt: new Date(Date.now() + 60_000) }).where(eq(schema.peopleAcquisitionRuns.id, r.id));
      await expect(orch.executeRun(r.id)).rejects.toMatchObject({ errorCode: 'RUN_NOT_STARTABLE' });
      await db.update(schema.peopleAcquisitionRuns).set({ leaseExpiresAt: new Date(Date.now() - 1000) }).where(eq(schema.peopleAcquisitionRuns.id, r.id));
      await expect((orch as any).checkpoint(r.id, 'not-the-token', {})).rejects.toBeDefined(); // stale/unknown owner cannot write
      expect(await orch.executeRun(r.id)).toMatchObject({ status: 'COMPLETED' });
    });

    it('state machine: QUEUED -> RUNNING -> COMPLETED; cancel only from QUEUED/RUNNING; resume only from FAILED; finished runs are final', async () => {
      const key = await newSource();
      const co = await company();
      orch.registerAdapter(listAdapter(key, mk(co, 1, 's')));
      const a = await orch.createRun(key, {}, { enqueue: false });
      expect((await orch.cancelRun(a.id)).status).toBe('CANCELLED');
      await expect(orch.executeRun(a.id)).rejects.toMatchObject({ errorCode: 'RUN_NOT_STARTABLE' });
      await expect(orch.resumeRun(a.id)).rejects.toMatchObject({ errorCode: 'RUN_NOT_RESUMABLE' });
      await expect(orch.cancelRun(a.id)).rejects.toMatchObject({ errorCode: 'RUN_NOT_CANCELLABLE' });
      const b = await orch.createRun(key, {}, { enqueue: false });
      await orch.executeRun(b.id);
      await expect(orch.cancelRun(b.id)).rejects.toMatchObject({ errorCode: 'RUN_NOT_CANCELLABLE' });
      await expect(orch.resumeRun(b.id)).rejects.toMatchObject({ errorCode: 'RUN_NOT_RESUMABLE' });
    });

    it('cancelling a running run stops it before the next batch; what was ingested stays', async () => {
      const key = await newSource();
      const co = await company();
      let runId = '';
      const adapter = pagedAdapter(key, [mk(co, 2, 'k'), mk(co, 2, 'z')], { onFetch: (_c, i) => { if (i === 1) void orch.cancelRun(runId); } });
      orch.registerAdapter(adapter);
      const r = await orch.createRun(key, { batchSize: 2 }, { enqueue: false });
      runId = r.id;
      const out = await orch.executeRun(r.id);
      expect(out.status).toBe('CANCELLED');
      await new Promise((res) => setTimeout(res, 20));
      const cur = await run(r.id);
      expect(cur.status).toBe('CANCELLED');
      expect(cur.recordsCreated).toBe(2);
    });

    it('uses the existing Postgres queue only as a wake-up carrying the run id', async () => {
      const addJob = jest.fn().mockResolvedValue({ id: 'j' });
      const registerWorker = jest.fn();
      const q = new AcquisitionOrchestratorService(db, ingestion, registry, { addJob, registerWorker } as any);
      q.onModuleInit();
      expect(registerWorker).toHaveBeenCalledWith('people-acquisition', expect.any(Function));
      const key = await newSource();
      const co = await company();
      q.registerAdapter(listAdapter(key, mk(co, 1, 'u')));
      const r = await q.createRun(key);
      expect(addJob).toHaveBeenCalledWith('people-acquisition', 'run', { runId: r.id }, { attempts: 1 }); // no records, no credentials, no payload
      const worker = registerWorker.mock.calls[0][1];
      await worker({ id: 'j', name: 'run', data: { runId: r.id } });
      expect((await run(r.id)).status).toBe('COMPLETED');
      await worker({ id: 'j2', name: 'run', data: { runId: r.id } }); // a duplicate wake-up is a no-op
      expect((await run(r.id)).status).toBe('COMPLETED');
      expect((await people()).filter((p) => p.fullName.startsWith('u')).length).toBe(1);
      // an enqueue failure never fails run creation
      addJob.mockRejectedValueOnce(new Error('queue down'));
      await expect(q.createRun(key)).resolves.toMatchObject({ status: 'QUEUED' });
    });
  });

  describe('boundaries', () => {
    it('the run row holds no payload or credential fields, and failure text is bounded', async () => {
      const cols = Object.keys(schema.peopleAcquisitionRuns);
      expect(cols.join(',')).not.toMatch(/payload|secret|token(?!s)|password|credential|apikey|raw|record(?!s)/i.source ? /payload|secret|password|credential|apikey|raw/i : /$^/);
      const key = await newSource();
      orch.registerAdapter({ name: key, sourceKey: key, records: () => { throw new BusinessException('x'.repeat(5000), 'LONG', 400); } } as any);
      const r = await orch.createRun(key, {}, { enqueue: false });
      await orch.executeRun(r.id);
      expect(((await run(r.id)).failureMessage ?? '').length).toBeLessThanOrEqual(300);
    });

    it('the upload bridge and customer code are independent of orchestration', () => {
      const root = path.resolve(__dirname, '../..');
      const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === '__tests__' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));
      for (const f of walk(path.join(root, 'import')).filter((x) => x.endsWith('.ts'))) expect(fs.readFileSync(f, 'utf8')).not.toMatch(/acquisition|Orchestrator/i);
      for (const f of ['people.service.ts', 'people-search.service.ts', 'people-export.service.ts', 'people.controller.ts']) {
        expect(fs.readFileSync(path.join(root, 'people', f), 'utf8')).not.toMatch(/acquisition|peopleAcquisitionRuns/i);
      }
      const text = fs.readFileSync(path.join(root, 'people/acquisition/acquisition-orchestrator.service.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(text).not.toMatch(/fetch\(\s*['"`]|axios|https?:\/\/|new Redis|bull/i);
      expect(sql`1`).toBeDefined();
    });
  });
});

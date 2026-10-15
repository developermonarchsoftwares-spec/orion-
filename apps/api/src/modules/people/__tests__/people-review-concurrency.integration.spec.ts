import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { IRawPersonRecord } from '../ingestion/ingestion.types';
import { PeopleIngestionService } from '../ingestion/people-ingestion.service';
import { ObservationService } from '../observations/observation.service';
import { PeoplePublishingService } from '../people-publishing.service';
import { PeopleWriteService } from '../people-write.service';
import { SourceRegistryService } from '../sources/source-registry.service';
import { JOURNALED_MIGRATIONS, readMigration, seedBusiness } from './pglite-test-db';

/**
 * REVIEW-ACTION CONCURRENCY (Phase 15), against a REAL local PostgreSQL.
 *
 * PGlite (the hermetic suite's database) runs one transaction at a time, so it cannot show a race. This spec therefore needs a real
 * server and is skipped unless ORION_TEST_PG_ADMIN_URL is set, to a LOCAL server's URL without a database name
 * (postgres://user:pass@localhost:5432). It creates a throwaway database `orion_p15_<random>`, applies the Orion migrations, and drops it
 * afterwards. It refuses any host but localhost / 127.0.0.1 and any URL that mentions neon.
 *
 * Determinism without sleeps: a side connection HOLDS the person's advisory lock; the first action is started and the test waits
 * (polling pg_locks, not timing) until it is queued on that lock; then the second action is started and waited for the same way; then
 * the lock is released. Both actions therefore run strictly one after the other, first-queued first, and an action that does not take
 * the person lock never queues, which fails the test.
 */
const ADMIN_URL = process.env.ORION_TEST_PG_ADMIN_URL;
const run = ADMIN_URL ? describe : describe.skip;

const ctx = { reviewedBy: 'reviewer@orion.test', note: 'concurrency test' };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Outcome = { ok: true } | { ok: false; code: string };

run('review actions serialize per person (real PostgreSQL)', () => {
  let adminPool: Pool;
  let pool: Pool;
  let dbName = '';
  let db: DrizzleDb;
  let ingest: PeopleIngestionService;
  let publishing: PeoplePublishingService;
  let n = 0;

  const person = async (label: string, opts: { publishRole?: boolean } = { publishRole: true }) => {
    const co = await seedBusiness(db, `cc-${label}-${++n}-${Math.random().toString(36).slice(2, 6)}`);
    const rec = {
      businessId: co.id,
      personName: `Race ${label.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)])} Person`, // names carry no digits
      jobTitle: 'Managing Director',
      email: `race.${label}.${n}.${Math.random().toString(36).slice(2, 6)}@race-test.example`,
      linkedinUrl: `https://www.linkedin.com/in/race-${label}-${n}-${Math.random().toString(36).slice(2, 6)}`,
      source: { type: 'GOVERNMENT_REGISTRY', reference: `ref-${label}-${n}`, recordId: `rel-${label}-${n}`, evidenceType: 'ROLE_CLAIM' },
    } as IRawPersonRecord;
    const r = (await ingest.ingest([rec], { sourceKey: 'cc-feed', batchRef: `cc-${n}` })).results[0];
    if (!r.personId) throw new Error(`ingest did not create the person: ${JSON.stringify(r)}`);
    const personId = r.personId!;
    const roleId = r.companyPersonId!;
    const [contact] = await db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, personId));
    if (opts.publishRole) await publishing.publishRole(roleId, ctx);
    return { personId, roleId, contactId: contact.id };
  };

  const role = async (id: string) => (await db.select().from(schema.companyPeople).where(eq(schema.companyPeople.id, id)))[0];
  const personRow = async (id: string) => (await db.select().from(schema.people).where(eq(schema.people.id, id)))[0];
  const contact = async (id: string) => (await db.select().from(schema.personContacts).where(eq(schema.personContacts.id, id)))[0];
  const items = async (roleId: string) => (await db.select().from(schema.peopleIngestionQuarantine)).filter((q: any) => q.raw?.companyPersonId === roleId);

  const waiting = async () => {
    const r = await pool.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`);
    return r.rows[0].n as number;
  };
  const until = async (what: string, cond: () => Promise<boolean>) => {
    const t0 = Date.now();
    while (!(await cond())) {
      if (Date.now() - t0 > 10_000) throw new Error(`timed out waiting for: ${what}`);
      await wait(15);
    }
  };
  const holdLock = async (personId: string) => {
    const c = await pool.connect();
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`people:person:${personId}`]);
    return { release: async () => { await c.query('COMMIT'); c.release(); } };
  };
  const outcome = (p: Promise<unknown>): Promise<Outcome> => p.then(() => ({ ok: true as const }), (e: any) => ({ ok: false as const, code: e?.errorCode ?? e?.response?.errorCode ?? e?.message ?? 'ERROR' }));

  /** `first` is queued on the person lock before `second` starts; both then run, in that order, once the lock is released. */
  const race = async (personId: string, first: () => Promise<unknown>, second: () => Promise<unknown>) => {
    const lock = await holdLock(personId);
    try {
      const p1 = outcome(first());
      await until('the first action to queue on the person lock (an action that does not take the lock never queues)', async () => (await waiting()) >= 1);
      const p2 = outcome(second());
      await until('the second action to queue on the person lock', async () => (await waiting()) >= 2);
      await lock.release();
      return await Promise.all([p1, p2]);
    } catch (e) {
      await lock.release().catch(() => undefined);
      throw e;
    }
  };

  beforeAll(async () => {
    const url = new URL(`${ADMIN_URL}/postgres`);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || /neon/i.test(ADMIN_URL!)) throw new Error('ORION_TEST_PG_ADMIN_URL must be a local PostgreSQL server');
    dbName = `orion_p15_${Math.random().toString(36).slice(2, 10)}`;
    adminPool = new Pool({ connectionString: `${ADMIN_URL}/postgres`, max: 2 });
    await adminPool.query(`CREATE DATABASE "${dbName}"`);
    pool = new Pool({ connectionString: `${ADMIN_URL}/${dbName}`, max: 14 });
    for (const file of JOURNALED_MIGRATIONS) await pool.query(readMigration(file));
    db = drizzle(pool, { schema }) as unknown as DrizzleDb;
    const registry = new SourceRegistryService(db);
    await registry.register({ key: 'cc-feed', displayName: 'cc-feed', sourceType: 'PARTNER_FEED', termsAcknowledged: true, enabled: true, policy: { permissions: { identity: true, title: true, email: true, phone: true, linkedin: true, evidence: true }, allowedEvidenceTypes: ['ROLE_CLAIM', 'IDENTITY_CLAIM', 'CONTACT_CLAIM'], maxAttestation: 'NONE' } } as any);
    ingest = new PeopleIngestionService(db, new PeopleWriteService(db), registry, new ObservationService(db));
    publishing = new PeoplePublishingService(db);
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => undefined);
    if (adminPool && dbName.startsWith('orion_p15_')) await adminPool.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => undefined);
    await adminPool?.end().catch(() => undefined);
  }, 60_000);

  const suppressedInvariant = async (personId: string, roleIds: string[], contactIds: string[] = []) => {
    expect((await personRow(personId)).dataStatus).toBe('SUPPRESSED');
    for (const id of roleIds) expect(await role(id)).toMatchObject({ isPublished: false });
    for (const id of roleIds) expect((await role(id)).reviewStatus).not.toBe('APPROVED');
    for (const id of contactIds) expect((await contact(id)).isPublished).toBe(false);
  };

  describe('A. suppress vs publish', () => {
    it('publish queued first, then suppress: the publish completes, the suppression wins; nothing stays published', async () => {
      const p = await person('a1');
      const [pub, sup] = await race(p.personId, () => publishing.publishRole(p.roleId, ctx), () => publishing.suppressPerson(p.personId, ctx));
      expect([pub, sup]).toEqual([{ ok: true }, { ok: true }]);
      await suppressedInvariant(p.personId, [p.roleId]);
      expect((await role(p.roleId)).reviewStatus).toBe('REJECTED');
    });

    it('suppress queued first, then publish: the publish is refused and the person stays SUPPRESSED (never restored to PUBLISHED)', async () => {
      const p = await person('a2', { publishRole: false });
      const [sup, pub] = await race(p.personId, () => publishing.suppressPerson(p.personId, ctx), () => publishing.publishRole(p.roleId, ctx));
      expect(sup).toEqual({ ok: true });
      expect(pub).toEqual({ ok: false, code: 'PERSON_SUPPRESSED' });
      await suppressedInvariant(p.personId, [p.roleId]);
      expect((await personRow(p.personId)).dataStatus).not.toBe('PUBLISHED');
    });
  });

  describe('B. reject vs unpublish', () => {
    it('reject first, then unpublish: the unpublish is refused (409) and the role stays REJECTED, never PENDING without a reopen', async () => {
      const p = await person('b1');
      const [rej, unp] = await race(p.personId, () => publishing.rejectRole(p.roleId, ctx), () => publishing.unpublishRole(p.roleId, ctx));
      expect(rej).toEqual({ ok: true });
      expect(unp).toEqual({ ok: false, code: 'REVIEW_STATE_INVALID' });
      expect(await role(p.roleId)).toMatchObject({ reviewStatus: 'REJECTED', isPublished: false });
    });

    it('unpublish first, then reject: both succeed in order and the role ends REJECTED', async () => {
      const p = await person('b2');
      const [unp, rej] = await race(p.personId, () => publishing.unpublishRole(p.roleId, ctx), () => publishing.rejectRole(p.roleId, ctx));
      expect([unp, rej]).toEqual([{ ok: true }, { ok: true }]);
      expect(await role(p.roleId)).toMatchObject({ reviewStatus: 'REJECTED', isPublished: false });
    });
  });

  describe('C. quarantine vs publish', () => {
    it('publish first, then quarantine: the role ends QUARANTINED and unpublished, with exactly one open reviewer-quarantine item', async () => {
      const p = await person('c1', { publishRole: false });
      const [pub, q] = await race(p.personId, () => publishing.publishRole(p.roleId, ctx), () => publishing.quarantineRole(p.roleId, ctx));
      expect([pub, q]).toEqual([{ ok: true }, { ok: true }]);
      expect(await role(p.roleId)).toMatchObject({ reviewStatus: 'QUARANTINED', isPublished: false });
      expect((await items(p.roleId)).filter((i: any) => i.status === 'PENDING')).toHaveLength(1);
    });

    it('quarantine first, then publish: the publish is refused (409) and the role stays QUARANTINED, never published', async () => {
      const p = await person('c2', { publishRole: false });
      const [q, pub] = await race(p.personId, () => publishing.quarantineRole(p.roleId, ctx), () => publishing.publishRole(p.roleId, ctx));
      expect(q).toEqual({ ok: true });
      expect(pub).toEqual({ ok: false, code: 'REVIEW_STATE_INVALID' });
      expect(await role(p.roleId)).toMatchObject({ reviewStatus: 'QUARANTINED', isPublished: false });
      expect((await items(p.roleId)).filter((i: any) => i.status === 'PENDING')).toHaveLength(1);
    });
  });

  describe('D. reopen vs suppress', () => {
    it('reopen first, then suppress: suppression wins; the role ends REJECTED, not PENDING', async () => {
      const p = await person('d1', { publishRole: false });
      await publishing.rejectRole(p.roleId, ctx);
      const [reo, sup] = await race(p.personId, () => publishing.reopenRole(p.roleId, ctx), () => publishing.suppressPerson(p.personId, ctx));
      expect([reo, sup]).toEqual([{ ok: true }, { ok: true }]);
      await suppressedInvariant(p.personId, [p.roleId]);
      expect((await role(p.roleId)).reviewStatus).toBe('REJECTED');
    });

    it('suppress first, then reopen: the reopen is refused (PERSON_SUPPRESSED); suppression stays authoritative', async () => {
      const p = await person('d2', { publishRole: false });
      await publishing.rejectRole(p.roleId, ctx);
      const [sup, reo] = await race(p.personId, () => publishing.suppressPerson(p.personId, ctx), () => publishing.reopenRole(p.roleId, ctx));
      expect(sup).toEqual({ ok: true });
      expect(reo).toEqual({ ok: false, code: 'PERSON_SUPPRESSED' });
      await suppressedInvariant(p.personId, [p.roleId]);
      expect((await role(p.roleId)).reviewStatus).toBe('REJECTED');
    });
  });

  describe('E. contact publish vs suppress', () => {
    it('publish first, then suppress: the contact ends unpublished', async () => {
      const p = await person('e1');
      const [pub, sup] = await race(p.personId, () => publishing.publishContact(p.contactId, ctx), () => publishing.suppressPerson(p.personId, ctx));
      expect([pub, sup]).toEqual([{ ok: true }, { ok: true }]);
      await suppressedInvariant(p.personId, [p.roleId], [p.contactId]);
    });

    it('suppress first, then publish: the publish is refused and no contact of a suppressed person is published', async () => {
      const p = await person('e2');
      const [sup, pub] = await race(p.personId, () => publishing.suppressPerson(p.personId, ctx), () => publishing.publishContact(p.contactId, ctx));
      expect(sup).toEqual({ ok: true });
      expect(pub).toEqual({ ok: false, code: 'PERSON_SUPPRESSED' });
      await suppressedInvariant(p.personId, [p.roleId], [p.contactId]);
    });
  });

  describe('locking does not change anything else', () => {
    it('the lock is released at commit: later actions on the same person run immediately, and other people are never blocked', async () => {
      const a = await person('f1');
      const b = await person('f2');
      const lock = await holdLock(a.personId);
      try {
        // an action on ANOTHER person is not delayed by a lock held on this one
        await publishing.rejectRole(b.roleId, ctx);
        expect((await role(b.roleId)).reviewStatus).toBe('REJECTED');
      } finally {
        await lock.release();
      }
      await publishing.rejectRole(a.roleId, ctx);
      await publishing.reopenRole(a.roleId, ctx);
      expect(await waiting()).toBe(0);
      expect((await role(a.roleId)).reviewStatus).toBe('PENDING');
    });

    it('a refused action does not leak the lock (the transaction rolls back and releases it)', async () => {
      const p = await person('f3', { publishRole: false });
      await expect(publishing.unpublishRole(p.roleId, ctx)).rejects.toMatchObject({ errorCode: 'REVIEW_STATE_INVALID' });
      await expect(publishing.reopenRole(p.roleId, ctx)).rejects.toMatchObject({ errorCode: 'REVIEW_STATE_INVALID' });
      expect(await waiting()).toBe(0);
      const lock = await holdLock(p.personId); // acquirable at once: nobody still holds it
      await lock.release();
    });

    it('twelve concurrent approve / reject / unpublish / reopen calls on one person finish with a state the lifecycle allows', async () => {
      const p = await person('f4', { publishRole: false });
      const calls = [0, 1, 2].flatMap(() => [
        () => publishing.publishRole(p.roleId, ctx),
        () => publishing.rejectRole(p.roleId, ctx),
        () => publishing.unpublishRole(p.roleId, ctx),
        () => publishing.reopenRole(p.roleId, ctx),
      ]);
      const results = await Promise.all(calls.map((c) => outcome(c())));
      for (const r of results) if (!r.ok) expect(['REVIEW_STATE_INVALID']).toContain(r.code);
      const final = await role(p.roleId);
      expect(['PENDING', 'APPROVED', 'REJECTED']).toContain(final.reviewStatus);
      expect(final.isPublished).toBe(final.reviewStatus === 'APPROVED'); // published <=> approved, whatever order won
      const [{ n: audits }] = (await db.select({ n: sql<number>`count(*)::int` }).from(schema.auditLogs).where(and(eq(schema.auditLogs.entityId, p.roleId), sql`${schema.auditLogs.action} LIKE 'PEOPLE_ROLE_%'`)));
      expect(audits).toBe(results.filter((r) => r.ok).length); // every successful action is audited exactly once, atomically with its change
    });
  });
});

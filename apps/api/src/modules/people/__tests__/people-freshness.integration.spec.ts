import { asc, eq } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { IRawPersonRecord } from '../ingestion/ingestion.types';
import { PeopleIngestionService } from '../ingestion/people-ingestion.service';
import { ObservationService } from '../observations/observation.service';
import { PeoplePublishingService } from '../people-publishing.service';
import { PeopleWriteService } from '../people-write.service';
import { SourceRegistryService } from '../sources/source-registry.service';
import { expectLedgerConsistent } from './ledger-invariants';
import { createTestDb, seedBusiness } from './pglite-test-db';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('People freshness (Phase 6.7)', () => {
  let db: DrizzleDb;
  let closeDb: () => Promise<void>;
  let ingest: PeopleIngestionService;
  let publishing: PeoplePublishingService;
  let registry: SourceRegistryService;
  let n = 0;

  const tag = () => `${++n}${Math.random().toString(36).slice(2, 6)}`.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);
  const company = () => seedBusiness(db, `fr-co-${++n}-${Math.random().toString(36).slice(2, 6)}`);
  const rec = (co: { id: string }, name: string, recordId: string, over: Record<string, unknown> = {}, source: Record<string, unknown> = {}): IRawPersonRecord =>
    ({ businessId: co.id, personName: name, jobTitle: 'Director', source: { type: 'MANUAL_IMPORT', reference: 'sheet-1', recordId, ...source }, ...over }) as IRawPersonRecord;
  const run = (records: IRawPersonRecord[], sourceKey = 'people-json', batchRef = `run-${++n}`) => ingest.ingest(records, { sourceKey, batchRef });
  const roles = (personId: string) => db.select().from(schema.companyPeople).where(eq(schema.companyPeople.personId, personId));
  const contacts = (personId: string) => db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, personId));
  const obsOf = (personId: string) => db.select().from(schema.peopleObservations).where(eq(schema.peopleObservations.personId, personId)).orderBy(asc(schema.peopleObservations.createdAt), asc(schema.peopleObservations.id));
  const byType = async (personId: string, type: string) => (await contacts(personId)).find((c) => c.contactType === type)!;

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    closeDb = () => t.client.close();
    registry = new SourceRegistryService(db);
    ingest = new PeopleIngestionService(db, new PeopleWriteService(db), registry, new ObservationService(db));
    publishing = new PeoplePublishingService(db);
  }, 60_000);

  afterAll(async () => {
    await expectLedgerConsistent(db);
    await closeDb?.();
  });

  describe('observation timestamps', () => {
    it('acquired_at is when Orion received the record; observed_at is only what the source says', async () => {
      const co = await company();
      const before = Date.now();
      const said = '2026-03-01T09:30:00.000Z';
      const r = await run([rec(co, 'Obs Erved', `rec-${tag()}`, {}, { observedAt: said })]);
      const [o] = await obsOf(r.results[0].personId!);
      expect(o.observedAt!.toISOString()).toBe(said);
      expect(o.acquiredAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(o.acquiredAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
      expect(o.acquiredAt.toISOString()).not.toBe(said); // the two meanings are not conflated
    });

    it('observed_at is never invented (absent stays NULL) and a future date is refused, never stored', async () => {
      const co = await company();
      const none = await run([rec(co, 'No Date', `rec-${tag()}`)]);
      expect((await obsOf(none.results[0].personId!))[0].observedAt).toBeNull();
      const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
      const f = await run([rec(co, 'Fut Ure', `rec-${tag()}`, {}, { observedAt: future })]);
      // existing safe behaviour (Phase 6.2): the record is refused; the future date is never stored as a fact
      expect(f.results[0].outcome).toBe('QUARANTINED');
      expect(f.results[0].reasons!.map((x: any) => x.code)).toEqual(['INVALID_OBSERVED_AT']);
      const q = (await db.select().from(schema.peopleObservations)).filter((o) => o.outcome === 'QUARANTINED' && o.reasonCodes?.includes('INVALID_OBSERVED_AT'));
      expect(q.length).toBeGreaterThan(0);
      expect(q.every((o) => o.observedAt === null && o.personId === null)).toBe(true);
    });

    it('historical observations are never rewritten by later acquisitions', async () => {
      const co = await company();
      const email = `${tag()}@corp-fr1.co.in`;
      const a = await run([rec(co, 'Hist Oric', 'rec-hist', { email }, { observedAt: '2026-02-01T00:00:00Z' })]);
      const personId = a.results[0].personId!;
      const first = (await obsOf(personId))[0];
      await sleep(20);
      await run([rec(co, 'Hist Oric', 'rec-hist', { email }, { observedAt: '2026-04-01T00:00:00Z' })]);
      const all = await obsOf(personId);
      expect(all).toHaveLength(2);
      expect(all[0]).toEqual(first); // byte-for-byte unchanged (acquired_at, observed_at, fingerprint ...)
      expect(all[1].observedAt!.toISOString()).toBe('2026-04-01T00:00:00.000Z');
      expect(all[1].acquiredAt.getTime()).toBeGreaterThan(first.acquiredAt.getTime());
    });
  });

  describe('last_seen_at is per claim', () => {
    it('re-seeing a role and a contact moves only those claims; a contact absent from the record is not touched', async () => {
      const co = await company();
      const email = `${tag()}@corp-fr2.co.in`;
      const a = await run([rec(co, 'Per Claim', 'rec-pc', { email, phone: '0422 255 0401' })]);
      const personId = a.results[0].personId!;
      const [role0] = await roles(personId);
      const mail0 = await byType(personId, 'WORK_EMAIL');
      const tel0 = await byType(personId, 'PHONE');
      expect(mail0.lastSeenAt).toBeInstanceOf(Date);
      expect(tel0.lastSeenAt).toBeInstanceOf(Date);
      await sleep(25);
      await run([rec(co, 'Per Claim', 'rec-pc', { email })]); // no phone this time
      const [role1] = await roles(personId);
      const mail1 = await byType(personId, 'WORK_EMAIL');
      const tel1 = await byType(personId, 'PHONE');
      expect(role1.lastSeenAt.getTime()).toBeGreaterThan(role0.lastSeenAt.getTime());
      expect(mail1.lastSeenAt!.getTime()).toBeGreaterThan(mail0.lastSeenAt!.getTime());
      expect(tel1.lastSeenAt).toEqual(tel0.lastSeenAt); // not seen -> not updated
      expect(await contacts(personId)).toHaveLength(2); // no duplicate canonical contacts
    });

    it('a changed title is a different role claim: the old role is not marked as seen; a changed email is a new contact claim', async () => {
      const co = await company();
      const e1 = `${tag()}@corp-fr3.co.in`;
      const e2 = `${tag()}@corp-fr3.co.in`;
      const a = await run([rec(co, 'Chg Both', 'rec-cb', { email: e1, jobTitle: 'Sales Manager' })]);
      const personId = a.results[0].personId!;
      const oldRole = (await roles(personId))[0];
      const oldMail = await byType(personId, 'WORK_EMAIL');
      await sleep(25);
      await run([rec(co, 'Chg Both', 'rec-cb', { email: e2, jobTitle: 'Head of Sales' })]);
      const rs = await roles(personId);
      expect(rs).toHaveLength(2);
      expect(rs.find((r) => r.id === oldRole.id)!.lastSeenAt).toEqual(oldRole.lastSeenAt);
      expect(rs.find((r) => r.id === oldRole.id)).toMatchObject({ classificationVersion: oldRole.classificationVersion, normalizedJobTitle: 'sales manager' }); // history not rewritten
      const cs = await contacts(personId);
      expect(cs).toHaveLength(2);
      expect(cs.find((c) => c.id === oldMail.id)!.lastSeenAt).toEqual(oldMail.lastSeenAt);
      expect(cs.find((c) => c.normalizedValue === e2)!.lastSeenAt!.getTime()).toBeGreaterThan(oldMail.lastSeenAt!.getTime());
    });

    it('a second source seeing the same fact refreshes the one canonical contact and adds observations; nothing else changes', async () => {
      const second = `feed-${tag()}`;
      await registry.register({ key: second, displayName: second, sourceType: 'PARTNER_FEED', termsAcknowledged: true, enabled: true, policy: { permissions: { identity: true, title: true, email: true, phone: true, linkedin: true, evidence: true }, allowedEvidenceTypes: ['ROLE_CLAIM', 'IDENTITY_CLAIM', 'CONTACT_CLAIM'], maxAttestation: 'NONE' } } as any);
      const co = await company();
      const email = `${tag()}@corp-fr4.co.in`;
      const a = await run([rec(co, 'Two Src', 'rec-1', { email })]);
      const personId = a.results[0].personId!;
      const mail0 = await byType(personId, 'WORK_EMAIL');
      await sleep(25);
      await run([rec(co, 'Two Src', 'rec-2', { email }, { type: 'PARTNER_FEED' })], second);
      const cs = await contacts(personId);
      expect(cs).toHaveLength(1);
      expect(cs[0].lastSeenAt!.getTime()).toBeGreaterThan(mail0.lastSeenAt!.getTime());
      expect(cs[0].verificationStatus).toBe('UNVERIFIED');
      expect((await obsOf(personId)).map((o) => o.sourceKey).sort()).toEqual(['people-json', second].sort());
    });

    it('simultaneous identical ingestion leaves one contact, one claim and a valid last_seen_at (never moves backwards)', async () => {
      const co = await company();
      const email = `${tag()}@corp-fr5.co.in`;
      const batch = `run-${++n}`;
      const mk = () => run([rec(co, 'Conc Fresh', 'rec-cf', { email, linkedinUrl: 'https://www.linkedin.com/in/conc-fresh-p67' })], 'people-json', batch);
      await Promise.allSettled([mk(), mk(), mk()]);
      const [p] = await db.select().from(schema.people).where(eq(schema.people.normalizedLinkedinUrl, 'linkedin.com/in/conc-fresh-p67'));
      const cs = await contacts(p.id);
      expect(cs).toHaveLength(1);
      const seen = cs[0].lastSeenAt!;
      await sleep(15);
      await mk();
      expect((await contacts(p.id))[0].lastSeenAt!.getTime()).toBeGreaterThanOrEqual(seen.getTime());
      expect((await db.select().from(schema.peopleObservationClaims)).filter((c) => c.contactId === cs[0].id)).toHaveLength(1);
    });
  });

  describe('last_confirmed_at and verified_at', () => {
    it('ordinary ingestion confirms and verifies nothing', async () => {
      const co = await company();
      const a = await run([rec(co, 'Not Conf', `rec-${tag()}`, { email: `${tag()}@corp-fr6.co.in` })]);
      const personId = a.results[0].personId!;
      await run([rec(co, 'Not Conf', `rec-${tag()}`, { email: (await contacts(personId))[0].contactValue })]);
      const [role] = await roles(personId);
      expect(role.lastConfirmedAt).toBeNull();
      expect(role.lastVerifiedAt).toBeNull();
      expect(role.verificationStatus).toBe('UNVERIFIED');
      const [c] = await contacts(personId);
      expect(c).toMatchObject({ lastConfirmedAt: null, lastVerifiedAt: null, verificationStatus: 'UNVERIFIED' });
    });

    it('a reviewer approving a role / publishing a contact is the confirmation event; it is not verification and re-ingestion does not move it', async () => {
      const co = await company();
      const a = await run([rec(co, 'Rev Confirmed', 'rec-rc', { email: `${tag()}@corp-fr7.co.in` })]);
      const personId = a.results[0].personId!;
      const [role] = await roles(personId);
      const c = (await contacts(personId))[0];
      const ctx = { reviewedBy: 'reviewer@orion.test', note: 'ok' };
      await publishing.publishRole(role.id, ctx);
      await publishing.publishContact(c.id, ctx);
      const [r1] = await roles(personId);
      const [c1] = await contacts(personId);
      expect(r1.lastConfirmedAt).toBeInstanceOf(Date);
      expect(c1.lastConfirmedAt).toBeInstanceOf(Date);
      expect(r1.lastVerifiedAt).toBeNull();
      expect(r1.verificationStatus).toBe('UNVERIFIED');
      expect(c1).toMatchObject({ lastVerifiedAt: null, verificationStatus: 'UNVERIFIED' });
      const ledger = await db.select().from(schema.peopleVerifications).where(eq(schema.peopleVerifications.personId, personId));
      expect(ledger).toHaveLength(0); // verified_at stays owned by the ledger; confirming wrote nothing there
      await sleep(20);
      await run([rec(co, 'Rev Confirmed', 'rec-rc', { email: c.contactValue })]);
      expect((await roles(personId))[0].lastConfirmedAt).toEqual(r1.lastConfirmedAt);
      expect((await contacts(personId))[0].lastConfirmedAt).toEqual(c1.lastConfirmedAt);
      expect((await roles(personId))[0].lastSeenAt.getTime()).toBeGreaterThan(r1.lastSeenAt.getTime()); // but it was seen again
    });
  });

  describe('no automatic consequences', () => {
    it('old timestamps never delete, unpublish or downgrade anything', async () => {
      const co = await company();
      const a = await run([rec(co, 'Old Data', 'rec-old', { email: `${tag()}@corp-fr8.co.in` })]);
      const personId = a.results[0].personId!;
      const [role] = await roles(personId);
      const c = (await contacts(personId))[0];
      const ctx = { reviewedBy: 'reviewer@orion.test', note: 'ok' };
      await publishing.publishRole(role.id, ctx);
      await publishing.publishContact(c.id, ctx);
      const old = new Date('2001-01-01T00:00:00Z');
      await db.update(schema.companyPeople).set({ lastSeenAt: old, lastConfirmedAt: old }).where(eq(schema.companyPeople.id, role.id));
      await db.update(schema.personContacts).set({ lastSeenAt: old, lastConfirmedAt: old }).where(eq(schema.personContacts.id, c.id));
      const [r] = await roles(personId);
      const [k] = await contacts(personId);
      expect(r).toMatchObject({ isPublished: true, reviewStatus: 'APPROVED', verificationStatus: 'UNVERIFIED' });
      expect(k).toMatchObject({ isPublished: true, verificationStatus: 'UNVERIFIED' });
      const [p] = await db.select().from(schema.people).where(eq(schema.people.id, personId));
      expect(p.dataStatus).toBe('PUBLISHED');
    });

    it('the freshness code has no TTL, deletion or unpublish logic (stale policy is deferred)', () => {
      const dir = path.resolve(__dirname, '..');
      const text = fs.readFileSync(path.join(dir, 'people-write.service.ts'), 'utf8');
      expect(text).not.toMatch(/STALE_AFTER|ttl|freshnessPolicy/i);
    });
  });

  describe('exposure', () => {
    it('customer-facing code never reads the freshness or observation timestamps', () => {
      const dir = path.resolve(__dirname, '..');
      for (const f of ['people.service.ts', 'people-search.service.ts', 'people-export.service.ts', 'people.controller.ts']) {
        const text = fs.readFileSync(path.join(dir, f), 'utf8');
        expect(text).not.toMatch(/lastConfirmedAt|lastSeenAt|acquiredAt|peopleObservations/);
      }
    });
  });
});

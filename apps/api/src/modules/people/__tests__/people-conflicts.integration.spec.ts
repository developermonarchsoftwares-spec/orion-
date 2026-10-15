import { eq } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { IRawPersonRecord } from '../ingestion/ingestion.types';
import { PeopleIngestionService } from '../ingestion/people-ingestion.service';
import { ObservationService } from '../observations/observation.service';
import { PeoplePublishingService } from '../people-publishing.service';
import { PeopleWriteService } from '../people-write.service';
import { PeopleReviewService } from '../review/people-review.service';
import { SourceRegistryService } from '../sources/source-registry.service';
import { PeopleVerificationService } from '../verification/people-verification.service';
import { expectLedgerConsistent } from './ledger-invariants';
import { createTestDb, seedBusiness } from './pglite-test-db';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('People conflict detection (Phase 6.8)', () => {
  let db: DrizzleDb;
  let closeDb: () => Promise<void>;
  let client: { query: (...a: any[]) => Promise<any> };
  let ingest: PeopleIngestionService;
  let publishing: PeoplePublishingService;
  let review: PeopleReviewService;
  let registry: SourceRegistryService;
  let srcB: string;
  let n = 0;

  const tag = () => `${++n}${Math.random().toString(36).slice(2, 6)}`.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);
  const company = () => seedBusiness(db, `cf-co-${++n}-${Math.random().toString(36).slice(2, 6)}`);
  const li = () => `https://www.linkedin.com/in/${tag()}-cf`;
  const rec = (co: { id: string }, name: string, recordId: string, over: Record<string, unknown> = {}): IRawPersonRecord =>
    ({ businessId: co.id, personName: name, jobTitle: 'Director', source: { type: 'MANUAL_IMPORT', reference: 'sheet-1', recordId }, ...over }) as IRawPersonRecord;
  const fromA = (records: IRawPersonRecord[]) => ingest.ingest(records, { sourceKey: 'people-json', batchRef: `run-${++n}` });
  const fromB = (records: IRawPersonRecord[]) => ingest.ingest(records.map((r) => ({ ...r, source: { ...(r.source as any), type: 'PARTNER_FEED' } })), { sourceKey: srcB, batchRef: `run-${++n}` });
  const conflicts = (type?: string) => db.select().from(schema.peopleConflicts).then((r) => (type ? r.filter((c) => c.conflictType === type) : r));
  const links = (id: string) => db.select().from(schema.peopleConflictLinks).where(eq(schema.peopleConflictLinks.conflictId, id));
  const roles = (personId: string) => db.select().from(schema.companyPeople).where(eq(schema.companyPeople.personId, personId));
  const contacts = (personId: string) => db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, personId));
  const forPerson = async (personId: string, type: string) => (await conflicts(type)).filter((c) => c.personId === personId);

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    client = t.client as any;
    closeDb = () => t.client.close();
    const write = new PeopleWriteService(db);
    registry = new SourceRegistryService(db);
    ingest = new PeopleIngestionService(db, write, registry, new ObservationService(db));
    publishing = new PeoplePublishingService(db);
    review = new PeopleReviewService(db, publishing, new PeopleVerificationService(db, publishing));
    srcB = `feed-${tag()}`;
    await registry.register({ key: srcB, displayName: srcB, sourceType: 'PARTNER_FEED', termsAcknowledged: true, enabled: true, policy: { permissions: { identity: true, title: true, email: true, phone: true, linkedin: true, evidence: true }, allowedEvidenceTypes: ['ROLE_CLAIM', 'IDENTITY_CLAIM', 'CONTACT_CLAIM'], maxAttestation: 'NONE' } } as any);
  }, 60_000);

  afterAll(async () => {
    await expectLedgerConsistent(db);
    await closeDb?.();
  });

  describe('role conflicts', () => {
    it('different titles from two sources: both roles and all observations remain; a conflict is recorded; no winner', async () => {
      const co = await company();
      const email = `arun.${tag()}@corp-cf.co.in`;
      const a = await fromA([rec(co, 'Arun Kumar', 'rec-a', { jobTitle: 'CEO', email })]);
      const personId = a.results[0].personId!;
      expect(await forPerson(personId, 'ROLE_TITLE')).toHaveLength(0); // one source so far
      const b = await fromB([rec(co, 'Arun Kumar', 'rec-b', { jobTitle: 'Managing Director', email })]);
      expect(b.results[0].personId).toBe(personId);

      const rs = await roles(personId);
      expect(rs.map((r) => r.normalizedJobTitle).sort()).toEqual(['ceo', 'managing director']);
      expect(rs.every((r) => r.reviewStatus === 'PENDING' && !r.isPublished && r.verificationStatus === 'UNVERIFIED')).toBe(true); // nobody wins, nothing published/verified
      const [c] = await forPerson(personId, 'ROLE_TITLE');
      expect(c).toMatchObject({ status: 'OPEN', businessId: co.id });
      const ls = await links(c.id);
      expect(ls).toHaveLength(2);
      // traceable: each side -> observation (source) -> role -> evidence
      const obs = await db.select().from(schema.peopleObservations).where(eq(schema.peopleObservations.personId, personId));
      for (const l of ls) {
        const o = obs.find((x) => x.id === l.observationId)!;
        expect(o).toBeDefined();
        expect(l.companyPersonId).toBe(o.companyPersonId);
        expect(l.evidenceId).toBe(o.evidenceId);
        expect(l.evidenceId).toBeTruthy();
      }
      expect(new Set(ls.map((l) => obs.find((x) => x.id === l.observationId)!.sourceKey))).toEqual(new Set(['people-json', srcB]));
      expect(JSON.stringify(c.details)).not.toContain(email); // no contact value in the conflict
    });

    it('the same fact from two sources is not a conflict', async () => {
      const co = await company();
      const email = `same.${tag()}@corp-cf.co.in`;
      const a = await fromA([rec(co, 'Same Fact', 'rec-a', { jobTitle: 'Head of Sales', email })]);
      await fromB([rec(co, 'Same Fact', 'rec-b', { jobTitle: 'Head of Sales', email })]);
      const p = a.results[0].personId!;
      expect((await conflicts()).filter((c) => c.personId === p)).toHaveLength(0);
      expect(await roles(p)).toHaveLength(1);
    });

    it('a source changing its own title is history, and a former role next to a current one is not a conflict', async () => {
      const co = await company();
      const l = li();
      const a1 = await fromA([rec(co, 'Hist Orical', 'rec-h', { jobTitle: 'CEO', linkedinUrl: l })]);
      const p = a1.results[0].personId!;
      await fromA([rec(co, 'Hist Orical', 'rec-h', { jobTitle: 'Managing Director', linkedinUrl: l })]); // same record, new title
      expect(await roles(p)).toHaveLength(2);
      expect(await forPerson(p, 'ROLE_TITLE')).toHaveLength(0);
      const co2 = await company();
      const l2 = li();
      const b1 = await fromA([rec(co2, 'Old New', 'rec-on', { jobTitle: 'Sales Manager', isCurrent: false, linkedinUrl: l2 })]);
      await fromB([rec(co2, 'Old New', 'rec-on2', { jobTitle: 'Head of Sales', isCurrent: true, linkedinUrl: l2 })]);
      expect(await forPerson(b1.results[0].personId!, 'ROLE_TITLE')).toHaveLength(0); // legitimate history
    });

    it('current vs former on the same role from two sources is recorded; one source omitting the flag is not', async () => {
      const co = await company();
      const l = li();
      const a = await fromA([rec(co, 'Cur Rent', 'rec-a', { jobTitle: 'Director', isCurrent: true, linkedinUrl: l })]);
      const p = a.results[0].personId!;
      await fromB([rec(co, 'Cur Rent', 'rec-b', { jobTitle: 'Director', linkedinUrl: l })]); // says nothing about currency
      expect(await forPerson(p, 'ROLE_CURRENCY')).toHaveLength(0);
      await fromB([rec(co, 'Cur Rent', 'rec-b', { jobTitle: 'Director', isCurrent: false, linkedinUrl: l })]);
      const [c] = await forPerson(p, 'ROLE_CURRENCY');
      expect(c.status).toBe('OPEN');
      expect(await links(c.id)).toHaveLength(2);
      expect(await roles(p)).toHaveLength(1); // no role was removed or duplicated; both observations are kept
      expect((await db.select().from(schema.peopleObservations).where(eq(schema.peopleObservations.personId, p))).length).toBeGreaterThanOrEqual(3);
    });

    it('employment-like roles at two companies from two sources are recorded; one source or a director role is not', async () => {
      const c1 = await company();
      const c2 = await company();
      const l = li();
      const a = await fromA([rec(c1, 'Two Places', 'rec-a', { jobTitle: 'Sales Manager', linkedinUrl: l })]);
      const p = a.results[0].personId!;
      expect(await forPerson(p, 'COMPANY_RELATIONSHIP')).toHaveLength(0);
      await fromA([rec(c2, 'Two Places', 'rec-a2', { jobTitle: 'Sales Manager', linkedinUrl: l })]); // same source: not a disagreement
      expect(await forPerson(p, 'COMPANY_RELATIONSHIP')).toHaveLength(0);
      await fromB([rec(c2, 'Two Places', 'rec-b', { jobTitle: 'Sales Manager', linkedinUrl: l })]);
      expect(await forPerson(p, 'COMPANY_RELATIONSHIP')).toHaveLength(1);
      expect(await roles(p)).toHaveLength(2);
    });
  });

  describe('contact and identity conflicts', () => {
    it('the same work e-mail on two people is recorded; the e-mail stays with its first owner and both people remain', async () => {
      const co1 = await company();
      const co2 = await company();
      const email = `shared.${tag()}@corp-cf.co.in`;
      const a = await fromA([rec(co1, 'Alpha Person', 'rec-1', { email })]);
      const b = await fromB([rec(co2, 'Bravo Different', 'rec-2', { email })]);
      const [pa, pb] = [a.results[0].personId!, b.results[0].personId!];
      expect(pa).not.toBe(pb);
      expect(await contacts(pa)).toHaveLength(1);
      expect(await contacts(pb)).toHaveLength(0); // existing behaviour: not attached to the second person
      const cs = await conflicts('CONTACT_MULTIPLE_PEOPLE');
      const mine = cs.filter((c) => c.subjectKey.startsWith('WORK_EMAIL:'));
      expect(mine.length).toBeGreaterThan(0);
      const c = mine.find(async () => true)!;
      const found = [];
      for (const x of mine) if ((await links(x.id)).some((l) => l.personId === pa) && (await links(x.id)).some((l) => l.personId === pb)) found.push(x);
      expect(found).toHaveLength(1);
      expect(c).toBeDefined();
      expect(JSON.stringify(found[0])).not.toContain(email);
    });

    it('a MOBILE number held by people with incompatible names is recorded; a shared landline PHONE is not', async () => {
      const co1 = await company();
      const co2 = await company();
      const mob = `98${String(Math.floor(10000000 + Math.random() * 89999999))}`;
      const a = await fromA([rec(co1, 'Mob Alpha', 'rec-1', { mobile: mob, phone: '0422 255 0777' })]);
      const b = await fromB([rec(co2, 'Zeta Other', 'rec-2', { mobile: mob, phone: '0422 255 0777' })]);
      const [pa, pb] = [a.results[0].personId!, b.results[0].personId!];
      expect(pa).not.toBe(pb);
      const cs = (await conflicts('CONTACT_MULTIPLE_PEOPLE')).filter((c) => c.subjectKey.startsWith('MOBILE:') || c.subjectKey.startsWith('PHONE:'));
      const both = [];
      for (const x of cs) {
        const ls = await links(x.id);
        if (ls.some((l) => l.personId === pa) && ls.some((l) => l.personId === pb)) both.push(x.subjectKey.split(':')[0]);
      }
      expect(both).toEqual(['MOBILE']);
    });

    it('the same LinkedIn under an incompatible name is an identity conflict; a different spelling of the same person is not', async () => {
      const co = await company();
      const l = li();
      const a = await fromA([rec(co, 'Ravi Shankar', 'rec-1', { linkedinUrl: l })]);
      const p = a.results[0].personId!;
      await fromB([rec(co, 'R. Shankar', 'rec-2', { linkedinUrl: l })]); // compatible (initial)
      expect(await forPerson(p, 'IDENTITY_LINKEDIN')).toHaveLength(0);
      await fromB([rec(co, 'Zubin Mehta', 'rec-3', { linkedinUrl: l })]);
      const [c] = await forPerson(p, 'IDENTITY_LINKEDIN');
      expect(c.status).toBe('OPEN');
      const ls = await links(c.id);
      expect(ls.filter((x) => x.observationId).length).toBeGreaterThanOrEqual(1);
      const [person] = await db.select().from(schema.people).where(eq(schema.people.id, p));
      expect(person.fullName).toBe('Ravi Shankar'); // nothing renamed or merged
      expect(JSON.stringify(c)).not.toMatch(/linkedin\.com/);
    });

    it('two sources claiming different work e-mails for one person is recorded; one source changing its mind, or omitting the e-mail, is not', async () => {
      const co = await company();
      const l = li();
      const e1 = `one.${tag()}@corp-cf.co.in`;
      const e2 = `two.${tag()}@corp-cf.co.in`;
      const a = await fromA([rec(co, 'Mail Person', 'rec-a', { email: e1, linkedinUrl: l })]);
      const p = a.results[0].personId!;
      await fromA([rec(co, 'Mail Person', 'rec-a', { email: e2, linkedinUrl: l })]); // same source+record changed: history
      expect(await forPerson(p, 'CONTACT_CONFLICTING_VALUES')).toHaveLength(0);
      await fromB([rec(co, 'Mail Person', 'rec-b', { linkedinUrl: l })]); // omits the e-mail: says nothing
      expect(await forPerson(p, 'CONTACT_CONFLICTING_VALUES')).toHaveLength(0);
      await fromB([rec(co, 'Mail Person', 'rec-b', { email: e1, linkedinUrl: l })]); // B says e1, A currently says e2
      const [c] = await forPerson(p, 'CONTACT_CONFLICTING_VALUES');
      expect(c).toMatchObject({ status: 'OPEN' });
      expect((c.details as any).sources.sort()).toEqual(['people-json', srcB].sort());
      const ls = await links(c.id);
      expect(ls).toHaveLength(2);
      for (const l2 of ls) {
        const [claim] = await db.select().from(schema.peopleObservationClaims).where(eq(schema.peopleObservationClaims.id, l2.observationClaimId!));
        expect(claim.contactId).toBe(l2.contactId);
        expect(claim.observationId).toBe(l2.observationId);
      }
      const cs = await contacts(p);
      expect(cs).toHaveLength(2); // both contacts kept
      expect(cs.every((x) => x.verificationStatus === 'UNVERIFIED' && !x.isPublished)).toBe(true);
    });
  });

  describe('boundaries', () => {
    it('detection is idempotent: repeated ingestion keeps one conflict and one set of links, first-detected never moves', async () => {
      const co = await company();
      const email = `idem.${tag()}@corp-cf.co.in`;
      const a = await fromA([rec(co, 'Idem Potent', 'rec-a', { jobTitle: 'CEO', email })]);
      const p = a.results[0].personId!;
      await fromB([rec(co, 'Idem Potent', 'rec-b', { jobTitle: 'Managing Director', email })]);
      const [c1] = await forPerson(p, 'ROLE_TITLE');
      const l1 = await links(c1.id);
      await sleep(25);
      await fromA([rec(co, 'Idem Potent', 'rec-a', { jobTitle: 'CEO', email })]);
      await fromB([rec(co, 'Idem Potent', 'rec-b', { jobTitle: 'Managing Director', email })]);
      const all = await forPerson(p, 'ROLE_TITLE');
      expect(all).toHaveLength(1);
      expect(all[0].firstDetectedAt).toEqual(c1.firstDetectedAt);
      expect(all[0].lastDetectedAt.getTime()).toBeGreaterThan(c1.lastDetectedAt.getTime());
      expect(all[0].status).toBe('OPEN');
      const l2 = await links(c1.id);
      expect(l2.length).toBe(l1.length); // links are keyed per side (source + claim): re-affirming adds none, the first observation stays as the trace
      expect(new Set(l2.map((x) => x.linkKey)).size).toBe(l2.length);
    });

    it('conflicts change no verification, publication or suppression; the ledger is untouched', async () => {
      const co = await company();
      const email = `ver.${tag()}@corp-cf.co.in`;
      const a = await fromA([rec(co, 'Ver Ified', 'rec-a', { jobTitle: 'CEO', email })]);
      const p = a.results[0].personId!;
      const [role] = await roles(p);
      await publishing.publishRole(role.id, { reviewedBy: 'r@orion.test', note: 'ok' });
      const before = (await roles(p)).find((r) => r.id === role.id)!;
      await fromB([rec(co, 'Ver Ified', 'rec-b', { jobTitle: 'Managing Director', email })]);
      expect(await forPerson(p, 'ROLE_TITLE')).toHaveLength(1);
      const after = (await roles(p)).find((r) => r.id === role.id)!;
      expect(after).toMatchObject({ isPublished: true, reviewStatus: 'APPROVED', verificationStatus: before.verificationStatus, lastVerifiedAt: before.lastVerifiedAt, lastConfirmedAt: before.lastConfirmedAt });
      expect((await db.select().from(schema.people).where(eq(schema.people.id, p)))[0].dataStatus).toBe('PUBLISHED');
      expect(await db.select().from(schema.peopleVerifications).where(eq(schema.peopleVerifications.personId, p))).toHaveLength(0);
    });

    it('a suppressed identity is still refused and creates no conflict', async () => {
      const co = await company();
      const l = li();
      const a = await fromA([rec(co, 'Sup Pressed', 'rec-a', { linkedinUrl: l })]);
      await publishing.suppressPerson(a.results[0].personId!, { reviewedBy: 'r@orion.test', note: 'opt-out request' });
      const before = (await conflicts()).length;
      const r = await fromB([rec(co, 'Totally Other', 'rec-b', { linkedinUrl: l, jobTitle: 'CEO' })]);
      expect(r.results[0].outcome).toBe('QUARANTINED');
      expect((await conflicts()).length).toBe(before);
    });

    it('reviewers see the conflict with its claims; customers never do', async () => {
      const co = await company();
      const email = `rv.${tag()}@corp-cf.co.in`;
      const a = await fromA([rec(co, 'Rev Iewer', 'rec-a', { jobTitle: 'CEO', email })]);
      await fromB([rec(co, 'Rev Iewer', 'rec-b', { jobTitle: 'Managing Director', email })]);
      const [role] = await roles(a.results[0].personId!);
      const detail: any = await review.getRoleDetail(role.id);
      expect(detail.conflicts).toHaveLength(1);
      expect(detail.conflicts[0]).toMatchObject({ type: 'ROLE_TITLE', status: 'OPEN' });
      expect(detail.conflicts[0].claims.map((c: any) => c.sourceKey).sort()).toEqual(['people-json', srcB].sort());
      const dir = path.resolve(__dirname, '..');
      for (const f of ['people.service.ts', 'people-search.service.ts', 'people-export.service.ts', 'people.controller.ts']) {
        expect(fs.readFileSync(path.join(dir, f), 'utf8')).not.toMatch(/peopleConflict|conflict-detector/);
      }
    });

    it('the database refuses unknown types / statuses and edits to links', async () => {
      const co = await company();
      const email = `db.${tag()}@corp-cf.co.in`;
      const a = await fromA([rec(co, 'Db Guard', 'rec-a', { jobTitle: 'CEO', email })]);
      await fromB([rec(co, 'Db Guard', 'rec-b', { jobTitle: 'Managing Director', email })]);
      const [c] = await forPerson(a.results[0].personId!, 'ROLE_TITLE');
      const q = (s: string) => client.query(s);
      await expect(q(`INSERT INTO people_conflicts (conflict_type, subject_key) VALUES ('NEWEST_WINS', 'x')`)).rejects.toThrow();
      await expect(q(`UPDATE people_conflicts SET status = 'WINNER' WHERE id = '${c.id}'`)).rejects.toThrow();
      await expect(q(`UPDATE people_conflict_links SET link_key = 'edited' WHERE conflict_id = '${c.id}'`)).rejects.toThrow(/append-only/);
    });

    it('the detector does no network I/O and never writes verification, publication or suppression state', () => {
      const text = fs.readFileSync(path.resolve(__dirname, '../conflicts/conflict-detector.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(text).not.toMatch(/fetch\(|axios|http:|https:|peopleVerifications|dataStatus|isPublished|reviewStatus:|SUPPRESSED|update\(/);
    });
  });
});

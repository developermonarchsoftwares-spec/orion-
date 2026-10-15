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
import { suppressionDigest } from '../suppression/people-suppression';
import { expectLedgerConsistent } from './ledger-invariants';
import { createTestDb, seedBusiness } from './pglite-test-db';

describe('People contact provenance (Phase 6.6)', () => {
  let db: DrizzleDb;
  let closeDb: () => Promise<void>;
  let client: { query: (...a: any[]) => Promise<any> };
  let ingest: PeopleIngestionService;
  let publishing: PeoplePublishingService;
  let registry: SourceRegistryService;
  let obsSvc: ObservationService;
  let n = 0;

  const tag = () => `${++n}${Math.random().toString(36).slice(2, 6)}`.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);
  const company = () => seedBusiness(db, `prov-co-${++n}-${Math.random().toString(36).slice(2, 6)}`);
  const phone = () => `98${String(Math.floor(10000000 + Math.random() * 89999999))}`;
  const rec = (co: { id: string }, name: string, recordId: string, over: Record<string, unknown> = {}): IRawPersonRecord =>
    ({ businessId: co.id, personName: name, jobTitle: 'Director', source: { type: 'MANUAL_IMPORT', reference: 'sheet-1', recordId }, ...over }) as IRawPersonRecord;
  const run = (records: IRawPersonRecord[], sourceKey = 'people-json', batchRef = `run-${++n}`) => ingest.ingest(records, { sourceKey, batchRef });
  const contacts = (personId: string) => db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, personId));
  const claims = () => db.select().from(schema.peopleObservationClaims).orderBy(asc(schema.peopleObservationClaims.createdAt), asc(schema.peopleObservationClaims.id));
  const claimsFor = async (personId: string) => {
    const ids = new Set((await contacts(personId)).map((c) => c.id));
    return (await claims()).filter((c) => c.contactId && ids.has(c.contactId));
  };
  const registerSource = async (key: string) =>
    registry.register({ key, displayName: key, sourceType: 'PARTNER_FEED', termsAcknowledged: true, enabled: true, policy: { permissions: { identity: true, title: true, email: true, phone: true, linkedin: true, evidence: true }, allowedEvidenceTypes: ['ROLE_CLAIM', 'IDENTITY_CLAIM', 'CONTACT_CLAIM'], maxAttestation: 'NONE' } } as any);

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    client = t.client as any;
    closeDb = () => t.client.close();
    const write = new PeopleWriteService(db);
    registry = new SourceRegistryService(db);
    obsSvc = new ObservationService(db);
    ingest = new PeopleIngestionService(db, write, registry, obsSvc);
    publishing = new PeoplePublishingService(db);
  }, 60_000);

  afterAll(async () => {
    await expectLedgerConsistent(db);
    await closeDb?.();
  });

  describe('what is recorded', () => {
    it('links email, phone, mobile and LinkedIn claims to the observation, the canonical contact and its evidence, as digests only', async () => {
      const co = await company();
      const email = `${tag()}@corp-prov.co.in`;
      const li = `https://www.linkedin.com/in/${tag()}-prov`;
      const r = await run([rec(co, 'Pro Venance', `rec-${tag()}`, { email, phone: '0422 255 0301', mobile: phone(), linkedinUrl: li })]);
      expect(r.results[0].outcome).toBe('CREATED');
      const personId = r.results[0].personId!;
      const cs = await contacts(personId);
      expect(cs.map((c) => c.contactType).sort()).toEqual(['MOBILE', 'PHONE', 'WORK_EMAIL']);
      const [obs] = await db.select().from(schema.peopleObservations).where(eq(schema.peopleObservations.personId, personId));
      const [person] = await db.select().from(schema.people).where(eq(schema.people.id, personId));
      const all = (await claims()).filter((c) => c.observationId === obs.id);
      expect(all.map((c) => c.claimType).sort()).toEqual(['LINKEDIN', 'MOBILE', 'PHONE', 'WORK_EMAIL']);

      for (const c of cs) {
        const claim = all.find((x) => x.contactId === c.id)!;
        expect(claim.claimType).toBe(c.contactType);
        expect(claim.valueDigest).toBe(suppressionDigest(c.normalizedValue)); // Phase 5 / 6.4 digest convention
        const [ev] = await db.select().from(schema.peopleEvidence).where(eq(schema.peopleEvidence.id, claim.evidenceId!));
        expect(ev).toMatchObject({ contactId: c.id, evidenceType: 'CONTACT_CLAIM', sourceType: 'MANUAL_IMPORT' });
      }
      const li2 = all.find((x) => x.claimType === 'LINKEDIN')!;
      expect(li2).toMatchObject({ contactId: null, valueDigest: suppressionDigest(person.normalizedLinkedinUrl!) });
      const [liEv] = await db.select().from(schema.peopleEvidence).where(eq(schema.peopleEvidence.id, li2.evidenceId!));
      expect(liEv).toMatchObject({ evidenceType: 'IDENTITY_CLAIM', personId });

      // traceable to source key / version / observation / evidence through the existing observation
      const prov = await obsSvc.contactProvenance(cs.find((c) => c.contactType === 'WORK_EMAIL')!.id);
      expect(prov).toHaveLength(1);
      expect(prov[0]).toMatchObject({ sourceKey: 'people-json', observationId: obs.id, sourceVersion: obs.sourceVersion, sourceRecordId: obs.sourceRecordId, claimType: 'WORK_EMAIL' });
      expect(prov[0].evidenceId).toBeTruthy();
      expect(await obsSvc.linkedinProvenance(personId)).toHaveLength(1);
    });

    it('privacy: no cleartext contact value or payload is stored in provenance rows', async () => {
      const co = await company();
      const email = `${tag()}@corp-priv.co.in`;
      const tel = phone();
      const li = `https://www.linkedin.com/in/${tag()}-priv`;
      const r = await run([rec(co, 'Priv Acy', `rec-${tag()}`, { email, mobile: tel, linkedinUrl: li })]);
      const mine = await claimsFor(r.results[0].personId!);
      const dump = JSON.stringify([...mine, ...(await claims()).filter((c) => c.claimType === 'LINKEDIN' && c.valueDigest === suppressionDigest(`linkedin.com/in/${li.split('/in/')[1]}`))]);
      expect(dump).not.toContain(email);
      expect(dump).not.toContain(tel);
      expect(dump).not.toMatch(/linkedin\.com|@corp-priv/);
      expect(Object.keys(mine[0]).sort()).toEqual(['claimType', 'contactId', 'createdAt', 'evidenceId', 'id', 'observationId', 'valueDigest']);
    });
  });

  describe('repeated and multi-source acquisition', () => {
    it('same source + same record + same contact + same run: no duplicate contact and no duplicate provenance', async () => {
      const co = await company();
      const email = `${tag()}@corp-same.co.in`;
      const batch = `run-${++n}`;
      const records = () => [rec(co, 'Same Record', 'rec-fixed-1', { email })];
      const a = await run(records(), 'people-json', batch);
      const personId = a.results[0].personId!;
      await run(records(), 'people-json', batch);
      expect(await contacts(personId)).toHaveLength(1);
      expect(await claimsFor(personId)).toHaveLength(1);
    });

    it('repeated acquisition in a later run: one canonical contact; history is added, earlier provenance is never rewritten', async () => {
      const co = await company();
      const email = `${tag()}@corp-again.co.in`;
      const a = await run([rec(co, 'Again Person', 'rec-again-1', { email })]);
      const personId = a.results[0].personId!;
      const before = await claimsFor(personId);
      await run([rec(co, 'Again Person', 'rec-again-1', { email })]);
      await run([rec(co, 'Again Person', 'rec-again-1', { email })]);
      expect(await contacts(personId)).toHaveLength(1); // duplicate contact prevented
      const after = await claimsFor(personId);
      expect(after).toHaveLength(3); // one claim per acquisition (each its own observation)
      expect(after.slice(0, 1)).toEqual(before); // the first claim row is byte-for-byte unchanged
      expect(new Set(after.map((c) => c.contactId)).size).toBe(1);
      expect(new Set(after.map((c) => c.observationId)).size).toBe(3);
    });

    it('different source + same contact: ONE canonical contact, provenance from both sources', async () => {
      const second = `feed-${tag()}`;
      await registerSource(second);
      const co = await company();
      const email = `${tag()}@corp-two.co.in`;
      const a = await run([rec(co, 'Two Sources', 'rec-a', { email })]);
      const personId = a.results[0].personId!;
      const b = await run([rec(co, 'Two Sources', 'rec-b', { email, source: { type: 'PARTNER_FEED', reference: 'https://corp-two.example/team', recordId: 'rec-b' } })], second);
      expect(b.results[0].personId).toBe(personId);
      const cs = await contacts(personId);
      expect(cs).toHaveLength(1);
      const prov = await obsSvc.contactProvenance(cs[0].id);
      expect(prov.map((p) => p.sourceKey).sort()).toEqual(['people-json', second].sort());
      expect(new Set(prov.map((p) => p.evidenceId)).size).toBe(2); // each source has its own evidence row
      expect(cs[0].verificationStatus).toBe('UNVERIFIED');
    });

    it('different source + different contact: both claims are kept, nothing is resolved', async () => {
      const second = `feed-${tag()}`;
      await registerSource(second);
      const co = await company();
      const li = `https://www.linkedin.com/in/${tag()}-conf`;
      const e1 = `${tag()}@corp-conf.co.in`;
      const e2 = `${tag()}@corp-conf.co.in`;
      const a = await run([rec(co, 'Conf Lict', 'rec-1', { email: e1, linkedinUrl: li })]);
      const personId = a.results[0].personId!;
      await run([rec(co, 'Conf Lict', 'rec-2', { email: e2, linkedinUrl: li })], second);
      const cs = await contacts(personId);
      expect(cs.map((c) => c.normalizedValue).sort()).toEqual([e1, e2].sort());
      expect(cs.every((c) => c.verificationStatus === 'UNVERIFIED' && !c.isPublished)).toBe(true); // no winner chosen
      const bySource = new Map<string, string[]>();
      for (const c of cs) for (const p of await obsSvc.contactProvenance(c.id)) bySource.set(p.sourceKey, [...(bySource.get(p.sourceKey) ?? []), c.normalizedValue]);
      expect(bySource.get('people-json')).toEqual([e1]);
      expect(bySource.get(second)).toEqual([e2]);
    });

    it('a changed contact in the same source record keeps the historical provenance and adds the new claim', async () => {
      const co = await company();
      const e1 = `${tag()}@corp-chg.co.in`;
      const e2 = `${tag()}@corp-chg.co.in`;
      const a = await run([rec(co, 'Chg Person', 'rec-chg', { email: e1 })]);
      const personId = a.results[0].personId!;
      await run([rec(co, 'Chg Person', 'rec-chg', { email: e2 })]);
      const cs = await contacts(personId);
      expect(cs).toHaveLength(2); // existing contact semantics: a new value is a new contact; the old one is not deleted
      const old = cs.find((c) => c.normalizedValue === e1)!;
      const fresh = cs.find((c) => c.normalizedValue === e2)!;
      expect(await obsSvc.contactProvenance(old.id)).toHaveLength(1);
      expect(await obsSvc.contactProvenance(fresh.id)).toHaveLength(1);
      const [o1, o2] = (await obsSvc.contactProvenance(old.id)).concat(await obsSvc.contactProvenance(fresh.id));
      expect(o1.observationId).not.toBe(o2.observationId);
    });
  });

  describe('invariants', () => {
    it('provenance is not verification: no ledger rows, contacts stay UNVERIFIED and unpublished', async () => {
      const co = await company();
      const r = await run([rec(co, 'Not Verified', `rec-${tag()}`, { email: `${tag()}@corp-nv.co.in`, phone: '0422 255 0311' })]);
      const personId = r.results[0].personId!;
      expect((await contacts(personId)).every((c) => c.verificationStatus === 'UNVERIFIED' && c.isPublished === false)).toBe(true);
      const ledger = await db.select().from(schema.peopleVerifications).where(eq(schema.peopleVerifications.personId, personId));
      expect(ledger.filter((l) => l.claimType === 'EMAIL' || l.claimType === 'PHONE' || l.claimType === 'LINKEDIN')).toHaveLength(0);
    });

    it('invalid contacts keep the existing behaviour and leave no provenance', async () => {
      const co = await company();
      const r = await run([rec(co, 'Bad Contact', `rec-${tag()}`, { email: 'not-an-email', linkedinUrl: 'https://example.com/nope' })]);
      const personId = r.results[0].personId;
      const codes = (r.results[0].warnings ?? []).map((w: any) => w.code);
      expect(codes).toEqual(expect.arrayContaining(['INVALID_LINKEDIN']));
      if (personId) expect(await claimsFor(personId)).toHaveLength(0);
    });

    it('a suppressed person gets no new contact and no provenance; the refused record leaves only its quarantine observation', async () => {
      const co = await company();
      const li = `https://www.linkedin.com/in/${tag()}-sup`;
      const a = await run([rec(co, 'Sup Pressed', `rec-${tag()}`, { linkedinUrl: li, email: `${tag()}@corp-sup2.co.in` })]);
      const personId = a.results[0].personId!;
      await publishing.suppressPerson(personId, { reviewedBy: 'a@orion.test', note: 'opt-out request' });
      const beforeClaims = (await claims()).length;
      const beforeContacts = (await contacts(personId)).length;
      const r = await run([rec(co, 'Sup Pressed', `rec-${tag()}`, { linkedinUrl: li, email: `${tag()}@corp-sup2.co.in` })]);
      expect(r.results[0].outcome).toBe('QUARANTINED');
      expect((await claims()).length).toBe(beforeClaims);
      expect((await contacts(personId)).length).toBe(beforeContacts);
    });

    it('concurrent identical ingestion cannot create duplicate contacts or duplicate claims', async () => {
      const co = await company();
      const email = `${tag()}@corp-conc.co.in`;
      const batch = `run-${++n}`;
      const mk = () => run([rec(co, 'Conc Urrent', 'rec-conc', { email, linkedinUrl: 'https://www.linkedin.com/in/conc-urrent-prov' })], 'people-json', batch);
      const rs = await Promise.allSettled([mk(), mk(), mk()]);
      expect(rs.some((x) => x.status === 'fulfilled')).toBe(true);
      const [p] = await db.select().from(schema.people).where(eq(schema.people.normalizedLinkedinUrl, 'linkedin.com/in/conc-urrent-prov'));
      expect(await contacts(p.id)).toHaveLength(1);
      expect(await claimsFor(p.id)).toHaveLength(1);
    });

    it('the database itself refuses duplicate / malformed / edited claims', async () => {
      const co = await company();
      const r = await run([rec(co, 'Db Guard', `rec-${tag()}`, { email: `${tag()}@corp-db.co.in` })]);
      const [c] = await claimsFor(r.results[0].personId!);
      const q = (s: string) => client.query(s);
      await expect(q(`INSERT INTO people_observation_claims (observation_id, claim_type, contact_id, value_digest) VALUES ('${c.observationId}', '${c.claimType}', '${c.contactId}', '${c.valueDigest}')`)).rejects.toThrow();
      await expect(q(`INSERT INTO people_observation_claims (observation_id, claim_type, value_digest) VALUES ('${c.observationId}', 'WORK_EMAIL', 'plain@cleartext.example')`)).rejects.toThrow();
      await expect(q(`INSERT INTO people_observation_claims (observation_id, claim_type, value_digest) VALUES ('${c.observationId}', 'PERSONAL_EMAIL', '${c.valueDigest}')`)).rejects.toThrow();
      await expect(q(`UPDATE people_observation_claims SET value_digest = '${suppressionDigest('x')}' WHERE id = '${c.id}'`)).rejects.toThrow(/append-only/);
    });
  });

  describe('exposure', () => {
    it('customer-facing code never reads provenance, source keys or observation ids', () => {
      const dir = path.resolve(__dirname, '..');
      for (const f of ['people.service.ts', 'people-search.service.ts', 'people-export.service.ts', 'people.controller.ts']) {
        const text = fs.readFileSync(path.join(dir, f), 'utf8');
        expect(text).not.toMatch(/peopleObservationClaims|peopleObservations|contactProvenance|linkedinProvenance|valueDigest|sourceKey|sourceVersion/);
      }
    });
  });
});

import { eq, sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { uploadRecordId } from '../../import/people/import-people.bridge';
import { IRawPersonRecord } from '../ingestion/ingestion.types';
import { PeopleIngestionService } from '../ingestion/people-ingestion.service';
import { ObservationService } from '../observations/observation.service';
import { OBSERVATION_LIMITS, canonicalize, measureRecord, readObservationFields } from '../observations/observation-policy';
import { PeopleWriteService } from '../people-write.service';
import { SourceRegistryService } from '../sources/source-registry.service';
import { INewSource, IPeopleSourceAdapter } from '../sources/source.types';
import { expectLedgerConsistent } from './ledger-invariants';
import { createTestDb, seedBusiness } from './pglite-test-db';

const SRC_DIR = path.resolve(__dirname, '../../..');
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

describe('People observation log + source-record idempotency (Phase 6.2)', () => {
  let db: DrizzleDb;
  let closeDb: () => Promise<void>;
  let client: { query: (...a: any[]) => Promise<any>; exec: (s: string) => Promise<any> };
  let registry: SourceRegistryService;
  let observations: ObservationService;
  let ingest: PeopleIngestionService;
  let write: PeopleWriteService;
  let n = 0;

  const newCompany = () => seedBusiness(db, `obs-co-${++n}-${Math.random().toString(36).slice(2, 6)}`);
  const registerSource = async (key: string, over: Partial<INewSource> = {}) =>
    registry.register({
      key,
      displayName: `Test feed ${key}`,
      sourceType: 'PARTNER_FEED',
      termsAcknowledged: true,
      termsReference: 'test',
      enabled: true,
      policy: { permissions: { identity: true, title: true, email: true, phone: true, linkedin: true, evidence: true }, allowedEvidenceTypes: ['ROLE_CLAIM', 'REGISTRY_FILING'], maxAttestation: 'NONE' },
      ...over,
    });
  const rec = (co: { id: string }, name: string, over: Record<string, unknown> = {}, source: Record<string, unknown> = {}): IRawPersonRecord =>
    ({ businessId: co.id, personName: name, jobTitle: 'CEO', source: { type: 'PARTNER_FEED', reference: 'feed-ref-1', recordId: `rec-${name}`, ...source }, ...over }) as IRawPersonRecord;
  const run = (key: string, records: IRawPersonRecord[], opts: Record<string, unknown> = {}) => ingest.ingest(records, { sourceKey: key, batchRef: `run-${++n}`, ...opts });
  const obsRows = (recordId?: string) => db.select().from(schema.peopleObservations).then((r) => (recordId ? r.filter((x) => x.sourceRecordId === recordId) : r));
  const counts = async () => ({
    people: (await db.select().from(schema.people)).length,
    roles: (await db.select().from(schema.companyPeople)).length,
    contacts: (await db.select().from(schema.personContacts)).length,
    evidence: (await db.select().from(schema.peopleEvidence)).length,
    quarantine: (await db.select().from(schema.peopleIngestionQuarantine)).length,
  });

  class Adapter implements IPeopleSourceAdapter {
    readonly name = 'obs adapter';
    constructor(
      readonly sourceKey: string,
      private readonly data: IRawPersonRecord[],
    ) {}
    records() {
      return this.data;
    }
  }

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    client = t.client as any;
    closeDb = () => t.client.close();
    registry = new SourceRegistryService(db);
    observations = new ObservationService(db);
    write = new PeopleWriteService(db);
    ingest = new PeopleIngestionService(db, write, registry, observations);
    await registerSource('feed-a');
    await registerSource('feed-b');
  }, 60_000);

  afterAll(async () => {
    await expectLedgerConsistent(db);
    await closeDb?.();
  });

  // ================================================================ creation + timestamps
  describe('an observation per source record handed over', () => {
    it('1. creates an observation for a keyed record, linked to the person, role and evidence it produced', async () => {
      const co = await newCompany();
      const report = await run('feed-a', [rec(co, 'Obs Olivia', { email: 'olivia@corp-obs.co.in', phone: '0422 255 0111', linkedinUrl: 'https://www.linkedin.com/in/obs-olivia-1' })], { batchRef: 'run-creation' });
      expect(report).toMatchObject({ created: 1, source: { key: 'feed-a', version: '1' }, observations: { recorded: 1, duplicate: 0, notRecorded: 0 } });
      expect(report.results[0].observation).toEqual({ status: 'RECORDED' });

      const [o] = await obsRows('rec-Obs Olivia');
      const role = (await db.select().from(schema.companyPeople).where(eq(schema.companyPeople.id, report.results[0].companyPersonId!)))[0];
      expect(o).toMatchObject({
        sourceKey: 'feed-a', sourceVersion: '1', sourceRecordId: 'rec-Obs Olivia', batchRef: 'run-creation', outcome: 'INGESTED',
        personId: report.results[0].personId, companyPersonId: role.id, businessId: co.id,
        observedName: 'Obs Olivia', observedTitle: 'CEO', observedIsCurrent: null, payloadRef: null,
      });
      expect(o.contentFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(o.payloadBytes).toBeGreaterThan(0);
      expect(o.reasonCodes).toBeNull();
    });

    it('6/7/8. acquired_at, observed_at and the run id are three different things, each kept as given', async () => {
      const co = await newCompany();
      const acquiredAt = daysAgo(2);
      const observedAt = daysAgo(30);
      await run('feed-a', [rec(co, 'Time Tanvi', {}, { observedAt: observedAt.toISOString() })], { acquiredAt, batchRef: 'run-times' });
      const [o] = await obsRows('rec-Time Tanvi');
      expect(o.acquiredAt.getTime()).toBe(acquiredAt.getTime());
      expect(o.observedAt!.getTime()).toBe(observedAt.getTime());
      expect(o.batchRef).toBe('run-times');
      expect(Math.abs(o.createdAt.getTime() - Date.now())).toBeLessThan(60_000); // Orion's own write time, separate again

      // the source did not say when: observed_at stays NULL (never defaulted to "now" or to the acquisition time)
      const before = Date.now();
      await run('feed-a', [rec(co, 'Quiet Qadir')], { batchRef: 'run-default' });
      const [q] = await obsRows('rec-Quiet Qadir');
      expect(q.observedAt).toBeNull();
      expect(q.acquiredAt.getTime()).toBeGreaterThanOrEqual(before - 1000); // defaults to the start of the run

      // an observation "from the future" is not believed
      await run('feed-a', [rec(co, 'Future Fatima', {}, { observedAt: new Date(Date.now() + 10 * 86_400_000).toISOString() })]);
      expect((await obsRows('rec-Future Fatima'))[0].observedAt).toBeNull();
    });

    it('the People evidence keeps its own meaning: its observed_at is the source-reported time, not the acquisition time', async () => {
      const co = await newCompany();
      const observedAt = daysAgo(40);
      const r = await run('feed-a', [rec(co, 'Evid Esha', {}, { observedAt: observedAt.toISOString() })], { acquiredAt: daysAgo(1) });
      const [ev] = await db.select().from(schema.peopleEvidence).where(eq(schema.peopleEvidence.companyPersonId, r.results[0].companyPersonId!));
      expect(ev.observedAt.getTime()).toBe(observedAt.getTime());
    });

    it('5. the source version is the registry version at the time, and history is never rewritten when it changes', async () => {
      await registerSource('versioned-feed', { version: '2' });
      const co = await newCompany();
      await run('versioned-feed', [rec(co, 'Ver Veda')], { batchRef: 'v2-run' });
      await db.execute(sql`UPDATE people_sources SET version = '3' WHERE key = 'versioned-feed'`);
      await run('versioned-feed', [rec(co, 'Ver Veda')], { batchRef: 'v3-run' });
      const rows = await obsRows('rec-Ver Veda');
      expect(rows.sort((a, b) => a.batchRef.localeCompare(b.batchRef)).map((r) => [r.batchRef, r.sourceVersion])).toEqual([['v2-run', '2'], ['v3-run', '3']]);
    });
  });

  // ================================================================ idempotency
  describe('source-record idempotency', () => {
    it('2. Case A: same source record, same content, same acquisition run => recognised; nothing written anywhere', async () => {
      const co = await newCompany();
      const records = [rec(co, 'Dup Dhanush', { email: 'dhanush@corp-obs.co.in' })];
      const first = await run('feed-a', records, { batchRef: 'run-dup' });
      const before = { c: await counts(), o: (await obsRows()).length };
      const second = await run('feed-a', records, { batchRef: 'run-dup' });
      expect(first.results[0].observation).toEqual({ status: 'RECORDED' });
      expect(second.results[0]).toMatchObject({ outcome: 'UNCHANGED', observation: { status: 'DUPLICATE' } });
      expect(second.results[0].warnings![0].code).toBe('OBSERVATION_DUPLICATE');
      expect(second.observations).toEqual({ recorded: 0, duplicate: 1, notRecorded: 0 });
      expect({ c: await counts(), o: (await obsRows()).length }).toEqual(before);
    });

    it('3. Case B: same record, same content, NEW acquisition => a new observation is kept, but no new person, role, contact or evidence', async () => {
      const co = await newCompany();
      const records = [rec(co, 'Again Anika', { email: 'anika@corp-obs.co.in', phone: '0422 255 0122' })];
      await run('feed-a', records, { batchRef: 'day-1', acquiredAt: daysAgo(40) });
      const before = await counts();
      const second = await run('feed-a', records, { batchRef: 'day-20', acquiredAt: daysAgo(20) });
      const third = await run('feed-a', records, { batchRef: 'day-40', acquiredAt: daysAgo(0) });
      expect(second.results[0]).toMatchObject({ outcome: 'UNCHANGED', observation: { status: 'RECORDED' } });
      expect(third.results[0]).toMatchObject({ outcome: 'UNCHANGED', observation: { status: 'RECORDED' } });
      expect(await counts()).toEqual(before); // 13/14/15: no duplicate people, roles, contacts; 10: no duplicate evidence
      const rows = (await obsRows('rec-Again Anika')).sort((a, b) => a.acquiredAt.getTime() - b.acquiredAt.getTime());
      expect(rows.map((r) => r.batchRef)).toEqual(['day-1', 'day-20', 'day-40']);
      expect(new Set(rows.map((r) => r.contentFingerprint)).size).toBe(1); // same content
      expect(new Set(rows.map((r) => r.evidenceId)).size).toBe(1); // all point at the ONE evidence row
      expect(rows[0].evidenceId).not.toBeNull();
    });

    it('4. Case C: the same record with a changed title => a new observation; History keeps every title; the People rules decide the rest', async () => {
      const co = await newCompany();
      const same = { personName: 'Change Charu', linkedinUrl: 'https://www.linkedin.com/in/change-charu-1' };
      await run('feed-a', [rec(co, 'Change Charu', same, { recordId: 'charu-1' })], { batchRef: 'd1', acquiredAt: daysAgo(40) });
      await run('feed-a', [rec(co, 'Change Charu', same, { recordId: 'charu-1' })], { batchRef: 'd20', acquiredAt: daysAgo(20) });
      const changed = await run('feed-a', [rec(co, 'Change Charu', { ...same, jobTitle: 'Managing Director' }, { recordId: 'charu-1' })], { batchRef: 'd40', acquiredAt: daysAgo(0) });
      expect(changed.results[0].observation).toEqual({ status: 'RECORDED' });

      const history = await observations.history('feed-a', 'charu-1');
      expect(history.map((h) => [h.batchRef, h.observedTitle])).toEqual([['d1', 'CEO'], ['d20', 'CEO'], ['d40', 'Managing Director']]);
      expect(new Set(history.map((h) => h.contentFingerprint)).size).toBe(2);
      // the existing identity / role rules handled the change (a second role awaiting its own review); nothing was chosen or overwritten
      const roles = await db.select().from(schema.companyPeople).where(eq(schema.companyPeople.personId, changed.results[0].personId!));
      expect(roles.map((r) => r.normalizedJobTitle).sort()).toEqual(['ceo', 'managing director']);
      expect(roles.every((r) => r.reviewStatus === 'PENDING' && !r.isPublished && r.verificationStatus === 'UNVERIFIED')).toBe(true);
      // history rows of the earlier acquisitions were not touched
      expect(history[0].observedTitle).toBe('CEO');
    });

    it('9/10. observations link to the existing evidence; evidence stays deduplicated however often it is observed', async () => {
      const co = await newCompany();
      const r = await run('feed-a', [rec(co, 'Link Lavanya')], { batchRef: 'l1' });
      await run('feed-a', [rec(co, 'Link Lavanya')], { batchRef: 'l2' });
      await run('feed-a', [rec(co, 'Link Lavanya')], { batchRef: 'l3' });
      const evidence = await db.select().from(schema.peopleEvidence).where(eq(schema.peopleEvidence.companyPersonId, r.results[0].companyPersonId!));
      expect(evidence).toHaveLength(1);
      const rows = await obsRows('rec-Link Lavanya');
      expect(rows).toHaveLength(3);
      expect(rows.every((o) => o.evidenceId === evidence[0].id)).toBe(true);
      expect(evidence[0]).toMatchObject({ sourceType: 'PARTNER_FEED', sourceReference: 'feed-ref-1' });
    });

    it('18. source-record isolation: the same record id under another source, or another record, is independent', async () => {
      const co = await newCompany();
      await run('feed-a', [rec(co, 'Iso Indira', {}, { recordId: 'shared-id' })], { batchRef: 'iso-1' });
      const b = await run('feed-b', [rec(co, 'Iso Indira', {}, { recordId: 'shared-id' })], { batchRef: 'iso-1' }); // same id, same run name, different source
      expect(b.results[0].observation).toEqual({ status: 'RECORDED' });
      const c = await run('feed-a', [rec(co, 'Iso Indira', {}, { recordId: 'other-id' })], { batchRef: 'iso-1' }); // same person, different record
      expect(c.results[0].observation).toEqual({ status: 'RECORDED' });
      const rows = await obsRows();
      expect(rows.filter((r) => r.sourceRecordId === 'shared-id').map((r) => r.sourceKey).sort()).toEqual(['feed-a', 'feed-b']);
      expect(rows.filter((r) => r.sourceKey === 'feed-a' && ['shared-id', 'other-id'].includes(r.sourceRecordId))).toHaveLength(2);
      // one duplicate in a batch does not affect the others
      const mixed = await run('feed-a', [rec(co, 'Iso Indira', {}, { recordId: 'shared-id' }), rec(co, 'Fresh Farida', {}, { recordId: 'fresh-id' })], { batchRef: 'iso-1' });
      expect(mixed.results.map((r) => r.observation!.status)).toEqual(['DUPLICATE', 'RECORDED']);
    });
  });

  // ================================================================ two sources
  describe('several sources', () => {
    it('11. two sources observing the SAME fact keep separate provenance while evidence is deduplicated', async () => {
      const co = await newCompany();
      const person = { personName: 'Same Saanvi', linkedinUrl: 'https://www.linkedin.com/in/same-saanvi-1' };
      const a = await run('feed-a', [rec(co, 'Same Saanvi', person, { recordId: 'a-1', reference: 'shared-locator' })]);
      const b = await run('feed-b', [rec(co, 'Same Saanvi', person, { recordId: 'b-9', reference: 'shared-locator' })]);
      expect(b.results[0].outcome).toBe('UNCHANGED'); // nothing new about the person
      const rows = [...(await obsRows('a-1')), ...(await obsRows('b-9'))];
      expect(rows.map((r) => r.sourceKey).sort()).toEqual(['feed-a', 'feed-b']);
      expect(new Set(rows.map((r) => r.personId)).size).toBe(1);
      expect(new Set(rows.map((r) => r.evidenceId)).size).toBe(1); // the same evidence (same type + locator), two provenances
      expect((await db.select().from(schema.peopleEvidence).where(eq(schema.peopleEvidence.companyPersonId, a.results[0].companyPersonId!))).length).toBe(1);

      // a different locator is a different piece of evidence
      await run('feed-b', [rec(co, 'Same Saanvi', person, { recordId: 'b-10', reference: 'another-locator' })]);
      expect((await db.select().from(schema.peopleEvidence).where(eq(schema.peopleEvidence.companyPersonId, a.results[0].companyPersonId!))).length).toBe(2);
    });

    it('12. Case E: two sources, different titles => both observations retained, no winner chosen', async () => {
      const co = await newCompany();
      const person = { personName: 'Differ Divya', linkedinUrl: 'https://www.linkedin.com/in/differ-divya-1' };
      const a = await run('feed-a', [rec(co, 'Differ Divya', { ...person, jobTitle: 'CEO' }, { recordId: 'div-a' })]);
      const b = await run('feed-b', [rec(co, 'Differ Divya', { ...person, jobTitle: 'Managing Director' }, { recordId: 'div-b' })]);
      expect(a.results[0].personId).toBe(b.results[0].personId);
      const rows = await db.select().from(schema.peopleObservations).where(eq(schema.peopleObservations.personId, a.results[0].personId!));
      expect(rows.map((r) => [r.sourceKey, r.observedTitle]).sort()).toEqual([['feed-a', 'CEO'], ['feed-b', 'Managing Director']]);
      const roles = await db.select().from(schema.companyPeople).where(eq(schema.companyPeople.personId, a.results[0].personId!));
      expect(roles).toHaveLength(2);
      expect(roles.every((r) => r.reviewStatus === 'PENDING' && !r.isPublished && r.verificationStatus === 'UNVERIFIED')).toBe(true); // nothing decided, nothing published or verified
    });

    it('13. a repeated acquisition through a second source still creates no duplicate people', async () => {
      const co = await newCompany();
      const person = { personName: 'Nodup Nisha', linkedinUrl: 'https://www.linkedin.com/in/nodup-nisha-1', email: 'nisha@corp-obs.co.in' };
      await run('feed-a', [rec(co, 'Nodup Nisha', person, { recordId: 'n-a' })]);
      const before = await counts();
      await run('feed-b', [rec(co, 'Nodup Nisha', person, { recordId: 'n-b' })]);
      const after = await counts();
      expect({ ...after, evidence: 0 }).toEqual({ ...before, evidence: 0 });
    });
  });

  // ================================================================ traceability / failure safety
  describe('failure-safe and traceable', () => {
    it('a record the People layer refuses is quarantined AND stays traceable as a QUARANTINED observation (codes only)', async () => {
      const co = await newCompany();
      const r = await run('feed-a', [rec(co, 'Sole', {}, { recordId: 'bad-1' })], { batchRef: 'q-run' }); // incomplete name
      expect(r.results[0]).toMatchObject({ outcome: 'QUARANTINED', observation: { status: 'RECORDED' } });
      const [o] = await obsRows('bad-1');
      expect(o).toMatchObject({ outcome: 'QUARANTINED', personId: null, companyPersonId: null, evidenceId: null });
      expect(o.reasonCodes).toEqual(['NAME_INCOMPLETE']);
      // repeating the identical refusal in the same run adds nothing
      await run('feed-a', [rec(co, 'Sole', {}, { recordId: 'bad-1' })], { batchRef: 'q-run' });
      expect(await obsRows('bad-1')).toHaveLength(1);
      // the record, fixed, later ingests in the same run: both facts are kept (was refused, then accepted)
      await run('feed-a', [rec(co, 'Solo Sunita', {}, { recordId: 'bad-1' })], { batchRef: 'q-run' });
      expect((await obsRows('bad-1')).map((x) => x.outcome).sort()).toEqual(['INGESTED', 'QUARANTINED']);
    });

    it('a failure during the person write rolls back the WHOLE write (no partial person) and is traceable', async () => {
      const co = await newCompany();
      // a missing company is found before the write: quarantined, traceable, nothing created
      const before = await counts();
      const r = await run('feed-a', [{ ...rec(co, 'Ghost Geeta', {}, { recordId: 'ghost-1' }), businessId: undefined, businessSlug: 'no-such-company' } as IRawPersonRecord]);
      expect(r.results[0]).toMatchObject({ outcome: 'QUARANTINED' });
      const [o] = await obsRows('ghost-1');
      expect(o.reasonCodes).toEqual(['BUSINESS_NOT_FOUND']);
      expect((await counts()).people).toBe(before.people);

      // a failure INSIDE the transaction (the observation cannot be stored) undoes the person, role and evidence as well
      const c2 = await newCompany();
      const b2 = await counts();
      await expect(
        write.upsertPersonForBusiness({
          businessId: c2.id,
          person: { fullName: 'Atomic Anu' },
          role: { jobTitle: 'CEO' },
          evidence: [{ sourceType: 'PARTNER_FEED', evidenceType: 'ROLE_CLAIM', sourceReference: 'atomic' }],
          observation: { sourceKey: 'not-a-registered-source', sourceVersion: '1', sourceRecordId: 'x', batchRef: 'b', acquiredAt: new Date(), observedAt: null, contentFingerprint: 'f'.repeat(64), payloadBytes: 1 },
        }),
      ).rejects.toThrow();
      const a2 = await counts();
      expect({ ...a2, quarantine: 0 }).toEqual({ ...b2, quarantine: 0 });
    });

    it('an ambiguous identity is quarantined with its observation; nothing half-written', async () => {
      const co = await newCompany();
      await run('feed-a', [rec(co, 'Amb Anand', { jobTitle: 'CTO', linkedinUrl: 'https://www.linkedin.com/in/amb-anand-cto' }, { recordId: 'amb-1' })]);
      await run('feed-a', [rec(co, 'Amb Anand', { jobTitle: 'CFO', linkedinUrl: 'https://www.linkedin.com/in/amb-anand-cfo' }, { recordId: 'amb-2' })]);
      const before = await counts();
      const r = await run('feed-a', [rec(co, 'Amb Anand', { jobTitle: 'Director' }, { recordId: 'amb-3' })]);
      expect(r.results[0].outcome).toBe('QUARANTINED');
      expect((await obsRows('amb-3'))[0]).toMatchObject({ outcome: 'QUARANTINED', reasonCodes: ['AMBIGUOUS_IDENTITY'] });
      expect({ ...(await counts()), quarantine: 0 }).toEqual({ ...before, quarantine: 0 });
    });
  });

  // ================================================================ legacy
  describe('legacy / unkeyed ingestion is marked, never given invented ids', () => {
    it('an unkeyed call writes no observation and says so; a keyed record without an id is ingested but not observed', async () => {
      const co = await newCompany();
      const unkeyed = await ingest.ingest([rec(co, 'Legacy Lata', {}, { recordId: 'ignored-id' })], { batchRef: 'legacy-run' });
      expect(unkeyed.source).toBeUndefined();
      expect(unkeyed.results[0]).toMatchObject({ outcome: 'CREATED', observation: { status: 'NOT_RECORDED', reason: 'UNKEYED_SOURCE' } });
      expect(await obsRows('ignored-id')).toHaveLength(0);

      const noId = rec(co, 'Anon Arjun');
      delete (noId.source as any).recordId;
      const keyed = await run('feed-a', [noId]);
      expect(keyed.results[0]).toMatchObject({ outcome: 'CREATED', observation: { status: 'NOT_RECORDED', reason: 'NO_SOURCE_RECORD_ID' } });
      expect(keyed.observations).toEqual({ recorded: 0, duplicate: 0, notRecorded: 1 });
      expect((await obsRows()).filter((r) => r.observedName === 'Anon Arjun')).toHaveLength(0);
    });

    it('dry runs record nothing', async () => {
      const co = await newCompany();
      const before = (await obsRows()).length;
      const r = await run('feed-a', [rec(co, 'Dry Dev')], { dryRun: true });
      expect(r.results[0]).toMatchObject({ outcome: 'VALID', observation: { status: 'NOT_RECORDED', reason: 'DRY_RUN' } });
      expect((await obsRows()).length).toBe(before);
    });

    it('the built-in CSV source can carry a record id column', async () => {
      const { CsvPeopleSource } = await import('../ingestion/sources/people-sources');
      const co = await newCompany();
      const csv = `business_id,person_name,job_title,source_type,source_reference,source_record_id\n${co.id},Csv Charan,Director,MANUAL_IMPORT,sheet-9,row-77\n`;
      const report = await ingest.ingestFromSource(new CsvPeopleSource('csv', csv), { batchRef: 'csv-run' });
      expect(report.results[0].observation).toEqual({ status: 'RECORDED' });
      expect((await obsRows('row-77'))[0]).toMatchObject({ sourceKey: 'people-csv', sourceVersion: '1', batchRef: 'csv-run' });
    });

    it('the upload bridge record id is derived only from stable parts and is bounded', () => {
      expect(uploadRecordId('batch-1', 'file.csv#row:3')).toBe('batch-1|file.csv#row:3');
      expect(uploadRecordId('batch-1', 'file.csv#row:3')).toBe(uploadRecordId('batch-1', 'file.csv#row:3'));
      const long = uploadRecordId('b'.repeat(36), 'x'.repeat(400));
      expect(long.length).toBeLessThanOrEqual(OBSERVATION_LIMITS.MAX_SOURCE_RECORD_ID);
      expect(long).not.toBe(uploadRecordId('b'.repeat(36), 'y'.repeat(400)));
    });
  });

  // ================================================================ payload safety + privacy
  describe('payload safety and privacy', () => {
    it('16. an oversized record is refused, stored only as a stub, and leaves no person or observation; a run over the record limit is refused whole', async () => {
      const co = await newCompany();
      const before = await counts();
      const huge = rec(co, 'Huge Hari', { description: 'x'.repeat(OBSERVATION_LIMITS.MAX_RECORD_BYTES + 100) });
      const r = await run('feed-a', [huge, rec(co, 'Next Nalini')]);
      expect(r.results[0]).toMatchObject({ outcome: 'QUARANTINED', observation: { status: 'NOT_RECORDED', reason: 'MALFORMED_OR_OVERSIZED' } });
      expect(r.results[0].reasons![0].code).toBe('RECORD_TOO_LARGE');
      expect(r.results[1].outcome).toBe('CREATED'); // the run continues
      const q = (await db.select().from(schema.peopleIngestionQuarantine)).filter((x) => (x.raw as any)?._stub);
      expect(q.length).toBeGreaterThan(0);
      expect(JSON.stringify(q[q.length - 1].raw).length).toBeLessThan(500); // a stub, not the payload
      expect((await counts()).people).toBe(before.people + 1);

      await expect(run('feed-a', Array.from({ length: OBSERVATION_LIMITS.MAX_RECORDS_PER_RUN + 1 }, (_v, i) => rec(co, `Bulk ${i}`)))).rejects.toMatchObject({ errorCode: 'BATCH_TOO_LARGE' });
      expect((await counts()).people).toBe(before.people + 1); // nothing from the refused run
    });

    it('16b. the same protection covers quarantined records of legacy unkeyed callers (raw stored as a stub when oversized)', async () => {
      const co = await newCompany();
      const bad = { businessId: co.id, personName: 'X', jobTitle: 'y'.repeat(OBSERVATION_LIMITS.MAX_QUARANTINE_RAW_BYTES + 10), source: { type: 'MANUAL_IMPORT' } } as IRawPersonRecord;
      const r = await ingest.ingest([bad], { batchRef: 'legacy-big' });
      expect(r.results[0].outcome).toBe('QUARANTINED');
      const row = (await db.select().from(schema.peopleIngestionQuarantine)).find((x) => x.batchRef === 'legacy-big')!;
      expect((row.raw as any)._stub).toBe(true);
    });

    it('17. malformed payloads (cycles, functions, bigint, deep nesting, bad dates, non-objects) are quarantined without crashing the run', async () => {
      const co = await newCompany();
      const cyclic: any = rec(co, 'Cyc Clara');
      cyclic.self = cyclic;
      const withFn: any = rec(co, 'Fn Farhan', { callback: () => 'x' });
      const withBig: any = rec(co, 'Big Bhavna', { n: BigInt(10) });
      const deep: any = rec(co, 'Deep Dipti');
      deep.nest = { a: { b: { c: { d: { e: { f: { g: { h: { i: 1 } } } } } } } } };
      const badDate: any = rec(co, 'Date Dalip', { startDate: new Date('not a date') });
      const records = [cyclic, withFn, withBig, deep, badDate, null as any, 'string' as any, [] as any, rec(co, 'Fine Fiona')];
      const r = await run('feed-a', records);
      expect(r.total).toBe(records.length);
      expect(r.results.slice(0, 8).every((x) => x.outcome === 'QUARANTINED')).toBe(true);
      expect(r.results[8]).toMatchObject({ outcome: 'CREATED', observation: { status: 'RECORDED' } });
      expect(r.results[0].reasons![0].code).toBe('MALFORMED_RECORD');
      expect((await obsRows()).filter((o) => ['Cyc Clara', 'Fn Farhan'].includes(o.observedName ?? ''))).toHaveLength(0);
      // the legacy path survives a cyclic record too (it used to throw out of the whole run)
      const legacyCyclic: any = rec(co, 'Sole'); // invalid (incomplete name) AND cyclic
      legacyCyclic.self = legacyCyclic;
      const legacyNul: any = rec(co, 'Sole', { jobTitle: 'CE\u0000O' }); // invalid AND contains NUL (unstorable)
      const legacy = await ingest.ingest([legacyCyclic, legacyNul, rec(co, 'Legacy Fine')], { batchRef: 'legacy-cyc' });
      expect(legacy.results.map((x) => x.outcome)).toEqual(['QUARANTINED', 'QUARANTINED', 'CREATED']);
    });

    it('canonicalisation is deterministic and bounded; the fingerprint ignores WHEN the source observed the record, not WHAT it said', () => {
      expect(canonicalize({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(canonicalize({ a: [2, { c: 2, d: 1 }], b: 1 }));
      expect(canonicalize({ a: undefined, b: 1 })).toBe(canonicalize({ b: 1 }));
      const base = { businessId: 'b', personName: 'Fp Fiona', jobTitle: 'CEO', source: { type: 'PARTNER_FEED', reference: 'r', observedAt: '2026-01-01' } } as IRawPersonRecord;
      const later = { ...base, source: { ...base.source, observedAt: '2026-06-01' } } as IRawPersonRecord;
      const changed = { ...base, jobTitle: 'CFO' } as IRawPersonRecord;
      expect(measureRecord(later).contentFingerprint).toBe(measureRecord(base).contentFingerprint);
      expect(measureRecord(changed).contentFingerprint).not.toBe(measureRecord(base).contentFingerprint);
      expect(() => canonicalize(Object.create({ inherited: 1 }))).toThrow(/non-plain/);
      expect(() => canonicalize(new Map())).toThrow(/non-plain/);
      expect(() => canonicalize({ a: 'nul\u0000inside' })).toThrow(/NUL/);
    });

    it('provenance must be well-formed and credential-free: bad record ids, payload references and URL credentials are refused', async () => {
      const co = await newCompany();
      const bad = [
        rec(co, 'Id Ishaan', {}, { recordId: 'has\u0007control' }),
        rec(co, 'Id Ira', {}, { recordId: 'x'.repeat(201) }),
        rec(co, 'Ref Rohit', {}, { payloadRef: 'has space' }),
        rec(co, 'Key Kabir', {}, { reference: 'https://x.example/a?api_key=abc123secret' }),
        rec(co, 'Cred Chaya', {}, { url: 'https://user:pass@x.example/a' }),
        rec(co, 'Tok Tara', {}, { label: 'Bearer abcdefghijk' }),
      ];
      const before = await counts();
      const r = await run('feed-a', bad);
      expect(r.results.every((x) => x.outcome === 'QUARANTINED')).toBe(true);
      expect(r.results.map((x) => x.reasons![0].code)).toEqual(['INVALID_SOURCE_RECORD_ID', 'INVALID_SOURCE_RECORD_ID', 'INVALID_PAYLOAD_REF', 'SOURCE_SECRET_REJECTED', 'SOURCE_SECRET_REJECTED', 'SOURCE_SECRET_REJECTED']);
      expect((await counts()).people).toBe(before.people);
      expect(readObservationFields(rec(co, 'Ok Om', {}, { payloadRef: 's3-key/abc123', recordId: 'ok-1' })).violations).toEqual([]);
    });

    it('privacy: observations hold no contact data and no raw payload, only role-level facts, a fingerprint and sizes', async () => {
      const co = await newCompany();
      await run('feed-a', [rec(co, 'Priv Priya', { email: 'priya.private@corp-obs.co.in', phone: '9876543210', mobile: '9123456789', linkedinUrl: 'https://www.linkedin.com/in/priv-priya-77' }, { recordId: 'priv-1', payloadRef: 'vault/priv-1' })]);
      const [o] = await obsRows('priv-1');
      const text = JSON.stringify(o);
      for (const secret of ['priya.private', '9876543210', '9123456789', 'priv-priya-77', 'corp-obs.co.in']) expect(text).not.toContain(secret);
      expect(o.payloadRef).toBe('vault/priv-1');
      const cols = (await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'people_observations'`)).rows.map((r: any) => r.column_name);
      expect(cols.filter((c: string) => /email|phone|mobile|linkedin|payload$|raw|secret|token|password|credential/i.test(c))).toEqual([]);
    });
  });

  // ================================================================ append-only + structure
  describe('append-only history and boundaries', () => {
    it('the database refuses to edit an observation; only the database itself may null a link when the target is deleted; removal with the person is allowed', async () => {
      const co = await newCompany();
      const r = await run('feed-a', [rec(co, 'Append Anvi', {}, { recordId: 'append-1' })]);
      const [o] = await obsRows('append-1');
      await expect(client.query(`UPDATE people_observations SET observed_title = 'CFO' WHERE id = $1`, [o.id])).rejects.toThrow(/append-only/);
      await expect(client.query(`UPDATE people_observations SET acquired_at = now() WHERE id = $1`, [o.id])).rejects.toThrow(/append-only/);
      await expect(client.query(`UPDATE people_observations SET source_version = '9' WHERE id = $1`, [o.id])).rejects.toThrow(/append-only/);
      await expect(client.query(`UPDATE people_observations SET evidence_id = gen_random_uuid() WHERE id = $1`, [o.id])).rejects.toThrow(); // cannot re-point
      // deleting the evidence row nulls the link (ON DELETE SET NULL) without being blocked
      await client.query(`DELETE FROM people_evidence WHERE id = $1`, [o.evidenceId]);
      expect((await obsRows('append-1'))[0].evidenceId).toBeNull();
      expect((await obsRows('append-1'))[0].observedTitle).toBe('CEO');
      // removing the person removes their observations (nothing lingers after a takedown)
      await client.query(`DELETE FROM people WHERE id = $1`, [r.results[0].personId]);
      expect(await obsRows('append-1')).toHaveLength(0);
      // the source itself cannot be deleted while history exists
      await expect(client.query(`DELETE FROM people_sources WHERE key = 'feed-a'`)).rejects.toThrow();
    });

    it('the database enforces the shape: outcome values, ingested rows need a person, bounded payload size', async () => {
      const base = `INSERT INTO people_observations (source_key, source_version, source_record_id, batch_ref, acquired_at, content_fingerprint, outcome`;
      await expect(client.query(`${base}) VALUES ('feed-a','1','x','b', now(), 'f', 'MAYBE')`)).rejects.toThrow();
      await expect(client.query(`${base}) VALUES ('feed-a','1','x','b', now(), 'f', 'INGESTED')`)).rejects.toThrow(); // no person
      await expect(client.query(`${base}, payload_bytes) VALUES ('feed-a','1','x','b', now(), 'f', 'QUARANTINED', 2000000)`)).rejects.toThrow();
      await expect(client.query(`${base}) VALUES ('no-such-source','1','x','b', now(), 'f', 'QUARANTINED')`)).rejects.toThrow(); // unregistered source
    });

    it('structural: only the writer and the observation service insert observations; nothing updates them; no controller or customer code reads them', () => {
      const walk = (dir: string): string[] =>
        fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === '__tests__' ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]));
      const files = walk(path.join(SRC_DIR, 'modules')).filter((f) => f.endsWith('.ts'));
      const using = files.filter((f) => /peopleObservations/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(SRC_DIR, f).replace(/\\/g, '/')).sort();
      // Phase 6.8/6.9: the conflict detector, the reviewer detail and the acquisition orchestrator (skip-already-done check) READ observations (never write them: see the insert/update guards below)
      // Phase 10B/10C: people-contact-attribution.ts is the ONLY observation consumer on the customer path (customer code -> this helper -> observations; people-contact-attribution-hardening.integration.spec.ts pins that no customer file bypasses it). It is the single customer-path reader. It only answers "may this contact show at this company" (yes / no);
      // it returns no observation data, and the customer files themselves (checked below) still never mention observations.
      expect(using).toEqual(['modules/people/acquisition/acquisition-orchestrator.service.ts', 'modules/people/conflicts/conflict-detector.ts', 'modules/people/observations/observation.service.ts', 'modules/people/people-contact-attribution.ts', 'modules/people/people-write.service.ts', 'modules/people/review/people-review.service.ts']);
      for (const f of files.filter((x) => /conflict-detector|people-review\.service|acquisition-orchestrator/.test(x))) expect(/insert\(\s*schema\.peopleObservations/.test(fs.readFileSync(f, 'utf8'))).toBe(false);
      for (const f of files) expect(/update\(\s*schema\.peopleObservations/.test(fs.readFileSync(f, 'utf8'))).toBe(false);
      const customerFiles = ['modules/people/people.controller.ts', 'modules/people/people.service.ts', 'modules/people/people-search.service.ts', 'modules/people/people-export.service.ts'];
      for (const f of customerFiles) expect(fs.readFileSync(path.join(SRC_DIR, f), 'utf8')).not.toMatch(/peopleObservations|people_observations|observation/i);
      // the import module reaches observations only through the ingestion contract (a record id), never the table
      for (const f of walk(path.join(SRC_DIR, 'modules/import'))) expect(fs.readFileSync(f, 'utf8')).not.toMatch(/peopleObservations|people_observations/);
    });
  });
});

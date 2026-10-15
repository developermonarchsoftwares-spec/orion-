import { eq, sql } from 'drizzle-orm';
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
import { findSuppressionMatch, identityOfUpsert, registerSuppressedIdentities, suppressionDigest } from '../suppression/people-suppression';
import { expectLedgerConsistent } from './ledger-invariants';
import { createTestDb, seedBusiness, seedUser } from './pglite-test-db';

const SRC_DIR = path.resolve(__dirname, '../../..');

describe('People suppression registry (Phase 6.4)', () => {
  let db: DrizzleDb;
  let closeDb: () => Promise<void>;
  let client: { query: (...a: any[]) => Promise<any>; exec: (s: string) => Promise<any> };
  let ingest: PeopleIngestionService;
  let publishing: PeoplePublishingService;
  let write: PeopleWriteService;
  let registry: SourceRegistryService;
  let n = 0;

  const tag = () => `${++n}${Math.random().toString(36).slice(2, 6)}`.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);
  const company = () => seedBusiness(db, `sup-co-${++n}-${Math.random().toString(36).slice(2, 6)}`);
  const phone = () => `98${String(Math.floor(10000000 + Math.random() * 89999999))}`;
  const rec = (co: { id: string }, name: string, over: Record<string, unknown> = {}, source: Record<string, unknown> = {}): IRawPersonRecord =>
    ({ businessId: co.id, personName: name, jobTitle: 'Director', source: { type: 'MANUAL_IMPORT', reference: 'sheet-1', recordId: `rec-${tag()}`, ...source }, ...over }) as IRawPersonRecord;
  const run = (records: IRawPersonRecord[], opts: Record<string, unknown> = {}) => ingest.ingest(records, { sourceKey: 'people-json', batchRef: `run-${++n}`, ...opts });
  const counts = async () => ({
    people: (await db.select().from(schema.people)).length,
    roles: (await db.select().from(schema.companyPeople)).length,
    contacts: (await db.select().from(schema.personContacts)).length,
    published: (await db.select().from(schema.companyPeople)).filter((r) => r.isPublished).length,
  });
  const regRows = (personId?: string) => db.select().from(schema.peopleSuppressions).then((r) => (personId ? r.filter((x) => x.personId === personId) : r));
  const suppressedPerson = async (over: Record<string, unknown> = {}, name = `Sup ${tag()}`) => {
    const co = await company();
    const linkedin = `https://www.linkedin.com/in/${tag()}-suppressed`;
    const email = `${tag()}@corp-sup.co.in`;
    const tel = phone();
    const r = await run([rec(co, name, { linkedinUrl: linkedin, email, phone: tel, ...over })]);
    expect(r.results[0].outcome).toBe('CREATED');
    const personId = r.results[0].personId!;
    await publishing.suppressPerson(personId, { reviewedBy: 'reviewer@orion.test', reviewerId: undefined, note: 'opt-out request' });
    return { co, name, personId, linkedin, email, tel };
  };

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    client = t.client as any;
    closeDb = () => t.client.close();
    write = new PeopleWriteService(db);
    registry = new SourceRegistryService(db);
    ingest = new PeopleIngestionService(db, write, registry, new ObservationService(db));
    publishing = new PeoplePublishingService(db);
  }, 60_000);

  afterAll(async () => {
    await expectLedgerConsistent(db);
    await closeDb?.();
  });

  // ================================================================ registry
  describe('the registry', () => {
    it('suppressing a person registers every deterministic identity they hold, as digests, in the same step', async () => {
      const co = await company();
      const linkedin = `https://www.linkedin.com/in/${tag()}-reg`;
      const r = await run([rec(co, 'Reg Ramesh', { linkedinUrl: linkedin, email: 'reg.ramesh@corp-sup.co.in', phone: '0422 255 0199', mobile: '9876512399' })]);
      const personId = r.results[0].personId!;
      expect(await regRows(personId)).toHaveLength(0); // not suppressed yet: nothing registered
      await publishing.suppressPerson(personId, { reviewedBy: 'a@orion.test', reviewerId: undefined, note: 'requested removal' });
      const rows = await regRows(personId);
      expect(rows.map((x) => x.identityKind).sort()).toEqual(['LINKEDIN', 'PHONE', 'PHONE', 'WORK_EMAIL']);
      for (const row of rows) {
        expect(row.identityDigest).toMatch(/^h:[0-9a-f]{64}$/);
        expect(row).toMatchObject({ origin: 'REVIEWER_ACTION', suppressedByKind: 'REVIEWER', suppressedByLabel: 'a@orion.test', reason: 'requested removal' });
      }
      const [person] = await db.select().from(schema.people).where(eq(schema.people.id, personId));
      expect(person.dataStatus).toBe('SUPPRESSED');
      expect(rows.find((x) => x.identityKind === 'LINKEDIN')!.identityDigest).toBe(suppressionDigest(person.normalizedLinkedinUrl!));
      const [audit] = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, personId));
      expect(audit.newValues).toMatchObject({ identitiesRegistered: 4, identitiesAlreadyRegistered: 0 });
    });

    it('suppressing twice is idempotent: no duplicate entries, no error', async () => {
      const s = await suppressedPerson();
      const before = await regRows(s.personId);
      await publishing.suppressPerson(s.personId, { reviewedBy: 'b@orion.test', reviewerId: undefined, note: 'again' });
      const again = await registerSuppressedIdentities(db as any, s.personId, { origin: 'REVIEWER_ACTION', byKind: 'REVIEWER' });
      expect(again).toEqual({ registered: 0, already: before.length });
      expect(await regRows(s.personId)).toEqual(before); // untouched: same rows, same reason, same actor
    });

    it('the database enforces uniqueness and shape, so concurrent writers cannot create duplicates or bad rows', async () => {
      const s = await suppressedPerson();
      const [row] = await regRows(s.personId);
      const ins = (kind: string, digest: string) =>
        client.query(`INSERT INTO people_suppressions (identity_kind, identity_digest, origin) VALUES ('${kind}', '${digest}', 'REVIEWER_ACTION')`);
      await expect(ins(row.identityKind, row.identityDigest)).rejects.toThrow(); // same (kind, digest)
      await expect(ins('NAME', suppressionDigest('x'))).rejects.toThrow(); // names are never a suppression key
      await expect(ins('WORK_EMAIL', 'plain@cleartext.example')).rejects.toThrow(); // cleartext refused
      await expect(ins('WORK_EMAIL', 'h:' + 'z'.repeat(64))).rejects.toThrow();
      await expect(client.query(`INSERT INTO people_suppressions (identity_kind, identity_digest, origin) VALUES ('PHONE', '${suppressionDigest('1')}', 'MAGIC')`)).rejects.toThrow();
      const user = await seedUser(db, `sup-${tag()}@orion.test`);
      await expect(client.query(`INSERT INTO people_suppressions (identity_kind, identity_digest, origin, suppressed_by_kind, suppressed_by_id) VALUES ('PHONE', '${suppressionDigest('2')}', 'LEGACY_BACKFILL', 'SYSTEM', '${user.id}')`)).rejects.toThrow(); // a system row names no human
    });

    it('history is preserved: rows can be neither edited nor deleted, and they outlive the person row', async () => {
      const s = await suppressedPerson();
      const rows = await regRows(s.personId);
      await expect(client.query(`UPDATE people_suppressions SET reason = 'changed' WHERE id = $1`, [rows[0].id])).rejects.toThrow(/immutable/);
      await expect(client.query(`UPDATE people_suppressions SET identity_digest = $2 WHERE id = $1`, [rows[0].id, suppressionDigest('other')])).rejects.toThrow(/immutable/);
      await expect(client.query(`DELETE FROM people_suppressions WHERE id = $1`, [rows[0].id])).rejects.toThrow(/never deleted/);
      await expect(client.query(`UPDATE people_suppressions SET person_id = gen_random_uuid() WHERE id = $1`, [rows[0].id])).rejects.toThrow(); // cannot be re-pointed
      // deleting the person (a takedown / erasure) keeps the protection, detached from the person
      await client.query(`DELETE FROM people WHERE id = $1`, [s.personId]);
      const after = await db.select().from(schema.peopleSuppressions).where(sql`${schema.peopleSuppressions.id} IN (${sql.join(rows.map((r) => sql`${r.id}`), sql`, `)})`);
      expect(after).toHaveLength(rows.length);
      expect(after.every((r) => r.personId === null)).toBe(true);
      expect(after.every((r) => r.reason === rows.find((x) => x.id === r.id)!.reason && r.suppressedAt.getTime() === rows.find((x) => x.id === r.id)!.suppressedAt.getTime())).toBe(true);
      // and LinkedIn / e-mail still refuse the person after erasure
      const co = await company();
      const again = await run([rec(co, `Erased ${tag()}`, { linkedinUrl: s.linkedin })]);
      expect(again.results[0]).toMatchObject({ outcome: 'QUARANTINED' });
      expect(again.results[0].reasons![0].code).toBe('SUPPRESSED_PERSON');
      const viaEmail = await run([rec(co, `Erased ${tag()}`, { email: s.email })]);
      expect(viaEmail.results[0].reasons![0].code).toBe('SUPPRESSED_PERSON');
      // a bare phone number is not a deterministic identity once the person is gone
      const viaPhone = await run([rec(co, s.name, { phone: s.tel })]);
      expect(viaPhone.results[0].outcome).toBe('CREATED');
    });

    it('privacy: the registry holds digests only, in no readable form', async () => {
      const s = await suppressedPerson();
      const dump = JSON.stringify(await regRows());
      for (const secret of [s.email, s.tel, s.linkedin, s.email.split('@')[0], 'linkedin.com/in/']) expect(dump).not.toContain(secret);
      const cols = (await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'people_suppressions'`)).rows.map((r: any) => r.column_name);
      expect(cols.filter((c: string) => /email|phone|linkedin|name|payload|raw|secret|token|password/i.test(c))).toEqual([]);
    });
  });

  // ================================================================ ingestion
  describe('ingestion honours the registry', () => {
    it('RESURRECTION: suppressed person + new source + new source record id + changed title + different company + same deterministic identity => no person, no role, no publication', async () => {
      await registry.register({ key: `feed-${++n}`, displayName: 'Other feed', sourceType: 'PARTNER_FEED', termsAcknowledged: true, enabled: true, policy: { permissions: { identity: true, title: true, email: true, phone: true, linkedin: true, evidence: true }, allowedEvidenceTypes: ['ROLE_CLAIM'], maxAttestation: 'NONE' } });
      const key = (await registry.list()).find((x) => x.displayName === 'Other feed')!.key;
      const s = await suppressedPerson();
      const elsewhere = await company();
      const before = await counts();
      const r = await ingest.ingest(
        [rec(elsewhere, `Different Name ${tag()}`, { jobTitle: 'Managing Director', linkedinUrl: s.linkedin }, { type: 'PARTNER_FEED', recordId: 'brand-new-record-id', reference: 'another-ref' })],
        { sourceKey: key, batchRef: 'resurrect-1' },
      );
      expect(r.results[0]).toMatchObject({ outcome: 'QUARANTINED' });
      expect(r.results[0].reasons![0].code).toBe('SUPPRESSED_PERSON');
      expect(await counts()).toEqual(before); // NO new person, NO new role, NO new contact, NO publication
      const [person] = await db.select().from(schema.people).where(eq(schema.people.id, s.personId));
      expect(person.dataStatus).toBe('SUPPRESSED'); // not resurrected
      expect((await db.select().from(schema.companyPeople).where(eq(schema.companyPeople.personId, s.personId))).every((x) => !x.isPublished && x.reviewStatus === 'REJECTED')).toBe(true);
    });

    it('suppressed LinkedIn, suppressed e-mail, and suppressed phone (with the same name) each refuse the record', async () => {
      const s = await suppressedPerson();
      const co = await company();
      const before = await counts();
      const byLinkedin = await run([rec(co, `Who ${tag()}`, { linkedinUrl: s.linkedin })]);
      const byEmail = await run([rec(co, `Who ${tag()}`, { email: s.email, jobTitle: 'CEO' })]); // same e-mail, changed title
      const byPhone = await run([rec(co, s.name, { phone: s.tel })]); // same phone, same name
      for (const r of [byLinkedin, byEmail, byPhone]) {
        expect(r.results[0].outcome).toBe('QUARANTINED');
        expect(r.results[0].reasons![0].code).toBe('SUPPRESSED_PERSON');
      }
      expect(byLinkedin.results[0].reasons![0].details).toMatchObject({ suppression: { kind: 'LINKEDIN', personId: s.personId } });
      expect(byEmail.results[0].reasons![0].details).toMatchObject({ suppression: { kind: 'WORK_EMAIL' } });
      expect(byPhone.results[0].reasons![0].details).toMatchObject({ suppression: { kind: 'PHONE' } });
      expect(await counts()).toEqual(before);
    });

    it('a signal added later still protects: a record with a NEW identifier plus one known identifier is refused', async () => {
      const s = await suppressedPerson();
      const co = await company();
      const r = await run([rec(co, s.name, { linkedinUrl: s.linkedin, email: `brand.new.${tag()}@other-corp.co.in`, phone: phone() })]);
      expect(r.results[0].reasons![0].code).toBe('SUPPRESSED_PERSON');
      expect((await db.select().from(schema.personContacts).where(sql`${schema.personContacts.normalizedValue} LIKE 'brand.new.%'`))).toHaveLength(0);
    });

    it('a phone number is deterministic only with the suppressed person\'s own name: same phone, different name is NOT suppressed', async () => {
      const s = await suppressedPerson();
      const co = await company();
      const r = await run([rec(co, `Shared Phone ${tag()}`, { phone: s.tel })]);
      expect(r.results[0].outcome).toBe('CREATED');
      // and it did not touch the suppressed person
      expect((await db.select().from(schema.people).where(eq(schema.people.id, s.personId)))[0].dataStatus).toBe('SUPPRESSED');
    });

    it('weak signals never suppress: same title, same company, similar name, different identifiers => a normal person', async () => {
      const s = await suppressedPerson();
      const r = await run([rec(s.co, `${s.name.split(' ')[0]} Someoneelse`, { jobTitle: 'Director', linkedinUrl: `https://www.linkedin.com/in/${tag()}-other`, email: `${tag()}@corp-sup.co.in` })]);
      expect(r.results[0].outcome).toBe('CREATED');
    });

    it('Case D: the same name at a DIFFERENT company with no identifier is not suppressed by the registry; the same name at the SAME company is still held back by the pre-existing resolver guard', async () => {
      const s = await suppressedPerson();
      const other = await company();
      const differentCompany = await run([rec(other, s.name)]);
      expect(differentCompany.results[0].outcome).toBe('CREATED'); // a name is never a suppression key
      const sameCompany = await run([rec(s.co, s.name)]);
      expect(sameCompany.results[0].outcome).toBe('QUARANTINED');
      expect(sameCompany.results[0].reasons![0].code).toBe('SUPPRESSED_PERSON');
      expect(sameCompany.results[0].reasons![0].details).toMatchObject({ suppression: { kind: 'PERSON', personId: s.personId } }); // the resolver guard, not a registry signal
    });

    it('Case E: a weak signal shared by two ACTIVE people suppresses nobody; ambiguity is not suppression', async () => {
      const shared = phone();
      const co = await company();
      await run([rec(co, `Active One ${tag()}`, { phone: shared })]);
      await run([rec(co, `Active Two ${tag()}`, { phone: shared })]);
      const third = await run([rec(co, `Active Three ${tag()}`, { phone: shared })]);
      expect(third.results[0].outcome).toBe('CREATED');
      // several same-named people at a company: AMBIGUOUS_IDENTITY, which is a review matter, not a suppression
      await run([rec(co, 'Twin Tara', { jobTitle: 'CTO', linkedinUrl: `https://www.linkedin.com/in/${tag()}-t1` })]);
      await run([rec(co, 'Twin Tara', { jobTitle: 'CFO', linkedinUrl: `https://www.linkedin.com/in/${tag()}-t2` })]);
      const amb = await run([rec(co, 'Twin Tara', { jobTitle: 'Director' })]);
      expect(amb.results[0].reasons![0].code).toBe('AMBIGUOUS_IDENTITY');
      const twinIds = (await db.select().from(schema.people).where(eq(schema.people.fullName, 'Twin Tara'))).map((p) => p.id);
      for (const id of twinIds) expect(await regRows(id)).toHaveLength(0); // nobody was suppressed by the ambiguity
    });

    it('the registry check is correct in dry runs and leaves no trace', async () => {
      const s = await suppressedPerson();
      const before = await counts();
      const r = await run([rec(s.co, `Dry ${tag()}`, { linkedinUrl: s.linkedin })], { dryRun: true });
      expect(r.results[0].outcome).toBe('QUARANTINED');
      expect(r.results[0].reasons![0].code).toBe('SUPPRESSED_PERSON');
      expect(await counts()).toEqual(before);
    });

    it('the write itself refuses too, whoever calls it (defence in depth inside the transaction)', async () => {
      const s = await suppressedPerson();
      const before = await counts();
      await expect(
        write.upsertPersonForBusiness({ businessId: s.co.id, person: { fullName: `Direct ${tag()}`, linkedinUrl: s.linkedin }, role: { jobTitle: 'CEO' }, evidence: [{ sourceType: 'MANUAL_IMPORT', evidenceType: 'ROLE_CLAIM', sourceReference: 'direct' }] }),
      ).rejects.toMatchObject({ errorCode: 'SUPPRESSED_PERSON' });
      expect(await counts()).toEqual(before);
    });

    it('findSuppressionMatch precedence and determinism: LinkedIn, then e-mail, then phone; several signals of one person are one identity', async () => {
      const s = await suppressedPerson();
      const both = await findSuppressionMatch(db as any, { linkedinNorm: null, emails: [], phones: [], normalizedName: 'x y' });
      expect(both).toBeNull();
      const [person] = await db.select().from(schema.people).where(eq(schema.people.id, s.personId));
      const id = identityOfUpsert({ person: { fullName: s.name, linkedinUrl: s.linkedin }, contacts: [{ type: 'WORK_EMAIL', value: s.email }, { type: 'PHONE', value: s.tel }] });
      expect(id.linkedinNorm).toBe(person.normalizedLinkedinUrl);
      const hit = await findSuppressionMatch(db as any, id);
      expect(hit).toEqual({ kind: 'LINKEDIN', personId: s.personId });
      expect(await findSuppressionMatch(db as any, { ...id, linkedinNorm: null })).toEqual({ kind: 'WORK_EMAIL', personId: s.personId });
      expect(await findSuppressionMatch(db as any, { ...id, linkedinNorm: null, emails: [] })).toEqual({ kind: 'PHONE', personId: s.personId });
    });
  });

  // ================================================================ observations
  describe('observations stay traceable', () => {
    it('a keyed record refused for suppression is a QUARANTINED observation with reason SUPPRESSED_PERSON; earlier observations are unchanged; nobody is resurrected', async () => {
      const co = await company();
      const linkedin = `https://www.linkedin.com/in/${tag()}-obs`;
      const first = await run([rec(co, 'Obs Olga', { linkedinUrl: linkedin }, { recordId: 'obs-rec-1' })], { batchRef: 'before-suppression' });
      const personId = first.results[0].personId!;
      const [earlier] = await db.select().from(schema.peopleObservations).where(eq(schema.peopleObservations.sourceRecordId, 'obs-rec-1'));
      const earlierSnapshot = JSON.stringify(earlier);
      await publishing.suppressPerson(personId, { reviewedBy: 'r@orion.test', reviewerId: undefined, note: 'takedown' });
      expect(JSON.stringify((await db.select().from(schema.peopleObservations).where(eq(schema.peopleObservations.id, earlier.id)))[0])).toBe(earlierSnapshot); // suppression does not rewrite history

      const before = await counts();
      const again = await run([rec(co, 'Obs Olga', { linkedinUrl: linkedin, jobTitle: 'CEO' }, { recordId: 'obs-rec-2' })], { batchRef: 'after-suppression' });
      expect(again.results[0]).toMatchObject({ outcome: 'QUARANTINED', observation: { status: 'RECORDED' } });
      const [refused] = await db.select().from(schema.peopleObservations).where(eq(schema.peopleObservations.sourceRecordId, 'obs-rec-2'));
      expect(refused).toMatchObject({ outcome: 'QUARANTINED', reasonCodes: ['SUPPRESSED_PERSON'], personId: null, companyPersonId: null, evidenceId: null, sourceKey: 'people-json', batchRef: 'after-suppression' });
      expect(await counts()).toEqual(before);
      // the same refusal again in the same run adds nothing
      await run([rec(co, 'Obs Olga', { linkedinUrl: linkedin, jobTitle: 'CEO' }, { recordId: 'obs-rec-2' })], { batchRef: 'after-suppression' });
      expect(await db.select().from(schema.peopleObservations).where(eq(schema.peopleObservations.sourceRecordId, 'obs-rec-2'))).toHaveLength(1);
      // suppression does not convert old observations into registry rows, and the refusal holds no identity data
      expect(JSON.stringify(refused)).not.toContain(linkedin);
    });
  });

  // ================================================================ compatibility + concurrency
  describe('compatibility and concurrency', () => {
    it('the legacy status setter registers the person in the same transaction', async () => {
      const co = await company();
      const r = await run([rec(co, `Legacy ${tag()}`, { linkedinUrl: `https://www.linkedin.com/in/${tag()}-leg`, email: `${tag()}@corp-sup.co.in` })]);
      await write.setDataStatus(r.results[0].personId!, 'SUPPRESSED');
      const rows = await regRows(r.results[0].personId!);
      expect(rows.map((x) => x.identityKind).sort()).toEqual(['LINKEDIN', 'WORK_EMAIL']);
      expect(rows.every((x) => x.origin === 'LEGACY_SET_STATUS' && x.suppressedByKind === 'SYSTEM' && x.suppressedById === null)).toBe(true);
    });

    describe('stored scheduled-export files (Phase 23)', () => {
      const storedFile = async () => {
        const [u] = await db.insert(schema.users).values({ email: `${tag()}@export-owner.test`, firstName: 'O', lastName: 'W' } as any).returning();
        const [job] = await db.insert(schema.exportJobs).values({ userId: u.id, dataset: 'unlocked-people', format: 'csv', source: 'SCHEDULED', status: 'COMPLETED', rowCount: 1, fileName: 'p.csv', sizeBytes: 3, content: Buffer.from('abc') } as any).returning();
        return job.id as string;
      };
      const jobOf = async (id: string) => (await db.select().from(schema.exportJobs).where(eq(schema.exportJobs.id, id)))[0] as any;

      it('a reviewer suppression expires stored files, even for a person with no deterministic identifier', async () => {
        const co = await company();
        const r = await run([rec(co, `Stored ${tag()}`)]);
        const id = await storedFile();
        await publishing.suppressPerson(r.results[0].personId!, { reviewedBy: 'r@orion.test', reviewerId: undefined, note: 'opt-out' });
        expect(await jobOf(id)).toMatchObject({ status: 'EXPIRED', content: null });
      });

      it('the legacy status setter expires stored files too', async () => {
        const co = await company();
        const r = await run([rec(co, `StoredLeg ${tag()}`, { email: `${tag()}@corp-sup.co.in` })]);
        const id = await storedFile();
        await write.setDataStatus(r.results[0].personId!, 'SUPPRESSED');
        expect(await jobOf(id)).toMatchObject({ status: 'EXPIRED', content: null });
      });

      it('a status change that is not a suppression leaves stored files alone', async () => {
        const co = await company();
        const r = await run([rec(co, `StoredKeep ${tag()}`, { email: `${tag()}@corp-sup.co.in` })]);
        const id = await storedFile();
        await write.setDataStatus(r.results[0].personId!, 'DRAFT');
        const j = await jobOf(id);
        expect(j.status).toBe('COMPLETED');
        expect(j.content).not.toBeNull();
      });
    });

    it('a suppressed person without any deterministic identifier leaves no registry entry (a documented legacy case; nothing is invented)', async () => {
      const co = await company();
      const r = await run([rec(co, `Bare ${tag()}`)]);
      await publishing.suppressPerson(r.results[0].personId!, { reviewedBy: 'r@orion.test', reviewerId: undefined, note: 'opt-out' });
      expect(await regRows(r.results[0].personId!)).toHaveLength(0);
      expect((await db.select().from(schema.people).where(eq(schema.people.id, r.results[0].personId!)))[0].dataStatus).toBe('SUPPRESSED');
    });

    it('simultaneous suppressions and simultaneous ingestion of a suppressed identity are safe and consistent', async () => {
      const co = await company();
      const linkedin = `https://www.linkedin.com/in/${tag()}-conc`;
      const r = await run([rec(co, `Conc ${tag()}`, { linkedinUrl: linkedin, email: `${tag()}@corp-sup.co.in` })]);
      const personId = r.results[0].personId!;
      const ctx = (l: string) => ({ reviewedBy: l, reviewerId: undefined, note: 'race' });
      await Promise.all([publishing.suppressPerson(personId, ctx('a')), publishing.suppressPerson(personId, ctx('b')), publishing.suppressPerson(personId, ctx('c'))]);
      const rows = await regRows(personId);
      expect(rows).toHaveLength(2); // one per identity, however many racers
      const attempts = await Promise.all([1, 2, 3].map((i) => run([rec(co, `Racer ${tag()}`, { linkedinUrl: linkedin }, { recordId: `race-${i}` })])));
      expect(attempts.every((a) => a.results[0].reasons?.[0].code === 'SUPPRESSED_PERSON')).toBe(true);
    });

    it('ingesting and suppressing the same person at the same moment never leaves a live role behind', async () => {
      const co = await company();
      const name = `Mid ${tag()}`;
      const linkedin = `https://www.linkedin.com/in/${tag()}-mid`;
      const r = await run([rec(co, name, { linkedinUrl: linkedin })]);
      const personId = r.results[0].personId!;
      await Promise.all([
        publishing.suppressPerson(personId, { reviewedBy: 'r', reviewerId: undefined, note: 'race with ingestion' }),
        run([rec(co, name, { linkedinUrl: linkedin, jobTitle: 'Managing Director' })]),
        run([rec(co, name, { linkedinUrl: linkedin, jobTitle: 'CEO' })]),
      ]);
      const roles = await db.select().from(schema.companyPeople).where(eq(schema.companyPeople.personId, personId));
      expect((await db.select().from(schema.people).where(eq(schema.people.id, personId)))[0].dataStatus).toBe('SUPPRESSED');
      expect(roles.every((x) => !x.isPublished && x.reviewStatus !== 'APPROVED')).toBe(true);
      expect(await regRows(personId)).toHaveLength(1); // LinkedIn only
    });
  });

  // ================================================================ boundaries
  describe('boundaries', () => {
    it('rejection, quarantine and deletion are not suppression: they write nothing to the registry', async () => {
      const co = await company();
      const before = (await regRows()).length;
      const r = await run([rec(co, `Plain ${tag()}`, { linkedinUrl: `https://www.linkedin.com/in/${tag()}-plain`, email: `${tag()}@corp-sup.co.in` })]);
      await db.update(schema.companyPeople).set({ reviewStatus: 'REJECTED' }).where(eq(schema.companyPeople.id, r.results[0].companyPersonId!));
      await run([rec(co, 'Sole')]); // quarantined
      await client.query(`DELETE FROM people WHERE id = $1`, [r.results[0].personId]);
      expect((await regRows()).length).toBe(before);
    });

    it('structural: only the publishing gate and the write service register suppressions; customer code never reads the registry', () => {
      const walk = (dir: string): string[] =>
        fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === '__tests__' ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]));
      const files = walk(path.join(SRC_DIR, 'modules')).filter((f) => f.endsWith('.ts'));
      const tableUsers = files.filter((f) => /peopleSuppressions/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(SRC_DIR, f).replace(/\\/g, '/')).sort();
      expect(tableUsers).toEqual(['modules/people/suppression/people-suppression.ts']);
      const fnUsers = files.filter((f) => /registerSuppressedIdentities\(/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(SRC_DIR, f).replace(/\\/g, '/')).sort();
      expect(fnUsers).toEqual(['modules/people/people-publishing.service.ts', 'modules/people/people-write.service.ts', 'modules/people/suppression/people-suppression.ts']);
      for (const f of ['modules/people/people.controller.ts', 'modules/people/people.service.ts', 'modules/people/people-search.service.ts', 'modules/people/people-export.service.ts']) {
        expect(fs.readFileSync(path.join(SRC_DIR, f), 'utf8')).not.toMatch(/suppression/i);
      }
      // no function updates or deletes registry rows
      for (const f of files) expect(/(update|delete)\(\s*schema\.peopleSuppressions/.test(fs.readFileSync(f, 'utf8'))).toBe(false);
    });
  });
});

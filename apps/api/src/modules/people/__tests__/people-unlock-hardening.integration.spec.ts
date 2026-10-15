import { and, eq, sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { BusinessRepository } from '../../business/repositories/business.repository';
import { CreditRepository } from '../../credit/credit.repository';
import { CreditService } from '../../credit/credit.service';
import { UnlockRepository } from '../../unlock/unlock.repository';
import { UnlockService } from '../../unlock/unlock.service';
import { MAX_EXPORT_PEOPLE, PeopleExportService, PEOPLE_EXPORT_HEADERS } from '../people-export.service';
import { PeoplePublishingService } from '../people-publishing.service';
import { PeopleUnlockService } from '../people-unlock.service';
import { PeopleWriteService } from '../people-write.service';
import { PeopleService } from '../people.service';
import { expectLedgerConsistent } from './ledger-invariants';
import { createTestDb, seedBusiness, seedUser } from './pglite-test-db';

describe('Credits, unlock & export hardening (Phase 6.16)', () => {
  let db: DrizzleDb;
  let closeDb: () => Promise<void>;
  let write: PeopleWriteService;
  let publishing: PeoplePublishingService;
  let people: PeopleService;
  let credit: CreditService;
  let unlock: PeopleUnlockService;
  let exporter: PeopleExportService;
  let n = 0;
  const L = () => Math.random().toString(36).replace(/[0-9.]/g, '').slice(0, 5) || 'abcde';
  const ctx = { reviewedBy: 'r@orion.test', note: 'checked by reviewer' };

  const customer = async (credits = 10) => (await seedUser(db, `unlock.${++n}.${L()}@test.dev`, { daily: credits, purchased: 0 })).id;
  const wallet = async (userId: string) => (await db.select().from(schema.userWallets).where(eq(schema.userWallets.userId, userId)))[0];
  const txRows = async (userId: string) => (await db.select().from(schema.creditTransactions).where(and(eq(schema.creditTransactions.userId, userId), eq(schema.creditTransactions.type, 'UNLOCK_LEAD' as any))));
  const unlockRows = async (userId: string, personId?: string) =>
    (await db.select().from(schema.personUnlocks).where(eq(schema.personUnlocks.userId, userId))).filter((r) => !personId || r.personId === personId);

  /** A visible person (published + approved role, published contact) at a published company. */
  const visible = async (name = `Unl ${L()}van`, extra: Record<string, unknown> = {}) => {
    const co = await seedBusiness(db, `unlock-co-${++n}-${L()}`);
    const r = await write.upsertPersonForBusiness({
      businessId: co.id,
      person: { fullName: name },
      role: { jobTitle: 'Managing Director' },
      dataStatus: 'PUBLISHED',
      contacts: [{ type: 'WORK_EMAIL', value: `u.${L()}@unlock-co.co.in`, isPublished: true }],
      evidence: [{ sourceType: 'MANUAL_IMPORT', evidenceType: 'ROLE_CLAIM', sourceReference: 'unlock-sheet' }],
      ...extra,
    } as any);
    return { co, personId: r.personId, roleId: r.companyPersonId, name };
  };

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    closeDb = () => t.client.close();
    write = new PeopleWriteService(db);
    publishing = new PeoplePublishingService(db);
    people = new PeopleService(db);
    credit = new CreditService(new CreditRepository(db), db);
    unlock = new PeopleUnlockService(db, credit, people);
    exporter = new PeopleExportService(db, people);
  }, 60_000);

  afterAll(async () => {
    await expectLedgerConsistent(db);
    await closeDb?.();
  });

  describe('idempotency and concurrency', () => {
    it('unlocking twice charges once: the second call is free and returns the same access', async () => {
      const u = await customer(10);
      const p = await visible();
      const a: any = await unlock.unlockPerson(u, p.personId);
      expect(a).toMatchObject({ success: true, alreadyUnlocked: false, creditsSpent: 1, balance: 9 });
      expect(a.person.contacts.email.value).toMatch(/@unlock-co/);
      const b: any = await unlock.unlockPerson(u, p.personId);
      expect(b).toMatchObject({ success: true, alreadyUnlocked: true, creditsSpent: 0, balance: 9 });
      expect((await wallet(u)).balance).toBe(9);
      expect(await txRows(u)).toHaveLength(1);
      expect(await unlockRows(u, p.personId)).toHaveLength(1);
      expect((await wallet(u)).lifetimeUsed).toBe(1);
    });

    it('concurrent unlock requests deduct exactly once (same customer, same person)', async () => {
      const u = await customer(10);
      const p = await visible();
      const results: any[] = await Promise.all(Array.from({ length: 8 }, () => unlock.unlockPerson(u, p.personId)));
      expect(results.every((r) => r.success)).toBe(true);
      expect(results.filter((r) => !r.alreadyUnlocked)).toHaveLength(1);
      expect(results.filter((r) => r.alreadyUnlocked).every((r) => r.creditsSpent === 0)).toBe(true);
      expect((await wallet(u)).balance).toBe(9);
      expect(await txRows(u)).toHaveLength(1);
      expect(await unlockRows(u, p.personId)).toHaveLength(1);
    });

    it('concurrent unlocks by different customers charge each customer once and never share access', async () => {
      const [a, b] = [await customer(5), await customer(5)];
      const p = await visible();
      const res: any[] = await Promise.all([a, b, a, b, a, b].map((u) => unlock.unlockPerson(u, p.personId)));
      expect(res.filter((r) => !r.alreadyUnlocked)).toHaveLength(2);
      expect((await wallet(a)).balance).toBe(4);
      expect((await wallet(b)).balance).toBe(4);
      expect(await unlockRows(a, p.personId)).toHaveLength(1);
      expect(await unlockRows(b, p.personId)).toHaveLength(1);
    });

    it('concurrent unlocks of different people each cost one credit; an insufficient wallet stops at the balance, with no unlock without a charge', async () => {
      const u = await customer(3);
      const ps = await Promise.all([visible(), visible(), visible(), visible(), visible()]);
      const res = await Promise.allSettled(ps.map((p) => unlock.unlockPerson(u, p.personId)));
      expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
      expect(res.filter((r) => r.status === 'rejected').every((r: any) => r.reason.errorCode === 'INSUFFICIENT_CREDITS')).toBe(true);
      expect((await wallet(u)).balance).toBe(0);
      expect(await unlockRows(u)).toHaveLength(3);
      expect(await txRows(u)).toHaveLength(3); // every unlock has its charge and every charge its unlock
    });

    it('the transaction is atomic: a failure after the deduction rolls the deduction back', async () => {
      const u = await customer(4);
      const p = await visible();
      const spy = jest.spyOn(credit, 'deductCredits').mockImplementation(async (...args: any[]) => {
        await (CreditService.prototype.deductCredits as any).apply(credit, args);
        throw new Error('crash after deduction');
      });
      await expect(unlock.unlockPerson(u, p.personId)).rejects.toThrow('crash after deduction');
      spy.mockRestore();
      expect((await wallet(u)).balance).toBe(4);
      expect(await txRows(u)).toHaveLength(0);
      expect(await unlockRows(u, p.personId)).toHaveLength(0);
      expect(await unlock.unlockPerson(u, p.personId)).toMatchObject({ alreadyUnlocked: false, balance: 3 }); // a clean retry works
    });
  });

  describe('visibility is re-checked at unlock time; failed unlocks never charge', () => {
    it('hidden people cannot be newly unlocked: pending, rejected, unpublished, suppressed, draft company', async () => {
      const u = await customer(10);
      const pending = await write.upsertPersonForBusiness({ businessId: (await seedBusiness(db, `u-pend-${++n}`)).id, person: { fullName: `Pend ${L()}van` }, role: { jobTitle: 'CEO' }, contacts: [{ type: 'WORK_EMAIL', value: `p.${L()}@unlock-co.co.in`, isPublished: true }] } as any);
      const rejected = await visible();
      await publishing.rejectRole(rejected.roleId, ctx);
      const unpublished = await visible();
      await publishing.unpublishRole(unpublished.roleId, ctx);
      const suppressed = await visible();
      await publishing.suppressPerson(suppressed.personId, ctx);
      const draft = await visible();
      await db.update(schema.businesses).set({ status: 'DRAFT' }).where(eq(schema.businesses.id, draft.co.id));
      for (const id of [pending.personId, rejected.personId, unpublished.personId, suppressed.personId, draft.personId, '00000000-0000-4000-8000-0000000000ee']) {
        await expect(unlock.unlockPerson(u, id)).rejects.toMatchObject({ errorCode: 'PERSON_NOT_FOUND', status: 404 });
      }
      expect((await wallet(u)).balance).toBe(10);
      expect(await txRows(u)).toHaveLength(0);
      expect(await unlockRows(u)).toHaveLength(0);
    });

    it('a stale pre-check cannot win: if the person is suppressed between the check and the charge, the locked transaction refuses and nothing is charged', async () => {
      const u = await customer(5);
      const p = await visible(`Stale ${L()}van`, { person: { fullName: `Stale ${L()}van`, linkedinUrl: `https://www.linkedin.com/in/stale-${L()}` } });
      const stale = await people.loadPublishedRolesForPerson(p.personId); // what the pre-check saw
      await publishing.suppressPerson(p.personId, ctx);
      const spy = jest.spyOn(people, 'loadPublishedRolesForPerson').mockResolvedValue(stale);
      try {
        await expect(unlock.unlockPerson(u, p.personId)).rejects.toMatchObject({ errorCode: 'PERSON_NOT_FOUND' });
      } finally {
        spy.mockRestore();
      }
      expect((await wallet(u)).balance).toBe(5);
      expect(await txRows(u)).toHaveLength(0);
      expect(await unlockRows(u, p.personId)).toHaveLength(0);
    });

    it('nothing to reveal and insufficient credits both fail without a charge or an unlock', async () => {
      const u = await customer(5);
      const co = await seedBusiness(db, `u-nocontact-${++n}`);
      const bare = await write.upsertPersonForBusiness({ businessId: co.id, person: { fullName: `Bare ${L()}van` }, role: { jobTitle: 'CEO' }, dataStatus: 'PUBLISHED', contacts: [{ type: 'WORK_EMAIL', value: `b.${L()}@unlock-co.co.in`, isPublished: false }] } as any);
      await expect(unlock.unlockPerson(u, bare.personId)).rejects.toMatchObject({ errorCode: 'NO_CONTACT_AVAILABLE', status: 409 });
      const broke = await customer(0);
      const p = await visible();
      await expect(unlock.unlockPerson(broke, p.personId)).rejects.toMatchObject({ errorCode: 'INSUFFICIENT_CREDITS', status: 402 });
      expect((await wallet(u)).balance).toBe(5);
      expect((await wallet(broke)).balance).toBe(0);
      expect(await unlockRows(broke)).toHaveLength(0);
      expect(await txRows(broke)).toHaveLength(0);
    });
  });

  describe('tenant isolation', () => {
    it('customer A unlocking never unlocks customer B, in the list, the unlocked list or the export', async () => {
      const [a, b] = [await customer(5), await customer(5)];
      const p = await visible(`Iso ${L()}van`);
      await unlock.unlockPerson(a, p.personId);
      const cardFor = async (u: string) => (await people.listCompanyPeople(p.co.id, u, { status: 'all' } as any)).people[0];
      expect((await cardFor(a)).contacts).toMatchObject({ isUnlocked: true, email: { value: expect.stringMatching(/@unlock-co/) } });
      expect((await cardFor(b)).contacts).toMatchObject({ isUnlocked: false, email: { value: null } });
      expect((await unlock.getUnlockedPeople(b) as any).unlocked).toEqual([]);
      const csvB = await exporter.exportUnlockedPeopleCsv(b, [p.personId]);
      expect(csvB).toMatchObject({ rowCount: 0, skippedLocked: 1 });
      expect(csvB.csv).not.toContain(p.name);
      expect(await exporter.exportUnlockedPeopleCsv(b)).toMatchObject({ rowCount: 0, skippedLocked: 0 });
      expect((await exporter.exportUnlockedPeopleCsv(a, [p.personId])).csv.toLowerCase()).toContain(p.name.toLowerCase());
    });
  });

  describe('after an unlock: later unpublish / suppression', () => {
    it('an unlocked person whose role is unpublished, or who is suppressed, disappears everywhere, cannot be re-unlocked, and costs nothing more', async () => {
      const u = await customer(10);
      const unpub = await visible(`Unp ${L()}van`);
      const supp = await visible(`Sup ${L()}van`);
      const comp = await visible(`Cmp ${L()}van`);
      for (const p of [unpub, supp, comp]) await unlock.unlockPerson(u, p.personId);
      expect((await wallet(u)).balance).toBe(7);
      expect(((await unlock.getUnlockedPeople(u)) as any).unlocked).toHaveLength(3);
      expect((await exporter.exportUnlockedPeopleCsv(u)).rowCount).toBe(3);

      await publishing.unpublishRole(unpub.roleId, ctx);
      await publishing.suppressPerson(supp.personId, ctx);
      await db.update(schema.businesses).set({ status: 'DRAFT' }).where(eq(schema.businesses.id, comp.co.id));

      const list: any = await unlock.getUnlockedPeople(u);
      expect(list.unlocked).toHaveLength(0);
      const csv = await exporter.exportUnlockedPeopleCsv(u);
      expect(csv.rowCount).toBe(0);
      for (const p of [unpub, supp, comp]) {
        expect(csv.csv).not.toContain(p.name);
        await expect(people.getPersonDetail(p.personId, u)).rejects.toMatchObject({ status: 404 });
        await expect(unlock.unlockPerson(u, p.personId)).rejects.toMatchObject({ errorCode: 'PERSON_NOT_FOUND' }); // not even "already unlocked" for a hidden person
      }
      expect((await wallet(u)).balance).toBe(7); // no refund, no further charge
      expect(await txRows(u)).toHaveLength(3);
      // the access row is kept: if the role is approved again, the customer's earlier purchase is honoured, not charged again
      await publishing.publishRole(unpub.roleId, ctx);
      expect(await unlock.unlockPerson(u, unpub.personId)).toMatchObject({ alreadyUnlocked: true, creditsSpent: 0 });
      expect((await wallet(u)).balance).toBe(7);
    });
  });

  describe('export', () => {
    it('exports only the caller\'s own unlocked, visible people: published contact values only, no internal data, formula-safe, deterministic', async () => {
      const u = await customer(10);
      const evil = await visible('=HYPERLINK("http://evil") Cmdvan', { contacts: [{ type: 'WORK_EMAIL', value: `e.${L()}@unlock-co.co.in`, isPublished: true }, { type: 'MOBILE', value: '9876501111', isPublished: false }] });
      const plain = await visible();
      await unlock.unlockPerson(u, evil.personId);
      await unlock.unlockPerson(u, plain.personId);
      const out = await exporter.exportUnlockedPeopleCsv(u);
      expect(out.rowCount).toBe(2);
      const header = out.csv.replace('﻿', '').split('\n')[0].replace(/"/g, '');
      expect(header).toBe(PEOPLE_EXPORT_HEADERS.join(','));
      expect(out.csv).not.toContain('9876501111'); // unpublished contact
      expect(out.csv).not.toMatch(/"=HYPERLINK|^=HYPERLINK|,=HYPERLINK/m); // formula neutralised
      expect(out.csv).toContain("'=HYPERLINK");
      const internal = new RegExp([evil.roleId, plain.roleId, evil.personId, plain.personId, 'unlock-sheet', 'MANUAL_IMPORT', 'ROLE_CLAIM', 'reviewer', 'r@orion', 'checked by', 'conflict', 'quarantine', 'suppress', 'h:[0-9a-f]{64}', 'SEN-', 'company-upload'].join('|'), 'i');
      expect(out.csv).not.toMatch(internal);
      const again = await exporter.exportUnlockedPeopleCsv(u);
      expect(again.csv).toBe(out.csv); // same input, same bytes
      // duplicate / unknown ids are counted once and never reveal anything
      const dup = await exporter.exportUnlockedPeopleCsv(u, [evil.personId, evil.personId, '00000000-0000-4000-8000-0000000000dd']);
      expect(dup).toMatchObject({ rowCount: 1, skippedLocked: 1 });
    });

    it('is bounded and ordered, and its request size is limited', () => {
      expect(MAX_EXPORT_PEOPLE).toBe(5000);
      const text = fs.readFileSync(path.resolve(__dirname, '../people-export.service.ts'), 'utf8');
      expect(text).toMatch(/\.limit\(MAX_EXPORT_PEOPLE\)/);
      expect(text).toMatch(/orderBy\(desc\(schema\.personUnlocks\.unlockedAt\), desc\(schema\.personUnlocks\.id\)\)/);
      expect(fs.readFileSync(path.resolve(__dirname, '../dto/people.dto.ts'), 'utf8')).toMatch(/@ArrayMaxSize\(1000\)/);
    });
  });

  describe('business lead unlock (the other credit path)', () => {
    let leads: UnlockService;
    beforeAll(() => {
      const discoverStub = { getBusinessBySlug: jest.fn().mockResolvedValue({ ok: true }) };
      leads = new UnlockService(new UnlockRepository(db), credit, discoverStub as any, new BusinessRepository(db) as any, db);
    });

    it('charges once under concurrent requests, never charges for an unpublished company', async () => {
      const u = await customer(6);
      const pub = await seedBusiness(db, `lead-pub-${++n}`);
      const draft = await seedBusiness(db, `lead-draft-${++n}`, { status: 'DRAFT' });
      const res: any[] = await Promise.all(Array.from({ length: 6 }, () => leads.unlockBusiness(u, pub.id)));
      expect(res.filter((r) => !r.alreadyUnlocked)).toHaveLength(1);
      expect((await wallet(u)).balance).toBe(5);
      await expect(leads.unlockBusiness(u, draft.id)).rejects.toMatchObject({ errorCode: 'BUSINESS_NOT_FOUND', status: 404 });
      await expect(leads.unlockBusiness(u, '00000000-0000-4000-8000-0000000000cc')).rejects.toMatchObject({ status: 404 });
      expect((await wallet(u)).balance).toBe(5);
      expect((await db.select().from(schema.leadUnlocks).where(eq(schema.leadUnlocks.userId, u)))).toHaveLength(1);
      void sql;
    });
  });
});

import { eq, sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { BusinessRepository } from '../../business/repositories/business.repository';
import { PeoplePublishingService } from '../../people/people-publishing.service';
import { PeopleSearchService } from '../../people/people-search.service';
import { PeopleService } from '../../people/people.service';
import { PeopleWriteService } from '../../people/people-write.service';
import { createTestDb, seedBusiness, seedUser } from '../../people/__tests__/pglite-test-db';
import { SavedLeadsRepository } from '../../saved-leads/saved-leads.repository';
import { SavedLeadsService } from '../../saved-leads/saved-leads.service';
import { DiscoverService } from '../discover.service';

const FORBIDDEN_KEY = /^(companyPersonId|contactId|evidence\w*|source\w*|reviewStatus|reviewed\w*|audit\w*|conflict\w*|quarantine\w*|suppress\w*|digest\w*|rule\w*|classification\w*|taxonomy\w*|isPublished|dataStatus|normalized\w*|fingerprint|batchRef|payload\w*|raw)$/i;
const walk = (v: unknown, fn: (k: string | null, v: unknown) => void, k: string | null = null): void => {
  fn(k, v);
  if (Array.isArray(v)) v.forEach((x) => walk(x, fn, k));
  else if (v && typeof v === 'object') for (const [kk, x] of Object.entries(v)) walk(x, fn, kk);
};

describe('Customer discovery & search hardening (Phase 6.15)', () => {
  let db: DrizzleDb;
  let closeDb: () => Promise<void>;
  let discover: DiscoverService;
  let people: PeopleService;
  let write: PeopleWriteService;
  let publishing: PeoplePublishingService;
  let savedLeads: SavedLeadsService;
  let u1: string;
  let u2: string;
  const biz: Record<string, { id: string; slug: string }> = {};
  let n = 0;
  const L = () => Math.random().toString(36).replace(/[0-9.]/g, '').slice(0, 5) || 'abcde';
  const ctx = { reviewedBy: 'r@orion.test', note: 'checked by reviewer' };
  const slugs = (r: any) => r.items.map((i: any) => i.slug);

  /** A person with a published, approved role at `b` (the way ingestion + review would leave it). */
  const dm = async (b: { id: string }, title = 'Managing Director', extra: Record<string, unknown> = {}) =>
    write.upsertPersonForBusiness({
      businessId: b.id,
      person: { fullName: `Disc ${L()}van`, city: 'Coimbatore', state: 'Tamil Nadu' },
      role: { jobTitle: title },
      dataStatus: 'PUBLISHED',
      contacts: [{ type: 'WORK_EMAIL', value: `d.${L()}@disc-co.co.in`, isPublished: true }],
      evidence: [{ sourceType: 'MANUAL_IMPORT', evidenceType: 'ROLE_CLAIM', sourceReference: 'disc-sheet' }],
      ...extra,
    } as any);

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    closeDb = () => t.client.close();
    write = new PeopleWriteService(db);
    publishing = new PeoplePublishingService(db);
    people = new PeopleService(db);
    // search index offline: every query is answered by the PostgreSQL path this phase hardens
    const searchStub = { searchBusinesses: jest.fn().mockRejectedValue(new Error('index offline')) };
    discover = new DiscoverService(searchStub as any, new BusinessRepository(db) as any, new PeopleSearchService(), db);
    savedLeads = new SavedLeadsService(new SavedLeadsRepository(db), db);

    u1 = (await seedUser(db, 'disc.one@test.dev', { daily: 5, purchased: 5 })).id;
    u2 = (await seedUser(db, 'disc.two@test.dev', { daily: 5, purchased: 5 })).id;
    // A: visible company with a visible decision maker (Coimbatore); B: published company whose only DM role was rejected;
    // C: published company whose DM was suppressed; D: DRAFT company with a published DM; E: DM role still pending; F: plain published company
    for (const [k, city, state] of [['A', 'Coimbatore', 'Tamil Nadu'], ['B', 'Chennai', 'Tamil Nadu'], ['C', 'Madurai', 'Tamil Nadu'], ['E', 'Salem', 'Tamil Nadu'], ['F', 'Mysuru', 'Karnataka']] as const) {
      biz[k] = await seedBusiness(db, `disc-${k.toLowerCase()}-co`, { city, state });
    }
    biz.D = await seedBusiness(db, 'disc-d-hidden', { status: 'DRAFT', city: 'Coimbatore' });

    await dm(biz.A, 'Founder & CEO');
    const b = await dm(biz.B);
    await publishing.rejectRole(b.companyPersonId, ctx);
    const c = await dm(biz.C);
    await publishing.suppressPerson(c.personId, ctx);
    await dm(biz.D);
    await write.upsertPersonForBusiness({ businessId: biz.E.id, person: { fullName: `Pend ${L()}van` }, role: { jobTitle: 'Managing Director' }, contacts: [] } as any); // DRAFT / pending

    // company-level contact data (business_contacts) and identifiers drive the contact-availability filters
    await db.insert(schema.businessContacts).values([
      { businessId: biz.A.id, fullName: 'Asha Kumar', title: 'Director', email: 'asha.kumar@disc-co.co.in', phone: '+91 9876543210', isDecisionMaker: true },
      { businessId: biz.F.id, fullName: 'Fiona Das', title: 'Owner', phone: '+91 9876500000' },
    ] as any);
    await db.insert(schema.businessIdentifiers).values({ businessId: biz.A.id, type: 'GSTIN', value: '33ABCDE1234F1Z5', normalizedValue: '33ABCDE1234F1Z5' } as any);
    await db.insert(schema.leadUnlocks).values({ userId: u1, businessId: biz.A.id, creditsSpent: 1 });
  }, 90_000);

  afterAll(async () => closeDb?.());

  describe('only customer-visible roles are discoverable (filters, counts, pages)', () => {
    it('decision-maker filters find only companies with a published + approved role of a published person at a published company', async () => {
      for (const q of [{ hasDecisionMaker: true }, { decisionMakerType: 'FOUNDER_CEO' }, { q: 'Companies with a Founder/CEO' }]) {
        const r: any = await discover.search(q as any, u1);
        expect(slugs(r)).toEqual(['disc-a-co']);
        expect(r.total).toBe(1);
      }
      const managing: any = await discover.search({ decisionMakerType: 'MANAGING_DIRECTOR' } as any, u1);
      expect(slugs(managing)).toEqual([]); // D is a draft company, B rejected, C suppressed, E pending
      expect(managing.total).toBe(0);
      expect(managing.items).toEqual([]);
      // the hidden ones cannot be reached by naming them, by their city, or through any people filter combination
      for (const q of [{ q: 'disc-d-hidden' }, { q: 'disc-b-co', hasDecisionMaker: true }, { q: 'disc-c-co', hasDecisionMaker: true }, { q: 'disc-e-co', hasDecisionMaker: true }]) {
        expect(slugs(await discover.search(q as any, u1)).filter((s: string) => s !== 'disc-b-co' && s !== 'disc-c-co' && s !== 'disc-e-co')).toEqual([]);
        expect((await discover.search(q as any, u1) as any).items.some((i: any) => i.slug === 'disc-d-hidden')).toBe(false);
      }
      expect(slugs(await discover.search({ q: 'disc-b-co', hasDecisionMaker: true } as any, u1))).toEqual([]);
      expect(slugs(await discover.search({ q: 'disc-c-co', hasDecisionMaker: true } as any, u1))).toEqual([]);
      expect(slugs(await discover.search({ q: 'disc-e-co', hasDecisionMaker: true } as any, u1))).toEqual([]);
      const all: any = await discover.search({ limit: 100 } as any, u1);
      expect(slugs(all)).not.toContain('disc-d-hidden');
      expect(all.total).toBe(5);
    });

    it('a decision maker who becomes hidden (unpublished, suppressed) disappears from search at once', async () => {
      const x = await seedBusiness(db, 'disc-x-co', { city: 'Ooty' });
      const r = await dm(x, 'Founder');
      expect(slugs(await discover.search({ q: 'disc-x-co', hasDecisionMaker: true } as any, u1))).toEqual(['disc-x-co']);
      await publishing.unpublishRole(r.companyPersonId, ctx);
      expect(slugs(await discover.search({ q: 'disc-x-co', hasDecisionMaker: true } as any, u1))).toEqual([]);
      await publishing.publishRole(r.companyPersonId, ctx);
      expect(slugs(await discover.search({ q: 'disc-x-co', hasDecisionMaker: true } as any, u1))).toEqual(['disc-x-co']);
      await publishing.suppressPerson(r.personId, ctx);
      expect(slugs(await discover.search({ q: 'disc-x-co', hasDecisionMaker: true } as any, u1))).toEqual([]);
    });

    it('verified / contactable decision-maker filters only count published contacts and customer-safe verification', async () => {
      expect(slugs(await discover.search({ hasDecisionMakerContact: true } as any, u1))).toEqual(['disc-a-co']);
      expect(slugs(await discover.search({ hasVerifiedDecisionMaker: true } as any, u1))).toEqual([]); // nobody is verified
      const unpub = await seedBusiness(db, 'disc-nc-co', { city: 'Ooty' });
      await write.upsertPersonForBusiness({ businessId: unpub.id, person: { fullName: `Nocon ${L()}van` }, role: { jobTitle: 'Founder' }, dataStatus: 'PUBLISHED', contacts: [{ type: 'WORK_EMAIL', value: `n.${L()}@disc-co.co.in`, isPublished: false }] } as any);
      expect(slugs(await discover.search({ hasDecisionMakerContact: true } as any, u1))).toEqual(['disc-a-co']); // an unpublished contact does not count
    });
  });

  describe('filters', () => {
    it('industry-free filters: state, city, contact availability and score behave the same as the search index would', async () => {
      expect(slugs(await discover.search({ state: 'karnataka' } as any, u1))).toEqual(['disc-f-co']);
      expect(slugs(await discover.search({ city: 'COIMBATORE' } as any, u1))).toEqual(['disc-a-co']); // case-insensitive, draft D excluded
      expect(slugs(await discover.search({ state: 'Tamil Nadu', city: 'Chennai' } as any, u1))).toEqual(['disc-b-co']);
      expect(slugs(await discover.search({ hasEmail: true } as any, u1))).toEqual(['disc-a-co']);
      expect(slugs(await discover.search({ hasPhone: true } as any, u1))).toEqual(['disc-a-co', 'disc-f-co']);
      expect(slugs(await discover.search({ hasGstin: true } as any, u1))).toEqual(['disc-a-co']);
      expect(slugs(await discover.search({ hasPhone: true, hasEmail: true, state: 'Tamil Nadu' } as any, u1))).toEqual(['disc-a-co']);
      const a = (await discover.search({ q: 'disc-a-co' } as any, u1) as any).items[0];
      expect(a.contactAvailability).toEqual({ hasWebsite: false, hasEmail: true, hasPhone: true, hasGstin: true });
      const f = (await discover.search({ q: 'disc-f-co' } as any, u1) as any).items[0];
      expect(f.contactAvailability).toEqual({ hasWebsite: false, hasEmail: false, hasPhone: true, hasGstin: false });
      expect(slugs(await discover.search({ q: 'disc-a', minOrionScore: 99 } as any, u1))).toEqual([]);
    });

    it('invalid or empty filters are handled consistently', async () => {
      await expect(discover.search({ decisionMakerType: 'BOGUS' } as any, u1)).rejects.toMatchObject({ errorCode: 'INVALID_FILTER', status: 400 });
      expect(slugs(await discover.search({ decisionMakerType: 'FOUNDER_CEO,bogus' } as any, u1))).toEqual(['disc-a-co', 'disc-nc-co']); // unknown extras are ignored as before (disc-nc-co: published founder from an earlier case)
      await expect(people.listCompanyPeople(biz.A.id, u1, { department: 'BOGUS' } as any)).rejects.toMatchObject({ errorCode: 'INVALID_FILTER', status: 400 });
      await expect(people.listCompanyPeople(biz.A.id, u1, { seniority: 'NOPE' } as any)).rejects.toMatchObject({ errorCode: 'INVALID_FILTER' });
      await expect(people.listCompanyPeople(biz.A.id, u1, { verification: 'MAYBE' } as any)).rejects.toMatchObject({ errorCode: 'INVALID_FILTER' });
      await expect(people.listCompanyPeople(biz.A.id, u1, { decisionMakerType: 'X' } as any)).rejects.toMatchObject({ errorCode: 'INVALID_FILTER' });
      const ok: any = await people.listCompanyPeople(biz.A.id, u1, { department: 'EXECUTIVE,BOGUS', seniority: 'EXECUTIVE', decisionMakerType: 'FOUNDER_CEO', decisionMakersOnly: true, hasContact: true, verification: 'UNVERIFIED' } as any);
      expect(ok.people).toHaveLength(1);
      const none: any = await discover.search({ q: 'no-such-company-xyz' } as any, u1);
      expect(none).toMatchObject({ items: [], total: 0, page: 1, totalPages: 1 });
      const beyond: any = await discover.search({ page: 99, limit: 5 } as any, u1);
      expect(beyond).toMatchObject({ items: [], page: 99 });
      expect(beyond.total).toBeGreaterThan(0);
      await expect(people.listCompanyPeople('not-a-company', u1, {} as any)).rejects.toMatchObject({ status: 404 });
      await expect(people.listCompanyPeople(biz.D.id, u1, {} as any)).rejects.toMatchObject({ status: 404 }); // draft company
      expect((await people.listCompanyPeople(biz.A.id, u1, { q: 'zzzz-nobody' } as any) as any).people).toEqual([]);
      // LIKE wildcards are ordinary characters
      expect((await discover.search({ q: '%' } as any, u1) as any).items).toEqual([]);
      expect((await discover.search({ q: '_' } as any, u1) as any).items).toEqual([]);
    });
  });

  describe('deterministic pagination and sorting', () => {
    it('pages are stable, never overlap or skip, and the order is total (ties broken by id)', async () => {
      // two published companies with the SAME name: only the id tiebreak makes the order deterministic
      for (let i = 0; i < 2; i++) {
        const [b] = await db.insert(schema.businesses).values({ slug: `disc-twin-${i}-${L()}`, name: 'Twin Traders', status: 'PUBLISHED', publishedAt: new Date() }).returning();
        await db.insert(schema.businessLocations).values({ businessId: b.id, addressLine1: '1 Street', city: 'Erode', district: 'Erode', state: 'Tamil Nadu', pincode: '638001', isPrimary: true });
      }
      const full: any = await discover.search({ limit: 100 } as any, u1);
      const ids = full.items.map((i: any) => i.id);
      expect(new Set(ids).size).toBe(ids.length);
      const names = full.items.map((i: any) => i.name);
      expect([...names].sort((a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(names.length ? names : []);
      const twins = full.items.filter((i: any) => i.name === 'Twin Traders').map((i: any) => i.id);
      expect(twins).toEqual([...twins].sort());
      const again: any = await discover.search({ limit: 100 } as any, u1);
      expect(again.items.map((i: any) => i.id)).toEqual(ids);
      const seen: string[] = [];
      for (let page = 1; page <= Math.ceil(full.total / 2) + 1; page++) {
        const r: any = await discover.search({ limit: 2, page } as any, u1);
        expect(r.total).toBe(full.total);
        seen.push(...r.items.map((i: any) => i.id));
      }
      expect(seen).toEqual(ids);
      const desc: any = await discover.search({ limit: 100, sortBy: 'name:desc' } as any, u1);
      expect(desc.items.map((i: any) => i.name)).toEqual([...names].reverse().map((_: string, i: number, arr: string[]) => arr[i]).sort((a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0)));
      const bogus: any = await discover.search({ limit: 100, sortBy: 'drop table' } as any, u1);
      expect(bogus.items.map((i: any) => i.id)).toEqual(ids); // an unsupported sort falls back to the default order
    });

    it('company people lists are totally ordered and paginate without overlap', async () => {
      const c = await seedBusiness(db, 'disc-many-co', { city: 'Ooty' });
      for (let i = 0; i < 5; i++) await write.upsertPersonForBusiness({ businessId: c.id, person: { fullName: 'Same Name' }, role: { jobTitle: `Head of Sales ${'x'.repeat(i)}` }, dataStatus: 'PUBLISHED' } as any).catch(() => undefined);
      for (let i = 0; i < 4; i++) await dm(c, 'Sales Manager');
      const full: any = await people.listCompanyPeople(c.id, u1, { limit: 100 } as any);
      const ids = full.people.map((p: any) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
      const again: any = await people.listCompanyPeople(c.id, u1, { limit: 100 } as any);
      expect(again.people.map((p: any) => p.id)).toEqual(ids);
      const paged: string[] = [];
      for (let page = 1; page <= Math.ceil(full.pagination.totalItems / 2); page++) paged.push(...(await people.listCompanyPeople(c.id, u1, { limit: 2, page } as any) as any).people.map((p: any) => p.id));
      expect(paged).toEqual(ids);
    });
  });

  describe('suggestions, related companies, details', () => {
    it('suggestions and related lists never reveal unpublished companies', async () => {
      const s: any = await discover.getSuggestions('Coimbatore');
      expect(s.locations.map((l: any) => l.text)).toEqual(['Coimbatore, Tamil Nadu']);
      const draftOnly = await seedBusiness(db, 'disc-draftcity-co', { status: 'DRAFT', city: 'Secretville', state: 'Goa' });
      expect(draftOnly.id).toBeTruthy();
      expect(((await discover.getSuggestions('Secretville')) as any).locations).toEqual([]);
      expect(((await discover.getSuggestions('disc-d')) as any).businesses).toEqual([]);
      expect(((await discover.getSuggestions('%')) as any).businesses).toEqual([]);
      expect(await discover.getRelatedBusinesses(biz.D.id)).toEqual([]); // a hidden company has no related list
      expect(await discover.getRelatedBusinesses('disc-d-hidden')).toEqual([]);
      expect(await discover.getRelatedBusinesses('no-such')).toEqual([]);
      const rel: any[] = await discover.getRelatedBusinesses(biz.A.id, 50);
      expect(rel.every((r) => r.slug !== 'disc-d-hidden')).toBe(true);
    });

    it('business detail: hidden companies are 404 for customers; nested records carry no internal ids; contacts stay masked until THIS customer unlocked', async () => {
      await expect(discover.getBusinessBySlug('disc-d-hidden', u1)).rejects.toMatchObject({ status: 404 });
      await expect(discover.getBusinessBySlug(biz.D.id)).rejects.toMatchObject({ status: 404 });
      const locked: any = await discover.getBusinessBySlug('disc-a-co', u2);
      expect(locked.isUnlocked).toBe(false);
      expect(locked.contacts[0]).toMatchObject({ isLocked: true });
      expect(JSON.stringify(locked)).not.toMatch(/asha\.kumar@disc-co|9876543210|33ABCDE1234F1Z5/);
      expect(locked.contacts[0].email).toMatch(/\*\*\*/);
      const open: any = await discover.getBusinessBySlug('disc-a-co', u1);
      expect(open.isUnlocked).toBe(true);
      expect(open.contacts[0]).toMatchObject({ isLocked: false, email: 'asha.kumar@disc-co.co.in' });
      const anon: any = await discover.getBusinessBySlug('disc-a-co');
      expect(anon.isUnlocked).toBe(false);
      for (const d of [locked, open, anon]) {
        for (const list of [d.contacts, d.locations, d.digitalPresence]) for (const x of list) expect(x).not.toHaveProperty('id');
        expect(Object.keys(d).sort()).toEqual(expect.arrayContaining(['id', 'slug', 'name', 'contacts', 'locations', 'identifiers']));
      }
    });
  });

  describe('saved leads', () => {
    it('are private to their owner, deterministic, and never show a company or person that is no longer visible', async () => {
      const p = await dm(biz.A, 'Director');
      const lead1: any = await savedLeads.saveLead(u1, { businessId: biz.A.id, personId: p.personId } as any);
      await savedLeads.saveLead(u1, { businessId: biz.F.id } as any);
      const mine: any = await savedLeads.getSavedLeads(u1, {} as any);
      expect(mine.items.map((i: any) => i.businessId).sort()).toEqual([biz.A.id, biz.F.id].sort());
      expect(mine.items.find((i: any) => i.personId === p.personId).person).toMatchObject({ id: p.personId });
      expect(JSON.stringify(mine)).not.toMatch(/@disc-co|companyPersonId|reviewStatus|evidence|quarantine|suppress/i);
      expect((await savedLeads.getSavedLeads(u2, {} as any) as any).items).toEqual([]); // another customer sees none of it
      const again: any = await savedLeads.getSavedLeads(u1, {} as any);
      expect(again.items.map((i: any) => i.id)).toEqual(mine.items.map((i: any) => i.id));
      await expect(savedLeads.saveLead(u1, { businessId: biz.D.id, personId: p.personId } as any)).rejects.toMatchObject({ status: 404 }); // cannot save a hidden company's person

      // the person becomes hidden: the saved lead stays, the person summary disappears
      await publishing.suppressPerson(p.personId, ctx);
      const afterSupp: any = await savedLeads.getSavedLeads(u1, {} as any);
      expect(afterSupp.items.find((i: any) => i.id === lead1.id).person).toBeNull();
      // the company becomes hidden: no company details at all
      await db.update(schema.businesses).set({ status: 'DRAFT' }).where(eq(schema.businesses.id, biz.F.id));
      const afterDraft: any = await savedLeads.getSavedLeads(u1, {} as any);
      expect(afterDraft.items.find((i: any) => i.businessId === biz.F.id).business).toBeNull();
      await db.update(schema.businesses).set({ status: 'PUBLISHED' }).where(eq(schema.businesses.id, biz.F.id));
    });
  });

  describe('company people (customer contract) consistency', () => {
    it('locked contacts stay hidden; the card carries only contract fields; hidden roles never appear in list, facets or summary', async () => {
      const r: any = await people.listCompanyPeople(biz.A.id, u2, { status: 'all' } as any);
      expect(r.people.length).toBeGreaterThan(0);
      for (const p of r.people) {
        expect(p.contacts.isUnlocked).toBe(false);
        expect(p.contacts.email.value).toBeNull();
        expect(Object.keys(p).sort()).toEqual(['additionalRoles', 'businessId', 'contacts', 'decisionMaker', 'department', 'endDate', 'evidence', 'fullName', 'id', 'isCurrent', 'isSaved', 'jobTitle', 'location', 'relevance', 'seniority', 'startDate', 'unlockCostCredits', 'verification']);
      }
      const rb: any = await people.listCompanyPeople(biz.B.id, u1, { status: 'all' } as any);
      expect(rb.people).toEqual([]); // rejected role
      expect(rb.summary).toEqual({ total: 0, decisionMakers: 0, verified: 0, withContact: 0 });
      expect(rb.facets.decisionMakerTypes).toEqual([]);
      const rc: any = await people.listCompanyPeople(biz.C.id, u1, { status: 'all' } as any);
      expect(rc.people).toEqual([]); // suppressed
      expect(rc.pagination.totalItems).toBe(0);
      const re: any = await people.listCompanyPeople(biz.E.id, u1, { status: 'all' } as any);
      expect(re.people).toEqual([]); // pending
    });

    it('no discovery response contains internal keys', async () => {
      const bodies = [await discover.search({ limit: 100 } as any, u1), await discover.search({ hasDecisionMaker: true } as any, u1), await discover.getBusinessBySlug('disc-a-co', u1), await discover.getSuggestions('disc'), await discover.getRelatedBusinesses(biz.A.id), await savedLeads.getSavedLeads(u1, {} as any)];
      for (const b of bodies) walk(b, (k) => { if (k !== null) expect(k).not.toMatch(FORBIDDEN_KEY); });
    });
  });

  describe('structure', () => {
    it('every People read path uses the one visibility rule', () => {
      const dir = path.resolve(__dirname, '../..');
      expect(fs.readFileSync(path.join(dir, 'people/people-search.service.ts'), 'utf8')).toMatch(/cp\.review_status = 'APPROVED'/);
      expect(fs.readFileSync(path.join(dir, 'people/people.service.ts'), 'utf8').match(/CUSTOMER_VISIBLE_ROLE\(\)/g)?.length).toBeGreaterThanOrEqual(2);
      expect(fs.readFileSync(path.join(dir, 'saved-leads/saved-leads.service.ts'), 'utf8').match(/reviewStatus, 'APPROVED'/g)?.length).toBe(2);
      const svc = fs.readFileSync(path.join(dir, 'discover/discover.service.ts'), 'utf8');
      expect(svc).toMatch(/orderBy: fallbackOrder/);
      expect(svc).not.toMatch(/ilike\([^)]*`%\$\{(query\.q|query)\.trim\(\)\}%`/);
      void sql;
    });
  });
});

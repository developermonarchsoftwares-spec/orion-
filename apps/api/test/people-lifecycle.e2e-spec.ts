import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import * as fs from 'fs';
import * as path from 'path';
import { INestApplication } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import * as schema from '../src/database/schema';
import { Readable } from 'stream';
import { TestAppHelper } from './helpers/test-app.helper';
import { PeopleImportJobService } from '../src/modules/people/ingestion/people-import-job.service';
import { suppressionDigest } from '../src/modules/people/suppression/people-suppression';

/**
 * Phase 10: the whole People lifecycle on the REAL application wiring (AppModule, global guards, interceptors) over HTTP, on the
 * hermetic in-process database:
 *
 *   Pipeline ZIP -> admin bundle import -> DRAFT / PENDING / UNVERIFIED -> review -> verify -> publish -> customer
 *
 * The ZIP is a real Phase 9B export produced by the People Pipeline from its own (synthetic) published-people view
 * (fixtures/pipeline-split-bundle.zip: 12 relationships, 11 people, 6 companies; one person holds roles at two companies).
 * After every action the database is read back: the UI or the response is never taken as proof of state.
 */
const API = '/api/v1';
const REVIEW = `${API}/internal/people-review`;
const VERIFY = `${API}/internal/people-verification`;
const ADMIN = 'p10.admin@monarchsoftwares.com';
const MANAGER = 'p10.manager@test.dev';
const CUST_A = 'p10.customer.a@test.dev';
const CUST_B = 'p10.customer.b@test.dev';
const REGISTRY = { sourceType: 'GOVERNMENT_REGISTRY', evidenceType: 'REGISTRY_FILING', sourceReference: 'MCA filing SRN-778' };
const WEBSITE = { sourceType: 'WEB_SCRAPING', evidenceType: 'COMPANY_WEBSITE', sourceReference: 'company website team page' };
const PROFILE = { sourceType: 'WEB_SCRAPING', evidenceType: 'PROFESSIONAL_PROFILE', sourceUrl: 'https://www.linkedin.com/in/p10-profile' };

const COMPANIES = [
  { key: 'meridian', name: 'Meridian Textiles Private Limited', city: 'Pune', state: 'Maharashtra', gstin: '27AAACT2727Q1ZW' },
  { key: 'kaveri', name: 'Kaveri Auto Components Private Limited', city: 'Chennai', state: 'Tamil Nadu', cin: 'U34300TN2005PTC056789' },
  { key: 'himalayan', name: 'Himalayan Foods Private Limited', city: 'Dehradun', state: 'Uttarakhand', pan: 'AAACH5678K' },
  { key: 'sagar', name: 'Sagar Logistics Private Limited', city: 'Kochi', state: 'Kerala' },
  { key: 'orchid', name: 'Orchid Pharma Works Private Limited', city: 'Hyderabad', state: 'Telangana' },
  { key: 'lotus', name: 'Lotus Steel Private Limited', city: 'Jaipur', state: 'Rajasthan' },
];

describe('People lifecycle: import -> review -> verify -> publish -> customer (full application)', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  let db: any;
  let adminToken = '';
  let managerToken = '';
  let tokenA = '';
  let tokenB = '';
  const slug: Record<string, string> = {};
  const biz: Record<string, string> = {};
  const obs: Record<string, unknown> = {}; // what was actually observed, written for the audit report when P10_OBS is set

  const data = (res: any) => res.body.data ?? res.body;
  const http = () => request(app.getHttpServer());
  const as = (r: any, token: string | null) => (token ? r.set('Authorization', `Bearer ${token}`) : r);
  const GET = (url: string, token: string | null = adminToken) => as(http().get(url), token);
  const POST = (url: string, token: string | null = adminToken, body: object = {}) => as(http().post(url), token).send(body);
  const PATCH = (url: string, token: string | null = adminToken, body: object = {}) => as(http().patch(url), token).send(body);
  const count = async (t: any) => (await db.select({ n: sql<number>`count(*)::int` }).from(t))[0].n as number;

  const personRow = async (name: string) => (await db.select().from(schema.people).where(eq(schema.people.normalizedName, name.toLowerCase())))[0];
  const roleRows = async (name: string) => db.select().from(schema.companyPeople).where(eq(schema.companyPeople.personId, (await personRow(name)).id));
  const roleAt = async (name: string, company: string) => (await roleRows(name)).find((r: any) => r.businessId === biz[company]);
  const roleNow = async (id: string) => (await db.select().from(schema.companyPeople).where(eq(schema.companyPeople.id, id)))[0];
  const contactsOf = async (name: string) => db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, (await personRow(name)).id));
  const contactOf = async (name: string, type: string, value?: string) => (await contactsOf(name)).find((c: any) => c.contactType === type && (!value || c.normalizedValue === value));
  const audits = async (entityId: string, action?: string) => (await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, entityId))).filter((a: any) => !action || a.action === action);

  /** What a customer sees at a company, as the API serves it. */
  const companyView = async (token: string, company: string, extra = '') => data(await GET(`${API}/companies/${slug[company]}/people?status=all${extra}`, token).expect(200));
  const cardOf = async (token: string, company: string, name: string) => (await companyView(token, company)).people.find((p: any) => p.fullName === name);
  const customerPeopleCount = async (token: string) => {
    let total = 0;
    for (const c of COMPANIES) total += (await companyView(token, c.key)).people.length;
    return total;
  };

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();
    db = testApp.db;
    // the private object store is a remote service in production: the import job stages its files in memory here
    const staged = new Map<string, Buffer>();
    (testApp.module.get(PeopleImportJobService, { strict: false }) as any).storage = {
      uploadFile: async (o: { key: string; buffer: Buffer }) => (staged.set(o.key, o.buffer), { key: o.key }),
      getFileStream: async (k: string) => Readable.from([staged.get(k)!]),
      deleteFile: async (k: string) => staged.delete(k),
    };
    await testApp.cleanupUsers([ADMIN, MANAGER, CUST_A, CUST_B]);
    await testApp.provisionAdmin(ADMIN, 'ADMIN');
    await http().post(`${API}/admin/auth/send-otp`).send({ email: ADMIN });
    adminToken = data(await http().post(`${API}/admin/auth/verify-otp`).send({ email: ADMIN, otp: '123456' })).adminToken;
    // a DATA_MANAGER has no admin-console login (that is ADMIN / SUPER_ADMIN only): it holds an ordinary account whose role is DATA_MANAGER
    await http().post(`${API}/auth/register`).send({ email: MANAGER, password: 'Password123!', firstName: 'Data', lastName: 'Manager' });
    await db.update(schema.users).set({ role: 'DATA_MANAGER' as any }).where(eq(schema.users.email, MANAGER));
    managerToken = data(await http().post(`${API}/auth/login`).send({ email: MANAGER, password: 'Password123!' })).tokens.accessToken;
    for (const [email, set] of [[CUST_A, (t: string) => (tokenA = t)], [CUST_B, (t: string) => (tokenB = t)]] as const) {
      const reg = await http().post(`${API}/auth/register`).send({ email, password: 'Password123!', firstName: 'Plain', lastName: 'Customer' });
      set(data(reg).tokens.accessToken);
    }
    for (const c of COMPANIES) {
      const [b] = await db.insert(schema.businesses).values({ slug: `p10-${c.key}`, name: c.name, status: 'PUBLISHED', publishedAt: new Date() }).returning();
      await db.insert(schema.businessLocations).values({ businessId: b.id, addressLine1: '1 Test Street', city: c.city, district: c.city, state: c.state, pincode: '400001', isPrimary: true });
      for (const [type, v] of [['GSTIN', (c as any).gstin], ['CIN', (c as any).cin], ['PAN', (c as any).pan]] as const) {
        if (v) await db.insert(schema.businessIdentifiers).values({ businessId: b.id, type, value: v, normalizedValue: v });
      }
      slug[c.key] = `p10-${c.key}`;
      biz[c.key] = b.id;
    }
  }, 120_000);

  afterAll(async () => {
    if (process.env.P10_OBS) fs.writeFileSync(process.env.P10_OBS, JSON.stringify(obs, null, 1));
    await testApp.cleanupUsers([ADMIN, MANAGER, CUST_A, CUST_B]);
    await testApp.close();
  });

  // ================================================================================================ 1. import
  describe('1. a real Pipeline ZIP is imported through the admin bundle endpoint', () => {
    it('imports every part, creating DRAFT people and PENDING / unverified / unpublished roles', async () => {
      const zip = fs.readFileSync(path.resolve(__dirname, 'fixtures/pipeline-split-bundle.zip'));
      const accepted = await POST(`${API}/admin/people/import/bundle`, adminToken, { content: zip.toString('base64') });
      expect(accepted.status).toBe(202);
      let view: any;
      for (let i = 0; i < 600; i++) {
        view = data(await GET(`${API}/admin/people/import/bundle/${data(accepted).bundleImportId}`));
        if (!['QUEUED', 'RUNNING'].includes(view.status)) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(view).toMatchObject({ status: 'COMPLETED', partCount: 4, completedParts: 4 });
      expect(view.reconciliation).toMatchObject({ balanced: true, orion: { imported: 11, updated: 1, quarantined: 0, rejected: 0 } });
      obs.import = view.reconciliation.orion;
    });

    it('everything imported starts DRAFT / PENDING / UNVERIFIED / unpublished (person, role, contacts)', async () => {
      const people = await db.select().from(schema.people);
      const roles = await db.select().from(schema.companyPeople);
      const contacts = await db.select().from(schema.personContacts);
      expect(people).toHaveLength(11);
      expect(roles).toHaveLength(12);
      expect(people.every((p: any) => p.dataStatus === 'DRAFT')).toBe(true);
      expect(roles.every((r: any) => r.reviewStatus === 'PENDING' && r.isPublished === false && r.verificationStatus === 'UNVERIFIED')).toBe(true);
      expect(contacts.length).toBeGreaterThan(0);
      expect(contacts.every((c: any) => c.isPublished === false && c.verificationStatus === 'UNVERIFIED')).toBe(true);
      expect(await count(schema.peopleVerifications)).toBe(0); // the ledger holds only decisions; an import records none
      obs.initial = { people: people.length, roles: roles.length, contacts: contacts.length, evidence: await count(schema.peopleEvidence), observations: await count(schema.peopleObservations) };
    });

    it('every role has evidence, and each import record left an observation keyed by the Pipeline relationship id', async () => {
      const roles = await db.select().from(schema.companyPeople);
      for (const r of roles) {
        const ev = await db.select().from(schema.peopleEvidence).where(eq(schema.peopleEvidence.companyPersonId, r.id));
        expect(ev.length).toBeGreaterThan(0);
      }
      const observations = await db.select().from(schema.peopleObservations);
      expect(observations).toHaveLength(12);
      expect(observations.every((o: any) => o.sourceKey === 'people-json' && /^people-export-v1-[0-9a-f]{24}$/.test(o.batchRef) && o.outcome === 'INGESTED')).toBe(true);
    });
  });

  // ================================================================================================ 2. nothing customer-visible
  describe('2. before review, no customer surface exposes anything', () => {
    it('company lists, person detail, unlock, unlocked list, export and discover see nothing', async () => {
      expect(await customerPeopleCount(tokenA)).toBe(0);
      for (const p of await db.select().from(schema.people)) {
        expect((await GET(`${API}/people/${p.id}`, tokenA)).status).toBe(404);
        expect((await POST(`${API}/people/${p.id}/unlock`, tokenA)).status).toBe(404);
      }
      expect(data(await GET(`${API}/people/unlocked`, tokenA).expect(200)).unlocked).toEqual([]);
      const ids = (await db.select().from(schema.people)).map((p: any) => p.id);
      const exp = await POST(`${API}/people/export`, tokenA, { personIds: ids });
      expect(exp.status).toBe(200);
      expect(exp.text.trim().split(/\r?\n/)).toHaveLength(1); // header only
      for (const q of ['hasDecisionMaker=true', 'hasDecisionMakerContact=true', 'hasVerifiedDecisionMaker=true', 'decisionMakerType=FOUNDER_CEO']) {
        const res = await http().get(`${API}/discover/search?${q}`); // the discover search is public
        expect(res.status).toBe(200);
        const names = JSON.stringify(res.body);
        for (const c of COMPANIES) expect(names).not.toContain(c.name);
      }
    });

    it('anonymous callers are refused on every People route', async () => {
      const someId = '00000000-0000-4000-8000-000000000001';
      for (const [m, u] of [['get', `${API}/companies/${slug.meridian}/people`], ['get', `${API}/people/${someId}`], ['post', `${API}/people/${someId}/unlock`], ['get', `${API}/people/unlocked`], ['post', `${API}/people/export`]] as const) {
        expect((await (http() as any)[m](u).send({})).status).toBe(401);
      }
    });

    it('the admin review queue sees all 12 PENDING roles; evidence and contacts are in the dossier', async () => {
      const queue = await GET(`${REVIEW}/queue?limit=100`);
      expect(queue.status).toBe(200);
      expect(data(queue)).toHaveLength(12);
      const anil = await roleAt('Anil Deshmukh', 'meridian');
      const d = data(await GET(`${REVIEW}/roles/${anil.id}`).expect(200));
      expect(d.readiness).toEqual({ canApprove: true, blockers: [] });
      expect(d.evidence.length).toBeGreaterThan(0);
      expect(d.contacts.map((c: any) => c.type).sort()).toEqual(['MOBILE', 'PHONE', 'WORK_EMAIL']);
      expect(d.contacts.every((c: any) => c.isPublished === false && c.value)).toBe(true); // reviewers see values; nothing is published
      expect(d.person.linkedinUrl).toContain('linkedin.com/in/anil-deshmukh');
      expect(d.role).toMatchObject({ reviewStatus: 'PENDING', isPublished: false });
      expect(d.quality).toMatchObject({ storedVerificationStatus: 'UNVERIFIED', effectiveVerificationStatus: 'UNVERIFIED' });
      obs.dossier = { evidence: d.evidence.map((e: any) => ({ scope: e.scope, sourceType: e.sourceType, evidenceType: e.evidenceType, sourceReference: e.sourceReference, status: e.status })), source: d.source ?? null, keys: Object.keys(d) };
    });
  });

  // ================================================================================================ 3. review queue
  describe('3. the review queue: filtering, search, pagination, stats', () => {
    it('filters, search and pagination return exactly what the database holds', async () => {
      const total = async (qs: string) => (data(await GET(`${REVIEW}/queue?${qs}`).expect(200)) as any[]).length;
      expect(await total('limit=100')).toBe(12);
      expect(await total('company=Meridian&limit=100')).toBe(4);
      expect(await total('q=Rohan&limit=100')).toBe(2);
      expect(await total('q=Procurement&limit=100')).toBe(1);
      expect(await total(`businessId=${biz.kaveri}&limit=100`)).toBe(2);
      expect(await total('verification=VERIFIED&limit=100')).toBe(0);
      expect(await total('verification=UNVERIFIED&limit=100')).toBe(12);
      expect(await total('hasEvidence=true&limit=100')).toBe(12);
      expect(await total('status=APPROVED&limit=100')).toBe(0);
      expect(await total('status=ALL&limit=100')).toBe(12);
      expect(await total('decisionMakerType=FOUNDER_CEO&limit=100')).toBe(await db.select().from(schema.companyPeople).where(eq(schema.companyPeople.decisionMakerType, 'FOUNDER_CEO')).then((r: any[]) => r.length));
      const p1 = data(await GET(`${REVIEW}/queue?limit=5&page=1&sort=created_asc`).expect(200)) as any[];
      const p2 = data(await GET(`${REVIEW}/queue?limit=5&page=2&sort=created_asc`).expect(200)) as any[];
      const p3 = data(await GET(`${REVIEW}/queue?limit=5&page=3&sort=created_asc`).expect(200)) as any[];
      expect([p1.length, p2.length, p3.length]).toEqual([5, 5, 2]);
      expect(new Set([...p1, ...p2, ...p3].map((r) => r.id)).size).toBe(12); // no duplicate, no gap across pages
      expect((await GET(`${REVIEW}/queue?limit=0`)).status).toBe(400);
      expect((await GET(`${REVIEW}/queue?limit=101`)).status).toBe(400);
      expect((await GET(`${REVIEW}/queue?page=0`)).status).toBe(400);
      expect((await GET(`${REVIEW}/queue?status=BOGUS`)).status).toBe(400);
      expect((await GET(`${REVIEW}/queue?businessId=not-a-uuid`)).status).toBe(400);
      expect((await GET(`${REVIEW}/queue?q=${encodeURIComponent("'; DROP TABLE people; --")}`)).status).toBe(200);
      expect(await count(schema.people)).toBe(11);
    });

    it('stats and triage agree with the database', async () => {
      const stats = data(await GET(`${REVIEW}/stats`).expect(200));
      expect(JSON.stringify(stats)).toMatch(/PENDING/);
      expect((await GET(`${REVIEW}/triage`)).status).toBe(200);
    });
  });

  // ================================================================================================ 4. review actions, state machine
  describe('4. review actions and the state machine (every step read back from the database)', () => {
    it('approve = publish ONE role: reviewStatus APPROVED, isPublished, person PUBLISHED, audited; contacts stay unpublished', async () => {
      const anil = await roleAt('Anil Deshmukh', 'meridian');
      const res = await POST(`${REVIEW}/roles/${anil.id}/approve`, adminToken, { reason: 'checked against the filing' });
      expect(res.status).toBe(200);
      const after = await roleNow(anil.id);
      expect(after).toMatchObject({ reviewStatus: 'APPROVED', isPublished: true, verificationStatus: 'UNVERIFIED' });
      expect(after.reviewedAt).not.toBeNull();
      expect((await personRow('Anil Deshmukh')).dataStatus).toBe('PUBLISHED');
      expect((await contactsOf('Anil Deshmukh')).every((c: any) => c.isPublished === false)).toBe(true);
      const a = await audits(anil.id, 'PEOPLE_ROLE_PUBLISHED');
      expect(a).toHaveLength(1);
      expect(a[0].oldValues).toMatchObject({ reviewStatus: 'PENDING', isPublished: false });
      expect(a[0].newValues).toMatchObject({ reviewStatus: 'APPROVED', isPublished: true, reviewedBy: ADMIN });
      expect((await companyView(tokenA, 'meridian')).people.map((p: any) => p.fullName)).toEqual(['Anil Deshmukh']);
    });

    it('a published role is customer-visible as UNVERIFIED (approval is not verification) and nobody else is', async () => {
      const card = await cardOf(tokenA, 'meridian', 'Anil Deshmukh');
      expect(card.verification).toMatchObject({ status: 'UNVERIFIED', assertion: 'UNVERIFIED' });
      expect(card.decisionMaker.assertion).toBe('UNVERIFIED');
      expect(await customerPeopleCount(tokenA)).toBe(1);
      expect((await GET(`${API}/people/${(await personRow('Sunita Kulkarni')).id}`, tokenA)).status).toBe(404);
    });

    it('re-approving an approved role is accepted as a no-op re-confirmation (a second audit row, state unchanged)', async () => {
      const anil = await roleAt('Anil Deshmukh', 'meridian');
      const res = await POST(`${REVIEW}/roles/${anil.id}/approve`, adminToken, { reason: 'again' });
      obs.reapprove = res.status;
      expect(res.status).toBe(200);
      expect(await roleNow(anil.id)).toMatchObject({ reviewStatus: 'APPROVED', isPublished: true });
      expect((await audits(anil.id, 'PEOPLE_ROLE_PUBLISHED')).length).toBe(2);
    });

    it('reject takes a published role offline at once; approving a rejected role is refused until it is reopened; reopen returns it to PENDING', async () => {
      const anil = await roleAt('Anil Deshmukh', 'meridian');
      expect((await POST(`${REVIEW}/roles/${anil.id}/reject`, adminToken, {})).status).toBe(400); // a reason is required
      expect((await POST(`${REVIEW}/roles/${anil.id}/reject`, adminToken, { reason: 'wrong company' })).status).toBe(200);
      expect(await roleNow(anil.id)).toMatchObject({ reviewStatus: 'REJECTED', isPublished: false });
      expect(await customerPeopleCount(tokenA)).toBe(0);
      expect((await GET(`${API}/people/${(await personRow('Anil Deshmukh')).id}`, tokenA)).status).toBe(404);
      const refused = await POST(`${REVIEW}/roles/${anil.id}/approve`, adminToken, { reason: 'try' });
      expect([refused.status, refused.body.errorCode]).toEqual([409, 'REVIEW_STATE_INVALID']);
      expect((await POST(`${REVIEW}/roles/${anil.id}/reopen`, adminToken, { reason: 'second look' })).status).toBe(200);
      expect(await roleNow(anil.id)).toMatchObject({ reviewStatus: 'PENDING', isPublished: false });
      expect((await POST(`${REVIEW}/roles/${anil.id}/reopen`, adminToken, { reason: 'again' })).status).toBe(409); // only rejected / quarantined roles reopen
    });

    it('quarantine hides the role and adds it to the quarantine queue; approve is refused; reopen closes the quarantine item', async () => {
      const anil = await roleAt('Anil Deshmukh', 'meridian');
      expect((await POST(`${REVIEW}/roles/${anil.id}/quarantine`, adminToken, { reason: 'title needs a fix' })).status).toBe(200);
      expect(await roleNow(anil.id)).toMatchObject({ reviewStatus: 'QUARANTINED', isPublished: false });
      const items = data(await GET(`${REVIEW}/quarantine?batchRef=review`).expect(200)) as any[];
      expect(items.some((i) => i.status === 'PENDING')).toBe(true);
      expect((await POST(`${REVIEW}/roles/${anil.id}/approve`, adminToken, { reason: 'try' })).status).toBe(409);
      expect((await POST(`${REVIEW}/roles/${anil.id}/reopen`, adminToken, { reason: 'fixed' })).status).toBe(200);
      const closed = (await db.select().from(schema.peopleIngestionQuarantine)).filter((q: any) => q.raw?.companyPersonId === anil.id);
      expect(closed.every((q: any) => q.status === 'RESOLVED')).toBe(true);
    });

    it('unpublish returns a published role to PENDING (it must be reviewed again); it needs a reason', async () => {
      const anil = await roleAt('Anil Deshmukh', 'meridian');
      await POST(`${REVIEW}/roles/${anil.id}/approve`, adminToken, { reason: 'ok' }).expect(200);
      expect((await POST(`${REVIEW}/roles/${anil.id}/unpublish`, adminToken, {})).status).toBe(400);
      expect((await POST(`${REVIEW}/roles/${anil.id}/unpublish`, adminToken, { reason: 'pulled for a check' })).status).toBe(200);
      expect(await roleNow(anil.id)).toMatchObject({ reviewStatus: 'PENDING', isPublished: false });
      expect(await customerPeopleCount(tokenA)).toBe(0);
    });

    it('unpublish is only the way down from APPROVED + published: a PENDING role is refused, state and audit unchanged', async () => {
      const sunita = await roleAt('Sunita Kulkarni', 'meridian');
      const before = (await audits(sunita.id, 'PEOPLE_ROLE_UNPUBLISHED')).length;
      const r = await POST(`${REVIEW}/roles/${sunita.id}/unpublish`, adminToken, { reason: 'was never live' });
      expect([r.status, r.body.errorCode]).toEqual([409, 'REVIEW_STATE_INVALID']);
      expect(await roleNow(sunita.id)).toMatchObject({ reviewStatus: 'PENDING', isPublished: false });
      expect((await audits(sunita.id, 'PEOPLE_ROLE_UNPUBLISHED')).length).toBe(before);
    });

    it('a REJECTED role cannot be unpublished (409); reopen is the explicit way back to PENDING', async () => {
      const sunita = await roleAt('Sunita Kulkarni', 'meridian');
      await POST(`${REVIEW}/roles/${sunita.id}/reject`, adminToken, { reason: 'duplicate' }).expect(200);
      const r = await POST(`${REVIEW}/roles/${sunita.id}/unpublish`, adminToken, { reason: 'undo' });
      expect([r.status, r.body.errorCode]).toEqual([409, 'REVIEW_STATE_INVALID']);
      expect(await roleNow(sunita.id)).toMatchObject({ reviewStatus: 'REJECTED', isPublished: false });
      // repeated reject is a no-op with a new audit row
      const prev = (await audits(sunita.id, 'PEOPLE_ROLE_REJECTED')).length;
      await POST(`${REVIEW}/roles/${sunita.id}/reject`, adminToken, { reason: 'duplicate again' }).expect(200);
      expect((await audits(sunita.id, 'PEOPLE_ROLE_REJECTED')).length).toBe(prev + 1);
      await POST(`${REVIEW}/roles/${sunita.id}/reopen`, adminToken, { reason: 'back to the queue' }).expect(200);
      expect(await roleNow(sunita.id)).toMatchObject({ reviewStatus: 'PENDING', isPublished: false });
    });

    it('a QUARANTINED role cannot be unpublished (409); its quarantine item stays PENDING until reopen closes it', async () => {
      const thomas = await roleAt('Thomas Varghese', 'sagar');
      const itemsOf = async () => (await db.select().from(schema.peopleIngestionQuarantine)).filter((q: any) => q.raw?.companyPersonId === thomas.id);
      await POST(`${REVIEW}/roles/${thomas.id}/quarantine`, adminToken, { reason: 'needs a fix' }).expect(200);
      const r = await POST(`${REVIEW}/roles/${thomas.id}/unpublish`, adminToken, { reason: 'undo' });
      expect([r.status, r.body.errorCode]).toEqual([409, 'REVIEW_STATE_INVALID']);
      expect((await roleNow(thomas.id)).reviewStatus).toBe('QUARANTINED');
      expect((await itemsOf()).map((q: any) => q.status)).toEqual(['PENDING']);
      await POST(`${REVIEW}/roles/${thomas.id}/reopen`, adminToken, { reason: 'fixed' }).expect(200);
      expect((await roleNow(thomas.id)).reviewStatus).toBe('PENDING');
      expect((await itemsOf()).every((q: any) => q.status === 'RESOLVED')).toBe(true);
    });

    it('publish without evidence is refused, and a role of an unpublished company can be approved but is not visible until the company is', async () => {
      const prakash = await roleAt('Prakash Joshi', 'meridian');
      const evidence = await db.select().from(schema.peopleEvidence).where(eq(schema.peopleEvidence.companyPersonId, prakash.id));
      await db.delete(schema.peopleEvidence).where(eq(schema.peopleEvidence.companyPersonId, prakash.id));
      const refused = await POST(`${REVIEW}/roles/${prakash.id}/approve`, adminToken, { reason: 'no evidence' });
      expect([refused.status, refused.body.errorCode]).toEqual([409, 'EVIDENCE_REQUIRED']);
      expect((await GET(`${REVIEW}/roles/${prakash.id}`)).body.data.readiness.blockers).toContain('EVIDENCE_REQUIRED');
      await db.insert(schema.peopleEvidence).values(evidence.map(({ id: _id, ...rest }: any) => rest)); // put it back
      expect(await roleNow(prakash.id)).toMatchObject({ reviewStatus: 'PENDING', isPublished: false });

      // company not published
      await db.update(schema.businesses).set({ status: 'DRAFT' }).where(eq(schema.businesses.id, biz.lotus));
      const gopal = await roleAt('Gopal Sharma', 'lotus');
      const approved = await POST(`${REVIEW}/roles/${gopal.id}/approve`, adminToken, { reason: 'ok' });
      obs.approveAtDraftCompany = approved.status;
      expect(approved.status).toBe(200);
      expect((await GET(`${API}/companies/${slug.lotus}/people`, tokenA)).status).toBe(404); // the company itself is not public
      expect((await GET(`${API}/people/${(await personRow('Gopal Sharma')).id}`, tokenA)).status).toBe(404);
      await db.update(schema.businesses).set({ status: 'PUBLISHED' }).where(eq(schema.businesses.id, biz.lotus));
      expect((await companyView(tokenA, 'lotus')).people.map((p: any) => p.fullName)).toEqual(['Gopal Sharma']); // live the moment the company is
      await POST(`${REVIEW}/roles/${gopal.id}/unpublish`, adminToken, { reason: 'test over' }).expect(200);
    });

    it('permissions: a data manager can read the queue and the dossier but cannot approve, reject, verify or publish; a customer can do nothing', async () => {
      const sunita = await roleAt('Sunita Kulkarni', 'meridian');
      obs.managerTokenRole = JSON.parse(Buffer.from(managerToken.split('.')[1], 'base64').toString()).role;
      expect((await GET(`${REVIEW}/queue`, managerToken)).status).toBe(200);
      expect((await GET(`${REVIEW}/roles/${sunita.id}`, managerToken)).status).toBe(200);
      for (const [u, body] of [[`${REVIEW}/roles/${sunita.id}/approve`, { reason: 'x1x' }], [`${REVIEW}/roles/${sunita.id}/reject`, { reason: 'x1x' }], [`${VERIFY}/roles/${sunita.id}/verify`, { claim: 'TITLE', evidence: REGISTRY, note: 'x1x' }], [`${REVIEW}/people/${(await personRow('Sunita Kulkarni')).id}/suppress`, { reason: 'x1x' }]] as const) {
        const mr = await POST(u, managerToken, body);
        (obs.managerAttempts as any) = [...((obs.managerAttempts as any) ?? []), [u.replace(API, ''), mr.status]];
        expect(mr.status).toBe(403);
        expect((await POST(u, tokenA, body)).status).toBe(403);
        expect((await POST(u, null, body)).status).toBe(401);
      }
      expect(await roleNow(sunita.id)).toMatchObject({ reviewStatus: 'PENDING', isPublished: false });
      expect((await GET(`${REVIEW}/queue`, tokenA)).status).toBe(403);
    });
  });

  // ================================================================================================ 5. verification
  describe('5. verification is separate from approval, evidence-backed, and never downgraded by weaker input', () => {
    it('verifying claims changes verification only: never review state, publication or person status', async () => {
      const sunita = await roleAt('Sunita Kulkarni', 'meridian');
      const before = await roleNow(sunita.id);
      const rel = await POST(`${VERIFY}/roles/${sunita.id}/verify`, adminToken, { claim: 'RELATIONSHIP', evidence: REGISTRY, note: 'officer of the company' });
      expect(rel.status).toBe(200);
      expect((await roleNow(sunita.id)).verificationStatus).toBe('PARTIALLY_VERIFIED');
      await POST(`${VERIFY}/roles/${sunita.id}/verify`, adminToken, { claim: 'TITLE', evidence: { ...REGISTRY, sourceReference: 'MCA filing SRN-779' }, note: 'designation on the filing' }).expect(200);
      const after = await roleNow(sunita.id);
      expect(after.verificationStatus).toBe('VERIFIED');
      expect({ reviewStatus: after.reviewStatus, isPublished: after.isPublished }).toEqual({ reviewStatus: before.reviewStatus, isPublished: before.isPublished });
      expect((await personRow('Sunita Kulkarni')).dataStatus).toBe('DRAFT');
      expect(await customerPeopleCount(tokenA)).toBe(0); // verified but not approved: still invisible
      expect((await audits(sunita.id, 'PEOPLE_CLAIM_VERIFIED')).length).toBeGreaterThanOrEqual(2);
      expect(await count(schema.peopleVerifications)).toBeGreaterThanOrEqual(2);
    });

    it('verification rules: a claim needs evidence of an accepted type with a citation; the ingestion evidence cannot verify what it claimed', async () => {
      const sunita = await roleAt('Sunita Kulkarni', 'meridian');
      const refuse = async (body: object, code: string) => {
        const r = await POST(`${VERIFY}/roles/${sunita.id}/verify`, adminToken, body);
        expect([r.status, r.body.errorCode]).toEqual([expect.any(Number), code]);
        expect(r.status).toBeGreaterThanOrEqual(400);
      };
      await refuse({ claim: 'TITLE', note: 'no evidence' }, 'EVIDENCE_REQUIRED');
      await refuse({ claim: 'TITLE', evidence: { sourceType: 'MANUAL_IMPORT', evidenceType: 'DOCUMENT' }, note: 'uncited' }, 'EVIDENCE_UNCITED');
      await refuse({ claim: 'LINKEDIN', evidence: REGISTRY, note: 'wrong type' }, 'EVIDENCE_TYPE_NOT_ACCEPTED');
      const claimEvidence = (await db.select().from(schema.peopleEvidence).where(eq(schema.peopleEvidence.companyPersonId, sunita.id)))[0];
      await refuse({ claim: 'TITLE', evidenceId: claimEvidence.id, note: 'ingestion evidence' }, 'EVIDENCE_TYPE_NOT_ACCEPTED');
    });

    it('weaker evidence cannot replace stronger evidence, and a re-verification cannot lower VERIFIED', async () => {
      const sunita = await roleAt('Sunita Kulkarni', 'meridian');
      const ledgerBefore = await db.select().from(schema.peopleVerifications).where(eq(schema.peopleVerifications.personId, sunita.personId));
      const weaker = await POST(`${VERIFY}/roles/${sunita.id}/verify`, adminToken, { claim: 'TITLE', evidence: WEBSITE, note: 'website says so too' });
      obs.weakerVerify = { status: weaker.status, outcome: data(weaker).outcome ?? weaker.body.errorCode };
      expect((await roleNow(sunita.id)).verificationStatus).toBe('VERIFIED');
      const ledgerAfter = await db.select().from(schema.peopleVerifications).where(eq(schema.peopleVerifications.personId, sunita.personId));
      const titleBefore = ledgerBefore.find((r: any) => r.claimType === 'TITLE');
      const titleAfter = ledgerAfter.find((r: any) => r.claimType === 'TITLE');
      expect(titleAfter.evidenceStrength).toBeGreaterThanOrEqual(titleBefore.evidenceStrength);
      expect(titleAfter.status).toBe('VERIFIED');
    });

    it('a dispute is the only way down: it marks the role CONFLICTED, is audited, and a later verification resolves it', async () => {
      const sunita = await roleAt('Sunita Kulkarni', 'meridian');
      const disputed = await POST(`${VERIFY}/roles/${sunita.id}/dispute`, adminToken, { claim: 'TITLE', note: 'the filing was amended' });
      expect(disputed.status).toBe(200);
      expect((await roleNow(sunita.id)).verificationStatus).toBe('CONFLICTED');
      expect((await audits(sunita.id, 'PEOPLE_CLAIM_DISPUTED')).length).toBe(1);
      const resolved = await POST(`${VERIFY}/roles/${sunita.id}/verify`, adminToken, { claim: 'TITLE', evidence: { ...REGISTRY, sourceReference: 'MCA filing SRN-780 (amended)' }, note: 'amended filing checked' });
      expect(resolved.status).toBe(200);
      expect((await roleNow(sunita.id)).verificationStatus).toBe('VERIFIED');
    });

    it('verifying a rejected role is allowed and does not reopen it (verification and review are independent)', async () => {
      const prakash = await roleAt('Prakash Joshi', 'meridian');
      await POST(`${REVIEW}/roles/${prakash.id}/reject`, adminToken, { reason: 'not a current employee' }).expect(200);
      const v = await POST(`${VERIFY}/roles/${prakash.id}/verify`, adminToken, { claim: 'RELATIONSHIP', evidence: REGISTRY, note: 'filing lists him' });
      obs.verifyAfterReject = v.status;
      expect(v.status).toBe(200);
      expect(await roleNow(prakash.id)).toMatchObject({ reviewStatus: 'REJECTED', isPublished: false, verificationStatus: 'PARTIALLY_VERIFIED' });
      await POST(`${REVIEW}/roles/${prakash.id}/reopen`, adminToken, { reason: 'reconsidered' }).expect(200);
    });
  });

  // ================================================================================================ 6. no downgrade from a weaker import
  describe('6. a stronger existing state is not downgraded by weaker Pipeline data or a weaker review action', () => {
    it('VERIFIED + PUBLISHED + contact published survives a later weaker import of the same people', async () => {
      const sunita = await roleAt('Sunita Kulkarni', 'meridian');
      await POST(`${REVIEW}/roles/${sunita.id}/approve`, adminToken, { reason: 'verified and ok' }).expect(200);
      const email = await contactOf('Sunita Kulkarni', 'WORK_EMAIL');
      const evidence = await db.select().from(schema.peopleEvidence).where(eq(schema.peopleEvidence.contactId, email.id));
      expect(evidence.length).toBeGreaterThan(0);
      await POST(`${REVIEW}/contacts/${email.id}/publish`, adminToken, { reason: 'work email confirmed' }).expect(200);
      const stateBefore = {
        role: await roleNow(sunita.id),
        contacts: (await contactsOf('Sunita Kulkarni')).map((c: any) => [c.contactType, c.isPublished]).sort(),
        evidence: await count(schema.peopleEvidence),
        ledger: await count(schema.peopleVerifications),
      };
      expect(stateBefore.role).toMatchObject({ reviewStatus: 'APPROVED', isPublished: true, verificationStatus: 'VERIFIED' });

      // the same people again, from a LATER export that says UNVERIFIED / LOW
      const { exportRow, toCsv } = await import('../src/modules/people/__tests__/people-export-fixtures');
      const sunitaRow = exportRow({
        company_name: COMPANIES[0].name, company_city: 'Pune', company_state: 'Maharashtra', gstin: COMPANIES[0].gstin, full_name: 'Sunita Kulkarni', job_title: 'Managing Director',
        email: 'sunita.kulkarni@meridiantextiles.example', mobile: '+919822098765', linkedin_url: 'https://www.linkedin.com/in/sunita-kulkarni-md',
        verification_status: 'UNVERIFIED', confidence_level: 'LOW', email_verification_status: 'UNVERIFIED', relationship_id: (await db.select().from(schema.peopleObservations).where(eq(schema.peopleObservations.companyPersonId, sunita.id)))[0].sourceRecordId,
        exported_at: new Date(Date.now() - 3_600_000).toISOString().replace(/\.\d+Z$/, '+00:00'),
      });
      const accepted = await POST(`${API}/admin/people/import`, adminToken, { format: 'csv', content: toCsv([sunitaRow]) });
      expect(accepted.status).toBe(202);
      for (let i = 0; i < 400; i++) {
        const j = data(await GET(`${API}/admin/people/import/${data(accepted).jobId}`));
        if (!['QUEUED', 'RUNNING'].includes(j.status)) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      const after = await roleNow(sunita.id);
      expect(after).toMatchObject({ reviewStatus: 'APPROVED', isPublished: true, verificationStatus: 'VERIFIED' });
      expect((await contactsOf('Sunita Kulkarni')).map((c: any) => [c.contactType, c.isPublished]).sort()).toEqual(stateBefore.contacts);
      expect(await count(schema.peopleEvidence)).toBeGreaterThanOrEqual(stateBefore.evidence);
      expect(await count(schema.peopleVerifications)).toBe(stateBefore.ledger);
      expect((await personRow('Sunita Kulkarni')).dataStatus).toBe('PUBLISHED');
      expect(await count(schema.people)).toBe(11);
      expect(await count(schema.companyPeople)).toBe(12);
    });

    it('a weaker review action is blocked or harmless: no reopen of an approved role, edits reset only what they changed', async () => {
      const sunita = await roleAt('Sunita Kulkarni', 'meridian');
      expect((await POST(`${REVIEW}/roles/${sunita.id}/reopen`, adminToken, { reason: 'try to weaken' })).status).toBe(409);
      expect(await roleNow(sunita.id)).toMatchObject({ reviewStatus: 'APPROVED', isPublished: true, verificationStatus: 'VERIFIED' });
      // an edit with a reason is audited; a changed title changes what is claimed, so the title claim then needs a new decision
      const edit = await PATCH(`${REVIEW}/roles/${sunita.id}`, adminToken, { jobTitle: 'Joint Managing Director', reason: 'title corrected from the annual report' });
      expect(edit.status).toBe(200);
      expect((await audits(sunita.id, 'PEOPLE_ROLE_EDITED')).length).toBe(1);
      const edited = await roleNow(sunita.id);
      obs.editAfterVerified = { title: edited.jobTitleAtCompany, verification: edited.verificationStatus, review: edited.reviewStatus, published: edited.isPublished };
      expect(edited.jobTitleAtCompany).toBe('Joint Managing Director');
      expect(edited.isPublished).toBe(true);
      // restore for the following tests
      await PATCH(`${REVIEW}/roles/${sunita.id}`, adminToken, { jobTitle: 'Managing Director', reason: 'restoring the original title' }).expect(200);
    });
  });

  // ================================================================================================ 7. multi-company
  describe('7. one person at two companies (Rohan Bhatnagar: Meridian CFO and Kaveri Director)', () => {
    it('is one person with two company relationships, each with its own role', async () => {
      const rohan = await personRow('Rohan Bhatnagar');
      const roles = await roleRows('Rohan Bhatnagar');
      expect(roles).toHaveLength(2);
      expect(new Set(roles.map((r: any) => r.businessId))).toEqual(new Set([biz.meridian, biz.kaveri]));
      expect((await roleAt('Rohan Bhatnagar', 'meridian')).jobTitleAtCompany).toBe('Chief Financial Officer');
      expect((await roleAt('Rohan Bhatnagar', 'kaveri')).jobTitleAtCompany).toBe('Director - Operations');
      expect(await db.select().from(schema.people).where(eq(schema.people.normalizedLinkedinUrl, rohan.normalizedLinkedinUrl))).toHaveLength(1);
      const queue = data(await GET(`${REVIEW}/queue?q=Rohan&limit=50`).expect(200)) as any[];
      expect(queue).toHaveLength(2);
      const detail = data(await GET(`${REVIEW}/roles/${(await roleAt('Rohan Bhatnagar', 'kaveri')).id}`).expect(200));
      expect(detail.otherRoles.map((r: any) => r.companyName)).toEqual([COMPANIES[0].name]); // the dossier shows the other relationship
    });

    it('approving one relationship publishes only that company role; the other stays hidden', async () => {
      const m = await roleAt('Rohan Bhatnagar', 'meridian');
      const k = await roleAt('Rohan Bhatnagar', 'kaveri');
      await POST(`${REVIEW}/roles/${m.id}/approve`, adminToken, { reason: 'ok' }).expect(200);
      expect(await roleNow(m.id)).toMatchObject({ reviewStatus: 'APPROVED', isPublished: true });
      expect(await roleNow(k.id)).toMatchObject({ reviewStatus: 'PENDING', isPublished: false });
      expect((await companyView(tokenA, 'meridian')).people.map((p: any) => p.fullName)).toContain('Rohan Bhatnagar');
      expect((await companyView(tokenA, 'kaveri')).people.map((p: any) => p.fullName)).not.toContain('Rohan Bhatnagar');
      const detail = data(await GET(`${API}/people/${(await personRow('Rohan Bhatnagar')).id}`, tokenA).expect(200));
      expect(detail.roles).toHaveLength(1); // only the published relationship
      expect(detail.roles[0].jobTitle).toBe('Chief Financial Officer');
    });

    it('verifying a role-level claim of one relationship does not touch the other', async () => {
      const m = await roleAt('Rohan Bhatnagar', 'meridian');
      const k = await roleAt('Rohan Bhatnagar', 'kaveri');
      await POST(`${VERIFY}/roles/${m.id}/verify`, adminToken, { claim: 'RELATIONSHIP', evidence: REGISTRY, note: 'listed as CFO' }).expect(200);
      expect((await roleNow(m.id)).verificationStatus).toBe('PARTIALLY_VERIFIED');
      expect(await roleNow(k.id)).toMatchObject({ verificationStatus: 'UNVERIFIED', reviewStatus: 'PENDING', isPublished: false });
      const cardK = (await db.select().from(schema.companyPeople).where(eq(schema.companyPeople.id, k.id)))[0];
      expect(cardK.lastVerifiedAt).toBeNull();
    });

    it('person-level claims (identity, LinkedIn) and contacts are shared by both relationships: documented behaviour', async () => {
      const m = await roleAt('Rohan Bhatnagar', 'meridian');
      const k = await roleAt('Rohan Bhatnagar', 'kaveri');
      const linkedin = await POST(`${VERIFY}/roles/${m.id}/verify`, adminToken, { claim: 'LINKEDIN', evidence: PROFILE, note: 'profile matches' });
      expect(linkedin.status).toBe(200);
      const panelK = data(await GET(`${VERIFY}/roles/${k.id}`).expect(200)).claims as any[];
      const lk = panelK.find((c) => c.claim === 'LINKEDIN');
      obs.sharedLinkedinClaimSeenFromOtherRole = lk?.state;
      expect(lk.state).toBe('VERIFIED'); // the claim belongs to the person, so the other relationship sees it
      expect((await roleNow(k.id)).verificationStatus).toBe('UNVERIFIED'); // but the role itself is untouched
      const contacts = await contactsOf('Rohan Bhatnagar');
      expect(contacts.filter((c: any) => c.contactType === 'WORK_EMAIL').map((c: any) => c.normalizedValue).sort()).toEqual(['rohan.b@kaveriauto.example', 'rohan.bhatnagar@meridiantextiles.example']);
      expect(contacts.filter((c: any) => c.contactType === 'PHONE')).toHaveLength(1);
      expect(contacts.filter((c: any) => c.contactType === 'MOBILE')).toHaveLength(1);
      expect('businessId' in contacts[0]).toBe(false); // contacts belong to the person, not to a company relationship
    });

    it('after both relationships are published, the customer sees the person at both, and each company card shows the work email that company reported', async () => {
      const k = await roleAt('Rohan Bhatnagar', 'kaveri');
      await POST(`${REVIEW}/roles/${k.id}/approve`, adminToken, { reason: 'ok' }).expect(200);
      for (const type of ['rohan.b@kaveriauto.example', 'rohan.bhatnagar@meridiantextiles.example']) {
        const c = await contactOf('Rohan Bhatnagar', 'WORK_EMAIL', type);
        await POST(`${REVIEW}/contacts/${c.id}/publish`, adminToken, { reason: 'confirmed' }).expect(200);
      }
      const pid = (await personRow('Rohan Bhatnagar')).id;
      await POST(`${API}/people/${pid}/unlock`, tokenA).expect(200);
      const atMeridian = (await cardOf(tokenA, 'meridian', 'Rohan Bhatnagar')).contacts.email.value;
      const atKaveri = (await cardOf(tokenA, 'kaveri', 'Rohan Bhatnagar')).contacts.email.value;
      obs.rohanEmailShownAt = { meridian: atMeridian, kaveri: atKaveri };
      expect(atMeridian).toBe('rohan.bhatnagar@meridiantextiles.example'); // Phase 10B: company context decides which email a card shows
      expect(atKaveri).toBe('rohan.b@kaveriauto.example');
      const both = data(await GET(`${API}/people/${pid}`, tokenA).expect(200));
      expect(both.roles.map((r: any) => r.jobTitle).sort()).toEqual(['Chief Financial Officer', 'Director - Operations']);
    });

    it('the attribution the customer cards rely on: each work email is attributed to the role that reported it (observation -> claim -> contact)', async () => {
      const m = await roleAt('Rohan Bhatnagar', 'meridian');
      const k = await roleAt('Rohan Bhatnagar', 'kaveri');
      const rows = await db
        .select({ roleId: schema.peopleObservations.companyPersonId, value: schema.personContacts.normalizedValue })
        .from(schema.peopleObservationClaims)
        .innerJoin(schema.peopleObservations, eq(schema.peopleObservations.id, schema.peopleObservationClaims.observationId))
        .innerJoin(schema.personContacts, eq(schema.personContacts.id, schema.peopleObservationClaims.contactId))
        .where(eq(schema.personContacts.contactType, 'WORK_EMAIL'));
      const mine = rows.filter((r: any) => r.roleId === m.id || r.roleId === k.id);
      const reportedBy = (role: string) => [...new Set(mine.filter((r: any) => r.roleId === role).map((r: any) => r.value))];
      obs.emailReportedByRole = { meridian: reportedBy(m.id), kaveri: reportedBy(k.id) };
      expect(reportedBy(m.id)).toEqual(['rohan.bhatnagar@meridiantextiles.example']);
      expect(reportedBy(k.id)).toEqual(['rohan.b@kaveriauto.example']);
    });

    it('rejecting one relationship leaves the other published', async () => {
      const k = await roleAt('Rohan Bhatnagar', 'kaveri');
      await POST(`${REVIEW}/roles/${k.id}/reject`, adminToken, { reason: 'left the company' }).expect(200);
      expect((await roleAt('Rohan Bhatnagar', 'meridian'))).toMatchObject({ reviewStatus: 'APPROVED', isPublished: true });
      expect((await companyView(tokenA, 'kaveri')).people.map((p: any) => p.fullName)).not.toContain('Rohan Bhatnagar');
      expect((await companyView(tokenA, 'meridian')).people.map((p: any) => p.fullName)).toContain('Rohan Bhatnagar');
    });
  });

  // ================================================================================================ 8. contact visibility
  describe('8. when does each contact field become customer-visible?', () => {
    const fields = (card: any) => ({ email: card.contacts.email, phone: card.contacts.phone, mobile: card.contacts.mobile, linkedin: card.contacts.linkedin });
    const vis = (f: any) => `${f.available ? 'available' : 'absent'}${f.value ? '+value' : ''}${f.verificationStatus ? `:${f.verificationStatus}` : ''}`;

    it('walks Vikram Rawat (email, mobile, LinkedIn; no phone) through every stage and records exactly what a customer sees', async () => {
      const timeline: Record<string, Record<string, string>> = {};
      const snap = async (stage: string, token = tokenA) => {
        const card = await cardOf(token, 'himalayan', 'Vikram Rawat');
        timeline[stage] = card ? Object.fromEntries(Object.entries(fields(card)).map(([k, v]) => [k, vis(v)])) : { all: 'person not visible' };
      };
      const role = await roleAt('Vikram Rawat', 'himalayan');
      const email = await contactOf('Vikram Rawat', 'WORK_EMAIL');
      const mobile = await contactOf('Vikram Rawat', 'MOBILE');
      await snap('1 imported (DRAFT)');
      await POST(`${REVIEW}/roles/${role.id}/approve`, adminToken, { reason: 'ok' }).expect(200);
      await snap('2 role approved, no contact published');
      await POST(`${VERIFY}/roles/${role.id}/verify`, adminToken, { claim: 'EMAIL', contactId: email.id, evidence: { sourceType: 'MANUAL_IMPORT', evidenceType: 'DIRECT_CONFIRMATION', sourceReference: 'call log 2026-10-01' }, note: 'confirmed by phone' }).expect(200);
      expect((await contactOf('Vikram Rawat', 'WORK_EMAIL')).isPublished).toBe(false); // verified is not published
      await snap('3 email VERIFIED but not published');
      await POST(`${REVIEW}/contacts/${email.id}/publish`, adminToken, { reason: 'confirmed' }).expect(200);
      await snap('4 email published (locked)');
      await POST(`${API}/people/${(await personRow('Vikram Rawat')).id}/unlock`, tokenA).expect(200);
      await snap('5 customer A unlocked');
      await snap('5b customer B (did not unlock)', tokenB);
      await POST(`${REVIEW}/contacts/${email.id}/unpublish`, adminToken, { reason: 'bounced' }).expect(200);
      await snap('6 email unpublished again (A has unlocked)');
      obs.contactTimeline = timeline;

      expect(timeline['1 imported (DRAFT)']).toEqual({ all: 'person not visible' });
      expect(timeline['2 role approved, no contact published']).toMatchObject({ email: 'absent', phone: 'absent', mobile: 'absent' });
      expect(timeline['3 email VERIFIED but not published'].email).toBe('absent');
      expect(timeline['4 email published (locked)'].email).toMatch(/^available:/);
      expect(timeline['4 email published (locked)'].email).not.toContain('+value');
      expect(timeline['5 customer A unlocked'].email).toContain('+value');
      expect(timeline['5 customer A unlocked'].mobile).toBe('absent'); // the mobile was never published, unlocking does not reveal it
      expect(timeline['5b customer B (did not unlock)'].email).not.toContain('+value');
      expect(timeline['6 email unpublished again (A has unlocked)'].email).toBe('absent');
      expect(mobile.isPublished).toBe(false);
    });

    it('LinkedIn has no per-field publication gate: it is on the person, shown as available once a role is published, and its value is revealed by an unlock', async () => {
      const card = await cardOf(tokenA, 'himalayan', 'Vikram Rawat');
      obs.linkedinAtRolePublish = card.contacts.linkedin;
      expect(card.contacts.linkedin.available).toBe(true);
      expect(card.contacts.linkedin.value).toContain('linkedin.com/in/vikram-rawat'); // customer A unlocked above
      const locked = await cardOf(tokenB, 'himalayan', 'Vikram Rawat');
      expect(locked.contacts.linkedin).toMatchObject({ available: true, value: null });
    });

    it('no unpublished contact value leaks through any customer surface, even after an unlock', async () => {
      const pid = (await personRow('Vikram Rawat')).id;
      const unpublished = (await contactsOf('Vikram Rawat')).filter((c: any) => !c.isPublished).map((c: any) => c.contactValue);
      expect(unpublished.length).toBeGreaterThan(0);
      const responses = [
        (await GET(`${API}/companies/${slug.himalayan}/people?status=all`, tokenA)).text,
        (await GET(`${API}/people/${pid}`, tokenA)).text,
        (await POST(`${API}/people/${pid}/unlock`, tokenA)).text,
        (await GET(`${API}/people/unlocked`, tokenA)).text,
        (await POST(`${API}/people/export`, tokenA, { personIds: [pid] })).text,
        (await http().get(`${API}/discover/businesses/${slug.himalayan}`).set('Authorization', `Bearer ${tokenA}`)).text,
        (await http().get(`${API}/discover/search?hasDecisionMaker=true`)).text,
        (await http().get(`${API}/discover/search?hasDecisionMaker=true`).set('Authorization', `Bearer ${tokenA}`)).text,
      ];
      for (const text of responses) for (const v of unpublished) expect(text).not.toContain(v);
      const exp = (await POST(`${API}/people/export`, tokenA, { personIds: [pid] })).text;
      expect(exp).toContain('Vikram Rawat');
      expect(exp).not.toContain('vikram.rawat@himalayanfoods.example'); // the email was unpublished above
    });
  });

  // ================================================================================================ 9. evidence
  describe('9. evidence', () => {
    it('is visible to admins with its source details and never to customers (counts only)', async () => {
      const role = await roleAt('Vikram Rawat', 'himalayan');
      const d = data(await GET(`${REVIEW}/roles/${role.id}`).expect(200));
      expect(d.evidence.length).toBeGreaterThan(0);
      expect(d.evidence[0]).toHaveProperty('sourceLabel');
      expect(d.evidence[0]).toHaveProperty('sourceUrl');
      const card = await cardOf(tokenA, 'himalayan', 'Vikram Rawat');
      expect(Object.keys(card.evidence).sort()).toEqual(['count', 'verifiedCount']);
      const evidenceIds = (await db.select().from(schema.peopleEvidence)).map((e: any) => e.id);
      const text = (await GET(`${API}/companies/${slug.himalayan}/people?status=all`, tokenA)).text + (await GET(`${API}/people/${(await personRow('Vikram Rawat')).id}`, tokenA)).text;
      for (const id of evidenceIds) expect(text).not.toContain(id);
      expect(text).not.toMatch(/sourceReference|sourceUrl|reviewedBy|auditTrail|batchRef|people-export-v1/);
    });

    it('a duplicate import adds no evidence; a verification adds the expected evidence row and ledger entry', async () => {
      const before = { evidence: await count(schema.peopleEvidence), ledger: await count(schema.peopleVerifications), audits: await count(schema.auditLogs) };
      const meena = await roleAt('Meena Bisht', 'himalayan');
      const v = await POST(`${VERIFY}/roles/${meena.id}/verify`, adminToken, { claim: 'RELATIONSHIP', evidence: REGISTRY, note: 'registry lists the role' });
      expect(v.status).toBe(200);
      expect(await count(schema.peopleEvidence)).toBe(before.evidence + 1);
      expect(await count(schema.peopleVerifications)).toBe(before.ledger + 1);
      expect(await count(schema.auditLogs)).toBeGreaterThan(before.audits);
      const fingerprints = (await db.select().from(schema.peopleEvidence)).map((e: any) => e.fingerprint).filter(Boolean);
      expect(new Set(fingerprints).size).toBe(fingerprints.length); // the fingerprint is unique: the same evidence cannot be stored twice
      const again = await POST(`${VERIFY}/roles/${meena.id}/verify`, adminToken, { claim: 'RELATIONSHIP', evidence: REGISTRY, note: 'same evidence again' });
      expect(again.status).toBe(200);
      expect(await count(schema.peopleEvidence)).toBe(before.evidence + 1); // the same evidence is reused, not duplicated
      expect(data(again).outcome).toBe('ALREADY_VERIFIED');
    });
  });

  // ================================================================================================ 10. publishing timeline
  describe('10. what the customer sees as roles are published and taken down', () => {
    it('counts: published roles appear at once and disappear at once, with no stale view', async () => {
      const timeline: number[] = [];
      timeline.push(await customerPeopleCount(tokenA));
      const gopal = await roleAt('Gopal Sharma', 'lotus');
      await POST(`${REVIEW}/roles/${gopal.id}/approve`, adminToken, { reason: 'ok' }).expect(200);
      timeline.push(await customerPeopleCount(tokenA));
      await POST(`${REVIEW}/roles/${gopal.id}/unpublish`, adminToken, { reason: 'pulled' }).expect(200);
      timeline.push(await customerPeopleCount(tokenA));
      await POST(`${REVIEW}/roles/${gopal.id}/approve`, adminToken, { reason: 'back' }).expect(200);
      timeline.push(await customerPeopleCount(tokenA));
      const published = (await db.select().from(schema.companyPeople).where(and(eq(schema.companyPeople.isPublished, true), eq(schema.companyPeople.reviewStatus, 'APPROVED')))).length;
      expect(timeline[3]).toBe(published);
      expect(timeline[1]).toBe(timeline[0] + 1);
      expect(timeline[2]).toBe(timeline[0]);
      obs.publishTimeline = timeline;
    });

    it('discover search reflects publication immediately: only companies with a published decision maker', async () => {
      const found = async (qs: string) => {
        const res = await http().get(`${API}/discover/search?${qs}`);
        expect(res.status).toBe(200);
        return COMPANIES.filter((c) => JSON.stringify(res.body).includes(c.name)).map((c) => c.key).sort();
      };
      const withDm = await found('hasDecisionMaker=true&limit=50');
      obs.discoverWithDecisionMaker = withDm;
      expect(withDm).toContain('lotus'); // Gopal Sharma, published above
      expect(withDm).not.toContain('orchid'); // nobody published at Orchid
      await POST(`${REVIEW}/roles/${(await roleAt('Gopal Sharma', 'lotus')).id}/unpublish`, adminToken, { reason: 'pulled' }).expect(200);
      expect(await found('hasDecisionMaker=true&limit=50')).not.toContain('lotus');
    });

    it('the database constraint ties publication to approval: a published role that is not approved cannot exist', async () => {
      const prakash = await roleAt('Prakash Joshi', 'meridian');
      await expect(db.update(schema.companyPeople).set({ isPublished: true }).where(eq(schema.companyPeople.id, prakash.id))).rejects.toThrow();
      expect(await roleNow(prakash.id)).toMatchObject({ reviewStatus: 'PENDING', isPublished: false });
    });
  });

  // ================================================================================================ 11. customer data contract
  describe('11. the customer data contract', () => {
    it('a customer card has exactly the intended fields and no internal identifier, source, evidence row or reviewer data', async () => {
      const card = await cardOf(tokenA, 'himalayan', 'Vikram Rawat');
      expect(Object.keys(card).sort()).toEqual(['additionalRoles', 'businessId', 'contacts', 'decisionMaker', 'department', 'endDate', 'evidence', 'fullName', 'id', 'isCurrent', 'isSaved', 'jobTitle', 'location', 'relevance', 'seniority', 'startDate', 'unlockCostCredits', 'verification']);
      expect(Object.keys(card.contacts).sort()).toEqual(['email', 'isUnlocked', 'linkedin', 'mobile', 'phone']);
      expect(Object.keys(card.contacts.email).sort()).toEqual(['available', 'value', 'verificationStatus']);
      expect(Object.keys(card.verification).sort()).toEqual(['assertion', 'confidence', 'lastVerifiedAt', 'status']);
      const everyId = [
        ...(await db.select().from(schema.companyPeople)).map((r: any) => r.id),
        ...(await db.select().from(schema.personContacts)).map((c: any) => c.id),
        ...(await db.select().from(schema.peopleEvidence)).map((e: any) => e.id),
        ...(await db.select().from(schema.peopleObservations)).map((o: any) => o.id),
        ...(await db.select().from(schema.peopleIngestionQuarantine)).map((q: any) => q.id),
      ];
      const pid = (await personRow('Vikram Rawat')).id;
      const surfaces = [
        (await GET(`${API}/companies/${slug.himalayan}/people?status=all`, tokenA)).text, (await GET(`${API}/people/${pid}`, tokenA)).text,
        (await POST(`${API}/people/${pid}/unlock`, tokenA)).text, (await GET(`${API}/people/unlocked`, tokenA)).text,
      ];
      for (const text of surfaces) {
        for (const id of everyId) expect(text).not.toContain(id); // only the person id and the company id (public ids) appear
        expect(text).not.toMatch(/reviewStatus|reviewNote|reviewedBy|dataStatus|quarantine|batchRef|sourceKey|fingerprint|people-json|PEOPLE_FILE|classificationSource/);
      }
      expect(JSON.stringify(data(await GET(`${API}/people/taxonomy`, tokenA)))).not.toMatch(/Vikram|Anil|@/);
    });
  });

  // ================================================================================================ 12. tenant / account boundaries
  describe('12. account boundaries: one customer never receives another customer\'s unlocks, and ids cannot be guessed', () => {
    it('customer B has none of customer A\'s unlocks, exports or revealed values', async () => {
      const pid = (await personRow('Vikram Rawat')).id;
      expect(data(await GET(`${API}/people/unlocked`, tokenB).expect(200)).unlocked).toEqual([]);
      const exp = await POST(`${API}/people/export`, tokenB, { personIds: [pid] });
      expect(exp.status).toBe(200);
      expect(exp.text.trim().split(/\r?\n/)).toHaveLength(1);
      expect(exp.headers['x-export-row-count']).toBe('0');
      const card = await cardOf(tokenB, 'himalayan', 'Vikram Rawat');
      expect(card.contacts.isUnlocked).toBe(false);
      expect(card.contacts.linkedin.value).toBeNull();
      expect(data(await GET(`${API}/people/unlocked`, tokenA).expect(200)).unlocked.length).toBeGreaterThan(0);
    });

    it('guessed, malformed and unknown ids, odd pagination and hostile search text never reveal or break anything', async () => {
      expect((await GET(`${API}/people/00000000-0000-4000-8000-0000000000aa`, tokenB)).status).toBe(404);
      expect((await GET(`${API}/people/not-a-uuid`, tokenB)).status).toBe(400);
      expect((await POST(`${API}/people/not-a-uuid/unlock`, tokenB)).status).toBe(400);
      expect((await GET(`${API}/companies/${randomSlug()}/people`, tokenB)).status).toBe(404);
      for (const qs of ['page=0', 'page=-1', 'limit=0', 'limit=100000', 'page=abc', 'limit=1e9']) {
        const r = await GET(`${API}/companies/${slug.meridian}/people?${qs}`, tokenB);
        expect([200, 400]).toContain(r.status);
        if (r.status === 200) expect(data(r).people.length).toBeLessThanOrEqual(100);
      }
      for (const q of ["' OR 1=1 --", '%27%3B%20DROP%20TABLE%20people%3B--', '<script>alert(1)</script>', 'a'.repeat(5000)]) {
        const r = await GET(`${API}/companies/${slug.meridian}/people?q=${encodeURIComponent(q)}`, tokenB);
        expect([200, 400]).toContain(r.status);
        expect(r.text).not.toMatch(/stack|SELECT|select |postgres/);
      }
      expect(await count(schema.people)).toBe(11);
      // another customer cannot unlock on A's behalf or read A's wallet effects: B's own balance is untouched by A's unlock
      const b = data(await POST(`${API}/people/${(await personRow('Vikram Rawat')).id}/unlock`, tokenB).expect(200));
      expect(b.alreadyUnlocked).toBe(false);
      expect(b.creditsSpent).toBe(1);
    });

    it('admin endpoints are closed to customers, and the review routes are not reachable anonymously', async () => {
      const someId = '00000000-0000-4000-8000-000000000001';
      for (const u of [`${REVIEW}/queue`, `${REVIEW}/roles/${someId}`, `${REVIEW}/quarantine`, `${REVIEW}/stats`, `${VERIFY}/roles/${someId}`, `${API}/admin/people/import`]) {
        expect((await GET(u, tokenA)).status).toBe(403);
        expect((await GET(u, null)).status).toBe(401);
      }
    });
  });

  // ================================================================================================ 13. suppression closes the lifecycle
  describe('13. suppression takes a person out everywhere and a later import cannot bring them back', () => {
    it('suppress: every role REJECTED, contacts unpublished, customers lose the person, re-import is blocked', async () => {
      const person = await personRow('Vikram Rawat');
      expect((await POST(`${REVIEW}/people/${person.id}/suppress`, adminToken, {})).status).toBe(400);
      expect((await POST(`${REVIEW}/people/${person.id}/suppress`, adminToken, { reason: 'opt-out request' })).status).toBe(200);
      expect((await personRow('Vikram Rawat')).dataStatus).toBe('SUPPRESSED');
      expect((await roleRows('Vikram Rawat')).every((r: any) => r.reviewStatus === 'REJECTED' && r.isPublished === false)).toBe(true);
      expect((await contactsOf('Vikram Rawat')).every((c: any) => c.isPublished === false)).toBe(true);
      expect((await GET(`${API}/people/${person.id}`, tokenA)).status).toBe(404);
      expect((await companyView(tokenA, 'himalayan')).people.map((p: any) => p.fullName)).not.toContain('Vikram Rawat');
      expect(data(await GET(`${API}/people/unlocked`, tokenA)).unlocked.flatMap((u: any) => u.roles.map((r: any) => r.fullName))).not.toContain('Vikram Rawat');
      const approve = await POST(`${REVIEW}/roles/${(await roleAt('Vikram Rawat', 'himalayan')).id}/approve`, adminToken, { reason: 'try' });
      expect(approve.status).toBe(409);
      // the exact same ZIP again is recognised record by record: nothing is reprocessed, so nothing can come back
      const zip = fs.readFileSync(path.resolve(__dirname, 'fixtures/pipeline-split-bundle.zip'));
      const same = await POST(`${API}/admin/people/import/bundle`, adminToken, { content: zip.toString('base64') });
      let view: any;
      for (let i = 0; i < 600; i++) {
        view = data(await GET(`${API}/admin/people/import/bundle/${data(same).bundleImportId}`));
        if (!['QUEUED', 'RUNNING'].includes(view.status)) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(view.reconciliation.orion.imported).toBe(0);
      expect((await personRow('Vikram Rawat')).dataStatus).toBe('SUPPRESSED');
      // a LATER export of the same person is refused by the suppression registry and quarantined
      const { exportRow, toCsv } = await import('../src/modules/people/__tests__/people-export-fixtures');
      const rid = (await db.select().from(schema.peopleObservations).where(eq(schema.peopleObservations.personId, person.id)))[0].sourceRecordId;
      const later = exportRow({
        company_name: COMPANIES[2].name, company_city: 'Dehradun', company_state: 'Uttarakhand', pan: 'AAACH5678K', full_name: 'Vikram Rawat', job_title: 'Founder',
        email: 'vikram.rawat@himalayanfoods.example', linkedin_url: 'https://www.linkedin.com/in/vikram-rawat-founder', relationship_id: rid,
        exported_at: new Date(Date.now() - 1_800_000).toISOString().replace(/\.\d+Z$/, '+00:00'),
      });
      const job = await POST(`${API}/admin/people/import`, adminToken, { format: 'csv', content: toCsv([later]) });
      let jv: any;
      for (let i = 0; i < 400; i++) {
        jv = data(await GET(`${API}/admin/people/import/${data(job).jobId}`));
        if (!['QUEUED', 'RUNNING'].includes(jv.status)) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(jv).toMatchObject({ status: 'COMPLETED_WITH_ISSUES', imported: 0, quarantined: 1 });
      expect(jv.reasonCounts).toMatchObject({ SUPPRESSED_PERSON: 1 });
      expect((await roleRows('Vikram Rawat')).every((r: any) => r.reviewStatus === 'REJECTED' && r.isPublished === false)).toBe(true);
      expect(await count(schema.people)).toBe(11);
    });
  });

  // ================================================================================================ 14. audit trail
  describe('14. every consequential action left an audit record with the actor', () => {
    it('the audit log holds the review, verification and publication actions with the admin as actor and the reason', async () => {
      const rows = await db.select().from(schema.auditLogs).where(sql`${schema.auditLogs.entityType} LIKE 'PEOPLE_%'`);
      const actions = new Set(rows.map((r: any) => r.action));
      for (const a of ['PEOPLE_ROLE_PUBLISHED', 'PEOPLE_ROLE_REJECTED', 'PEOPLE_ROLE_REOPENED', 'PEOPLE_ROLE_QUARANTINED', 'PEOPLE_ROLE_UNPUBLISHED', 'PEOPLE_CLAIM_VERIFIED', 'PEOPLE_CLAIM_DISPUTED', 'PEOPLE_CONTACT_PUBLISHED', 'PEOPLE_CONTACT_UNPUBLISHED', 'PEOPLE_PERSON_SUPPRESSED', 'PEOPLE_ROLE_EDITED']) {
        expect(actions.has(a)).toBe(true);
      }
      const adminId = (await db.select().from(schema.users).where(eq(schema.users.email, ADMIN)))[0].id;
      const consequential = rows.filter((r: any) => ['PEOPLE_ROLE_PUBLISHED', 'PEOPLE_ROLE_REJECTED', 'PEOPLE_CLAIM_VERIFIED', 'PEOPLE_PERSON_SUPPRESSED'].includes(r.action));
      expect(consequential.length).toBeGreaterThan(5);
      expect(consequential.every((r: any) => r.userId === adminId && r.newValues?.reviewedBy === ADMIN)).toBe(true);
      const managerId = (await db.select().from(schema.users).where(eq(schema.users.email, MANAGER)))[0].id;
      expect((await db.select().from(schema.auditLogs).where(inArray(schema.auditLogs.userId, [managerId]))).filter((r: any) => String(r.entityType).startsWith('PEOPLE_'))).toEqual([]); // the refused data manager wrote no People action
    });
  });

  // ================================================================================================ 15. reviewer-only import provenance
  describe('15. the dossier tells a reviewer where an imported relationship came from (read-only, reviewer-only)', () => {
    const dossier = (id: string, token: string | null = adminToken) => GET(`${REVIEW}/roles/${id}`, token);
    const provenanceOf = async (id: string) => data(await dossier(id).expect(200)).provenance;
    const observationsOf = async (roleId: string) => db.select().from(schema.peopleObservations).where(eq(schema.peopleObservations.companyPersonId, roleId));
    const cloneObservation = async (from: any, over: Record<string, unknown>) => {
      const { id: _id, ...rest } = from;
      await db.insert(schema.peopleObservations).values({ ...rest, ...over });
    };

    it('an imported role: source, batch, source record (the Pipeline relationship id), acquired and observed time; no database id', async () => {
      const role = await roleAt('Rohan Bhatnagar', 'meridian');
      const [row] = await observationsOf(role.id);
      expect(row).toBeTruthy();
      const p = await provenanceOf(role.id);
      expect(p).toMatchObject({ available: true, truncated: false });
      expect(p.observations).toHaveLength(1);
      expect(p.observations[0]).toMatchObject({ batchRef: row.batchRef, sourceRecordId: row.sourceRecordId, observedTitle: row.observedTitle, source: { key: row.sourceKey, version: row.sourceVersion } });
      expect(p.observations[0].batchRef).toMatch(/^people-export-v1-/);
      expect(p.observations[0].sourceRecordId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(new Date(p.observations[0].acquiredAt).getTime()).toBe(row.acquiredAt.getTime());
      expect(typeof p.observations[0].source.name).toBe('string');
      expect(JSON.stringify(p)).not.toContain(row.id); // no observation id
      expect(Object.keys(p.observations[0]).sort()).toEqual(['acquiredAt', 'batchRef', 'observedAt', 'observedIsCurrent', 'observedTitle', 'source', 'sourceRecordId']);
    });

    it('each role of a two-company person points at its own record (no cross-role provenance)', async () => {
      const m = await roleAt('Rohan Bhatnagar', 'meridian');
      const k = await roleAt('Rohan Bhatnagar', 'kaveri');
      const pm = (await provenanceOf(m.id)).observations[0];
      const pk = (await provenanceOf(k.id)).observations[0];
      expect(pm.sourceRecordId).not.toBe(pk.sourceRecordId);
      expect(pm.sourceRecordId).toBe((await observationsOf(m.id))[0].sourceRecordId);
      expect(pk.sourceRecordId).toBe((await observationsOf(k.id))[0].sourceRecordId);
    });

    it('a relationship seen by two real Pipeline runs lists both (same source record, different batch), newest first; an identical re-run adds no row', async () => {
      const role = await roleAt('Sunita Kulkarni', 'meridian');
      const rows = await observationsOf(role.id);
      expect(rows.length).toBeGreaterThanOrEqual(2); // the lifecycle imported it in more than one run (section 6)
      const p = await provenanceOf(role.id);
      expect(p.observations).toHaveLength(rows.length);
      expect(new Set(p.observations.map((o: any) => o.sourceRecordId)).size).toBe(1);
      expect(new Set(p.observations.map((o: any) => o.batchRef)).size).toBe(rows.length);
      const times = p.observations.map((o: any) => new Date(o.acquiredAt).getTime());
      expect(times).toEqual([...times].sort((x: number, y: number) => y - x));
      expect(p.truncated).toBe(false);
    });

    it('more than the listed maximum is reported as truncated, not silently cut', async () => {
      const role = await roleAt('Sunita Kulkarni', 'meridian');
      const [first] = await observationsOf(role.id);
      for (let i = 0; i < 21; i++) await cloneObservation(first, { batchRef: `people-export-v1-bulk-${i}`, contentFingerprint: String(i).padStart(64, '0') });
      const p = await provenanceOf(role.id);
      expect(p.observations).toHaveLength(20);
      expect(p.truncated).toBe(true);
    });

    it('incomplete provenance: an observation without an observed time shows null, nothing is filled in', async () => {
      const role = await roleAt('Thomas Varghese', 'sagar');
      await cloneObservation((await observationsOf(role.id))[0], { batchRef: 'people-export-v1-incomplete', observedAt: null, observedTitle: null, observedIsCurrent: null, contentFingerprint: 'd'.repeat(64) });
      const incomplete = (await provenanceOf(role.id)).observations.find((o: any) => o.batchRef === 'people-export-v1-incomplete');
      expect(incomplete).toMatchObject({ observedAt: null, observedTitle: null, observedIsCurrent: null });
    });

    it('no observation (created by hand, or imported before observations): an explicit empty provenance, role detail otherwise unchanged', async () => {
      const [person] = await db.insert(schema.people).values({ fullName: 'Manual Mina', normalizedName: 'manual mina', dataStatus: 'DRAFT' }).returning();
      const [role] = await db.insert(schema.companyPeople).values({ personId: person.id, businessId: biz.meridian, jobTitleAtCompany: 'Advisor', normalizedJobTitle: 'advisor', isCurrent: true }).returning();
      await db.insert(schema.personContacts).values({ personId: person.id, contactType: 'WORK_EMAIL', contactValue: 'mina@manual.example', normalizedValue: 'mina@manual.example' });
      const d = data(await dossier(role.id).expect(200));
      expect(d.provenance).toEqual({ available: false, truncated: false, observations: [] });
      expect(d.role.jobTitle).toBe('Advisor');
      expect(d.contacts).toHaveLength(1);
      expect(d.readiness.blockers).toContain('EVIDENCE_REQUIRED');
    });

    it('quarantined records never appear as role provenance (they belong to no role)', async () => {
      const role = await roleAt('Thomas Varghese', 'sagar');
      const all = await db.select().from(schema.peopleObservations);
      expect(all.filter((o: any) => o.outcome === 'QUARANTINED' && o.companyPersonId === role.id)).toEqual([]);
    });

    it('existing dossier keys are unchanged; provenance is the only addition', async () => {
      const role = await roleAt('Rohan Bhatnagar', 'meridian');
      const keys = Object.keys(data(await dossier(role.id).expect(200))).sort();
      expect(keys).toEqual(['auditTrail', 'classification', 'company', 'conflicts', 'contacts', 'evidence', 'otherRoles', 'person', 'provenance', 'quality', 'readiness', 'role', 'verification']);
    });

    it('authorization follows the existing review policy: admin and data manager (read) see it; customers and anonymous do not', async () => {
      const role = await roleAt('Rohan Bhatnagar', 'meridian');
      expect((await dossier(role.id, adminToken)).status).toBe(200);
      const asManager = await dossier(role.id, managerToken);
      expect(asManager.status).toBe(200); // the existing read policy for the dossier (DATA_MANAGER is read-only)
      expect(data(asManager).provenance.available).toBe(true);
      expect((await POST(`${REVIEW}/roles/${role.id}/unpublish`, managerToken, { reason: 'nope' })).status).toBe(403);
      const customer = await dossier(role.id, tokenA);
      const anonymous = await dossier(role.id, null);
      expect([customer.status, anonymous.status]).toEqual([403, 401]);
      for (const res of [customer, anonymous]) expect(JSON.stringify(res.body)).not.toMatch(/people-export-v1|sourceRecordId|batchRef|provenance/);
    });

    it('no customer surface carries provenance: cards, detail, unlock, unlocked list, export, discover', async () => {
      const rows = await db.select().from(schema.peopleObservations);
      const needles = [...new Set(rows.flatMap((o: any) => [o.batchRef, o.sourceRecordId]))] as string[];
      expect(needles.length).toBeGreaterThan(3);
      const bodies: string[] = [];
      const ids = new Set<string>();
      for (const c of COMPANIES) {
        const view = await GET(`${API}/companies/${slug[c.key]}/people?status=all`, tokenA).expect(200);
        bodies.push(view.text);
        for (const p of data(view).people) ids.add(p.id);
      }
      for (const id of ids) bodies.push((await GET(`${API}/people/${id}`, tokenA)).text);
      const pid = (await personRow('Rohan Bhatnagar')).id;
      bodies.push((await POST(`${API}/people/${pid}/unlock`, tokenA)).text, (await GET(`${API}/people/unlocked`, tokenA)).text, (await POST(`${API}/people/export`, tokenA, { personIds: [pid] })).text);
      bodies.push((await GET(`${API}/discover/search?q=Meridian&hasDecisionMakerContact=true`, tokenA)).text);
      expect(bodies.length).toBeGreaterThan(5);
      for (const text of bodies) {
        for (const n of needles) expect(text).not.toContain(n);
        expect(text).not.toMatch(/people-export-v1|provenance/i);
      }
    });
  });

  // ================================================================================================ 16. reject / quarantine source states
  describe('16. reject and quarantine have explicit source states, and the reviewer-quarantine item always follows the role', () => {
    const reasonBody = { reason: 'state guard test' };
    const act = (id: string, action: string, token: string | null = adminToken) => POST(`${REVIEW}/roles/${id}/${action}`, token, reasonBody);
    const itemsOf = async (roleId: string) => (await db.select().from(schema.peopleIngestionQuarantine)).filter((q: any) => q.raw?.companyPersonId === roleId);
    const pending = async (roleId: string) => (await itemsOf(roleId)).filter((q: any) => q.status === 'PENDING');
    /** Drives a role to PENDING from wherever earlier tests left it, only through the public review actions. */
    const toPending = async (id: string) => {
      const { reviewStatus } = await roleNow(id);
      if (reviewStatus === 'APPROVED') await act(id, 'unpublish').then((r: any) => expect(r.status).toBe(200));
      else if (reviewStatus === 'REJECTED' || reviewStatus === 'QUARANTINED') await act(id, 'reopen').then((r: any) => expect(r.status).toBe(200));
      expect((await roleNow(id)).reviewStatus).toBe('PENDING');
    };
    let roleId = '';

    beforeAll(async () => {
      roleId = (await roleAt('Prakash Joshi', 'meridian')).id;
      await toPending(roleId);
    });

    it('REJECTED -> reject is an idempotent no-op with an audit row; REJECTED -> quarantine is refused (409): reopen first', async () => {
      await act(roleId, 'reject').then((r: any) => expect(r.status).toBe(200));
      const audits0 = (await audits(roleId, 'PEOPLE_ROLE_REJECTED')).length;
      await act(roleId, 'reject').then((r: any) => expect(r.status).toBe(200));
      expect((await audits(roleId, 'PEOPLE_ROLE_REJECTED')).length).toBe(audits0 + 1);
      const refused = await act(roleId, 'quarantine');
      expect([refused.status, refused.body.errorCode]).toEqual([409, 'REVIEW_STATE_INVALID']);
      expect(await roleNow(roleId)).toMatchObject({ reviewStatus: 'REJECTED', isPublished: false });
      expect(await pending(roleId)).toEqual([]); // the refused action left no queue item behind
      expect((await audits(roleId, 'PEOPLE_ROLE_QUARANTINED')).length).toBe(0);
    });

    it('reopen from REJECTED returns it to PENDING; reopen of PENDING and of APPROVED is refused', async () => {
      await act(roleId, 'reopen').then((r: any) => expect(r.status).toBe(200));
      expect(await roleNow(roleId)).toMatchObject({ reviewStatus: 'PENDING', isPublished: false });
      expect((await act(roleId, 'reopen')).status).toBe(409);
      await POST(`${REVIEW}/roles/${roleId}/approve`, adminToken, {}).then((r: any) => expect(r.status).toBe(200));
      expect((await act(roleId, 'reopen')).status).toBe(409);
      await toPending(roleId);
    });

    it('QUARANTINED -> quarantine is idempotent: still QUARANTINED, exactly one open item', async () => {
      await act(roleId, 'quarantine').then((r: any) => expect(r.status).toBe(200));
      await act(roleId, 'quarantine').then((r: any) => expect(r.status).toBe(200));
      expect(await roleNow(roleId)).toMatchObject({ reviewStatus: 'QUARANTINED', isPublished: false });
      expect(await pending(roleId)).toHaveLength(1);
    });

    it('QUARANTINED -> reject is allowed (the reviewer discards a held role) and closes its queue item in the same step', async () => {
      await act(roleId, 'reject').then((r: any) => expect(r.status).toBe(200));
      expect(await roleNow(roleId)).toMatchObject({ reviewStatus: 'REJECTED', isPublished: false });
      expect(await pending(roleId)).toEqual([]);
      const closed = await itemsOf(roleId);
      expect(closed.every((q: any) => q.status === 'DISCARDED' && q.resolution?.action === 'REJECTED')).toBe(true);
      // nothing is left to resolve in the quarantine queue for it, and it can still be reopened
      expect(data(await GET(`${REVIEW}/quarantine?status=PENDING&limit=100`).expect(200)).some((q: any) => q.id && closed.some((c: any) => c.id === q.id))).toBe(false);
      await act(roleId, 'reopen').then((r: any) => expect(r.status).toBe(200));
      expect((await roleNow(roleId)).reviewStatus).toBe('PENDING');
    });

    it('QUARANTINED -> reopen resolves the item; rejecting the item from the quarantine queue still rejects the role and discards the item', async () => {
      await act(roleId, 'quarantine').then((r: any) => expect(r.status).toBe(200));
      await act(roleId, 'reopen').then((r: any) => expect(r.status).toBe(200));
      expect(await pending(roleId)).toEqual([]);
      expect((await itemsOf(roleId)).some((q: any) => q.status === 'RESOLVED')).toBe(true);
      await act(roleId, 'quarantine').then((r: any) => expect(r.status).toBe(200));
      const [item] = await pending(roleId);
      await POST(`${REVIEW}/quarantine/${item.id}/reject`, adminToken, reasonBody).then((r: any) => expect(r.status).toBe(200));
      expect(await roleNow(roleId)).toMatchObject({ reviewStatus: 'REJECTED', isPublished: false });
      expect((await itemsOf(roleId)).filter((q: any) => q.id === item.id)[0].status).toBe('DISCARDED');
      await toPending(roleId);
    });

    it('a published role can still be rejected or quarantined (it goes offline at once); DATA_MANAGER cannot do either', async () => {
      await POST(`${REVIEW}/roles/${roleId}/approve`, adminToken, {}).then((r: any) => expect(r.status).toBe(200));
      expect((await act(roleId, 'quarantine', managerToken)).status).toBe(403);
      expect((await act(roleId, 'reject', managerToken)).status).toBe(403);
      await act(roleId, 'quarantine').then((r: any) => expect(r.status).toBe(200));
      expect(await roleNow(roleId)).toMatchObject({ reviewStatus: 'QUARANTINED', isPublished: false });
      await toPending(roleId);
      await POST(`${REVIEW}/roles/${roleId}/approve`, adminToken, {}).then((r: any) => expect(r.status).toBe(200));
      await act(roleId, 'reject').then((r: any) => expect(r.status).toBe(200));
      expect(await roleNow(roleId)).toMatchObject({ reviewStatus: 'REJECTED', isPublished: false });
      await toPending(roleId);
    });

    it('suppressing a person closes the open reviewer-quarantine items of its roles, and a suppressed person\'s role cannot be reopened', async () => {
      const gopal = await roleAt('Gopal Sharma', 'lotus');
      await toPending(gopal.id);
      await act(gopal.id, 'quarantine').then((r: any) => expect(r.status).toBe(200));
      expect(await pending(gopal.id)).toHaveLength(1);
      await POST(`${REVIEW}/people/${gopal.personId}/suppress`, adminToken, reasonBody).then((r: any) => expect(r.status).toBe(200));
      expect(await pending(gopal.id)).toEqual([]);
      expect((await itemsOf(gopal.id))[0]).toMatchObject({ status: 'DISCARDED', resolution: { action: 'PERSON_SUPPRESSED' } });
      const reopened = await act(gopal.id, 'reopen');
      expect([reopened.status, reopened.body.errorCode]).toEqual([409, 'PERSON_SUPPRESSED']);
      expect(await roleNow(gopal.id)).toMatchObject({ reviewStatus: 'REJECTED', isPublished: false });
    });
  });

  // ================================================================================================ 17. contact attribution in the reviewer dossier
  describe('17. the dossier says where each contact came from (reviewer information only; customers are unaffected)', () => {
    const dossier = (id: string, token: string | null = adminToken) => GET(`${REVIEW}/roles/${id}`, token);
    const contactsAt = async (id: string) => (data(await dossier(id).expect(200)).contacts as any[]);
    const byValue = (cs: any[], value: string) => cs.find((c) => c.value === value);
    const MERIDIAN_EMAIL = 'rohan.bhatnagar@meridiantextiles.example';
    const KAVERI_EMAIL = 'rohan.b@kaveriauto.example';

    it('each company\'s dossier labels the email that company reported as its own and the other company\'s as foreign', async () => {
      const m = await roleAt('Rohan Bhatnagar', 'meridian');
      const k = await roleAt('Rohan Bhatnagar', 'kaveri');
      const atM = await contactsAt(m.id);
      const atK = await contactsAt(k.id);
      expect(byValue(atM, MERIDIAN_EMAIL).attribution).toEqual({ status: 'THIS_COMPANY', eligibleForThisCompany: true });
      expect(byValue(atM, KAVERI_EMAIL).attribution).toEqual({ status: 'OTHER_COMPANY', eligibleForThisCompany: false });
      expect(byValue(atK, KAVERI_EMAIL).attribution).toEqual({ status: 'THIS_COMPANY', eligibleForThisCompany: true });
      expect(byValue(atK, MERIDIAN_EMAIL).attribution).toEqual({ status: 'OTHER_COMPANY', eligibleForThisCompany: false });
    });

    it('every contact carries exactly the status and eligibility, and nothing else (no ids, no observation rows)', async () => {
      const m = await roleAt('Rohan Bhatnagar', 'meridian');
      for (const c of await contactsAt(m.id)) {
        expect(Object.keys(c.attribution).sort()).toEqual(['eligibleForThisCompany', 'status']);
        expect(['THIS_COMPANY', 'SHARED', 'OTHER_COMPANY', 'UNATTRIBUTED']).toContain(c.attribution.status);
        expect(c.attribution.eligibleForThisCompany).toBe(c.attribution.status === 'THIS_COMPANY' || c.attribution.status === 'SHARED');
      }
      const text = JSON.stringify(data(await dossier(m.id).expect(200)).contacts);
      const observationIds = (await db.select({ id: schema.peopleObservations.id }).from(schema.peopleObservations)).map((r: any) => r.id);
      for (const id of observationIds) expect(text).not.toContain(id);
    });

    it('an unattributed contact: not eligible for a multi-company person, eligible for a one-company person; nothing is guessed from its value', async () => {
      const rohan = await personRow('Rohan Bhatnagar');
      const anil = await personRow('Anil Deshmukh');
      expect(await roleRows('Anil Deshmukh')).toHaveLength(1);
      await db.insert(schema.personContacts).values({ personId: rohan.id, contactType: 'WORK_EMAIL', contactValue: 'rohan@meridiantextiles-lookalike.example', normalizedValue: 'rohan@meridiantextiles-lookalike.example' });
      await db.insert(schema.personContacts).values({ personId: anil.id, contactType: 'WORK_EMAIL', contactValue: 'anil.manual@meridian.example', normalizedValue: 'anil.manual@meridian.example' });
      const m = await roleAt('Rohan Bhatnagar', 'meridian');
      const k = await roleAt('Rohan Bhatnagar', 'kaveri');
      // the value looks like Meridian's domain, yet it is attributed to nobody: shown as such at BOTH companies
      expect(byValue(await contactsAt(m.id), 'rohan@meridiantextiles-lookalike.example').attribution).toEqual({ status: 'UNATTRIBUTED', eligibleForThisCompany: false });
      expect(byValue(await contactsAt(k.id), 'rohan@meridiantextiles-lookalike.example').attribution).toEqual({ status: 'UNATTRIBUTED', eligibleForThisCompany: false });
      const a = await roleAt('Anil Deshmukh', 'meridian');
      expect(byValue(await contactsAt(a.id), 'anil.manual@meridian.example').attribution).toEqual({ status: 'UNATTRIBUTED', eligibleForThisCompany: true });
    });

    it('a contact claimed by both companies\' imports is SHARED at each', async () => {
      const m = await roleAt('Rohan Bhatnagar', 'meridian');
      const k = await roleAt('Rohan Bhatnagar', 'kaveri');
      const shared = await contactOf('Rohan Bhatnagar', 'WORK_EMAIL', MERIDIAN_EMAIL);
      const [kObservation] = await db.select().from(schema.peopleObservations).where(eq(schema.peopleObservations.companyPersonId, k.id));
      await db.insert(schema.peopleObservationClaims).values({ observationId: kObservation.id, claimType: 'WORK_EMAIL', contactId: shared.id, valueDigest: suppressionDigest(shared.normalizedValue) });
      expect(byValue(await contactsAt(m.id), MERIDIAN_EMAIL).attribution).toEqual({ status: 'SHARED', eligibleForThisCompany: true });
      expect(byValue(await contactsAt(k.id), MERIDIAN_EMAIL).attribution).toEqual({ status: 'SHARED', eligibleForThisCompany: true });
    });

    it('reading the dossier changes nothing: contacts, claims, observations and what customers see are identical before and after', async () => {
      const m = await roleAt('Rohan Bhatnagar', 'meridian');
      const k = await roleAt('Rohan Bhatnagar', 'kaveri');
      const snapshot = async () => ({
        counts: [await count(schema.personContacts), await count(schema.peopleObservationClaims), await count(schema.peopleObservations), await count(schema.auditLogs)],
        contacts: (await contactsOf('Rohan Bhatnagar')).map((c: any) => [c.id, c.isPublished, c.isPrimary, c.confidenceScore]).sort(),
        meridianCard: (await cardOf(tokenA, 'meridian', 'Rohan Bhatnagar'))?.contacts ?? null,
        kaveriCard: (await cardOf(tokenA, 'kaveri', 'Rohan Bhatnagar'))?.contacts ?? null,
      });
      const before = await snapshot();
      for (const id of [m.id, k.id]) await dossier(id).expect(200);
      await dossier(m.id, managerToken).expect(200);
      expect(await snapshot()).toEqual(before);
    });

    it('authorization follows the existing policy: admin and data manager read it; the data manager cannot change anything; customers and anonymous get nothing', async () => {
      const m = await roleAt('Rohan Bhatnagar', 'meridian');
      const asManager = await dossier(m.id, managerToken);
      expect(asManager.status).toBe(200);
      expect(byValue(data(asManager).contacts, MERIDIAN_EMAIL).attribution.status).toBeTruthy();
      const mc = await contactOf('Rohan Bhatnagar', 'WORK_EMAIL', MERIDIAN_EMAIL);
      expect((await POST(`${REVIEW}/contacts/${mc.id}/publish`, managerToken, { reason: 'nope' })).status).toBe(403);
      expect((await POST(`${REVIEW}/contacts/${mc.id}/unpublish`, managerToken, { reason: 'nope' })).status).toBe(403);
      const customer = await dossier(m.id, tokenA);
      const anonymous = await dossier(m.id, null);
      expect([customer.status, anonymous.status]).toEqual([403, 401]);
      for (const res of [customer, anonymous]) expect(JSON.stringify(res.body)).not.toMatch(/attribution|THIS_COMPANY|OTHER_COMPANY|UNATTRIBUTED|eligibleForThisCompany/);
    });

    it('no customer surface carries reviewer attribution metadata: cards, detail, unlock, unlocked list, export, discover', async () => {
      const pid = (await personRow('Rohan Bhatnagar')).id;
      const bodies: string[] = [];
      for (const c of COMPANIES) bodies.push((await GET(`${API}/companies/${slug[c.key]}/people?status=all`, tokenA).expect(200)).text);
      bodies.push((await GET(`${API}/people/${pid}`, tokenA)).text, (await POST(`${API}/people/${pid}/unlock`, tokenA)).text, (await GET(`${API}/people/unlocked`, tokenA)).text, (await POST(`${API}/people/export`, tokenA, { personIds: [pid] })).text);
      bodies.push((await GET(`${API}/discover/search?q=Meridian&hasDecisionMakerContact=true`, tokenA)).text);
      expect(bodies.length).toBeGreaterThan(8);
      for (const text of bodies) expect(text).not.toMatch(/attribution|eligibleForThisCompany|THIS_COMPANY|OTHER_COMPANY|UNATTRIBUTED|"SHARED"/);
    });
  });
});

const randomSlug = () => `no-such-company-${Math.random().toString(36).slice(2, 8)}`;

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { UserRole } from '@orion/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as jwt from 'jsonwebtoken';
import * as path from 'path';
import { ExtractJwt, Strategy } from 'passport-jwt';
import request from 'supertest';
import { ROLES_KEY } from '../../../auth/decorators';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { AllExceptionsFilter } from '../../../common/filters/all-exceptions.filter';
import { TransformInterceptor } from '../../../common/interceptors/transform.interceptor';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { CreditRepository } from '../../credit/credit.repository';
import { CreditService } from '../../credit/credit.service';
import { IRawPersonRecord } from '../ingestion/ingestion.types';
import { PeopleIngestionService } from '../ingestion/people-ingestion.service';
import { PeopleController } from '../people.controller';
import { PeopleExportService } from '../people-export.service';
import { PeoplePublishingService } from '../people-publishing.service';
import { PeopleSearchService } from '../people-search.service';
import { PeopleUnlockService } from '../people-unlock.service';
import { PeopleWriteService } from '../people-write.service';
import { PeopleService } from '../people.service';
import { PeopleQuarantineService } from '../review/people-quarantine.service';
import { PeopleReviewController } from '../review/people-review.controller';
import { PeopleTriageService } from '../review/people-triage.service';
import { PeopleReviewService } from '../review/people-review.service';
import { PeopleVerificationService } from '../verification/people-verification.service';
import { expectLedgerConsistent } from './ledger-invariants';
import { createTestDb, seedBusiness, seedUser } from './pglite-test-db';

const SECRET = 'review-test-secret';
class TestJwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: SECRET });
  }
  validate(payload: unknown) {
    return payload;
  }
}

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const SRC = { type: 'MANUAL_IMPORT', label: 'unit', reference: 'sheet-1' };
const BASE = '/internal/people-review';
const SRC_DIR = path.resolve(__dirname, '../../..');

describe('People review & publishing workflow (Phase 4)', () => {
  let app: INestApplication;
  let db: DrizzleDb;
  let closeDb: () => Promise<void>;
  let client: { query: (...a: any[]) => Promise<any> };
  let ingest: PeopleIngestionService;
  let write: PeopleWriteService;
  let publishing: PeoplePublishingService;
  let people: PeopleService;
  let review: PeopleReviewService;

  let admin: { id: string; token: string; email: string };
  let dataManager: { id: string; token: string };
  let customer: { id: string; token: string };
  let acme: { id: string; slug: string };
  let beta: { id: string; slug: string };
  let draftCo: { id: string; slug: string };
  let seq = 0;

  const tokenFor = (id: string, role: string, email = `${id}@t.dev`) => jwt.sign({ sub: id, email, role }, SECRET);
  const auth = (r: request.Test, t: string) => r.set('Authorization', `Bearer ${t}`);
  const GET = (url: string, t?: string) => (t ? auth(request(app.getHttpServer()).get(url), t) : request(app.getHttpServer()).get(url));
  const POST = (url: string, t?: string, body: object = {}) => (t ? auth(request(app.getHttpServer()).post(url), t) : request(app.getHttpServer()).post(url)).send(body);
  const PATCH = (url: string, t: string, body: object = {}) => auth(request(app.getHttpServer()).patch(url), t).send(body);

  // names must not contain digits (ingestion rejects them)
  const alpha = (n: number) => 'Q' + n.toString(26).replace(/[0-9]/g, (d) => String.fromCharCode(103 + Number(d)));
  const rec = (over: Partial<IRawPersonRecord> = {}): IRawPersonRecord => ({
    businessId: acme.id,
    personName: `Person ${alpha(++seq)}`,
    jobTitle: 'CEO',
    source: SRC,
    ...over,
  });
  const ingestOne = async (over: Partial<IRawPersonRecord> = {}) => {
    const r = (await ingest.ingest([rec(over)])).results[0];
    if (!r.companyPersonId) throw new Error(`ingest failed: ${JSON.stringify(r)}`);
    return { personId: r.personId!, roleId: r.companyPersonId!, outcome: r.outcome };
  };
  const roleRow = async (id: string) => (await db.select().from(schema.companyPeople).where(eq(schema.companyPeople.id, id)))[0];
  const personRow = async (id: string) => (await db.select().from(schema.people).where(eq(schema.people.id, id)))[0];
  const auditFor = (entityId: string) => db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, entityId)).orderBy(desc(schema.auditLogs.createdAt));
  const custList = async (co: { id: string }, extra = '') =>
    (await GET(`/companies/${co.id}/people?status=all${extra}`, customer.token).expect(200)).body.data.people as any[];
  const custNames = async (co: { id: string }) => (await custList(co)).map((p) => p.fullName);

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    client = t.client as any;
    closeDb = () => t.client.close();

    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [PeopleController, PeopleReviewController],
      providers: [
        { provide: DRIZZLE_DATABASE, useValue: db },
        { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
        TestJwtStrategy, JwtAuthGuard, RolesGuard, Reflector,
        CreditRepository, CreditService,
        PeopleService, PeopleUnlockService, PeopleExportService, PeopleSearchService,
        PeopleWriteService, PeopleIngestionService, PeoplePublishingService,
        PeopleReviewService, PeopleQuarantineService, PeopleVerificationService, PeopleTriageService,
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    ingest = module.get(PeopleIngestionService);
    write = module.get(PeopleWriteService);
    publishing = module.get(PeoplePublishingService);
    people = module.get(PeopleService);
    review = module.get(PeopleReviewService);

    const a = await seedUser(db, 'reviewer.admin@orion.test', undefined, 'ADMIN');
    const d = await seedUser(db, 'data.manager@orion.test', undefined, 'DATA_MANAGER');
    const c = await seedUser(db, 'customer@orion.test', { daily: 5, purchased: 5 });
    admin = { id: a.id, email: a.email, token: tokenFor(a.id, UserRole.ADMIN, a.email) };
    dataManager = { id: d.id, token: tokenFor(d.id, UserRole.DATA_MANAGER) };
    customer = { id: c.id, token: tokenFor(c.id, UserRole.USER) };

    acme = await seedBusiness(db, 'acme-review');
    beta = await seedBusiness(db, 'beta-review', { city: 'Chennai' });
    draftCo = await seedBusiness(db, 'draft-review', { status: 'DRAFT' });
  }, 60_000);

  afterAll(async () => {
    await expectLedgerConsistent(db); // status columns must still agree with the verification ledger
    await app?.close();
    await closeDb?.();
  });

  // ================================================================ RBAC
  describe('reviewer RBAC (existing auth system)', () => {
    const someId = '00000000-0000-0000-0000-000000000001';
    const mutations: Array<[string, string]> = [
      ['POST', `roles/${someId}/approve`], ['PATCH', `roles/${someId}`], ['POST', `roles/${someId}/edit-and-approve`],
      ['POST', `roles/${someId}/reject`], ['POST', `roles/${someId}/quarantine`], ['POST', `roles/${someId}/reopen`],
      ['POST', `roles/${someId}/unpublish`], ['POST', `people/${someId}/suppress`],
      ['POST', `contacts/${someId}/publish`], ['POST', `contacts/${someId}/unpublish`],
      ['POST', `quarantine/${someId}/resolve`], ['POST', `quarantine/${someId}/retry`],
      ['POST', `quarantine/${someId}/reject`], ['POST', `quarantine/${someId}/suppress`],
    ];
    const reads: Array<[string, string]> = [
      ['GET', 'stats'], ['GET', 'queue'], ['GET', `roles/${someId}`], ['GET', 'quarantine'], ['GET', `quarantine/${someId}`],
    ];
    const call = (m: string, p: string, t?: string) =>
      m === 'GET' ? GET(`${BASE}/${p}`, t) : m === 'PATCH' ? auth(request(app.getHttpServer()).patch(`${BASE}/${p}`), t!).send({}) : POST(`${BASE}/${p}`, t, {});

    it.each([...reads, ...mutations])('%s %s rejects anonymous callers (401)', async (m, p) => {
      await call(m, p).expect(401);
    });

    it.each([...reads, ...mutations])('%s %s rejects customer accounts (403) - even by guessed id', async (m, p) => {
      await call(m, p, customer.token).expect(403);
    });

    it('customers cannot read the queue or any internal record, and see no internal payload in the error', async () => {
      const { roleId } = await ingestOne({ email: 'secret@internal.example' });
      const res = await GET(`${BASE}/roles/${roleId}`, customer.token).expect(403);
      expect(JSON.stringify(res.body)).not.toMatch(/secret@internal|evidence|contacts/i);
    });

    it('a forged token is rejected', async () => {
      await GET(`${BASE}/queue`, jwt.sign({ sub: admin.id, role: 'ADMIN' }, 'wrong')).expect(401);
    });

    it('data managers can read but not change; admins can do both', async () => {
      const { roleId } = await ingestOne();
      await GET(`${BASE}/queue`, dataManager.token).expect(200);
      await GET(`${BASE}/roles/${roleId}`, dataManager.token).expect(200);
      await POST(`${BASE}/roles/${roleId}/approve`, dataManager.token).expect(403);
      await POST(`${BASE}/roles/${roleId}/reject`, dataManager.token, { reason: 'nope' }).expect(403);
      expect((await roleRow(roleId)).reviewStatus).toBe('PENDING');
      await GET(`${BASE}/queue`, admin.token).expect(200);
    });

    it('every handler of the review controller is explicitly role-protected, and the class is guarded', () => {
      const proto = PeopleReviewController.prototype as any;
      const handlers = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor');
      expect(handlers.length).toBeGreaterThanOrEqual(19);
      for (const h of handlers) expect(Reflect.getMetadata(ROLES_KEY, proto[h])).toBeDefined();
      expect((Reflect.getMetadata('__guards__', PeopleReviewController) as any[]).map((g) => g.name)).toEqual(['JwtAuthGuard', 'RolesGuard']);
      // no customer role is ever listed
      for (const h of handlers) {
        const roles = Reflect.getMetadata(ROLES_KEY, proto[h]) as string[];
        expect(roles).not.toContain('USER');
        expect(roles).not.toContain('MEMBER');
      }
    });

    it('rejects malformed ids and unknown fields', async () => {
      await GET(`${BASE}/roles/not-a-uuid`, admin.token).expect(400);
      await GET(`${BASE}/queue?status=WHATEVER`, admin.token).expect(400);
      await GET(`${BASE}/queue?limit=1000`, admin.token).expect(400);
      const { roleId } = await ingestOne();
      await POST(`${BASE}/roles/${roleId}/approve`, admin.token, { isPublished: true }).expect(400);
    });
  });

  // ================================================================ customer visibility
  describe('customer visibility (nothing unreviewed is ever returned)', () => {
    it('1. a DRAFT person is invisible (list, detail, unlock, export)', async () => {
      const co = await seedBusiness(db, `vis-1-${++seq}`);
      const r = await ingestOne({ businessId: co.id, personName: 'Draft Dora', email: 'dora@vis.co.in' });
      expect(await custNames(co)).toEqual([]);
      await GET(`/people/${r.personId}`, customer.token).expect(404);
      await POST(`/people/${r.personId}/unlock`, customer.token).expect(404);
      const exp = await POST('/people/export', customer.token, { personIds: [r.personId] }).expect(200);
      expect(exp.text).not.toContain('Draft Dora');
    });

    it('2. a DRAFT role is invisible even when the person is PUBLISHED', async () => {
      const co = await seedBusiness(db, `vis-2-${++seq}`);
      const r = await ingestOne({ businessId: co.id, personName: 'Half Way' });
      await write.setDataStatus(r.personId, 'PUBLISHED');
      expect((await personRow(r.personId)).dataStatus).toBe('PUBLISHED');
      expect(await custNames(co)).toEqual([]);
      await GET(`/people/${r.personId}`, customer.token).expect(404);
    });

    it('3. published person + unpublished role: only the reviewed role is visible', async () => {
      const li = `linkedin.com/in/three-${++seq}`;
      const coA = await seedBusiness(db, `vis-3a-${seq}`);
      const coB = await seedBusiness(db, `vis-3b-${seq}`);
      const a = await ingestOne({ businessId: coA.id, personName: 'Two Hat', linkedinUrl: li, jobTitle: 'CEO' });
      const b = await ingestOne({ businessId: coB.id, personName: 'Two Hat', linkedinUrl: li, jobTitle: 'Director' });
      expect(b.personId).toBe(a.personId);
      await POST(`${BASE}/roles/${a.roleId}/approve`, admin.token).expect(200);
      expect(await custNames(coA)).toEqual(['Two Hat']);
      expect(await custNames(coB)).toEqual([]);
      const detail = (await GET(`/people/${a.personId}`, customer.token).expect(200)).body.data;
      expect(detail.roles.map((x: any) => x.businessId)).toEqual([coA.id]);
      expect(JSON.stringify(detail)).not.toContain(coB.id);
    });

    it('4. published role + unpublished contact: the contact never appears, even after unlock', async () => {
      const co = await seedBusiness(db, `vis-4-${++seq}`);
      const r = await ingestOne({ businessId: co.id, personName: 'Private Pete', email: 'pete@vis.co.in', mobile: '98765 43210' });
      await POST(`${BASE}/roles/${r.roleId}/approve`, admin.token).expect(200);
      const list = await custList(co);
      expect(list[0].contacts.email.available).toBe(false);
      expect(list[0].contacts.mobile.available).toBe(false);
      // unlock refuses (nothing to reveal) and charges nothing
      const before = (await new CreditService(new CreditRepository(db), db).getWallet(customer.id)).balance;
      await POST(`/people/${r.personId}/unlock`, customer.token).expect(409);
      expect((await new CreditService(new CreditRepository(db), db).getWallet(customer.id)).balance).toBe(before);
      expect(JSON.stringify((await GET(`/people/${r.personId}`, customer.token).expect(200)).body)).not.toMatch(/pete@vis|9876543210/);

      // publishing ONE named contact reveals only that one, and only after unlock
      const detail = (await GET(`${BASE}/roles/${r.roleId}`, admin.token).expect(200)).body.data;
      const emailId = detail.contacts.find((c: any) => c.type === 'WORK_EMAIL').id;
      await POST(`${BASE}/contacts/${emailId}/publish`, admin.token).expect(200);
      await POST(`/people/${r.personId}/unlock`, customer.token).expect(200);
      const after = (await GET(`/people/${r.personId}`, customer.token).expect(200)).body.data;
      expect(after.contacts.email.value).toBe('pete@vis.co.in');
      expect(after.contacts.mobile).toMatchObject({ available: false, value: null });
      expect(JSON.stringify(after)).not.toMatch(/9876543210/);
    });

    it('5/6. quarantined and rejected roles are invisible, and cannot be approved until reopened', async () => {
      const co = await seedBusiness(db, `vis-5-${++seq}`);
      const q = await ingestOne({ businessId: co.id, personName: 'Quarantined Quinn' });
      const j = await ingestOne({ businessId: co.id, personName: 'Rejected Rex' });
      await POST(`${BASE}/roles/${q.roleId}/approve`, admin.token).expect(200);
      await POST(`${BASE}/roles/${j.roleId}/approve`, admin.token).expect(200);
      expect((await custNames(co)).sort()).toEqual(['Quarantined Quinn', 'Rejected Rex']);

      await POST(`${BASE}/roles/${q.roleId}/quarantine`, admin.token, { reason: 'title looks wrong' }).expect(200);
      await POST(`${BASE}/roles/${j.roleId}/reject`, admin.token, { reason: 'not a director' }).expect(200);
      expect(await custNames(co)).toEqual([]);
      await GET(`/people/${q.personId}`, customer.token).expect(404);
      await GET(`/people/${j.personId}`, customer.token).expect(404);

      const res = await POST(`${BASE}/roles/${q.roleId}/approve`, admin.token).expect(409);
      expect(JSON.stringify(res.body)).toMatch(/REVIEW_STATE_INVALID/);
      expect(await custNames(co)).toEqual([]);
    });

    it('7. a suppressed person is invisible everywhere and cannot come back', async () => {
      const li = `linkedin.com/in/suppressed-${++seq}`;
      const co = await seedBusiness(db, `vis-7-${seq}`);
      const r = await ingestOne({ businessId: co.id, personName: 'Suppressed Sue', linkedinUrl: li });
      await POST(`${BASE}/roles/${r.roleId}/approve`, admin.token).expect(200);
      expect(await custNames(co)).toEqual(['Suppressed Sue']);

      await POST(`${BASE}/people/${r.personId}/suppress`, admin.token, {}).expect(400); // reason required
      await POST(`${BASE}/people/${r.personId}/suppress`, admin.token, { reason: 'opt-out request #42' }).expect(200);
      expect(await custNames(co)).toEqual([]);
      await GET(`/people/${r.personId}`, customer.token).expect(404);
      await POST(`/people/${r.personId}/unlock`, customer.token).expect(404);

      const again = (await ingest.ingest([rec({ businessId: co.id, personName: 'Suppressed Sue', linkedinUrl: li })])).results[0];
      expect(again.outcome).toBe('QUARANTINED');
      expect(again.reasons![0].code).toBe('SUPPRESSED_PERSON'); // renamed in Phase 6.4
      await POST(`${BASE}/roles/${r.roleId}/approve`, admin.token).expect(409);
      expect((await roleRow(r.roleId)).reviewStatus).toBe('REJECTED');
    });

    it('8. approving a role makes it visible when the other conditions hold - and not on an unpublished company', async () => {
      const co = await seedBusiness(db, `vis-8-${++seq}`);
      const r = await ingestOne({ businessId: co.id, personName: 'Approved Ann', jobTitle: 'Managing Director' });
      expect(await custNames(co)).toEqual([]);
      const res = await POST(`${BASE}/roles/${r.roleId}/approve`, admin.token, { reason: 'checked registry filing' }).expect(200);
      expect(res.body.data).toMatchObject({ companyPersonId: r.roleId, isPublished: true, publishedContactIds: [] });
      const [card] = await custList(co);
      expect(card).toMatchObject({ fullName: 'Approved Ann', decisionMaker: { type: 'MANAGING_DIRECTOR' } });
      expect(card.verification.assertion).toBe('UNVERIFIED'); // approval publishes; it does not verify
      const role = await roleRow(r.roleId);
      expect(role).toMatchObject({ reviewStatus: 'APPROVED', isPublished: true, reviewedById: admin.id, reviewNote: 'checked registry filing' });
      expect(role.reviewedAt).not.toBeNull();

      const dr = await ingestOne({ businessId: draftCo.id, personName: 'Draft Company Dan' });
      await POST(`${BASE}/roles/${dr.roleId}/approve`, admin.token).expect(200);
      await GET(`/companies/${draftCo.id}/people`, customer.token).expect(404);
    });

    it('9. approving one role cannot publish an unrelated role or someone else\'s contact', async () => {
      const co = await seedBusiness(db, `vis-9-${++seq}`);
      const li = `linkedin.com/in/nine-${seq}`;
      const a = await ingestOne({ businessId: co.id, personName: 'Nine Alpha', jobTitle: 'CEO', linkedinUrl: li, email: 'alpha@nine.co.in' });
      const a2 = await ingestOne({ businessId: co.id, personName: 'Nine Alpha', jobTitle: 'Director', linkedinUrl: li });
      const other = await ingestOne({ businessId: co.id, personName: 'Nine Bravo', email: 'bravo@nine.co.in' });
      expect(a2.personId).toBe(a.personId);

      const bravoContact = (await db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, other.personId)))[0];
      // naming another person's contact is refused and nothing is published
      await POST(`${BASE}/roles/${a.roleId}/approve`, admin.token, { publishContactIds: [bravoContact.id] }).expect(404);
      expect((await roleRow(a.roleId)).isPublished).toBe(false);
      expect((await db.select().from(schema.personContacts).where(eq(schema.personContacts.id, bravoContact.id)))[0].isPublished).toBe(false);

      await POST(`${BASE}/roles/${a.roleId}/approve`, admin.token).expect(200);
      expect((await roleRow(a.roleId)).isPublished).toBe(true);
      expect((await roleRow(a2.roleId))).toMatchObject({ isPublished: false, reviewStatus: 'PENDING' }); // same person, other role
      expect((await roleRow(other.roleId)).isPublished).toBe(false);
      expect((await db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, a.personId))).every((c) => !c.isPublished)).toBe(true);
      expect(await custNames(co)).toEqual(['Nine Alpha']);
      expect((await custList(co))[0].additionalRoles).toEqual([]); // the Director role is not even mentioned
    });

    it('the database itself refuses a published role that is not APPROVED', async () => {
      const r = await ingestOne();
      await expect(db.update(schema.companyPeople).set({ isPublished: true }).where(eq(schema.companyPeople.id, r.roleId))).rejects.toBeDefined();
      await expect(db.update(schema.companyPeople).set({ reviewStatus: 'WHATEVER' }).where(eq(schema.companyPeople.id, r.roleId))).rejects.toBeDefined();
    });

    it('search never surfaces unreviewed roles', async () => {
      const co = await seedBusiness(db, `vis-s-${++seq}`);
      const r = await ingestOne({ businessId: co.id, personName: 'Searchable Sam', jobTitle: 'Head of Procurement' });
      const search = new PeopleSearchService();
      const ids = async () =>
        (await db.select({ id: schema.businesses.id }).from(schema.businesses).where(and(eq(schema.businesses.id, co.id), search.buildBusinessPredicate({ decisionMakerTypes: ['PROCUREMENT_DECISION_MAKER'] }, sql`${schema.businesses.id}`)!))).map((x) => x.id);
      expect(await ids()).toEqual([]);
      await POST(`${BASE}/roles/${r.roleId}/approve`, admin.token).expect(200);
      expect(await ids()).toEqual([co.id]);
      await POST(`${BASE}/roles/${r.roleId}/unpublish`, admin.token, { reason: 'wrong company' }).expect(200);
      expect(await ids()).toEqual([]);
    });
  });

  // ================================================================ queue
  describe('review queue', () => {
    let qCo: { id: string; slug: string };
    let ids: Record<string, string>;

    beforeAll(async () => {
      qCo = await seedBusiness(db, 'queue-co', { city: 'Madurai' });
      const mk = async (key: string, over: Partial<IRawPersonRecord>) => {
        ids = ids ?? {};
        ids[key] = (await ingestOne({ businessId: qCo.id, ...over })).roleId;
      };
      await mk('ceo', { personName: 'Queue Ceo', jobTitle: 'CEO', source: { type: 'GOVERNMENT_REGISTRY', reference: 'reg-1' }, confidenceScore: 80 });
      await mk('proc', { personName: 'Queue Proc', jobTitle: 'Head of Procurement', source: { type: 'PARTNER_FEED', reference: 'feed-1' }, confidenceScore: 30 });
      await mk('staff', { personName: 'Queue Staff', jobTitle: 'Software Engineer' });
      await mk('ver', { personName: 'Queue Verified', jobTitle: 'CFO', verification: { status: 'VERIFIED', verifiedAt: daysAgo(5), verifiedBy: 'rev' }, confidenceScore: 95 });
      // a role with NO evidence at all
      const noEv = await write.upsertPersonForBusiness({ businessId: qCo.id, person: { fullName: 'Queue Bare' }, role: { jobTitle: 'Owner' } });
      ids.bare = noEv.companyPersonId;
      await POST(`${BASE}/roles/${ids.staff}/reject`, admin.token, { reason: 'not a decision maker' }).expect(200);
    });

    const q = async (qs: string) => (await GET(`${BASE}/queue?businessId=${qCo.id}&${qs}`, admin.token).expect(200)).body;
    const names = async (qs: string) => ((await q(qs)).data as any[]).map((x) => x.fullName).sort();

    it('defaults to pending and excludes rejected/approved', async () => {
      expect(await names('')).toEqual(['Queue Bare', 'Queue Ceo', 'Queue Proc', 'Queue Verified']);
      expect(await names('status=REJECTED')).toEqual(['Queue Staff']);
      expect(await names('status=ALL')).toHaveLength(5);
    });

    it('filters: company, text, classification, verification, source, confidence, dates, evidence', async () => {
      expect(await names('company=queue-co')).toHaveLength(4);
      const byName = (await GET(`${BASE}/queue?company=${encodeURIComponent('queue-co pvt')}`, admin.token).expect(200)).body.data as any[];
      expect(byName.length).toBe(4);
      expect(await names('q=procurement')).toEqual(['Queue Proc']);
      expect(await names('q=queue%20verified')).toEqual(['Queue Verified']);
      expect(await names('decisionMakerType=PROCUREMENT_DECISION_MAKER')).toEqual(['Queue Proc']);
      expect(await names('decisionMakerType=NONE&status=ALL')).toEqual(['Queue Staff']);
      expect(await names('verification=VERIFIED')).toEqual(['Queue Verified']);
      expect(await names('verification=UNVERIFIED')).toEqual(['Queue Bare', 'Queue Ceo', 'Queue Proc']);
      expect(await names('verification=NOPE')).toEqual([]);
      expect(await names('source=GOVERNMENT_REGISTRY')).toEqual(['Queue Ceo']);
      expect(await names('source=PARTNER_FEED,GOVERNMENT_REGISTRY')).toEqual(['Queue Ceo', 'Queue Proc']);
      expect(await names('minConfidence=60')).toEqual(['Queue Ceo', 'Queue Verified']);
      expect(await names('maxConfidence=40')).toEqual(['Queue Bare', 'Queue Proc']);
      expect(await names(`createdFrom=${daysAgo(1)}&createdTo=${new Date(Date.now() + 60_000).toISOString()}`)).toHaveLength(4);
      expect(await names(`createdTo=${daysAgo(30)}`)).toEqual([]);
      expect(await names(`updatedFrom=${daysAgo(1)}`)).toHaveLength(4);
      expect(await names('hasEvidence=false')).toEqual(['Queue Bare']);
      expect(await names('hasEvidence=true')).toEqual(['Queue Ceo', 'Queue Proc', 'Queue Verified']);
    });

    it('rows carry what a reviewer needs without further calls', async () => {
      const item = ((await q('q=queue%20ceo')).data as any[])[0];
      expect(item).toMatchObject({
        id: ids.ceo, fullName: 'Queue Ceo', companyName: expect.stringContaining('queue-co'), jobTitle: 'CEO',
        decisionMakerType: 'FOUNDER_CEO', reviewStatus: 'PENDING', isPublished: false,
        evidenceCount: 1, verifiedEvidenceCount: 0, sourceTypes: ['GOVERNMENT_REGISTRY'], confidence: { score: 80 },
      });
    });

    it('sorts and paginates', async () => {
      const byConf = ((await q('sort=confidence_desc')).data as any[]).map((x) => x.fullName);
      expect(byConf[0]).toBe('Queue Verified');
      const p1 = await q('limit=2&page=1&sort=created_asc');
      const p2 = await q('limit=2&page=2&sort=created_asc');
      expect(p1.pagination).toMatchObject({ page: 1, limit: 2, totalItems: 4, totalPages: 2 });
      const all = [...p1.data, ...p2.data].map((x: any) => x.id);
      expect(new Set(all).size).toBe(4);
    });

    it('stats report roles per review state and quarantine per status', async () => {
      const s = (await GET(`${BASE}/stats`, admin.token).expect(200)).body.data;
      expect(s.roles.PENDING).toBeGreaterThanOrEqual(4);
      expect(s.roles.REJECTED).toBeGreaterThanOrEqual(1);
    });

    it('is separate from customer search: customers see none of it', async () => {
      expect(await custNames(qCo)).toEqual([]);
    });

    it('performance: one statement per aspect (no N+1) and the review index is usable', async () => {
      const spy = jest.spyOn(client, 'query');
      await review.getQueue({ status: 'PENDING', limit: 25, page: 1 } as any);
      const calls = spy.mock.calls.length;
      spy.mockRestore();
      expect(calls).toBeLessThanOrEqual(2); // page + total, however many rows come back

      await client.query('SET enable_seqscan = off');
      const plan = await client.query(
        `EXPLAIN SELECT id FROM company_people WHERE review_status = 'PENDING' ORDER BY created_at DESC LIMIT 25`,
      );
      await client.query('SET enable_seqscan = on');
      expect(plan.rows.map((r: any) => r['QUERY PLAN']).join('\n')).toMatch(/company_people_review_idx/);
    });
  });

  // ================================================================ detail
  describe('reviewer detail', () => {
    it('shows identity, contacts, quality and ALL evidence with provenance - nothing fabricated', async () => {
      const li = `linkedin.com/in/detail-${++seq}`;
      const r = await ingestOne({
        businessId: acme.id, personName: 'Detail Dee', jobTitle: 'Managing Director', email: 'dee@detail.co.in', mobile: '98765 12345', linkedinUrl: li,
        source: { type: 'WEB_SCRAPING', url: 'https://detail.example/team', reference: 'crawl-9', observedAt: '2026-05-01T00:00:00Z' },
      });
      await ingest.ingest([rec({ businessId: beta.id, personName: 'Detail Dee', jobTitle: 'Advisor', linkedinUrl: li, source: { type: 'PARTNER_FEED', reference: 'feed-7' } })]);

      const d = (await GET(`${BASE}/roles/${r.roleId}`, admin.token).expect(200)).body.data;
      expect(d.person).toMatchObject({ fullName: 'Detail Dee', dataStatus: 'DRAFT' });
      expect(d.company).toMatchObject({ id: acme.id });
      expect(d.role).toMatchObject({ jobTitle: 'Managing Director', decisionMakerType: 'MANAGING_DIRECTOR', isCurrent: true, reviewStatus: 'PENDING', isPublished: false });
      expect(d.quality).toMatchObject({ storedVerificationStatus: 'UNVERIFIED', effectiveVerificationStatus: 'UNVERIFIED', lastVerifiedAt: null, evidenceCount: 1, verifiedEvidenceCount: 0 });
      expect(d.role.firstSeenAt).toBeDefined();
      expect(d.contacts.map((c: any) => [c.type, c.value, c.isPublished]).sort()).toEqual([['MOBILE', '+919876512345', false], ['WORK_EMAIL', 'dee@detail.co.in', false]]);

      const roleEv = d.evidence.filter((e: any) => e.scope === 'ROLE');
      expect(roleEv).toEqual([
        expect.objectContaining({ sourceType: 'WEB_SCRAPING', sourceReference: 'crawl-9', sourceUrl: 'https://detail.example/team', evidenceType: 'ROLE_CLAIM', status: 'UNVERIFIED', appliesToThisRole: true }),
      ]);
      expect(d.evidence.filter((e: any) => e.scope === 'CONTACT')).toHaveLength(2);
      expect(d.evidence.some((e: any) => e.scope === 'OTHER_ROLE' && e.sourceType === 'PARTNER_FEED' && e.appliesToThisRole === false)).toBe(true);
      expect(d.evidence.every((e: any) => e.verifiedAt === null)).toBe(true);
      expect(d.otherRoles).toEqual([expect.objectContaining({ businessId: beta.id, jobTitle: 'Advisor', isPublished: false })]);
      expect(d.readiness).toEqual({ canApprove: true, blockers: [] });
      expect(new Date(d.evidence[0].observedAt).toString()).not.toBe('Invalid Date');
    });

    it('reports blockers instead of pretending a role can be approved', async () => {
      const bare = await write.upsertPersonForBusiness({ businessId: acme.id, person: { fullName: 'Bare Bones' }, role: { jobTitle: 'CEO' } });
      const d = (await GET(`${BASE}/roles/${bare.companyPersonId}`, admin.token).expect(200)).body.data;
      expect(d.evidence).toEqual([]);
      expect(d.readiness).toEqual({ canApprove: false, blockers: ['EVIDENCE_REQUIRED'] });
      const res = await POST(`${BASE}/roles/${bare.companyPersonId}/approve`, admin.token).expect(409);
      expect(JSON.stringify(res.body)).toMatch(/EVIDENCE_REQUIRED/);
      expect((await roleRow(bare.companyPersonId)).isPublished).toBe(false);
    });

    it('marks old verification as STALE and unknown roles as 404', async () => {
      const r = await ingestOne({ personName: 'Stale Stan', verification: { status: 'VERIFIED', verifiedAt: daysAgo(500), verifiedBy: 'rev' } });
      const d = (await GET(`${BASE}/roles/${r.roleId}`, admin.token).expect(200)).body.data;
      expect(d.quality.effectiveVerificationStatus).toBe('STALE');
      expect(d.evidence.find((e: any) => e.evidenceType === 'MANUAL_VERIFICATION').status).toBe('STALE');
      await GET(`${BASE}/roles/00000000-0000-0000-0000-00000000dead`, admin.token).expect(404);
    });

    it('the customer API never returns internal evidence details', async () => {
      const co = await seedBusiness(db, `detail-cust-${++seq}`);
      const r = await ingestOne({ businessId: co.id, personName: 'Leak Check', source: { type: 'WEB_SCRAPING', url: 'https://internal.example/secret-page', reference: 'internal-ref-77' } });
      await POST(`${BASE}/roles/${r.roleId}/approve`, admin.token).expect(200);
      const body = JSON.stringify([(await GET(`/people/${r.personId}`, customer.token).expect(200)).body, await custList(co)]);
      expect(body).not.toMatch(/secret-page|internal-ref-77|sourceUrl|sourceReference|reviewNote|reviewedBy|auditTrail|fingerprint/);
    });
  });

  // ================================================================ approve / audit
  describe('approve and audit trail', () => {
    it('approve with named contacts publishes exactly those, atomically, and audits both', async () => {
      const co = await seedBusiness(db, `aud-1-${++seq}`);
      const r = await ingestOne({ businessId: co.id, personName: 'Audit Ann', email: 'ann@aud.co.in', mobile: '98765 55555' });
      const contacts = await db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, r.personId));
      const email = contacts.find((c) => c.contactType === 'WORK_EMAIL')!;
      const res = await POST(`${BASE}/roles/${r.roleId}/approve`, admin.token, { reason: 'ok', publishContactIds: [email.id] }).expect(200);
      expect(res.body.data.publishedContactIds).toEqual([email.id]);
      const after = await db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, r.personId));
      expect(after.filter((c) => c.isPublished).map((c) => c.contactType)).toEqual(['WORK_EMAIL']);

      const [roleAudit] = await auditFor(r.roleId);
      expect(roleAudit).toMatchObject({ action: 'PEOPLE_ROLE_PUBLISHED', entityType: 'PEOPLE_ROLE', userId: admin.id });
      expect(roleAudit.oldValues).toMatchObject({ reviewStatus: 'PENDING', isPublished: false, personStatus: 'DRAFT' });
      expect(roleAudit.newValues).toMatchObject({ reviewStatus: 'APPROVED', isPublished: true, personId: r.personId, companyId: co.id, reviewedBy: admin.email, reason: 'ok' });
      expect(roleAudit.createdAt).toBeInstanceOf(Date);
      const [contactAudit] = await auditFor(email.id);
      expect(contactAudit).toMatchObject({ action: 'PEOPLE_CONTACT_PUBLISHED', userId: admin.id });
    });

    it('an action and its audit record succeed or fail together', async () => {
      const r = await ingestOne({ personName: 'Atomic Al' });
      const ghost = { reviewedBy: 'ghost', reviewerId: '00000000-0000-0000-0000-00000000dead' }; // FK violation in the audit insert
      await expect(publishing.publishRole(r.roleId, ghost)).rejects.toBeDefined();
      expect((await roleRow(r.roleId))).toMatchObject({ isPublished: false, reviewStatus: 'PENDING' });
      expect((await personRow(r.personId)).dataStatus).toBe('DRAFT');
    });

    it('reject, quarantine, reopen, unpublish and suppress each require a reason and record before/after', async () => {
      const r = await ingestOne({ personName: 'Reasoned Rae' });
      for (const action of ['reject', 'quarantine', 'unpublish']) {
        const res = await POST(`${BASE}/roles/${r.roleId}/${action}`, admin.token, {}).expect(400);
        expect(JSON.stringify(res.body)).toMatch(/REASON_REQUIRED/);
      }
      expect((await roleRow(r.roleId)).reviewStatus).toBe('PENDING');

      await POST(`${BASE}/roles/${r.roleId}/reject`, admin.token, { reason: 'duplicate of another record' }).expect(200);
      await POST(`${BASE}/roles/${r.roleId}/reopen`, admin.token, { reason: 'second look' }).expect(200);
      await POST(`${BASE}/roles/${r.roleId}/approve`, admin.token).expect(200);
      await POST(`${BASE}/roles/${r.roleId}/unpublish`, admin.token, { reason: 'company merged' }).expect(200);

      const trail = (await auditFor(r.roleId)).map((a) => [a.action, (a.oldValues as any)?.reviewStatus, (a.newValues as any).reviewStatus]).reverse();
      expect(trail).toEqual([
        ['PEOPLE_ROLE_REJECTED', 'PENDING', 'REJECTED'],
        ['PEOPLE_ROLE_REOPENED', 'REJECTED', 'PENDING'],
        ['PEOPLE_ROLE_PUBLISHED', 'PENDING', 'APPROVED'],
        ['PEOPLE_ROLE_UNPUBLISHED', 'APPROVED', 'PENDING'],
      ]);
      expect((await auditFor(r.roleId)).every((a) => a.userId === admin.id)).toBe(true);
      const detail = (await GET(`${BASE}/roles/${r.roleId}`, admin.token).expect(200)).body.data;
      expect(detail.auditTrail.length).toBe(4);
      expect(detail.auditTrail[0].reviewerEmail).toBe('reviewer.admin@orion.test');
    });

    it('a reopened or approved role cannot be reopened again; an approved role is not re-approved into a different state', async () => {
      const r = await ingestOne({ personName: 'State Sid' });
      await POST(`${BASE}/roles/${r.roleId}/reopen`, admin.token, { reason: 'x1x' }).expect(409);
      await POST(`${BASE}/roles/${r.roleId}/approve`, admin.token).expect(200);
      await POST(`${BASE}/roles/${r.roleId}/approve`, admin.token).expect(200); // idempotent
      await POST(`${BASE}/roles/${r.roleId}/reopen`, admin.token, { reason: 'x1x' }).expect(409);
    });

    it('quarantining a role adds it to the existing quarantine queue; resolving reopens the role', async () => {
      const r = await ingestOne({ personName: 'Held Hal' });
      await POST(`${BASE}/roles/${r.roleId}/quarantine`, admin.token, { reason: 'company name mismatch' }).expect(200);
      expect((await roleRow(r.roleId)).reviewStatus).toBe('QUARANTINED');
      expect(((await GET(`${BASE}/queue?q=Held%20Hal`, admin.token)).body.data as any[])).toEqual([]); // out of the pending queue

      const list = (await GET(`${BASE}/quarantine?batchRef=review`, admin.token).expect(200)).body.data as any[];
      const item = list.find((x) => x.personName === 'Held Hal')!;
      expect(item).toMatchObject({ kind: 'REVIEWER_QUARANTINE', status: 'PENDING', reasons: [{ code: 'REVIEWER_QUARANTINE', message: 'company name mismatch' }] });
      const detail = (await GET(`${BASE}/quarantine/${item.id}`, admin.token).expect(200)).body.data;
      expect(detail).toMatchObject({ kind: 'REVIEWER_QUARANTINE', roleId: r.roleId });

      await POST(`${BASE}/quarantine/${item.id}/resolve`, admin.token, { reason: 'company confirmed' }).expect(200);
      expect(await roleRow(r.roleId)).toMatchObject({ reviewStatus: 'PENDING', isPublished: false });
      expect((await GET(`${BASE}/queue?q=Held%20Hal`, admin.token)).body.data).toHaveLength(1);
      const closed = (await GET(`${BASE}/quarantine?status=RESOLVED`, admin.token)).body.data as any[];
      expect(closed.find((x) => x.id === item.id)).toBeDefined();
    });
  });

  // ================================================================ edit
  describe('reviewer edits', () => {
    it('requires a reason and at least one real change', async () => {
      const r = await ingestOne({ personName: 'Edit Ed' });
      await PATCH(`${BASE}/roles/${r.roleId}`, admin.token, { jobTitle: 'Director' }).expect(400);
      const res = await PATCH(`${BASE}/roles/${r.roleId}`, admin.token, { reason: 'no change', jobTitle: 'CEO' }).expect(400);
      expect(JSON.stringify(res.body)).toMatch(/NO_CHANGES/);
    });

    it('corrects name, title and classification; records previous and new values; the old spelling still finds the person', async () => {
      const co = await seedBusiness(db, `edit-1-${++seq}`);
      const r = await ingestOne({ businessId: co.id, personName: 'Arun Kumr', jobTitle: 'Director' });
      const res = await PATCH(`${BASE}/roles/${r.roleId}`, admin.token, { reason: 'typo per registry filing', fullName: 'Arun Kumar', jobTitle: 'Managing Director' }).expect(200);
      expect(res.body.data.changes).toEqual(
        expect.arrayContaining([
          { field: 'fullName', from: 'Arun Kumr', to: 'Arun Kumar' },
          { field: 'jobTitle', from: 'Director', to: 'Managing Director' },
          { field: 'decisionMakerType', from: 'DIRECTOR_PARTNER', to: 'MANAGING_DIRECTOR' },
        ]),
      );
      expect(await personRow(r.personId)).toMatchObject({ fullName: 'Arun Kumar', normalizedName: 'arun kumar', nameAliases: ['arun kumr'], firstName: 'Arun', lastName: 'Kumar' });
      expect(await roleRow(r.roleId)).toMatchObject({ jobTitleAtCompany: 'Managing Director', decisionMakerType: 'MANAGING_DIRECTOR', classificationSource: 'AUTO' });

      const [audit] = await auditFor(r.roleId);
      expect(audit).toMatchObject({ action: 'PEOPLE_ROLE_EDITED', userId: admin.id });
      expect(audit.oldValues).toMatchObject({ fullName: 'Arun Kumr', jobTitle: 'Director' });
      expect(audit.newValues).toMatchObject({ fullName: 'Arun Kumar', jobTitle: 'Managing Director', reason: 'typo per registry filing', reviewedBy: admin.email });

      // re-uploading the misspelled row must not create a second person
      const again = (await ingest.ingest([rec({ businessId: co.id, personName: 'Arun Kumr', jobTitle: 'Director' })])).results[0];
      expect(again.personId).toBe(r.personId);
      expect(await db.select().from(schema.people).where(eq(schema.people.normalizedName, 'arun kumr'))).toHaveLength(0);
    });

    it('a reviewer classification override is validated and survives re-ingestion', async () => {
      const co = await seedBusiness(db, `edit-2-${++seq}`);
      const r = await ingestOne({ businessId: co.id, personName: 'Override Olga', jobTitle: 'Sales Executive' });
      await PATCH(`${BASE}/roles/${r.roleId}`, admin.token, { reason: 'because', seniorityLevel: 'STAFF', decisionMakerType: 'FOUNDER_CEO' }).expect(400); // impossible
      await PATCH(`${BASE}/roles/${r.roleId}`, admin.token, { reason: 'because', department: 'WIZARDRY' }).expect(400);
      await PATCH(`${BASE}/roles/${r.roleId}`, admin.token, { reason: 'registry lists her as head of sales', department: 'SALES', seniorityLevel: 'HEAD', decisionMakerType: 'SALES_DECISION_MAKER' }).expect(200);
      expect(await roleRow(r.roleId)).toMatchObject({ decisionMakerType: 'SALES_DECISION_MAKER', seniorityLevel: 'HEAD', classificationSource: 'REVIEWER' });
      await ingest.ingest([rec({ businessId: co.id, personName: 'Override Olga', jobTitle: 'Sales Executive' })]);
      expect(await roleRow(r.roleId)).toMatchObject({ decisionMakerType: 'SALES_DECISION_MAKER', seniorityLevel: 'HEAD' });
      await PATCH(`${BASE}/roles/${r.roleId}`, admin.token, { reason: 'clear it', decisionMakerType: null, seniorityLevel: 'MANAGER' }).expect(200);
      expect((await roleRow(r.roleId)).decisionMakerType).toBeNull();
    });

    it('current/former and dates are validated', async () => {
      const r = await ingestOne({ personName: 'Dates Dan' });
      await PATCH(`${BASE}/roles/${r.roleId}`, admin.token, { reason: 'because', startDate: '2024-01-01', endDate: '2023-01-01' }).expect(400);
      await PATCH(`${BASE}/roles/${r.roleId}`, admin.token, { reason: 'because', endDate: '2020-01-01' }).expect(400); // still current
      await PATCH(`${BASE}/roles/${r.roleId}`, admin.token, { reason: 'left in 2020', isCurrent: false, endDate: '2020-01-01' }).expect(200);
      expect(await roleRow(r.roleId)).toMatchObject({ isCurrent: false, endDate: '2020-01-01' });
    });

    it('refuses a title change that collides with another role of the same person', async () => {
      const co = await seedBusiness(db, `edit-3-${++seq}`);
      const a = await ingestOne({ businessId: co.id, personName: 'Clash Cal', jobTitle: 'Director' });
      await ingestOne({ businessId: co.id, personName: 'Clash Cal', jobTitle: 'Founder' });
      const res = await PATCH(`${BASE}/roles/${a.roleId}`, admin.token, { reason: 'because', jobTitle: 'founder' }).expect(409);
      expect(JSON.stringify(res.body)).toMatch(/ROLE_EXISTS/);
    });

    it('contact edits must cite a source, are validated, and come back unverified and unpublished', async () => {
      const co = await seedBusiness(db, `edit-4-${++seq}`);
      const r = await ingestOne({ businessId: co.id, personName: 'Contact Cleo', email: 'old@edit.co.in' });
      const old = (await db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, r.personId)))[0];
      await publishing.publishContact(old.id, { reviewedBy: 'seed' }); // it is published; the edit must take it offline
      expect((await db.select().from(schema.personContacts).where(eq(schema.personContacts.id, old.id)))[0].isPublished).toBe(true);

      const edit = (c: object) => PATCH(`${BASE}/roles/${r.roleId}`, admin.token, { reason: 'phoned the company', contacts: [c] });
      await edit({ contactId: old.id, type: 'WORK_EMAIL', value: 'new@edit.co.in' }).expect(400); // no source
      await edit({ contactId: old.id, type: 'WORK_EMAIL', value: 'new@edit.co.in', source: { type: 'MANUAL_IMPORT' } }).expect(400); // no reference
      await edit({ contactId: old.id, type: 'WORK_EMAIL', value: 'not-an-email', source: { type: 'MANUAL_IMPORT', reference: 'call-1' } }).expect(400);
      await edit({ contactId: old.id, type: 'WORK_EMAIL', value: 'info@edit.co.in', source: { type: 'MANUAL_IMPORT', reference: 'call-1' } }).expect(400); // shared mailbox
      await edit({ type: 'PHONE', value: '12345', source: { type: 'MANUAL_IMPORT', reference: 'call-1' } }).expect(400);

      await edit({ contactId: old.id, type: 'WORK_EMAIL', value: 'New@Edit.co.in', source: { type: 'MANUAL_IMPORT', reference: 'call-1' } }).expect(200);
      const updated = (await db.select().from(schema.personContacts).where(eq(schema.personContacts.id, old.id)))[0];
      expect(updated).toMatchObject({ contactValue: 'new@edit.co.in', normalizedValue: 'new@edit.co.in', verificationStatus: 'UNVERIFIED', lastVerifiedAt: null, isPublished: false });
      const ev = (await db.select().from(schema.peopleEvidence).where(eq(schema.peopleEvidence.contactId, old.id))).find((e) => e.evidenceType === 'REVIEWER_EDIT')!;
      expect(ev).toMatchObject({ sourceType: 'MANUAL_IMPORT', sourceReference: 'call-1', verifiedAt: null });

      // adding a new number
      await edit({ type: 'MOBILE', value: '98765 43210', source: { type: 'USER_SUBMISSION', reference: 'form-12' } }).expect(200);
      expect((await db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, r.personId))).map((c) => c.normalizedValue).sort()).toEqual(['+919876543210', 'new@edit.co.in']);
      const audit = (await auditFor(r.roleId))[0];
      expect(audit.newValues).toMatchObject({ 'contact.MOBILE': '+919876543210' });
    });

    it('will not move an email that belongs to another person or duplicate an existing value', async () => {
      const co = await seedBusiness(db, `edit-5-${++seq}`);
      const a = await ingestOne({ businessId: co.id, personName: 'Owner Olive', email: 'olive@edit5.co.in' });
      const b = await ingestOne({ businessId: co.id, personName: 'Thief Theo', email: 'theo@edit5.co.in' });
      const src = { type: 'MANUAL_IMPORT', reference: 'r' };
      const res = await PATCH(`${BASE}/roles/${b.roleId}`, admin.token, { reason: 'because', contacts: [{ type: 'WORK_EMAIL', value: 'olive@edit5.co.in', source: src }] }).expect(409);
      expect(JSON.stringify(res.body)).toMatch(/CONTACT_BELONGS_TO_ANOTHER_PERSON/);
      const dup = await PATCH(`${BASE}/roles/${a.roleId}`, admin.token, { reason: 'because', contacts: [{ type: 'WORK_EMAIL', value: 'OLIVE@edit5.co.in', source: src }] }).expect(409);
      expect(JSON.stringify(dup.body)).toMatch(/CONTACT_EXISTS/);
    });

    it('a contact id from another person is not editable (IDOR)', async () => {
      const co = await seedBusiness(db, `edit-6-${++seq}`);
      const a = await ingestOne({ businessId: co.id, personName: 'Mine Mia', email: 'mia@edit6.co.in' });
      const b = await ingestOne({ businessId: co.id, personName: 'Theirs Tom', email: 'tom@edit6.co.in' });
      const theirs = (await db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, b.personId)))[0];
      await PATCH(`${BASE}/roles/${a.roleId}`, admin.token, { reason: 'because', contacts: [{ contactId: theirs.id, type: 'WORK_EMAIL', value: 'hijack@edit6.co.in', source: { type: 'MANUAL_IMPORT', reference: 'r' } }] }).expect(404);
      expect((await db.select().from(schema.personContacts).where(eq(schema.personContacts.id, theirs.id)))[0].contactValue).toBe('tom@edit6.co.in');
    });

    it('supporting evidence can be added but is never verified by an edit', async () => {
      const r = await ingestOne({ personName: 'Evidence Eve' });
      await PATCH(`${BASE}/roles/${r.roleId}`, admin.token, { reason: 'because', addEvidence: [{ sourceType: 'MANUAL_IMPORT', evidenceType: 'annual report' }] }).expect(400); // no locator
      await PATCH(`${BASE}/roles/${r.roleId}`, admin.token, { reason: 'found in annual report p.4', addEvidence: [{ sourceType: 'MANUAL_IMPORT', evidenceType: 'annual report', sourceReference: 'AR-2025 p4' }] }).expect(200);
      const ev = (await db.select().from(schema.peopleEvidence).where(eq(schema.peopleEvidence.companyPersonId, r.roleId))).find((e) => e.evidenceType === 'ANNUAL_REPORT')!;
      expect(ev).toMatchObject({ verifiedAt: null, sourceReference: 'AR-2025 p4' });
      expect((await roleRow(r.roleId)).verificationStatus).toBe('UNVERIFIED');
      // adding the same evidence twice is a no-op
      await PATCH(`${BASE}/roles/${r.roleId}`, admin.token, { reason: 'again', addEvidence: [{ sourceType: 'MANUAL_IMPORT', evidenceType: 'annual report', sourceReference: 'AR-2025 p4' }] }).expect(400);
    });

    it('edit-and-approve is atomic: a failed approval rolls the edit back', async () => {
      const bare = await write.upsertPersonForBusiness({ businessId: acme.id, person: { fullName: 'Atomic Edit' }, role: { jobTitle: 'Director' } });
      const res = await POST(`${BASE}/roles/${bare.companyPersonId}/edit-and-approve`, admin.token, { reason: 'fix and publish', jobTitle: 'Managing Director' }).expect(409);
      expect(JSON.stringify(res.body)).toMatch(/EVIDENCE_REQUIRED/);
      expect(await roleRow(bare.companyPersonId)).toMatchObject({ jobTitleAtCompany: 'Director', isPublished: false });
      expect((await auditFor(bare.companyPersonId)).length).toBe(0);
    });

    it('edit-and-approve edits, cites the reviewer\'s evidence, and publishes in one step', async () => {
      const co = await seedBusiness(db, `edit-7-${++seq}`);
      const r = await ingestOne({ businessId: co.id, personName: 'Combo Cora', jobTitle: 'Director' });
      const res = await POST(`${BASE}/roles/${r.roleId}/edit-and-approve`, admin.token, { reason: 'fix title, publish', jobTitle: 'Managing Director' }).expect(200);
      expect(res.body.data.changes.find((c: any) => c.field === 'jobTitle')).toBeDefined();
      expect(res.body.data.detail.role).toMatchObject({ jobTitle: 'Managing Director', isPublished: true, reviewStatus: 'APPROVED' });
      expect((await custList(co))[0]).toMatchObject({ jobTitle: 'Managing Director' });
      expect((await auditFor(r.roleId)).map((a) => a.action).sort()).toEqual(['PEOPLE_ROLE_EDITED', 'PEOPLE_ROLE_PUBLISHED']);
    });

    it('a suppressed person cannot be edited', async () => {
      const r = await ingestOne({ personName: 'Gone Gil' });
      await POST(`${BASE}/people/${r.personId}/suppress`, admin.token, { reason: 'takedown' }).expect(200);
      await PATCH(`${BASE}/roles/${r.roleId}`, admin.token, { reason: 'because', jobTitle: 'Founder' }).expect(409);
    });
  });

  // ================================================================ quarantine workflow
  describe('quarantine workflow', () => {
    const quarantined = async (over: Partial<IRawPersonRecord>) => {
      const raw = rec(over);
      const r = (await ingest.ingest([raw], { batchRef: `qtest-${++seq}` })).results[0];
      expect(r.outcome).toBe('QUARANTINED');
      const row = (await db.select().from(schema.peopleIngestionQuarantine).where(eq(schema.peopleIngestionQuarantine.raw, raw as any)))[0]
        ?? (await db.select().from(schema.peopleIngestionQuarantine).orderBy(desc(schema.peopleIngestionQuarantine.createdAt)).limit(1))[0];
      return { raw, id: row.id, reasons: r.reasons! };
    };

    it('lists quarantined records with reason codes and filters by code and batch', async () => {
      const q = await quarantined({ personName: 'Tinylist' }); // single name
      const list = (await GET(`${BASE}/quarantine?code=NAME_INCOMPLETE`, admin.token).expect(200)).body.data as any[];
      expect(list.find((x) => x.id === q.id)).toMatchObject({ kind: 'INGESTION', status: 'PENDING', personName: 'Tinylist', reasons: [{ code: 'NAME_INCOMPLETE' }] });
      expect(((await GET(`${BASE}/quarantine?code=AMBIGUOUS_IDENTITY&batchRef=nope`, admin.token)).body.data as any[])).toEqual([]);
    });

    it('detail shows raw + normalized payload, validation errors, company problem and source', async () => {
      const q = await quarantined({ businessId: undefined, businessSlug: 'no-such-company', personName: 'Ghost Company Gus', source: { type: 'PARTNER_FEED', reference: 'feed-3', url: 'https://feed.example/x' } });
      const d = (await GET(`${BASE}/quarantine/${q.id}`, admin.token).expect(200)).body.data;
      expect(d.raw).toMatchObject({ personName: 'Ghost Company Gus', businessSlug: 'no-such-company' });
      expect(d.normalized).toMatchObject({ upsert: { person: { fullName: 'Ghost Company Gus' } } });
      expect(d.reasons[0].code).toBe('BUSINESS_NOT_FOUND');
      expect(d.companyMatch.status).toBe('NOT_FOUND');
      expect(d.source).toMatchObject({ type: 'PARTNER_FEED', reference: 'feed-3' });
      expect(d.createdAt).toBeDefined();

      const inv = await quarantined({ personName: 'Mono' });
      const di = (await GET(`${BASE}/quarantine/${inv.id}`, admin.token).expect(200)).body.data;
      expect(di.normalized).toBeNull();
      expect(di.validationErrors.map((e: any) => e.code)).toContain('NAME_INCOMPLETE');
      expect(di.companyMatch).toMatchObject({ status: 'MATCHED', businessId: acme.id });
    });

    it('ambiguous identity is NOT retried automatically; a reviewer supplies the identifier and retries -> DRAFT role enters the review queue', async () => {
      const co = await seedBusiness(db, `qa-${++seq}`);
      await ingestOne({ businessId: co.id, personName: 'Ravi Shankar', jobTitle: 'CTO', linkedinUrl: 'linkedin.com/in/qa-rs-cto' });
      await ingestOne({ businessId: co.id, personName: 'Ravi Shankar', jobTitle: 'CFO', linkedinUrl: 'linkedin.com/in/qa-rs-cfo' });
      const q = await quarantined({ businessId: co.id, personName: 'Ravi Shankar', jobTitle: 'Director' });
      expect(q.reasons[0].code).toBe('AMBIGUOUS_IDENTITY');

      // nothing retried on its own: re-ingesting the same file keeps ONE pending item
      await ingest.ingest([q.raw]);
      const pending = (await GET(`${BASE}/quarantine?code=AMBIGUOUS_IDENTITY`, admin.token)).body.data as any[];
      expect(pending.filter((x) => x.id === q.id)).toHaveLength(1);

      const d = (await GET(`${BASE}/quarantine/${q.id}`, admin.token).expect(200)).body.data;
      expect(d.identityCandidates.map((c: any) => c.jobTitle).sort()).toEqual(['CFO', 'CTO']);

      // a bare retry fails again and stays pending
      const again = await POST(`${BASE}/quarantine/${q.id}/retry`, admin.token, { reason: 'try again' }).expect(200);
      expect(again.body.data).toMatchObject({ status: 'PENDING', outcome: 'QUARANTINED' });
      // fields that would rewrite provenance are refused
      await POST(`${BASE}/quarantine/${q.id}/retry`, admin.token, { reason: 'x1x', patch: { source: { type: 'GOVERNMENT_REGISTRY' } } }).expect(400);
      await POST(`${BASE}/quarantine/${q.id}/retry`, admin.token, { reason: 'x1x', patch: { verification: { status: 'VERIFIED' } } }).expect(400);
      await POST(`${BASE}/quarantine/${q.id}/retry`, admin.token, { patch: { linkedinUrl: 'linkedin.com/in/qa-rs-dir' } }).expect(400); // reason required

      const fixed = await POST(`${BASE}/quarantine/${q.id}/retry`, admin.token, { reason: 'LinkedIn from the annual report', patch: { linkedinUrl: 'https://linkedin.com/in/qa-rs-dir' } }).expect(200);
      expect(fixed.body.data).toMatchObject({ status: 'RESOLVED', outcome: 'CREATED' });
      const role = await roleRow(fixed.body.data.companyPersonId);
      expect(role).toMatchObject({ reviewStatus: 'PENDING', isPublished: false });
      expect(await custNames(co)).toEqual([]); // resolved does not mean published
      const queue = (await GET(`${BASE}/queue?businessId=${co.id}&q=Director`, admin.token)).body.data as any[];
      expect(queue.map((x) => x.id)).toContain(role.id);
      const closed = (await db.select().from(schema.peopleIngestionQuarantine).where(eq(schema.peopleIngestionQuarantine.id, q.id)))[0];
      expect(closed.status).toBe('RESOLVED');
      expect(closed.resolution).toMatchObject({ action: 'RETRY', by: admin.email, outcome: 'CREATED' });
      // audited, with the patched fields before/after
      const [audit] = await auditFor(q.id);
      expect(audit).toMatchObject({ action: 'PEOPLE_QUARANTINE_RETRIED', userId: admin.id });
      expect(audit.newValues).toMatchObject({ raw: { linkedinUrl: 'https://linkedin.com/in/qa-rs-dir' } });
      expect(audit.oldValues).toMatchObject({ raw: { linkedinUrl: null } });
      // a closed item cannot be closed again
      await POST(`${BASE}/quarantine/${q.id}/reject`, admin.token, { reason: 'x1x' }).expect(409);
    });

    it('retry failing for a missing company does not create a second quarantine row', async () => {
      const q = await quarantined({ businessId: undefined, businessSlug: 'still-missing', personName: 'Lost Larry' });
      const before = (await db.select().from(schema.peopleIngestionQuarantine)).length;
      await POST(`${BASE}/quarantine/${q.id}/retry`, admin.token, { reason: 'checking', patch: { businessSlug: 'also-missing' } }).expect(200);
      expect((await db.select().from(schema.peopleIngestionQuarantine)).length).toBe(before);
      const ok = await POST(`${BASE}/quarantine/${q.id}/retry`, admin.token, { reason: 'right company', patch: { businessSlug: acme.slug } }).expect(200);
      expect(ok.body.data).toMatchObject({ status: 'RESOLVED', outcome: 'CREATED' });
    });

    it('reject discards; resolve closes with a note; suppress blocks the person', async () => {
      const a = await quarantined({ personName: 'Discarddi' });
      await POST(`${BASE}/quarantine/${a.id}/reject`, admin.token, { reason: 'junk row' }).expect(200);
      expect((await db.select().from(schema.peopleIngestionQuarantine).where(eq(schema.peopleIngestionQuarantine.id, a.id)))[0].status).toBe('DISCARDED');

      const b = await quarantined({ personName: 'Handledhank' });
      await POST(`${BASE}/quarantine/${b.id}/resolve`, admin.token, { reason: 'fixed in source file' }).expect(200);
      expect((await db.select().from(schema.peopleIngestionQuarantine).where(eq(schema.peopleIngestionQuarantine.id, b.id)))[0]).toMatchObject({ status: 'RESOLVED', resolution: expect.objectContaining({ action: 'RESOLVED_MANUALLY' }) });

      // suppress from a quarantined record that cannot be tied to a person -> needs personId
      const co = await seedBusiness(db, `qs-${++seq}`);
      const bad = await quarantined({ businessId: co.id, personName: 'Nobody', jobTitle: undefined });
      const need = await POST(`${BASE}/quarantine/${bad.id}/suppress`, admin.token, { reason: 'opt-out' }).expect(409);
      expect(JSON.stringify(need.body)).toMatch(/PERSON_REQUIRED/);

      // suppress from a valid-but-held record: creates a suppressed stub so it can never be ingested
      const held = await quarantined({ businessId: undefined, businessSlug: 'not-yet', personName: 'Blocked Bea', jobTitle: 'CEO', linkedinUrl: 'linkedin.com/in/blocked-bea' });
      const later = await seedBusiness(db, 'not-yet');
      // the company exists now, so the record resolves and a stub can be created
      const sup = await POST(`${BASE}/quarantine/${held.id}/suppress`, admin.token, { reason: 'person asked not to be listed' }).expect(200);
      expect(sup.body.data).toMatchObject({ status: 'DISCARDED', action: 'SUPPRESSED' });
      expect((await personRow(sup.body.data.personId)).dataStatus).toBe('SUPPRESSED');
      const retry = (await ingest.ingest([rec({ businessId: later.id, personName: 'Blocked Bea', jobTitle: 'CEO', linkedinUrl: 'linkedin.com/in/blocked-bea' })])).results[0];
      expect(retry.outcome).toBe('QUARANTINED');
      expect(retry.reasons![0].code).toBe('SUPPRESSED_PERSON'); // renamed in Phase 6.4
      expect(await custNames(later)).toEqual([]);
    });

    it('quarantine data is not reachable by customers', async () => {
      const q = await quarantined({ personName: 'Hidden Hal2', email: 'hal@quarantine.example' });
      for (const p of [`quarantine`, `quarantine/${q.id}`]) await GET(`${BASE}/${p}`, customer.token).expect(403);
      for (const p of ['resolve', 'retry', 'reject', 'suppress']) await POST(`${BASE}/quarantine/${q.id}/${p}`, customer.token, {}).expect(403);
      expect((await db.select().from(schema.peopleIngestionQuarantine).where(eq(schema.peopleIngestionQuarantine.id, q.id)))[0].status).toBe('PENDING');
    });
  });

  // ================================================================ end-to-end domain flow
  describe('end to end: upload -> DRAFT -> review -> PUBLISHED -> customer', () => {
    it('follows the whole path and exposes only what was approved', async () => {
      const co = await seedBusiness(db, `e2e-${++seq}`);
      const li = `linkedin.com/in/e2e-mira-${seq}`;
      // 1-2. upload: two roles for one person, another person, all DRAFT
      const report = await ingest.ingest([
        rec({ businessId: co.id, personName: 'MIRA Roy', jobTitle: 'Managing Director', linkedinUrl: li, email: 'mira@e2e.co.in', source: { type: 'GOVERNMENT_REGISTRY', reference: 'filing-1', observedAt: '2026-06-01' } }),
        rec({ businessId: co.id, personName: 'Mira Roy', jobTitle: 'Director', linkedinUrl: li }),
        rec({ businessId: co.id, personName: 'Nikhil Rao', jobTitle: 'Head of Procurement', email: 'nikhil@e2e.co.in' }),
      ]);
      expect(report).toMatchObject({ created: 2, updated: 1, quarantined: 0 });
      expect(await custNames(co)).toEqual([]);

      // 3. reviewer opens the queue
      const queue = (await GET(`${BASE}/queue?businessId=${co.id}`, admin.token).expect(200)).body.data as any[];
      expect(queue.map((x) => x.jobTitle).sort()).toEqual(['Director', 'Head of Procurement', 'Managing Director']);
      const md = queue.find((x) => x.jobTitle === 'Managing Director');

      // 4. views evidence
      const detail = (await GET(`${BASE}/roles/${md.id}`, admin.token).expect(200)).body.data;
      expect(detail.evidence.find((e: any) => e.scope === 'ROLE')).toMatchObject({ sourceType: 'GOVERNMENT_REGISTRY', sourceReference: 'filing-1' });

      // 5. edits the person (display name is a case fix; normalised name unchanged)
      await PATCH(`${BASE}/roles/${md.id}`, admin.token, { reason: 'fix casing from filing', fullName: 'Mira Roy' }).expect(200);

      // 6-7. approves the MD role only (+ her work email)
      const emailId = detail.contacts.find((c: any) => c.type === 'WORK_EMAIL').id;
      await POST(`${BASE}/roles/${md.id}/approve`, admin.token, { reason: 'registry filing matches', publishContactIds: [emailId] }).expect(200);

      // 8. customers see the published role, with the email locked until unlock
      const seen = await custList(co);
      expect(seen.map((p) => [p.fullName, p.jobTitle])).toEqual([['Mira Roy', 'Managing Director']]);
      expect(seen[0].contacts.email).toMatchObject({ available: true, value: null });

      // 9. the other roles stay DRAFT
      expect((await GET(`${BASE}/queue?businessId=${co.id}`, admin.token)).body.data.map((x: any) => x.jobTitle).sort()).toEqual(['Director', 'Head of Procurement']);
      expect(seen[0].additionalRoles).toEqual([]);
      expect(JSON.stringify(await custList(co))).not.toMatch(/Nikhil|nikhil@|Head of Procurement/);

      // ...and customers can unlock only what was published
      await POST(`/people/${md.personId}/unlock`, customer.token).expect(200);
      const unlocked = (await GET(`/people/${md.personId}`, customer.token)).body.data;
      expect(unlocked.contacts.email.value).toBe('mira@e2e.co.in');
    });

    it('duplicate person: re-uploading does not create a second person or a second queue item', async () => {
      const co = await seedBusiness(db, `dup-${++seq}`);
      const row = rec({ businessId: co.id, personName: 'Dup Dora', jobTitle: 'CEO' });
      await ingest.ingest([row]);
      const again = await ingest.ingest([row, { ...row, personName: 'DUP DORA' }]);
      expect(again).toMatchObject({ created: 0, unchanged: 2 });
      expect((await GET(`${BASE}/queue?businessId=${co.id}`, admin.token)).body.pagination.totalItems).toBe(1);
    });

    it('a new role for an already-published person lands in the queue and stays hidden', async () => {
      const li = `linkedin.com/in/newrole-${++seq}`;
      const coA = await seedBusiness(db, `nr-a-${seq}`);
      const coB = await seedBusiness(db, `nr-b-${seq}`);
      const a = await ingestOne({ businessId: coA.id, personName: 'New Role Nia', linkedinUrl: li });
      await POST(`${BASE}/roles/${a.roleId}/approve`, admin.token).expect(200);
      const b = await ingestOne({ businessId: coB.id, personName: 'New Role Nia', jobTitle: 'Director', linkedinUrl: li });
      expect(b.personId).toBe(a.personId);
      expect(await custNames(coB)).toEqual([]);
      expect(((await GET(`${BASE}/queue?businessId=${coB.id}`, admin.token)).body.data as any[]).map((x) => x.id)).toEqual([b.roleId]);
      expect(await custNames(coA)).toEqual(['New Role Nia']);
    });

    it('a verified, approved person is not downgraded or un-published by weaker re-ingestion', async () => {
      const co = await seedBusiness(db, `weak-${++seq}`);
      const strong = await ingestOne({
        businessId: co.id, personName: 'Strong Sal', jobTitle: 'Managing Director', confidenceScore: 90,
        verification: { status: 'VERIFIED', verifiedAt: daysAgo(10), verifiedBy: 'rev' },
      });
      await POST(`${BASE}/roles/${strong.roleId}/approve`, admin.token).expect(200);
      const before = await roleRow(strong.roleId);
      for (let i = 0; i < 2; i++) await ingest.ingest([rec({ businessId: co.id, personName: 'Strong Sal', jobTitle: 'managing director', confidenceScore: 5, verification: { status: 'UNVERIFIED' } })]);
      const after = await roleRow(strong.roleId);
      expect(after).toMatchObject({ verificationStatus: 'VERIFIED', confidenceScore: 90, isPublished: true, reviewStatus: 'APPROVED' });
      expect(after.lastVerifiedAt!.getTime()).toBe(before.lastVerifiedAt!.getTime());
      expect((await custList(co))[0].verification).toMatchObject({ status: 'VERIFIED', assertion: 'KNOWN' });
    });

    it('a rejected role stays rejected when the same person is uploaded again', async () => {
      const co = await seedBusiness(db, `rej-${++seq}`);
      const r = await ingestOne({ businessId: co.id, personName: 'Rejected Ron' });
      await POST(`${BASE}/roles/${r.roleId}/reject`, admin.token, { reason: 'not this company' }).expect(200);
      const again = await ingest.ingest([rec({ businessId: co.id, personName: 'Rejected Ron' })]);
      expect(again.results[0].personId).toBe(r.personId);
      expect(await roleRow(r.roleId)).toMatchObject({ reviewStatus: 'REJECTED', isPublished: false });
      expect((await GET(`${BASE}/queue?businessId=${co.id}`, admin.token)).body.data).toEqual([]);
    });
  });

  // ================================================================ static architecture checks
  describe('static architecture checks', () => {
    const SRC_DIR = path.resolve(__dirname, '../../..');
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === '__tests__' || e.name === 'migrations' ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]));
    const files = walk(SRC_DIR).filter((f) => f.endsWith('.ts'));
    const read = (f: string) => fs.readFileSync(f, 'utf8');

    it('the import module does not access People tables or writers directly', () => {
      const importFiles = files.filter((f) => f.includes(`${path.sep}modules${path.sep}import${path.sep}`));
      const offenders = importFiles.filter((f) => /schema\.(people|companyPeople|personContacts|peopleEvidence|personUnlocks|peopleIngestionQuarantine)\b|PeopleWriteService|(?<!I)PeopleIngestionService|PeoplePublishingService|PeopleReviewService/.test(read(f)));
      expect(offenders).toEqual([]);
    });

    it('customer-facing controllers expose no review, publishing or ingestion routes', () => {
      const customer = files.filter((f) => /\.controller\.ts$/.test(f) && !/people-review\.controller\.ts$/.test(f));
      const offenders = customer.filter((f) => /PeopleReviewService|PeopleQuarantineService|PeoplePublishingService|PeopleIngestionService|PeopleWriteService|internal\/people-review/.test(read(f)));
      expect(offenders.map((f) => path.basename(f))).toEqual([]);
      const proto = PeopleController.prototype as any;
      const paths = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor').map((n) => String(Reflect.getMetadata('path', proto[n])));
      expect(paths.join(' ').toLowerCase()).not.toMatch(/review|publish|quarantine|suppress|ingest|approve/);
    });

    it('publishing logic is centralised: only PeoplePublishingService sets is_published / review_status to APPROVED for reviews', () => {
      const writers = files.filter((f) => /isPublished:\s*(true|published)|reviewStatus:\s*'APPROVED'|reviewStatus:\s*status/.test(read(f)) && !/database[\\/]schema/.test(f));
      expect(writers.map((f) => path.basename(f)).sort()).toEqual(['people-publishing.service.ts', 'people-write.service.ts']);
      const review = read(path.join(SRC_DIR, 'modules/people/review/people-review.service.ts')) + read(path.join(SRC_DIR, 'modules/people/review/people-review.controller.ts')) + read(path.join(SRC_DIR, 'modules/people/review/people-quarantine.service.ts'));
      expect(review).not.toMatch(/isPublished:\s*true|reviewStatus:\s*'APPROVED'/);
    });

    it('no government portal, Apollo, SignalHire or ContactOut integration exists', () => {
      const offenders = files.filter((f) => /[a-z0-9.-]*(mca|udyamregistration|fssai|startupindia)[a-z0-9.-]*\.gov\.in|api\.apollo\.io|signalhire\.com|contactout\.com/i.test(read(f)));
      expect(offenders).toEqual([]);
    });

    it('reuses the existing audit table and auth guards (no second system)', () => {
      const publishing = read(path.join(SRC_DIR, 'modules/people/people-publishing.service.ts'));
      expect(publishing).toMatch(/schema\.auditLogs/);
      const controller = read(path.join(SRC_DIR, 'modules/people/review/people-review.controller.ts'));
      expect(controller).toMatch(/JwtAuthGuard/);
      expect(controller).toMatch(/RolesGuard/);
      expect(fs.readdirSync(path.join(SRC_DIR, 'database/schema')).filter((f) => /audit/i.test(f))).toEqual(['audits.ts']);
    });
  });

  // ================================================================ migration
  describe('migration 0007', () => {
    it('backfills review_status exactly once and keeps existing published roles visible', async () => {
      const before = await createTestDb(['0000_bent_johnny_storm.sql', '0001_blushing_loa.sql', '0002_typical_clint_barton.sql', '0004_decision_maker_people.sql', '0005_people_ingestion.sql', '0006_import_people_report.sql']);
      try {
        await before.client.exec(`
          INSERT INTO businesses (id, slug, name, status) VALUES ('11111111-1111-1111-1111-111111111111','m','M','PUBLISHED');
          INSERT INTO people (id, full_name, normalized_name, data_status) VALUES ('22222222-2222-2222-2222-222222222222','A B','a b','PUBLISHED');
          INSERT INTO company_people (id, business_id, person_id, job_title_at_company, normalized_job_title, is_published)
            VALUES ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','CEO','ceo', true),
                   ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Director','director', false);
        `);
        const sqlText = fs.readFileSync(path.resolve(SRC_DIR, 'database/migrations/0007_people_review.sql'), 'utf8');
        await before.client.exec(sqlText);
        const q = () => before.client.query<{ job_title_at_company: string; review_status: string; is_published: boolean }>('SELECT job_title_at_company, review_status, is_published FROM company_people ORDER BY job_title_at_company');
        expect((await q()).rows).toEqual([
          { job_title_at_company: 'CEO', review_status: 'APPROVED', is_published: true },
          { job_title_at_company: 'Director', review_status: 'PENDING', is_published: false },
        ]);
        await before.client.exec(`UPDATE company_people SET review_status = 'REJECTED' WHERE job_title_at_company = 'Director'`);
        await before.client.exec(sqlText); // idempotent, no re-backfill
        expect((await q()).rows[1].review_status).toBe('REJECTED');
      } finally {
        await before.client.close();
      }
    });

    it('only touches people-layer tables', () => {
      const text = fs.readFileSync(path.resolve(SRC_DIR, 'database/migrations/0007_people_review.sql'), 'utf8');
      const touched = [...text.matchAll(/(?:ALTER TABLE|(?<!ON )UPDATE)\s+"(\w+)"/g)].map((m) => m[1]);
      expect(new Set(touched)).toEqual(new Set(['company_people', 'people', 'people_ingestion_quarantine']));
      expect(text).not.toMatch(/DROP|CREATE TABLE|(?<!ON )DELETE/i);
    });
  });

  // ================================================================ role identity (stabilization)
  describe('role identity across title changes and re-ingestion', () => {
    const rolesOf = async (businessId: string, personId: string) =>
      db.select().from(schema.companyPeople).where(and(eq(schema.companyPeople.businessId, businessId), eq(schema.companyPeople.personId, personId)));
    const evidenceCount = async (roleId: string) =>
      (await db.select().from(schema.peopleEvidence).where(eq(schema.peopleEvidence.companyPersonId, roleId))).length;

    it('CEO and Chief Executive Officer are the same role (no duplicate)', async () => {
      const co = await seedBusiness(db, `ident-a-${++seq}`);
      const a = await ingestOne({ businessId: co.id, personName: 'Ident Alpha', jobTitle: 'CEO' });
      const b = await ingestOne({ businessId: co.id, personName: 'Ident Alpha', jobTitle: 'Chief Executive Officer' });
      expect(b.roleId).toBe(a.roleId);
      expect(await rolesOf(co.id, a.personId)).toHaveLength(1);
    });

    it('CEO -> reviewer sets Chief Executive Officer -> original upload does not create a role', async () => {
      const co = await seedBusiness(db, `ident-b-${++seq}`);
      const a = await ingestOne({ businessId: co.id, personName: 'Ident Beta', jobTitle: 'CEO' });
      await PATCH(`${BASE}/roles/${a.roleId}`, admin.token, { reason: 'spell out title', jobTitle: 'Chief Executive Officer' }).expect(200);
      const again = await ingestOne({ businessId: co.id, personName: 'Ident Beta', jobTitle: 'CEO' });
      expect(again.roleId).toBe(a.roleId);
      expect(await rolesOf(co.id, a.personId)).toHaveLength(1);
    });

    it('CEO -> Managing Director (reviewer): the old title resolves to the same role, repeatedly', async () => {
      const co = await seedBusiness(db, `ident-c-${++seq}`);
      const a = await ingestOne({ businessId: co.id, personName: 'Ident Gamma', jobTitle: 'CEO' });
      await PATCH(`${BASE}/roles/${a.roleId}`, admin.token, { reason: 'registry shows MD', jobTitle: 'Managing Director' }).expect(200);
      const row = await roleRow(a.roleId);
      expect(row).toMatchObject({ jobTitleAtCompany: 'Managing Director', normalizedJobTitle: 'managing director' });
      expect(row.titleAliases).toEqual(['ceo']);

      for (let i = 0; i < 3; i++) {
        const again = await ingestOne({ businessId: co.id, personName: 'Ident Gamma', jobTitle: 'CEO' });
        expect(again.roleId).toBe(a.roleId);
      }
      const again2 = await ingestOne({ businessId: co.id, personName: 'Ident Gamma', jobTitle: 'Managing Director' });
      expect(again2.roleId).toBe(a.roleId);
      expect(await rolesOf(co.id, a.personId)).toHaveLength(1);
      // the reviewer wording survives ingestion
      expect((await roleRow(a.roleId)).jobTitleAtCompany).toBe('Managing Director');
    });

    it('reviewer edits (title, classification, review state) survive re-ingestion', async () => {
      const co = await seedBusiness(db, `ident-d-${++seq}`);
      const a = await ingestOne({ businessId: co.id, personName: 'Ident Delta', jobTitle: 'Director' });
      await PATCH(`${BASE}/roles/${a.roleId}`, admin.token, { reason: 'is the founder', jobTitle: 'Founder', decisionMakerType: 'FOUNDER_CEO', department: 'EXECUTIVE', seniorityLevel: 'EXECUTIVE' }).expect(200);
      await POST(`${BASE}/roles/${a.roleId}/approve`, admin.token, { reason: 'checked' }).expect(200);
      await ingestOne({ businessId: co.id, personName: 'Ident Delta', jobTitle: 'Director' });
      const row = await roleRow(a.roleId);
      expect(row).toMatchObject({ jobTitleAtCompany: 'Founder', decisionMakerType: 'FOUNDER_CEO', classificationSource: 'REVIEWER', reviewStatus: 'APPROVED', isPublished: true });
      expect(await rolesOf(co.id, a.personId)).toHaveLength(1);
    });

    it('a verified role: a reviewer changing the verified title needs re-verification (PARTIALLY_VERIFIED); a weaker re-upload under the old title then changes nothing', async () => {
      // CORRECTED in Phase 5 (was: stays VERIFIED). The reviewer changed the very value that was verified, so the title
      // claim must be re-verified; the company-relationship claim still stands. The re-upload must not move it either way.
      const co = await seedBusiness(db, `ident-e-${++seq}`);
      const first = await ingest.ingest([
        rec({ businessId: co.id, personName: 'Ident Epsilon', jobTitle: 'CEO', verification: { status: 'VERIFIED', verifiedAt: daysAgo(3), verifiedBy: 'registry desk' } }),
      ]);
      const id = first.results[0].companyPersonId!;
      expect((await roleRow(id)).verificationStatus).toBe('VERIFIED');
      await PATCH(`${BASE}/roles/${id}`, admin.token, { reason: 'title wording', jobTitle: 'Managing Director' }).expect(200);
      expect((await roleRow(id)).verificationStatus).toBe('PARTIALLY_VERIFIED');
      await ingestOne({ businessId: co.id, personName: 'Ident Epsilon', jobTitle: 'CEO', confidenceScore: 5 });
      expect((await roleRow(id)).verificationStatus).toBe('PARTIALLY_VERIFIED');
    });

    it('the same person with genuinely different titles keeps separate roles, each independently reviewed', async () => {
      const co = await seedBusiness(db, `ident-f-${++seq}`);
      const a = await ingestOne({ businessId: co.id, personName: 'Ident Zeta', jobTitle: 'CEO' });
      const b = await ingestOne({ businessId: co.id, personName: 'Ident Zeta', jobTitle: 'Head of Sales' });
      expect(b.roleId).not.toBe(a.roleId);
      await POST(`${BASE}/roles/${a.roleId}/approve`, admin.token, { reason: 'ok' }).expect(200);
      expect(await roleRow(b.roleId)).toMatchObject({ isPublished: false, reviewStatus: 'PENDING' });
      await ingestOne({ businessId: co.id, personName: 'Ident Zeta', jobTitle: 'CEO' });
      await ingestOne({ businessId: co.id, personName: 'Ident Zeta', jobTitle: 'Head of Sales' });
      expect(await rolesOf(co.id, a.personId)).toHaveLength(2);
    });

    it('re-uploading the same evidence after an edit does not duplicate evidence', async () => {
      const co = await seedBusiness(db, `ident-g-${++seq}`);
      const a = await ingestOne({ businessId: co.id, personName: 'Ident Eta', jobTitle: 'CEO' });
      const before = await evidenceCount(a.roleId);
      await PATCH(`${BASE}/roles/${a.roleId}`, admin.token, { reason: 'rename', jobTitle: 'Managing Director' }).expect(200);
      await ingestOne({ businessId: co.id, personName: 'Ident Eta', jobTitle: 'CEO' });
      await ingestOne({ businessId: co.id, personName: 'Ident Eta', jobTitle: 'CEO' });
      expect(await evidenceCount(a.roleId)).toBe(before);
    });

    it('a reviewer cannot rename a role onto another role current or former title', async () => {
      const co = await seedBusiness(db, `ident-h-${++seq}`);
      const a = await ingestOne({ businessId: co.id, personName: 'Ident Theta', jobTitle: 'CEO' });
      const b = await ingestOne({ businessId: co.id, personName: 'Ident Theta', jobTitle: 'Head of Sales' });
      await PATCH(`${BASE}/roles/${a.roleId}`, admin.token, { reason: 'rename', jobTitle: 'Managing Director' }).expect(200);
      await PATCH(`${BASE}/roles/${b.roleId}`, admin.token, { reason: 'clash', jobTitle: 'CEO' }).expect(409);
      await PATCH(`${BASE}/roles/${b.roleId}`, admin.token, { reason: 'clash', jobTitle: 'Managing Director' }).expect(409);
    });
  });

  // ================================================================ suppression registry (Phase 6.4) through the reviewer API
  describe('suppression registry via the reviewer API', () => {
    const registryRows = (personId: string) => db.select().from(schema.peopleSuppressions).where(eq(schema.peopleSuppressions.personId, personId));

    it('only ADMIN / SUPER_ADMIN may suppress; DATA_MANAGER, customers and anonymous callers cannot, and the registry is untouched', async () => {
      const li = `linkedin.com/in/rbac-sup-${++seq}`;
      const r = await ingestOne({ personName: 'Rbac Rupa', linkedinUrl: li, email: `rupa${seq}@rbac-sup.co.in` });
      for (const t of [dataManager.token, customer.token]) await POST(`${BASE}/people/${r.personId}/suppress`, t, { reason: 'not allowed' }).expect(403);
      await POST(`${BASE}/people/${r.personId}/suppress`, undefined, { reason: 'anon' }).expect(401);
      expect(await registryRows(r.personId)).toHaveLength(0);
      expect((await personRow(r.personId)).dataStatus).not.toBe('SUPPRESSED');

      await POST(`${BASE}/people/${r.personId}/suppress`, admin.token, { reason: 'removal requested by the person' }).expect(200);
      const rows = await registryRows(r.personId);
      expect(rows.map((x) => x.identityKind).sort()).toEqual(['LINKEDIN', 'WORK_EMAIL']);
      expect(rows.every((x) => x.origin === 'REVIEWER_ACTION' && x.suppressedById === admin.id && x.suppressedByLabel === admin.email && x.reason === 'removal requested by the person')).toBe(true);
      const audit = (await auditFor(r.personId)).find((a) => a.action === 'PEOPLE_PERSON_SUPPRESSED')!;
      expect(audit).toMatchObject({ userId: admin.id });
      expect(audit.newValues).toMatchObject({ identitiesRegistered: 2 });
      // the registry is invisible to customers and to the reviewer detail payload of other people
      expect(JSON.stringify((await GET(`/companies/${acme.id}/people?status=all`, customer.token).expect(200)).body)).not.toMatch(/suppress|h:[0-9a-f]{16}/i);
    });

    it('a suppressed identity stays refused from another source, with a new record id and a changed title', async () => {
      const li = `linkedin.com/in/resurrect-${++seq}`;
      const r = await ingestOne({ personName: 'Comeback Chitra', linkedinUrl: li });
      await POST(`${BASE}/people/${r.personId}/suppress`, admin.token, { reason: 'opt-out' }).expect(200);
      const before = (await db.select().from(schema.people)).length;
      const back = (await ingest.ingest([rec({ personName: 'Chitra C', jobTitle: 'Managing Director', linkedinUrl: li, source: { type: 'PARTNER_FEED', label: 'other', reference: 'other-1' } })])).results[0];
      expect(back.outcome).toBe('QUARANTINED');
      expect(back.reasons![0].code).toBe('SUPPRESSED_PERSON');
      expect((await db.select().from(schema.people)).length).toBe(before);
    });

    it('quarantine "suppress" registers with its own origin and reference; an identity that is already suppressed closes cleanly', async () => {
      const k = ++seq; // rec() also advances seq, so fix the number used in names before calling it
      const li = `linkedin.com/in/qsup-${k}`;
      const latest = async () => (await db.select().from(schema.peopleIngestionQuarantine).orderBy(desc(schema.peopleIngestionQuarantine.createdAt)).limit(1))[0];

      const held = rec({ businessId: undefined, businessSlug: `qsup-later-${k}`, personName: 'Held Hari', jobTitle: 'CEO', linkedinUrl: li });
      expect((await ingest.ingest([held], { batchRef: `qsup-${k}` })).results[0].outcome).toBe('QUARANTINED');
      const row = await latest();
      await seedBusiness(db, `qsup-later-${k}`);
      const res = await POST(`${BASE}/quarantine/${row.id}/suppress`, admin.token, { reason: 'asked not to be listed' }).expect(200);
      const rows = await registryRows(res.body.data.personId);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((x) => x.origin === 'QUARANTINE_ACTION' && x.sourceReference === `quarantine:${row.id}`)).toBe(true);

      // a second held record with the same (already suppressed) LinkedIn: suppress succeeds without creating anything
      const held2 = rec({ businessId: undefined, businessSlug: `qsup-missing-${k}`, personName: 'Held Hari Again', jobTitle: 'CEO', linkedinUrl: li });
      await ingest.ingest([held2], { batchRef: `qsup2-${k}` });
      const row2 = await latest();
      await seedBusiness(db, `qsup-missing-${k}`);
      const people = (await db.select().from(schema.people)).length;
      await POST(`${BASE}/quarantine/${row2.id}/suppress`, admin.token, { reason: 'same person' }).expect(200);
      expect((await db.select().from(schema.people)).length).toBe(people);
      expect((await db.select().from(schema.peopleIngestionQuarantine).where(eq(schema.peopleIngestionQuarantine.id, row2.id)))[0].status).toBe('DISCARDED');
    });

    it('there is no unsuppress / restore operation anywhere in the reviewer API (restoration is a future, explicit administrative operation)', () => {
      const src = fs.readFileSync(path.resolve(SRC_DIR, 'modules/people/review/people-review.controller.ts'), 'utf8');
      expect(src).not.toMatch(/unsuppress|restore|reinstate|lift/i);
    });
  });
});

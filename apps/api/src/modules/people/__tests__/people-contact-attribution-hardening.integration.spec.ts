import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { UserRole } from '@orion/shared';
import { and, eq, sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as jwt from 'jsonwebtoken';
import * as path from 'path';
import { ExtractJwt, Strategy } from 'passport-jwt';
import request from 'supertest';
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
import { ObservationService } from '../observations/observation.service';
import { PeopleController } from '../people.controller';
import { PERSON_UNLOCK_COST_CREDITS } from '../people.constants';
import { contactsForCompany, loadContactAttribution } from '../people-contact-attribution';
import { PeopleExportService } from '../people-export.service';
import { PeoplePublishingService } from '../people-publishing.service';
import { PeopleSearchService } from '../people-search.service';
import { PeopleUnlockService } from '../people-unlock.service';
import { PeopleWriteService } from '../people-write.service';
import { PeopleService } from '../people.service';
import { SourceRegistryService } from '../sources/source-registry.service';
import { expectLedgerConsistent } from './ledger-invariants';
import { createTestDb, seedBusiness, seedUser } from './pglite-test-db';

const SECRET = 'attribution-hardening-secret';
class TestJwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: SECRET });
  }
  validate(payload: unknown) {
    return payload;
  }
}

type Biz = { id: string; slug: string };
interface IPlacement {
  co: Biz;
  email?: string;
  phone?: string;
  /** publish this company's role (default true) */
  visible?: boolean;
}

/** Phase 10C: boundary audit of the company-scoped contact attribution (single-company exception, person detail, unlock, discover parity). */
describe('contact attribution hardening (Phase 10C)', () => {
  let app: INestApplication;
  let db: DrizzleDb;
  let closeDb: () => Promise<void>;
  let ingest: PeopleIngestionService;
  let publishing: PeoplePublishingService;
  let peopleService: PeopleService;
  let searchSvc: PeopleSearchService;
  let user: { id: string; token: string };
  let n = 0;

  const ctx = { reviewedBy: 'reviewer@orion.test', note: 'hardening' };
  const tokenFor = (id: string) => jwt.sign({ sub: id, email: `${id}@t.dev`, role: UserRole.USER }, SECRET);
  const GET = (url: string, t = user.token) => request(app.getHttpServer()).get(url).set('Authorization', `Bearer ${t}`);
  const POST = (url: string, body: object = {}, t = user.token) => request(app.getHttpServer()).post(url).set('Authorization', `Bearer ${t}`).send(body);
  const biz = async (label: string, status: 'PUBLISHED' | 'DRAFT' = 'PUBLISHED'): Promise<Biz> => seedBusiness(db, `h10c-${label}-${++n}`, { status });
  const digits = (s: string) => s.replace(/\D/g, '');
  const rec = (co: Biz, name: string, recordId: string, over: Record<string, unknown> = {}): IRawPersonRecord =>
    ({
      businessId: co.id,
      personName: name,
      jobTitle: 'Managing Director',
      source: { type: 'GOVERNMENT_REGISTRY', reference: `ref-${recordId}`, recordId, evidenceType: 'ROLE_CLAIM' },
      ...over,
    }) as IRawPersonRecord;
  const run = async (records: IRawPersonRecord[]) => (await ingest.ingest(records, { sourceKey: 'h10c-feed', batchRef: `b-${Math.random().toString(36).slice(2, 8)}` })).results;
  const balance = async () => (await db.select().from(schema.userWallets).where(eq(schema.userWallets.userId, user.id)))[0].balance;
  const unlockCount = async (pid: string) => (await db.select().from(schema.personUnlocks).where(and(eq(schema.personUnlocks.userId, user.id), eq(schema.personUnlocks.personId, pid)))).length;
  const contactRow = async (pid: string, value: string) => (await db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, pid))).find((c) => c.contactValue === value)!;

  /** One person (identified by a LinkedIn the test removes again unless wanted), one record per placement; every imported contact published. */
  const person = async (name: string, placements: IPlacement[], opts: { keepLinkedin?: boolean } = {}) => {
    const li = `https://www.linkedin.com/in/h10c-${++n}-${name.toLowerCase().replace(/\W/g, '')}`;
    const results = await run(placements.map((p, i) => rec(p.co, name, `rel-${n}-${i}`, { linkedinUrl: li, ...(p.email ? { email: p.email } : {}), ...(p.phone ? { phone: p.phone } : {}) })));
    const personId = results[0].personId!;
    expect(new Set(results.map((r) => r.personId)).size).toBe(1);
    const roleIds = results.map((r) => r.companyPersonId!);
    for (const [i, p] of placements.entries()) if (p.visible !== false) await publishing.publishRole(roleIds[i], ctx);
    for (const c of await db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, personId))) await publishing.publishContact(c.id, ctx);
    if (!opts.keepLinkedin) await db.update(schema.people).set({ linkedinUrl: null, normalizedLinkedinUrl: null }).where(eq(schema.people.id, personId));
    return { personId, roleIds, li };
  };
  /** A reviewer-added / legacy contact: published, no observation claim. */
  const manual = async (personId: string, type: 'WORK_EMAIL' | 'PHONE', value: string) =>
    db.insert(schema.personContacts).values({ personId, contactType: type, contactValue: value, normalizedValue: type === 'PHONE' ? digits(value) : value, isPrimary: true, isPublished: true, confidenceScore: 100 });
  const cardAt = async (co: Biz, name: string, t = user.token) => (await GET(`/companies/${co.id}/people?status=all`, t).expect(200)).body.data.people.find((p: any) => p.fullName === name);
  const shown = (c: any) => [c.contacts.email.value, c.contacts.phone.value];

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    closeDb = () => t.client.close();
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [PeopleController],
      providers: [
        { provide: DRIZZLE_DATABASE, useValue: db },
        { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
        TestJwtStrategy, JwtAuthGuard, RolesGuard, Reflector,
        CreditRepository, CreditService,
        PeopleService, PeopleUnlockService, PeopleExportService, PeopleSearchService,
        PeopleWriteService, PeoplePublishingService,
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    const registry = new SourceRegistryService(db);
    await registry.register({ key: 'h10c-feed', displayName: 'h10c-feed', sourceType: 'PARTNER_FEED', termsAcknowledged: true, enabled: true, policy: { permissions: { identity: true, title: true, email: true, phone: true, linkedin: true, evidence: true }, allowedEvidenceTypes: ['ROLE_CLAIM', 'IDENTITY_CLAIM', 'CONTACT_CLAIM'], maxAttestation: 'NONE' } } as any);
    ingest = new PeopleIngestionService(db, module.get(PeopleWriteService), registry, new ObservationService(db));
    publishing = module.get(PeoplePublishingService);
    peopleService = module.get(PeopleService);
    searchSvc = module.get(PeopleSearchService);
    const u = await seedUser(db, 'hardening@orion.test', { daily: 500, purchased: 500 });
    user = { id: u.id, token: tokenFor(u.id) };
  }, 120_000);

  afterAll(async () => {
    await expectLedgerConsistent(db);
    await app?.close();
    await closeDb?.();
  });

  // ------------------------------------------------------------------------------------------------ 2. single-company exception
  describe('single-company exception', () => {
    const E = 'case.a@h10c-solo.example';
    const P = '+914225550201';
    let a: Biz;
    let b: Biz;
    let pid: string;
    let roleA: string;
    let li: string;

    it('Case A: one company, an unattributed email and phone: shown after unlock like any contact', async () => {
      a = await biz('a');
      b = await biz('b');
      const p = await person('Case Alpha', [{ co: a }], { keepLinkedin: true });
      pid = p.personId;
      li = p.li;
      roleA = p.roleIds[0];
      await manual(pid, 'WORK_EMAIL', E);
      await manual(pid, 'PHONE', P);
      const before = await cardAt(a, 'Case Alpha');
      expect([before.contacts.email.available, before.contacts.phone.available]).toEqual([true, true]);
      expect(shown(before)).toEqual([null, null]); // locked until unlocked
      await POST(`/people/${pid}/unlock`).expect(200);
      expect(shown(await cardAt(a, 'Case Alpha'))).toEqual([E, P]);
    });

    it('Case B: a second company (even one not visible yet) removes them from BOTH cards; the original company keeps no privilege', async () => {
      const p2 = (await run([rec(b, 'Case Alpha', 'rel-case-b', { linkedinUrl: li })]))[0]; // the same person, now also at company B (role PENDING: not visible)
      expect(p2.personId).toBe(pid);
      const role = { id: p2.companyPersonId! };
      // company B's role is NOT published, not visible, but exists
      const cardA = await cardAt(a, 'Case Alpha');
      expect([cardA.contacts.email.available, cardA.contacts.phone.available]).toEqual([false, false]);
      expect(shown(cardA)).toEqual([null, null]);
      expect(JSON.stringify((await GET(`/people/${pid}`).expect(200)).body)).not.toMatch(new RegExp(`${E}|${digits(P)}`));
      // publishing the second role changes nothing for the contacts: they are still nobody's
      await db.update(schema.companyPeople).set({ isPublished: true, reviewStatus: 'APPROVED' }).where(eq(schema.companyPeople.id, role.id));
      for (const co of [a, b]) {
        const c = await cardAt(co, 'Case Alpha');
        expect(shown(c)).toEqual([null, null]);
        expect([c.contacts.email.available, c.contacts.phone.available]).toEqual([false, false]);
      }
    });

    it('Case C: what the company count counts - every role in any state (rejected, unpublished, former, hidden company), distinct companies only; deleting the role restores it', async () => {
      const [bRole] = await db.select().from(schema.companyPeople).where(and(eq(schema.companyPeople.personId, pid), eq(schema.companyPeople.businessId, b.id)));
      const count = async () => (await loadContactAttribution(db, [pid])).companyCount.get(pid);
      expect(await count()).toBe(2);
      for (const state of [
        { reviewStatus: 'REJECTED', isPublished: false },
        { reviewStatus: 'QUARANTINED', isPublished: false },
        { reviewStatus: 'PENDING', isPublished: false },
        { isCurrent: false },
      ] as const) {
        await db.update(schema.companyPeople).set(state as any).where(eq(schema.companyPeople.id, bRole.id));
        expect(await count()).toBe(2);
        expect(shown(await cardAt(a, 'Case Alpha'))).toEqual([null, null]); // still hidden: the second company exists, whatever its state
      }
      await db.update(schema.businesses).set({ status: 'DRAFT' }).where(eq(schema.businesses.id, b.id));
      expect(await count()).toBe(2);
      await db.update(schema.businesses).set({ status: 'PUBLISHED' }).where(eq(schema.businesses.id, b.id));
      // a second role at the SAME company is not a second company
      await db.insert(schema.companyPeople).values({ personId: pid, businessId: a.id, jobTitleAtCompany: 'Chairman', normalizedJobTitle: 'chairman', isCurrent: true } as any);
      expect(await count()).toBe(2);
      // removing the second company's relationship is the only thing that returns the person to the single-company case
      await db.delete(schema.companyPeople).where(eq(schema.companyPeople.id, bRole.id));
      expect(await count()).toBe(1);
      expect(shown(await cardAt(a, 'Case Alpha'))).toEqual([E, P]);
      expect(roleA).toBeTruthy();
    });
  });

  // ------------------------------------------------------------------------------------------------ 3. top-level person detail
  describe('person detail: top-level contacts versus hidden companies', () => {
    const M = 'only.m@h10c-detail.example';
    const K = 'only.k@h10c-detail.example';
    let m: Biz;
    let k: Biz;
    let pid: string;
    let roles: string[];
    const detail = () => GET(`/people/${pid}`);
    const hide = async (i: number) => publishing.unpublishRole(roles[i], ctx);
    const show = async (i: number) => publishing.publishRole(roles[i], ctx);
    const body = (o: unknown) => JSON.stringify(o);

    beforeAll(async () => {
      m = await biz('m');
      k = await biz('k');
      const p = await person('Detail Dana', [{ co: m, email: M }, { co: k, email: K }]);
      pid = p.personId;
      roles = p.roleIds;
      await POST(`/people/${pid}/unlock`).expect(200); // paid while both visible: values are now revealable
    });

    it('both visible: both are represented person-level; every roles[] card carries only its own company\'s email', async () => {
      const d = (await detail().expect(200)).body.data;
      expect([M, K]).toContain(d.contacts.email.value);
      expect(d.roles.find((r: any) => r.businessId === m.id).contacts.email.value).toBe(M);
      expect(d.roles.find((r: any) => r.businessId === k.id).contacts.email.value).toBe(K);
    });

    it('only Meridian visible: the response (top level, roles, unlock, list, export) never contains the Kaveri-only email', async () => {
      await hide(1);
      const d = await detail().expect(200);
      expect(d.body.data.contacts.email.value).toBe(M);
      const others = [body(d.body), body((await POST(`/people/${pid}/unlock`).expect(200)).body), body((await GET('/people/unlocked').expect(200)).body), (await POST('/people/export', { personIds: [pid] }).expect(200)).text];
      for (const t of others) {
        expect(t).not.toContain(K);
        expect(t).toContain(M);
      }
      await show(1);
    });

    it('only Kaveri visible (Meridian role unpublished): never the Meridian-only email', async () => {
      await hide(0);
      const d = await detail().expect(200);
      expect(d.body.data.contacts.email.value).toBe(K);
      expect(body(d.body)).not.toContain(M);
      expect((await POST('/people/export', { personIds: [pid] }).expect(200)).text).not.toContain(M);
      await show(0);
    });

    it('a company hidden because its BUSINESS is not published behaves the same as an unpublished role', async () => {
      await db.update(schema.businesses).set({ status: 'DRAFT' }).where(eq(schema.businesses.id, k.id));
      const d = await detail().expect(200);
      expect(d.body.data.contacts.email.value).toBe(M);
      expect(body(d.body)).not.toContain(K);
      await db.update(schema.businesses).set({ status: 'PUBLISHED' }).where(eq(schema.businesses.id, k.id));
    });

    it('neither visible: the person is a 404 and no attributed contact appears anywhere', async () => {
      await hide(0);
      await hide(1);
      const d = await detail();
      expect(d.status).toBe(404);
      expect(body(d.body)).not.toMatch(new RegExp(`${M}|${K}`));
      const list = body((await GET('/people/unlocked').expect(200)).body);
      expect(list).not.toMatch(new RegExp(`${M}|${K}`));
      const csv = (await POST('/people/export', { personIds: [pid] }).expect(200)).text;
      expect(csv).not.toMatch(new RegExp(`${M}|${K}`));
      await show(0);
      await show(1);
    });

    it('a person reported by Meridian only, with Kaveri visible and nothing reported by Kaveri: Kaveri cards and the top level show nothing of Meridian', async () => {
      const m2 = await biz('m2');
      const k2 = await biz('k2');
      const only = 'meridian.only@h10c-detail.example';
      const p = await person('Detail Dev', [{ co: m2, email: only }, { co: k2 }], { keepLinkedin: true });
      await POST(`/people/${p.personId}/unlock`).expect(200);
      await publishing.unpublishRole(p.roleIds[0], ctx); // Meridian hidden; Kaveri (which reported no contact) is the only visible company
      const d = await GET(`/people/${p.personId}`).expect(200);
      expect(d.body.data.contacts.email.available).toBe(false);
      expect(body(d.body)).not.toContain(only);
    });
  });

  // ------------------------------------------------------------------------------------------------ 4. unlock
  describe('unlock: never charges for something no visible company may show', () => {
    const outcome = async (pid: string) => {
      const [balBefore, unlocksBefore] = [await balance(), await unlockCount(pid)];
      const res = await POST(`/people/${pid}/unlock`);
      return { res, spent: balBefore - (await balance()), unlockRows: (await unlockCount(pid)) - unlocksBefore };
    };

    it('only a foreign-company contact exists (its company is hidden): 409, nothing charged, no unlock row', async () => {
      const visible = await biz('u1v');
      const foreign = await biz('u1f');
      const p = await person('Unlock Uma', [{ co: foreign, email: 'uma@h10c-foreign.example', visible: false }, { co: visible }]);
      const o = await outcome(p.personId);
      expect([o.res.status, o.res.body.errorCode, o.spent, o.unlockRows]).toEqual([409, 'NO_CONTACT_AVAILABLE', 0, 0]);
    });

    it('only an unattributed contact exists on a multi-company person: 409, nothing charged', async () => {
      const c1 = await biz('u2a');
      const c2 = await biz('u2b');
      const p = await person('Unlock Ulrich', [{ co: c1 }, { co: c2 }]);
      await manual(p.personId, 'WORK_EMAIL', 'ulrich@h10c-manual.example');
      const o = await outcome(p.personId);
      expect([o.res.status, o.res.body.errorCode, o.spent, o.unlockRows]).toEqual([409, 'NO_CONTACT_AVAILABLE', 0, 0]);
      expect(JSON.stringify(o.res.body)).not.toContain('ulrich@h10c-manual.example');
    });

    it('an eligible company contact exists: unlocked once, charged exactly the unlock cost, and a repeat is free', async () => {
      const c1 = await biz('u3a');
      const c2 = await biz('u3b');
      const p = await person('Unlock Ugo', [{ co: c1, email: 'ugo@h10c-eligible.example' }, { co: c2 }]);
      const o = await outcome(p.personId);
      expect([o.res.status, o.spent, o.unlockRows]).toEqual([200, PERSON_UNLOCK_COST_CREDITS, 1]);
      const again = await outcome(p.personId);
      expect([again.res.status, again.spent, again.unlockRows]).toEqual([200, 0, 0]);
      const list = (await GET('/people/unlocked').expect(200)).body.data.unlocked;
      const entry = list.find((u: any) => u.roles.some((r: any) => r.id === p.personId));
      expect(entry.roles.find((r: any) => r.businessId === c1.id).contacts.email.value).toBe('ugo@h10c-eligible.example');
      expect(entry.roles.find((r: any) => r.businessId === c2.id).contacts.email.value).toBeNull();
    });

    it('a shared contact whose only visible reporter is one of its companies counts as eligible', async () => {
      const c1 = await biz('u4a');
      const c2 = await biz('u4b');
      const shared = 'shared@h10c-shared.example';
      const p = await person('Unlock Uri', [{ co: c1, email: shared }, { co: c2, email: shared, visible: false }]);
      const o = await outcome(p.personId);
      expect([o.res.status, o.spent, o.unlockRows]).toEqual([200, PERSON_UNLOCK_COST_CREDITS, 1]);
    });

    it('the in-transaction re-check applies the same rule when the pre-check was stale (no charge, no unlock row)', async () => {
      const visible = await biz('u5v');
      const foreign = await biz('u5f');
      const p = await person('Unlock Ula', [{ co: foreign, email: 'ula@h10c-stale.example' }, { co: visible }]);
      // the pre-check is shown the foreign company's role as still visible (stale), while the database says it is hidden
      await publishing.unpublishRole(p.roleIds[0], ctx);
      const real = peopleService.loadPublishedRolesForPerson.bind(peopleService);
      const spy = jest.spyOn(peopleService, 'loadPublishedRolesForPerson').mockImplementation(async (id: string) => {
        const roles = await real(id);
        const [stale] = await db.select().from(schema.companyPeople).where(eq(schema.companyPeople.id, p.roleIds[0]));
        const [person] = await db.select().from(schema.people).where(eq(schema.people.id, id));
        return [...roles, { role: stale, person }];
      });
      try {
        const o = await outcome(p.personId);
        expect([o.res.status, o.res.body.errorCode, o.spent, o.unlockRows]).toEqual([409, 'NO_CONTACT_AVAILABLE', 0, 0]);
      } finally {
        spy.mockRestore();
      }
    });
  });

  // ------------------------------------------------------------------------------------------------ 5. discover SQL parity
  describe('discover predicate parity with the application rule', () => {
    interface IScenario {
      label: string;
      expected: Record<string, boolean>; // company label -> contactable
    }

    it('SQL and application agree on company-specific, foreign-only, shared, unattributed single-company and unattributed multi-company contacts', async () => {
      const cos: Record<string, Biz> = {};
      const mk = async (label: string) => (cos[label] = await biz(`d-${label}`));
      const scenarios: IScenario[] = [];

      // company-specific: X reported an email, Y reported none
      const [cs1, cs2] = [await mk('spec-x'), await mk('spec-y')];
      await person('Parity Specific', [{ co: cs1, email: 'x@h10c-par.example' }, { co: cs2 }]);
      scenarios.push({ label: 'company-specific', expected: { 'spec-x': true, 'spec-y': false } });

      // foreign-only: the contact was reported by Y; X shows a role too
      const [fo1, fo2] = [await mk('for-x'), await mk('for-y')];
      await person('Parity Foreign', [{ co: fo1 }, { co: fo2, email: 'y@h10c-par.example' }]);
      scenarios.push({ label: 'foreign-only', expected: { 'for-x': false, 'for-y': true } });

      // shared: both reported it
      const [sh1, sh2] = [await mk('sh-x'), await mk('sh-y')];
      await person('Parity Shared', [{ co: sh1, email: 'both@h10c-par.example' }, { co: sh2, email: 'both@h10c-par.example' }]);
      scenarios.push({ label: 'shared', expected: { 'sh-x': true, 'sh-y': true } });

      // unattributed, single company
      const un1 = await mk('un-single');
      const unp = await person('Parity Unattributed Single', [{ co: un1 }]);
      await manual(unp.personId, 'WORK_EMAIL', 'single@h10c-par.example');
      scenarios.push({ label: 'unattributed single-company', expected: { 'un-single': true } });

      // unattributed, multi company
      const [um1, um2] = [await mk('un-multi-x'), await mk('un-multi-y')];
      const ump = await person('Parity Unattributed Multi', [{ co: um1 }, { co: um2 }]);
      await manual(ump.personId, 'WORK_EMAIL', 'multi@h10c-par.example');
      scenarios.push({ label: 'unattributed multi-company', expected: { 'un-multi-x': false, 'un-multi-y': false } });

      // SQL side
      const pred = searchSvc.buildBusinessPredicate({ hasDecisionMakerContact: true }, sql`${schema.businesses.id}`)!;
      const sqlRows = await db.select({ id: schema.businesses.id }).from(schema.businesses).where(and(eq(schema.businesses.status, 'PUBLISHED'), pred));
      const sqlSet = new Set(sqlRows.map((r) => r.id));

      // application side: the helper over the same data (a company is contactable when a visible role there has an eligible published contact)
      const roles = await db.select({ role: schema.companyPeople }).from(schema.companyPeople).innerJoin(schema.people, eq(schema.people.id, schema.companyPeople.personId)).where(and(eq(schema.companyPeople.isPublished, true), eq(schema.companyPeople.reviewStatus, 'APPROVED'), eq(schema.companyPeople.isCurrent, true)));
      const personIds = [...new Set(roles.map((r) => r.role.personId))];
      const attribution = await loadContactAttribution(db, personIds);
      const published = await db.select().from(schema.personContacts).where(eq(schema.personContacts.isPublished, true));
      const appSet = new Set(roles.filter((r) => contactsForCompany(published.filter((c) => c.personId === r.role.personId), r.role.businessId, attribution).length > 0 && r.role.decisionMakerType).map((r) => r.role.businessId));

      for (const s of scenarios) {
        for (const [label, expected] of Object.entries(s.expected)) {
          const id = cos[label].id;
          expect([s.label, label, 'sql', sqlSet.has(id)]).toEqual([s.label, label, 'sql', expected]);
          expect([s.label, label, 'app', appSet.has(id)]).toEqual([s.label, label, 'app', expected]);
        }
      }
    });
  });

  // ------------------------------------------------------------------------------------------------ 6. observation lifecycle limitation
  describe('contacts with no observation (reviewer-added, or imported before observations were recorded)', () => {
    it('deterministic and safe: shown for a one-company person, hidden for a multi-company one, never moved to a company', async () => {
      const one = await biz('lc1');
      const x = await biz('lc2a');
      const y = await biz('lc2b');
      const E1 = 'legacy.one@h10c-legacy.example';
      const E2 = 'legacy.two@h10c-legacy.example';
      const single = await person('Legacy Lena', [{ co: one, email: E1 }]);
      const multi = await person('Legacy Lars', [{ co: x, email: E2 }, { co: y }]);
      // simulate "imported before observations existed": the observations (and so the claims) are gone
      await db.delete(schema.peopleObservations).where(sql`${schema.peopleObservations.personId} IN (${single.personId}, ${multi.personId})`);
      await POST(`/people/${single.personId}/unlock`).expect(200);
      expect(shown(await cardAt(one, 'Legacy Lena'))[0]).toBe(E1);
      for (const co of [x, y]) {
        const c = await cardAt(co, 'Legacy Lars');
        expect([c.contacts.email.available, c.contacts.email.value]).toEqual([false, null]);
      }
      const o = await POST(`/people/${multi.personId}/unlock`);
      expect([o.status, o.body.errorCode]).toEqual([409, 'NO_CONTACT_AVAILABLE']);
      // repeating the evaluation changes nothing (no hidden state)
      expect((await cardAt(x, 'Legacy Lars')).contacts.email.available).toBe(false);
      expect(shown(await cardAt(one, 'Legacy Lena'))[0]).toBe(E1);
    });
  });

  // ------------------------------------------------------------------------------------------------ 1 + 8. structural boundary
  describe('structural boundary: customer code -> attribution helper -> observations', () => {
    const SRC = path.resolve(__dirname, '../../..');
    const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
    const CUSTOMER = ['modules/people/people.service.ts', 'modules/people/people-unlock.service.ts', 'modules/people/people-search.service.ts', 'modules/people/people-export.service.ts', 'modules/people/people.controller.ts'];

    it('no customer file touches observation tables, claims or the observation service; they reach the data only through the attribution helper', () => {
      for (const f of CUSTOMER) {
        const text = read(f);
        expect(text).not.toMatch(/peopleObservation|people_observation|observation/i);
        expect(text).not.toMatch(/observation\.service|conflict-detector/);
      }
      for (const f of ['modules/people/people.service.ts', 'modules/people/people-unlock.service.ts', 'modules/people/people-search.service.ts']) expect(read(f)).toMatch(/from '\.\/people-contact-attribution'/);
    });

    it('the helper is the only customer-path module that reads observation data, and it exports decisions and loader types only (no raw rows, no ids to a response)', () => {
      const helper = read('modules/people/people-contact-attribution.ts');
      expect(helper).toMatch(/peopleObservations/);
      const exported = [...helper.matchAll(/^export (?:const|interface|type) (\w+)/gm)].map((m) => m[1]).sort();
      // Phase 15: + the reviewer dossier's read-only reading of the same decision (status + eligibility, no ids, no rows)
      expect(exported).toEqual(['ContactAttributionStatus', 'IContactAttribution', 'IContactAttributionView', 'contactAttributionStatus', 'contactEligibleForRoleSql', 'contactsForAnyCompany', 'contactsForCompany', 'isContactEligibleForCompany', 'loadContactAttribution']);
      // the only other consumer is the reviewer dossier (admin side); it receives decisions only
      expect(read('modules/people/review/people-review.service.ts')).toMatch(/contactAttributionStatus, loadContactAttribution/);
      // nothing from the helper is returned by a controller or DTO
      for (const f of ['modules/people/people.controller.ts', 'modules/people/dto/people.dto.ts']) expect(read(f)).not.toMatch(/contact-attribution|IContactAttribution/);
      // the rest of the people module may not import it either, except the three services that apply the rule
      const importers = fs
        .readdirSync(path.join(SRC, 'modules/people'))
        .filter((f) => f.endsWith('.ts'))
        .filter((f) => /people-contact-attribution/.test(read(`modules/people/${f}`)) && f !== 'people-contact-attribution.ts')
        .sort();
      expect(importers).toEqual(['people-search.service.ts', 'people-unlock.service.ts', 'people.service.ts']);
    });

    it('no customer response contains an observation or claim identifier (a real response, scanned for every observation / claim id)', async () => {
      const co = await biz('scan');
      const p = await person('Scan Sam', [{ co, email: 'sam@h10c-scan.example' }], { keepLinkedin: true });
      await POST(`/people/${p.personId}/unlock`).expect(200);
      const ids = [...(await db.select({ id: schema.peopleObservations.id }).from(schema.peopleObservations)).map((r) => r.id), ...(await db.select({ id: schema.peopleObservationClaims.id }).from(schema.peopleObservationClaims)).map((r) => r.id)];
      expect(ids.length).toBeGreaterThan(0);
      const bodies = [(await GET(`/companies/${co.id}/people?status=all`).expect(200)).text, (await GET(`/people/${p.personId}`).expect(200)).text, (await GET('/people/unlocked').expect(200)).text, (await POST('/people/export', { personIds: [p.personId] }).expect(200)).text];
      for (const text of bodies) for (const id of ids) expect(text).not.toContain(id);
      expect(await contactRow(p.personId, 'sam@h10c-scan.example')).toBeTruthy();
    });
  });
});

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { UserRole } from '@orion/shared';
import { eq } from 'drizzle-orm';
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
import { PeopleController } from '../people.controller';
import { PeopleExportService } from '../people-export.service';
import { PeoplePublishingService } from '../people-publishing.service';
import { PeopleSearchService } from '../people-search.service';
import { PeopleUnlockService } from '../people-unlock.service';
import { PeopleWriteService } from '../people-write.service';
import { PeopleService } from '../people.service';
import { expectLedgerConsistent } from './ledger-invariants';
import { createTestDb, seedBusiness, seedUser } from './pglite-test-db';

const SECRET = 'contract-test-secret';
class TestJwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: SECRET });
  }
  validate(payload: unknown) {
    return payload;
  }
}

/** The customer-safe person card: exactly these keys, nothing else (Phase 6.11). */
const CARD_KEYS = ['additionalRoles', 'businessId', 'contacts', 'decisionMaker', 'department', 'endDate', 'evidence', 'fullName', 'id', 'isCurrent', 'isSaved', 'jobTitle', 'location', 'relevance', 'seniority', 'startDate', 'unlockCostCredits', 'verification'];
const FORBIDDEN_KEY = /^(companyPersonId|contactId|evidenceId|personId|observation\w*|source(Key|Version|Url|Reference|Types?|Label)?|reviewStatus|reviewed\w*|reviewer\w*|reviewNote|audit\w*|conflict\w*|quarantine\w*|suppress\w*|digest\w*|rule\w*|classification\w*|taxonomy\w*|isPublished|dataStatus|lastSeenAt|lastConfirmedAt|firstSeenAt|normalized\w*|fingerprint|titleAliases|nameAliases|claimToken|batchRef|payload\w*|raw)$/i;
const FORBIDDEN_VALUE = /MCA-SECRET-REF|registry\.example|secret\.reviewer@|internal-note-zzz|h:[0-9a-f]{64}|SEN-[A-Z]|DEP-[A-Z]|DM-[A-Z]|ROLE_TITLE|CONTACT_MULTIPLE|SUPPRESSED_PERSON|QUARANTINE|people-json|IDENTITY_CLAIM|CONTACT_CLAIM|ROLE_CLAIM/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const walk = (v: unknown, fn: (key: string | null, value: unknown) => void, key: string | null = null): void => {
  fn(key, v);
  if (Array.isArray(v)) v.forEach((x) => walk(x, fn, key));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, fn, k);
};

describe('Customer People contract & data exposure (Phase 6.11)', () => {
  let app: INestApplication;
  let db: DrizzleDb;
  let closeDb: () => Promise<void>;
  let ingest: PeopleIngestionService;
  let publishing: PeoplePublishingService;
  let u1: { id: string; token: string };
  let u2: { id: string; token: string };
  let co: { id: string; slug: string };
  let draftCo: { id: string; slug: string };
  let n = 0;
  const ids = {} as Record<string, { personId: string; roleId: string }>;
  const internalIds = new Set<string>();
  const allResponses: unknown[] = [];

  const tokenFor = (id: string) => jwt.sign({ sub: id, email: `${id}@t.dev`, role: UserRole.USER }, SECRET);
  const GET = (url: string, t?: string) => {
    const r = request(app.getHttpServer()).get(url);
    return t ? r.set('Authorization', `Bearer ${t}`) : r;
  };
  const POST = (url: string, t: string, body: object = {}) => request(app.getHttpServer()).post(url).set('Authorization', `Bearer ${t}`).send(body);
  const tag = () => `${++n}${Math.random().toString(36).slice(2, 6)}`.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);
  const ctx = { reviewedBy: 'secret.reviewer@orion.test', note: 'internal-note-zzz' };
  const rec = (c: { id: string }, name: string, over: Record<string, unknown> = {}): IRawPersonRecord =>
    ({
      businessId: c.id,
      personName: name,
      jobTitle: 'Managing Director',
      source: { type: 'GOVERNMENT_REGISTRY', reference: 'MCA-SECRET-REF-123', url: 'https://registry.example/secret-path-xyz', evidenceType: 'ROLE_CLAIM' },
      ...over,
    }) as IRawPersonRecord;
  const seed = async (key: string, c: { id: string }, name: string, over: Record<string, unknown> = {}) => {
    const r = (await ingest.ingest([rec(c, name, over)])).results[0];
    ids[key] = { personId: r.personId!, roleId: r.companyPersonId! };
    return ids[key];
  };
  const keep = <T>(body: T): T => {
    allResponses.push(body);
    return body;
  };
  const list = async (t: string, qs = '') => keep((await GET(`/companies/${co.id}/people?status=all${qs}`, t).expect(200)).body.data);

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
        PeopleWriteService, PeopleIngestionService, PeoplePublishingService,
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    ingest = module.get(PeopleIngestionService);
    publishing = module.get(PeoplePublishingService);

    const a = await seedUser(db, 'contract.one@orion.test', { daily: 20, purchased: 20 });
    const b = await seedUser(db, 'contract.two@orion.test', { daily: 20, purchased: 20 });
    u1 = { id: a.id, token: tokenFor(a.id) };
    u2 = { id: b.id, token: tokenFor(b.id) };
    co = await seedBusiness(db, 'contract-co');
    draftCo = await seedBusiness(db, 'contract-draft-co', { status: 'DRAFT' });

    // A: approved + published, with published email/phone, an UNPUBLISHED mobile and a LinkedIn
    await seed('A', co, 'Alpha Visible', { email: `alpha.${tag()}@corp-ct.co.in`, phone: '0422 255 0901', mobile: '9876501234', linkedinUrl: 'https://www.linkedin.com/in/alpha-visible-ct' });
    await publishing.publishRole(ids.A.roleId, ctx);
    const aContacts = await db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, ids.A.personId));
    for (const c of aContacts.filter((x) => x.contactType !== 'MOBILE')) await publishing.publishContact(c.id, ctx);
    // B: pending (never approved), C: published then unpublished, D: rejected, E: published then suppressed, G: person at a DRAFT company
    await seed('B', co, 'Bravo Pending', { email: `bravo.${tag()}@corp-ct.co.in` });
    await seed('C', co, 'Charlie Unpublished');
    await publishing.publishRole(ids.C.roleId, ctx);
    await publishing.unpublishRole(ids.C.roleId, ctx);
    await seed('D', co, 'Delta Rejected');
    await publishing.rejectRole(ids.D.roleId, ctx);
    await seed('E', co, 'Echo Suppressed', { email: `echo.${tag()}@corp-ct.co.in` });
    await publishing.publishRole(ids.E.roleId, ctx);
    for (const c of await db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, ids.E.personId))) await publishing.publishContact(c.id, ctx);
    await seed('G', draftCo, 'Golf Draftco');
    await publishing.publishRole(ids.G.roleId, ctx);

    // internal data that must never reach a customer: a conflict, a quarantine row, internal ids
    await db.insert(schema.peopleConflicts).values({ conflictType: 'ROLE_TITLE', subjectKey: 'ROLE_TITLE:internal', personId: ids.A.personId, businessId: co.id });
    await db.insert(schema.peopleIngestionQuarantine).values({ fingerprint: 'f'.repeat(64), raw: { personName: 'Alpha Visible' }, reasons: [{ code: 'SUPPRESSED_PERSON' }] });
    for (const x of Object.values(ids)) {
      internalIds.add(x.roleId);
      for (const e of await db.select().from(schema.peopleEvidence).where(eq(schema.peopleEvidence.personId, x.personId))) internalIds.add(e.id);
      for (const c of await db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, x.personId))) internalIds.add(c.id);
    }
  }, 90_000);

  afterAll(async () => {
    await expectLedgerConsistent(db);
    await app?.close();
    await closeDb?.();
  });

  describe('visibility', () => {
    it('shows only published AND approved roles of PUBLISHED people at PUBLISHED companies', async () => {
      const d = await list(u1.token);
      const names = d.people.map((p: any) => p.fullName);
      expect(names).toContain('Alpha Visible');
      expect(names).toContain('Echo Suppressed'); // still published here
      for (const hidden of ['Bravo Pending', 'Charlie Unpublished', 'Delta Rejected']) expect(names).not.toContain(hidden);
      expect(d.summary.total).toBe(2);
      // the rule is also stated in code at the read paths
      const svc = fs.readFileSync(path.resolve(__dirname, '../people.service.ts'), 'utf8');
      expect(svc).toMatch(/reviewStatus, 'APPROVED'/);
      expect((svc.match(/CUSTOMER_VISIBLE_ROLE\(\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
      expect(fs.readFileSync(path.resolve(__dirname, '../people-search.service.ts'), 'utf8')).toMatch(/cp\.review_status = 'APPROVED'/);
      expect(fs.readFileSync(path.resolve(__dirname, '../../saved-leads/saved-leads.service.ts'), 'utf8').match(/reviewStatus, 'APPROVED'/g)?.length).toBe(2);
    });

    it('hidden people are not reachable by id, unlock or export; an unpublished company is indistinguishable from a missing one', async () => {
      for (const k of ['B', 'C', 'D', 'G']) {
        await GET(`/people/${ids[k].personId}`, u1.token).expect(404);
        await POST(`/people/${ids[k].personId}/unlock`, u1.token).expect(404);
      }
      const missing = (await GET(`/companies/00000000-0000-4000-8000-0000000000aa/people`, u1.token).expect(404)).body;
      const draft = (await GET(`/companies/${draftCo.id}/people`, u1.token).expect(404)).body;
      expect(draft).toMatchObject({ errorCode: missing.errorCode, message: missing.message, statusCode: 404 });
      const noPerson = (await GET(`/people/00000000-0000-4000-8000-0000000000bb`, u1.token).expect(404)).body;
      const hiddenPerson = (await GET(`/people/${ids.B.personId}`, u1.token).expect(404)).body;
      expect(hiddenPerson).toMatchObject({ errorCode: noPerson.errorCode, message: noPerson.message });
      await GET(`/people/${ids.A.personId}`).expect(401);
      await GET(`/companies/${co.id}/people`).expect(401);
    });

    it('suppression removes a person everywhere, even for a customer who had unlocked them', async () => {
      await POST(`/people/${ids.E.personId}/unlock`, u1.token).expect(200);
      expect(keep((await GET('/people/unlocked', u1.token).expect(200)).body.data).unlocked.some((u: any) => u.roles[0].fullName === 'Echo Suppressed')).toBe(true);
      await publishing.suppressPerson(ids.E.personId, ctx);
      await GET(`/people/${ids.E.personId}`, u1.token).expect(404);
      expect((await list(u1.token)).people.map((p: any) => p.fullName)).not.toContain('Echo Suppressed');
      expect((await GET('/people/unlocked', u1.token).expect(200)).body.data.unlocked.some((u: any) => u.roles[0].fullName === 'Echo Suppressed')).toBe(false);
      const csv = (await POST('/people/export', u1.token, {}).expect(200)).text;
      expect(csv).not.toContain('Echo Suppressed');
    });
  });

  describe('contacts', () => {
    it('stay locked until unlock: availability is shown, values are null, unpublished contacts do not exist for customers', async () => {
      const a = (await list(u2.token)).people.find((p: any) => p.fullName === 'Alpha Visible');
      expect(a.contacts.isUnlocked).toBe(false);
      expect(a.contacts.email).toMatchObject({ available: true, value: null });
      expect(a.contacts.phone).toMatchObject({ available: true, value: null });
      expect(a.contacts.linkedin).toMatchObject({ available: true, value: null });
      expect(a.contacts.mobile).toEqual({ available: false, verificationStatus: null, value: null }); // exists internally, unpublished: invisible
      const detail = keep((await GET(`/people/${ids.A.personId}`, u2.token).expect(200)).body.data);
      expect(JSON.stringify(detail)).not.toMatch(/@corp-ct|9876501234|255 ?0901|alpha-visible-ct/);
    });

    it('unlock reveals ONLY published values, only to the unlocking customer (tenant isolation)', async () => {
      const res = keep((await POST(`/people/${ids.A.personId}/unlock`, u1.token).expect(200)).body.data);
      expect(res).toMatchObject({ success: true, alreadyUnlocked: false });
      const c = res.person.contacts;
      expect(c.isUnlocked).toBe(true);
      expect(c.email.value).toMatch(/@corp-ct/);
      expect(c.phone.value).toBeTruthy();
      expect(c.linkedin.value).toContain('alpha-visible-ct');
      expect(c.mobile.value).toBeNull(); // unpublished: never revealed, not even to the unlocker
      expect(JSON.stringify(res)).not.toContain('9876501234');
      // the other customer is unaffected: still locked everywhere
      const other = (await list(u2.token)).people.find((p: any) => p.fullName === 'Alpha Visible');
      expect(other.contacts).toMatchObject({ isUnlocked: false, email: { value: null }, phone: { value: null }, linkedin: { value: null } });
      expect((await GET('/people/unlocked', u2.token).expect(200)).body.data.unlocked).toEqual([]);
      expect((await GET(`/people/${ids.A.personId}`, u2.token).expect(200)).body.data.contacts.email.value).toBeNull();
      // idempotent: no second charge
      expect(keep((await POST(`/people/${ids.A.personId}/unlock`, u1.token).expect(200)).body.data)).toMatchObject({ alreadyUnlocked: true, creditsSpent: 0 });
    });

    it('export contains only the caller\'s own unlocked, visible people; asking for others is dropped, never revealed', async () => {
      const mine = await POST('/people/export', u1.token, { personIds: [ids.A.personId] }).expect(200);
      expect(mine.headers['x-export-row-count']).toBe('1');
      expect(mine.text).toContain('Alpha Visible');
      expect(mine.text).not.toContain('9876501234');
      const header = mine.text.replace('﻿', '').split('\n')[0];
      expect(header.replace(/"/g, '').replace(/^FEFF/, '')).toBe('Company,Person,Job Title,Department,Seniority,Decision Maker Type,Role Status,Email,Phone,Mobile,LinkedIn,Location,Verification Status,Confidence,Last Verified');
      expect(mine.text).not.toMatch(FORBIDDEN_VALUE);
      const theirs = await POST('/people/export', u2.token, { personIds: [ids.A.personId] }).expect(200);
      expect(theirs.headers['x-export-row-count']).toBe('0');
      expect(theirs.headers['x-export-skipped-locked']).toBe('1');
      expect(theirs.text).not.toContain('Alpha Visible');
    });
  });

  describe('one customer-safe contract', () => {
    it('the company list, person detail, unlock and unlocked list use exactly the contract fields', async () => {
      const d = await list(u1.token);
      for (const p of d.people) expect(Object.keys(p).sort()).toEqual(CARD_KEYS);
      expect(Object.keys(d).sort()).toEqual(['business', 'facets', 'pagination', 'people', 'summary']);
      expect(Object.keys(d.business).sort()).toEqual(['id', 'name', 'slug']);
      const detail = keep((await GET(`/people/${ids.A.personId}`, u1.token).expect(200)).body.data);
      expect(Object.keys(detail).sort()).toEqual(['contacts', 'fullName', 'id', 'isSaved', 'location', 'roles', 'unlockCostCredits']);
      for (const r of detail.roles) expect(Object.keys(r).sort()).toEqual([...CARD_KEYS, 'business'].sort());
      const un = keep((await GET('/people/unlocked', u1.token).expect(200)).body.data);
      for (const u of un.unlocked) {
        expect(Object.keys(u).sort()).toEqual(['creditsSpent', 'roles', 'unlockedAt']);
        for (const r of u.roles) expect(Object.keys(r).sort()).toEqual(CARD_KEYS);
      }
      keep((await GET('/people/taxonomy', u1.token).expect(200)).body.data);
    });

    it('no response, at any depth, carries internal keys, values or ids', async () => {
      expect(allResponses.length).toBeGreaterThan(6);
      const allowed = new Set([ids.A.personId, ids.E.personId, co.id]);
      for (const body of allResponses) {
        walk(body, (key, value) => {
          if (key !== null) expect(key).not.toMatch(FORBIDDEN_KEY);
          if (typeof value === 'string') {
            expect(value).not.toMatch(FORBIDDEN_VALUE);
            for (const id of value.match(UUID) ?? []) {
              expect(internalIds.has(id)).toBe(false); // no role / evidence / contact id
              expect([...allowed].includes(id) || id === ids.A.personId).toBe(true); // only public person / company ids
            }
          }
        });
      }
    });

    it('the evidence summary is counts only (no source type, URL, reference or evidence rows)', async () => {
      const a = (await list(u1.token)).people.find((p: any) => p.fullName === 'Alpha Visible');
      expect(a.evidence).toEqual({ count: expect.any(Number), verifiedCount: expect.any(Number) });
      const detail = (await GET(`/people/${ids.A.personId}`, u1.token).expect(200)).body.data;
      expect(detail.evidence).toBeUndefined();
    });
  });

  describe('verification semantics are unchanged', () => {
    it('exposes only status, assertion, last verified date and confidence', async () => {
      const a = (await list(u1.token)).people.find((p: any) => p.fullName === 'Alpha Visible');
      expect(Object.keys(a.verification).sort()).toEqual(['assertion', 'confidence', 'lastVerifiedAt', 'status']);
      expect(a.verification).toMatchObject({ status: 'UNVERIFIED', assertion: 'UNVERIFIED', lastVerifiedAt: null });
      await db.update(schema.companyPeople).set({ verificationStatus: 'CONFLICTED' }).where(eq(schema.companyPeople.id, ids.A.roleId));
      const conflicted = (await list(u1.token)).people.find((p: any) => p.fullName === 'Alpha Visible');
      expect(conflicted.verification.status).toBe('CONFLICTED'); // existing semantics kept ...
      expect(JSON.stringify(conflicted)).not.toMatch(/conflict_|CONFLICT_|ROLE_TITLE|subject/i); // ... and nothing about WHY leaks
      await db.update(schema.companyPeople).set({ verificationStatus: 'UNVERIFIED' }).where(eq(schema.companyPeople.id, ids.A.roleId));
    });
  });

  describe('errors', () => {
    it('validation and not-found errors are generic and carry no internals; the query string is not echoed', async () => {
      const bad = (await GET('/people/not-a-uuid?secret=abc', u1.token).expect(400)).body;
      expect(JSON.stringify(bad)).not.toMatch(/secret=abc|stack|select |at Object|node_modules/i);
      expect(bad.path).toBe('/people/not-a-uuid');
      const nf = (await GET(`/people/${ids.B.personId}`, u1.token).expect(404)).body;
      expect(JSON.stringify(nf)).not.toMatch(/PENDING|reviewStatus|unpublished|APPROVED/i);
    });

    it('an unexpected server error never leaks its text unless NODE_ENV is explicitly development/test', () => {
      const filter = new AllExceptionsFilter();
      const run = (env: string | undefined) => {
        const prev = process.env.NODE_ENV;
        if (env === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = env;
        let body: any;
        const host: any = {
          switchToHttp: () => ({
            getResponse: () => ({ status: () => ({ json: (b: unknown) => (body = b) }) }),
            getRequest: () => ({ headers: {}, method: 'GET', url: '/people/x?q=1' }),
          }),
        };
        try {
          filter.catch(new Error('relation "people_evidence" does not exist at /srv/api'), host);
        } finally {
          process.env.NODE_ENV = prev;
        }
        return body;
      };
      for (const env of ['production', undefined, 'staging']) {
        const b = run(env);
        expect(b.statusCode).toBe(500);
        expect(JSON.stringify(b)).not.toMatch(/people_evidence|\/srv\/api/);
      }
      expect(run('test').message).toContain('people_evidence'); // developers still see it locally
    });
  });
});

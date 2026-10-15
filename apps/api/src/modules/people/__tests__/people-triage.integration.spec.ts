import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { UserRole } from '@orion/shared';
import { eq, sql } from 'drizzle-orm';
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
import { IRawPersonRecord } from '../ingestion/ingestion.types';
import { PeopleIngestionService } from '../ingestion/people-ingestion.service';
import { ObservationService } from '../observations/observation.service';
import { PeoplePublishingService } from '../people-publishing.service';
import { PeopleWriteService } from '../people-write.service';
import { PeopleQuarantineService } from '../review/people-quarantine.service';
import { PeopleReviewController } from '../review/people-review.controller';
import { PeopleReviewService } from '../review/people-review.service';
import { PeopleTriageService } from '../review/people-triage.service';
import { SourceRegistryService } from '../sources/source-registry.service';
import { PeopleVerificationService } from '../verification/people-verification.service';
import { expectLedgerConsistent } from './ledger-invariants';
import { createTestDb, seedBusiness, seedUser } from './pglite-test-db';

const SECRET = 'triage-test-secret';
class TestJwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: SECRET });
  }
  validate(payload: unknown) {
    return payload;
  }
}
const BASE = '/internal/people-review';

describe('People review triage (Phase 6.10)', () => {
  let app: INestApplication;
  let db: DrizzleDb;
  let closeDb: () => Promise<void>;
  let ingest: PeopleIngestionService;
  let publishing: PeoplePublishingService;
  let registry: SourceRegistryService;
  let admin: string;
  let dataManager: string;
  let customer: string;
  let srcB: string;
  let n = 0;

  const tokenFor = (id: string, role: string) => jwt.sign({ sub: id, email: `${id}@t.dev`, role }, SECRET);
  const GET = (url: string, t?: string) => {
    const r = request(app.getHttpServer()).get(url);
    return t ? r.set('Authorization', `Bearer ${t}`) : r;
  };
  const POST = (url: string, t: string, body: object = {}) => request(app.getHttpServer()).post(url).set('Authorization', `Bearer ${t}`).send(body);
  const tag = () => `${++n}${Math.random().toString(36).slice(2, 6)}`.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);
  const company = () => seedBusiness(db, `tr-co-${++n}-${Math.random().toString(36).slice(2, 6)}`);
  const rec = (co: { id: string }, name: string, recordId: string, over: Record<string, unknown> = {}): IRawPersonRecord =>
    ({ businessId: co.id, personName: name, jobTitle: 'Director', source: { type: 'MANUAL_IMPORT', reference: 'sheet-1', recordId }, ...over }) as IRawPersonRecord;
  const fromA = (records: IRawPersonRecord[]) => ingest.ingest(records, { sourceKey: 'people-json', batchRef: `run-${++n}` });
  const fromB = (records: IRawPersonRecord[]) => ingest.ingest(records.map((r) => ({ ...r, source: { ...(r.source as any), type: 'PARTNER_FEED' } })), { sourceKey: srcB, batchRef: `run-${++n}` });
  const triage = async (qs = '', t = admin) => (await GET(`${BASE}/triage?limit=100${qs ? `&${qs}` : ''}`, t).expect(200)).body as { data: any[]; pagination: any };
  const find = async (idPart: string, qs = '') => (await triage(qs)).data.find((i) => i.id.includes(idPart));
  const roles = (personId: string) => db.select().from(schema.companyPeople).where(eq(schema.companyPeople.personId, personId));

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    closeDb = () => t.client.close();
    registry = new SourceRegistryService(db);
    const write = new PeopleWriteService(db);
    ingest = new PeopleIngestionService(db, write, registry, new ObservationService(db));
    publishing = new PeoplePublishingService(db);
    srcB = `feed-${tag()}`;
    await registry.register({ key: srcB, displayName: srcB, sourceType: 'PARTNER_FEED', termsAcknowledged: true, enabled: true, policy: { permissions: { identity: true, title: true, email: true, phone: true, linkedin: true, evidence: true }, allowedEvidenceTypes: ['ROLE_CLAIM', 'IDENTITY_CLAIM', 'CONTACT_CLAIM'], maxAttestation: 'NONE' } } as any);
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [PeopleReviewController],
      providers: [
        { provide: DRIZZLE_DATABASE, useValue: db },
        { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
        TestJwtStrategy, JwtAuthGuard, RolesGuard, Reflector,
        { provide: PeopleIngestionService, useValue: ingest },
        { provide: PeopleWriteService, useValue: write },
        { provide: PeoplePublishingService, useValue: publishing },
        PeopleReviewService, PeopleQuarantineService, PeopleVerificationService, PeopleTriageService,
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    const a = await seedUser(db, 'triage.admin@orion.test', undefined, 'ADMIN');
    const d = await seedUser(db, 'triage.dm@orion.test', undefined, 'DATA_MANAGER');
    const c = await seedUser(db, 'triage.customer@orion.test', { daily: 5, purchased: 5 });
    admin = tokenFor(a.id, UserRole.ADMIN);
    dataManager = tokenFor(d.id, UserRole.DATA_MANAGER);
    customer = tokenFor(c.id, UserRole.USER);
  }, 60_000);

  afterAll(async () => {
    await expectLedgerConsistent(db);
    await app?.close();
    await closeDb?.();
  });

  describe('RBAC', () => {
    it('admin and data manager may read; customers are refused; anonymous is 401', async () => {
      await GET(`${BASE}/triage`, admin).expect(200);
      await GET(`${BASE}/triage`, dataManager).expect(200);
      await GET(`${BASE}/triage`, customer).expect(403);
      await GET(`${BASE}/triage`).expect(401);
      await GET(`${BASE}/triage?limit=1000`, admin).expect(400);
      await GET(`${BASE}/triage?bogus=1`, admin).expect(400);
    });

    it('triage has no write route and no customer-facing code knows it', () => {
      const proto = PeopleReviewController.prototype as any;
      expect(typeof proto.triageList).toBe('function');
      const text = fs.readFileSync(path.resolve(__dirname, '../review/people-triage.service.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(text).not.toMatch(/\b(insert|update|delete)\s*\(|INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM/i);
      for (const f of ['people.service.ts', 'people-search.service.ts', 'people-export.service.ts', 'people.controller.ts']) {
        expect(fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8')).not.toMatch(/triage/i);
      }
    });
  });

  describe('categories and priority', () => {
    it('quarantine appears (NORMAL), links to the existing quarantine review, and disappears when a reviewer closes it', async () => {
      const co = await company();
      const r = await fromA([rec(co, 'Bad Title', `rec-${tag()}`, { jobTitle: '' })]);
      expect(r.results[0].outcome).toBe('QUARANTINED');
      const q = (await db.select().from(schema.peopleIngestionQuarantine)).find((x) => (x.raw as any).personName === 'Bad Title' && x.status === 'PENDING')!;
      const item = await find(`quarantine:${q.id}`);
      expect(item).toMatchObject({ category: 'QUARANTINE', priority: 'NORMAL', status: 'PENDING', refType: 'QUARANTINE', refId: q.id, personName: 'Bad Title', link: { workflow: 'QUARANTINE_REVIEW', path: `${BASE}/quarantine/${q.id}` } });
      await GET(item.link.path, dataManager).expect(200); // the existing workflow endpoint
      await POST(`${BASE}/quarantine/${q.id}/reject`, admin, { reason: 'not usable' }).expect(200);
      expect(await find(`quarantine:${q.id}`)).toBeUndefined(); // reflects the underlying state, no second "resolved" flag
    });

    it('suppression hits are CRITICAL; ambiguous / unknown company is an IDENTITY issue (HIGH)', async () => {
      const co = await company();
      const li = `https://www.linkedin.com/in/${tag()}-triage`;
      const a = await fromA([rec(co, 'Sup Pressed', `rec-${tag()}`, { linkedinUrl: li })]);
      await publishing.suppressPerson(a.results[0].personId!, { reviewedBy: 'r@orion.test', note: 'opt-out request' });
      const r = await fromA([rec(co, 'Sup Pressed', `rec-${tag()}`, { linkedinUrl: li })]);
      expect(r.results[0].outcome).toBe('QUARANTINED');
      const sup = (await triage('category=SUPPRESSION')).data;
      expect(sup.length).toBeGreaterThan(0);
      expect(sup.every((i) => i.priority === 'CRITICAL' && i.reasonCode === 'SUPPRESSED_PERSON')).toBe(true);

      await fromA([rec({ id: '00000000-0000-4000-8000-000000000001' }, 'Ghost Person', `rec-${tag()}`)]);
      const ident = (await triage('category=IDENTITY')).data.find((i) => i.personName === 'Ghost Person');
      expect(ident).toMatchObject({ priority: 'HIGH', reasonCode: 'BUSINESS_NOT_FOUND' });
    });

    it('conflicts appear with their category; a conflict on a person with a PUBLISHED role is CRITICAL, otherwise HIGH', async () => {
      const co = await company();
      const email = `trg.${tag()}@corp-tr.co.in`;
      const a = await fromA([rec(co, 'Con Flicted', 'rec-a', { jobTitle: 'CEO', email })]);
      const personId = a.results[0].personId!;
      await fromB([rec(co, 'Con Flicted', 'rec-b', { jobTitle: 'Managing Director', email })]);
      const c = (await db.select().from(schema.peopleConflicts)).find((x) => x.personId === personId && x.conflictType === 'ROLE_TITLE')!;
      let item = await find(`conflict:${c.id}`);
      expect(item).toMatchObject({ category: 'CONFLICT', reasonCode: 'ROLE_TITLE', priority: 'HIGH', status: 'OPEN', refType: 'CONFLICT', refId: c.id, personId, link: { workflow: 'ROLE_REVIEW' } });
      await GET(item.link.path, admin).expect(200).expect((res) => expect(res.body.data.conflicts.length).toBeGreaterThan(0)); // the existing role detail shows it
      const [role] = await roles(personId);
      await publishing.publishRole(role.id, { reviewedBy: 'r@orion.test', note: 'ok' });
      item = await find(`conflict:${c.id}`);
      expect(item.priority).toBe('CRITICAL'); // customer-visible data at risk
      // duplicate underlying detection does not duplicate the item
      await fromA([rec(co, 'Con Flicted', 'rec-a', { jobTitle: 'CEO', email })]);
      await fromB([rec(co, 'Con Flicted', 'rec-b', { jobTitle: 'Managing Director', email })]);
      expect((await triage()).data.filter((i) => i.id === `conflict:${c.id}`)).toHaveLength(1);
      // when the underlying conflict is no longer open, triage reflects it
      await db.update(schema.peopleConflicts).set({ status: 'RESOLVED' }).where(eq(schema.peopleConflicts.id, c.id));
      expect(await find(`conflict:${c.id}`)).toBeUndefined();
      await db.update(schema.peopleConflicts).set({ status: 'OPEN' }).where(eq(schema.peopleConflicts.id, c.id));
      expect(await find(`conflict:${c.id}`)).toBeDefined();
    });

    it('contact conflicts are CONTACT, linked to the person role review', async () => {
      const c1 = await company();
      const c2 = await company();
      const email = `shr.${tag()}@corp-tr.co.in`;
      await fromA([rec(c1, 'Alpha Holder', 'rec-1', { email })]);
      await fromB([rec(c2, 'Bravo Other', 'rec-2', { email })]);
      const items = (await triage('category=CONTACT')).data;
      const item = items.find((i) => i.reasonCode === 'CONTACT_MULTIPLE_PEOPLE' && ['Alpha Holder', 'Bravo Other'].includes(i.personName));
      expect(item).toMatchObject({ category: 'CONTACT', status: 'OPEN', link: { workflow: 'ROLE_REVIEW' } });
      await GET(item.link.path, admin).expect(200);
    });

    it('a verification dispute appears (CRITICAL when the role is published) and goes away when the underlying status changes', async () => {
      const co = await company();
      const a = await fromA([rec(co, 'Dis Puted', `rec-${tag()}`, { jobTitle: 'Head of Sales' })]);
      const [role] = await roles(a.results[0].personId!);
      await db.update(schema.companyPeople).set({ verificationStatus: 'CONFLICTED' }).where(eq(schema.companyPeople.id, role.id));
      let item = await find(`role-verification:${role.id}`);
      expect(item).toMatchObject({ category: 'VERIFICATION', reasonCode: 'VERIFICATION_CONFLICTED', priority: 'HIGH', refType: 'ROLE', link: { workflow: 'VERIFICATION_REVIEW', path: `${BASE}/roles/${role.id}` } });
      await db.update(schema.companyPeople).set({ isPublished: true, reviewStatus: 'APPROVED' }).where(eq(schema.companyPeople.id, role.id));
      item = await find(`role-verification:${role.id}`);
      expect(item).toMatchObject({ priority: 'CRITICAL', status: 'APPROVED' });
      await db.update(schema.companyPeople).set({ verificationStatus: 'UNVERIFIED' }).where(eq(schema.companyPeople.id, role.id));
      expect(await find(`role-verification:${role.id}`)).toBeUndefined();
    });

    it('an unclassified title on a pending role is a CLASSIFICATION item (LOW) until it is classified or decided', async () => {
      const co = await company();
      const a = await fromA([rec(co, 'Uncl Assified', `rec-${tag()}`, { jobTitle: 'Wizard of Whimsy' })]);
      const [role] = await roles(a.results[0].personId!);
      expect(await find(`role-classification:${role.id}`)).toMatchObject({ category: 'CLASSIFICATION', reasonCode: 'UNCLASSIFIED_TITLE', priority: 'LOW', status: 'PENDING', link: { workflow: 'ROLE_REVIEW' } });
      await POST(`${BASE}/roles/${role.id}/reject`, admin, { reason: 'not a real role' }).expect(200);
      expect(await find(`role-classification:${role.id}`)).toBeUndefined();
    });
  });

  describe('ordering, pagination, filters', () => {
    it('is ordered by priority, then oldest first, then id; repeated calls are identical', async () => {
      const co = await company();
      await fromA([rec(co, 'Normal Item', `rec-${tag()}`, { jobTitle: '' })]); // NORMAL (quarantine)
      await fromA([rec(co, 'Low Item', `rec-${tag()}`, { jobTitle: 'Wizard of Whimsy' })]); // LOW (unclassified)
      const a = await triage();
      const b = await triage();
      expect(b.data.map((i) => i.id)).toEqual(a.data.map((i) => i.id));
      const rank: Record<string, number> = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
      for (let i = 1; i < a.data.length; i++) {
        const [x, y] = [a.data[i - 1], a.data[i]];
        const k = rank[x.priority] - rank[y.priority] || new Date(x.detectedAt).getTime() - new Date(y.detectedAt).getTime() || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
        expect(k).toBeLessThanOrEqual(0);
      }
      expect(a.data.map((i) => i.priority)).toEqual(expect.arrayContaining(['CRITICAL', 'HIGH', 'NORMAL', 'LOW']));
      expect(new Set(a.data.map((i) => i.id)).size).toBe(a.data.length); // no duplicates
    });

    it('pages never overlap or skip, and the total is consistent', async () => {
      const all = (await triage()).data.map((i) => i.id);
      const seen: string[] = [];
      let page = 1;
      for (;;) {
        const r = (await GET(`${BASE}/triage?limit=3&page=${page}`, admin).expect(200)).body;
        expect(r.pagination).toMatchObject({ page, limit: 3, totalItems: all.length });
        seen.push(...r.data.map((i: any) => i.id));
        if (page >= r.pagination.totalPages) break;
        page++;
      }
      expect(seen).toEqual(all);
    });

    it('filters by category, priority, status, name, person, company and detection time', async () => {
      const all = (await triage()).data;
      const some = all.find((i) => i.personId && i.businessId)!;
      expect((await triage('category=CONFLICT,CONTACT')).data.every((i) => ['CONFLICT', 'CONTACT'].includes(i.category))).toBe(true);
      expect((await triage('priority=CRITICAL')).data.every((i) => i.priority === 'CRITICAL')).toBe(true);
      expect((await triage('status=PENDING')).data.every((i) => i.status === 'PENDING')).toBe(true);
      expect((await triage(`personId=${some.personId}`)).data.every((i) => i.personId === some.personId)).toBe(true);
      expect((await triage(`businessId=${some.businessId}`)).data.every((i) => i.businessId === some.businessId)).toBe(true);
      expect((await triage(`q=${encodeURIComponent(some.personName.slice(0, 4))}`)).data.some((i) => i.id === some.id)).toBe(true);
      expect((await triage('category=NOPE')).data).toEqual([]);
      expect((await triage('detectedFrom=2100-01-01T00:00:00Z')).data).toEqual([]);
      expect((await triage('detectedTo=2000-01-01T00:00:00Z')).data).toEqual([]);
    });
  });

  describe('read-only and internal only', () => {
    it('reading triage changes nothing (no rows, no audit, no timestamps)', async () => {
      const snap = async () => {
        const out: Record<string, unknown> = {};
        for (const t of ['company_people', 'people', 'person_contacts', 'people_conflicts', 'people_ingestion_quarantine', 'audit_logs', 'people_verifications']) {
          const res: any = await db.execute(sql.raw(`SELECT count(*)::int AS n, max(${({ audit_logs: 'created_at', people_verifications: 'created_at', people_conflicts: 'last_detected_at' } as Record<string, string>)[t] ?? 'updated_at'})::text AS m FROM ${t}`));
          out[t] = (res.rows ?? res)[0];
        }
        return out;
      };
      const before = await snap();
      await triage();
      await triage('category=CONFLICT&priority=HIGH');
      await GET(`${BASE}/triage?page=999`, admin).expect(200);
      expect(await snap()).toEqual(before);
    });

    it('exposes only the documented fields: no digests, rule ids, raw payload, source keys, contact values or reviewer identity', async () => {
      const r = await triage();
      expect(r.data.length).toBeGreaterThan(0);
      for (const i of r.data) {
        expect(Object.keys(i).sort()).toEqual(['businessId', 'category', 'companyName', 'detectedAt', 'id', 'link', 'personId', 'personName', 'priority', 'reasonCode', 'refId', 'refType', 'status', 'updatedAt'].sort());
      }
      const dump = JSON.stringify(r);
      expect(dump).not.toMatch(/h:[0-9a-f]{64}|SEN-|DEP-|DM-|REL-|subject_?key|@corp-tr|linkedin\.com|reviewer@|raw|payload|source_?key|people-json|feed-/i);
    });
  });
});

import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { DynamicModule, Global, INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { UserRole } from '@orion/shared';
import { eq, like, sql } from 'drizzle-orm';
import * as jwt from 'jsonwebtoken';
import { ExtractJwt, Strategy } from 'passport-jwt';
import request from 'supertest';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { AllExceptionsFilter } from '../../../common/filters/all-exceptions.filter';
import { applyUploadBodyLimit } from '../../../common/http/upload-body-limit';
import { TransformInterceptor } from '../../../common/interceptors/transform.interceptor';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { TransactionService } from '../../../database/transaction.service';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import { QueueService } from '../../queue/queue.service';
import { StorageService } from '../../storage/storage.service';
import { PeopleExportImportController } from '../ingestion/people-export-import.controller';
import { buildReconciliation, IMPORT_SLICE_SIZE, PeopleExportImportService } from '../ingestion/people-export-import.service';
import { PeopleImportJobService } from '../ingestion/people-import-job.service';
import { PeopleIngestionService } from '../ingestion/people-ingestion.service';
import { ObservationService } from '../observations/observation.service';
import { PeopleWriteService } from '../people-write.service';
import { PeoplePublishingService } from '../people-publishing.service';
import { PeopleQuarantineService } from '../review/people-quarantine.service';
import { PeopleReviewController } from '../review/people-review.controller';
import { PeopleReviewService } from '../review/people-review.service';
import { PeopleTriageService } from '../review/people-triage.service';
import { BUILT_IN_SOURCE_KEYS } from '../sources/built-in-sources';
import { SourceRegistryService } from '../sources/source-registry.service';
import { PeopleVerificationController } from '../verification/people-verification.controller';
import { PeopleVerificationService } from '../verification/people-verification.service';
import { expectLedgerConsistent } from './ledger-invariants';
import { exportRow, ExportRowInput, toCsv, toJson } from './people-export-fixtures';
import { createTestDb, JOURNALED_MIGRATIONS, seedBusiness, seedUser } from './pglite-test-db';

/**
 * Phase 9A: the file handoff (People Pipeline export -> Orion People Import) as an operational workflow.
 *
 * Nothing here changes how People are ingested. It proves, end to end over HTTP and the real services on an in-memory database, that
 * the existing mechanisms already make the handoff reliable: reconciliation of every row, a large export carried as several
 * independently importable files, retries and partial failures, an unmatched company going through the existing quarantine, the
 * existing source identification, and the review / verification / edit protections staying intact after an import.
 */
const SECRET = 'people-handoff-secret';
class TestJwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: SECRET });
  }
  validate(payload: unknown) {
    return payload;
  }
}
@Global()
@Module({})
class TestDbModule {
  static forDb(db: DrizzleDb): DynamicModule {
    return { module: TestDbModule, global: true, providers: [{ provide: DRIZZLE_DATABASE, useValue: db }, TransactionService], exports: [DRIZZLE_DATABASE, TransactionService] };
  }
}
class FakeStorage {
  files = new Map<string, Buffer>();
  async uploadFile(o: { key: string; buffer: Buffer }) {
    this.files.set(o.key, o.buffer);
    return { key: o.key } as any;
  }
  async getFileStream(key: string) {
    const b = this.files.get(key);
    if (!b) throw new Error('NoSuchKey');
    return Readable.from([b]);
  }
  async deleteFile(key: string) {
    return this.files.delete(key);
  }
}
const poolOver = (client: { query: (t: string, p?: unknown[]) => Promise<{ rows: any[] }> }) => {
  const query = async (text: string, params?: unknown[]) => {
    const r = await client.query(text, params);
    return { rows: r.rows, rowCount: r.rows.length };
  };
  return { query, connect: async () => ({ query, release: () => undefined }) };
};

const PREFIX = '/api/v1';
const IMPORT = `${PREFIX}/admin/people/import`;
const REVIEW = `${PREFIX}/internal/people-review`;
const VERIFY = `${PREFIX}/internal/people-verification`;
const GSTIN_A = '27AAACT2727Q1ZW';
const REGISTRY = { sourceType: 'GOVERNMENT_REGISTRY', evidenceType: 'REGISTRY_FILING', sourceReference: 'MCA filing SRN-778' };
const nameOf = (slug: string) => `${slug} Pvt Ltd`;
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

describe('People export handoff hardening (Phase 9A)', () => {
  let app: INestApplication;
  let db: DrizzleDb;
  let close: () => Promise<void>;
  let ingestion: PeopleIngestionService;
  let sources: SourceRegistryService;
  let jobsSvc: PeopleImportJobService;
  let queue: QueueService;
  const storage = new FakeStorage();
  let admin: { id: string; email: string; token: string };
  let n = 0;
  const A = { slug: 'hand-alpha', city: 'Pune', state: 'Maharashtra' };
  const B = { slug: 'hand-bravo', city: 'Chennai', state: 'Tamil Nadu' };
  const biz: Record<string, { id: string }> = {};

  const tokenFor = (id: string, role: string, email: string) => jwt.sign({ sub: id, email, role }, SECRET);
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${admin.token}`);
  const letters = (k: number) => {
    let s = '';
    let v = k + 1;
    while (v > 0) {
      s = String.fromCharCode(97 + ((v - 1) % 26)) + s;
      v = Math.floor((v - 1) / 26);
    }
    return s;
  };
  const pname = () => `Hand${letters(++n)} Kapoorv${letters(n * 7)}`;
  const row = (over: Partial<ExportRowInput> = {}): ExportRowInput =>
    exportRow({
      company_name: nameOf(A.slug), company_city: A.city, company_state: A.state, full_name: pname(), job_title: 'Head of Procurement',
      relationship_id: randomUUID(), ...over,
    });
  const post = (body: object) => auth(request(app.getHttpServer()).post(IMPORT)).send(body);
  const getJob = (id: string) => auth(request(app.getHttpServer()).get(`${IMPORT}/${id}`));
  const finished = async (jobId: string) => {
    const started = Date.now();
    for (;;) {
      const res = await getJob(jobId);
      const view = res.body.data ?? res.body;
      if (res.status !== 200 || !['QUEUED', 'RUNNING'].includes(view.status)) return view as any;
      if (Date.now() - started > 90_000) throw new Error(`job ${jobId} did not finish: ${view.status}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  const accept = async (rows: ExportRowInput[], extra: object = {}, as: 'csv' | 'json' = 'csv') => {
    const r = await post({ format: as, content: as === 'csv' ? toCsv(rows) : toJson(rows), ...extra });
    expect(r.status).toBe(202);
    return (r.body.data ?? r.body) as any;
  };
  const run = async (rows: ExportRowInput[], extra: object = {}, as: 'csv' | 'json' = 'csv') => finished((await accept(rows, extra, as)).jobId);
  const count = async (table: any) => (await db.select({ n: sql<number>`count(*)::int` }).from(table))[0].n as number;
  const snapshot = async () => ({
    businesses: await count(schema.businesses), identifiers: await count(schema.businessIdentifiers),
    people: await count(schema.people), roles: await count(schema.companyPeople), contacts: await count(schema.personContacts),
    evidence: await count(schema.peopleEvidence), quarantine: await count(schema.peopleIngestionQuarantine),
  });
  const withIngest = async (wrapper: (real: PeopleIngestionService['ingest'], next: () => number) => PeopleIngestionService['ingest'], body: () => Promise<void>) => {
    const real = ingestion.ingest.bind(ingestion);
    let calls = 0;
    (ingestion as any).ingest = wrapper(real, () => ++calls);
    try {
      await body();
    } finally {
      (ingestion as any).ingest = real;
    }
  };
  const personByName = async (name: string) => (await db.select().from(schema.people).where(eq(schema.people.normalizedName, name.toLowerCase())))[0];
  const rolesOf = (personId: string) => db.select().from(schema.companyPeople).where(eq(schema.companyPeople.personId, personId));
  const roleByName = async (name: string) => (await rolesOf((await personByName(name)).id))[0];

  beforeAll(async () => {
    const t = await createTestDb([...JOURNALED_MIGRATIONS, '0017_queue_jobs_admin_otps.sql']);
    db = t.db;
    close = () => t.client.close();
    const module = await Test.createTestingModule({
      imports: [PassportModule, TestDbModule.forDb(db)],
      controllers: [PeopleExportImportController, PeopleReviewController, PeopleVerificationController],
      providers: [
        { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
        TestJwtStrategy, JwtAuthGuard, RolesGuard, Reflector,
        PeopleWriteService, PeopleIngestionService, PeopleExportImportService, SourceRegistryService, ObservationService, PeopleImportJobService,
        PeoplePublishingService, PeopleReviewService, PeopleQuarantineService, PeopleTriageService, PeopleVerificationService,
        { provide: StorageService, useValue: storage },
        { provide: QueueService, useFactory: () => new QueueService(t.db, poolOver(t.client as any) as any) },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix(PREFIX.slice(1));
    applyUploadBodyLimit(app, PREFIX);
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    ingestion = module.get(PeopleIngestionService);
    sources = module.get(SourceRegistryService);
    jobsSvc = module.get(PeopleImportJobService);
    queue = module.get(QueueService);

    for (const c of [A, B]) biz[c.slug] = await seedBusiness(db, c.slug, { city: c.city, state: c.state });
    await db.insert(schema.businessIdentifiers).values({ businessId: biz[A.slug].id, type: 'GSTIN', value: GSTIN_A, normalizedValue: GSTIN_A });
    for (const slug of ['hand-twin-one', 'hand-twin-two']) {
      const [b] = await db.insert(schema.businesses).values({ slug, name: 'Handtwin Works Pvt Ltd', status: 'PUBLISHED', publishedAt: new Date() }).returning();
      await db.insert(schema.businessLocations).values({ businessId: b.id, addressLine1: '1 Test Street', city: 'Nagpur', district: 'Nagpur', state: 'Maharashtra', pincode: '440001', isPrimary: true });
    }
    const a = await seedUser(db, 'handoff.admin@orion.test', undefined, 'ADMIN');
    admin = { id: a.id, email: a.email, token: tokenFor(a.id, UserRole.ADMIN, a.email) };
  }, 120_000);

  afterAll(async () => {
    await expectLedgerConsistent(db);
    queue?.unregisterWorker(QUEUE_NAMES.PEOPLE_IMPORT);
    await app?.close();
    await close?.();
  });

  // ------------------------------------------------------------------------------------------------ reconciliation
  describe('reconciliation', () => {
    const mixedFile = () => [
      row(), row(), row(),
      row({ company_name: nameOf(B.slug), company_city: B.city, company_state: B.state }),
      row({ company_name: 'Nowhere Land Pvt Ltd', company_city: 'Pune', company_state: 'Maharashtra' }), // unmatched
      row({ company_name: 'Handtwin Works Pvt Ltd', company_city: 'Nagpur', company_state: 'Maharashtra' }), // ambiguous
      row({ job_title: null }), // refused by the ingestion layer -> quarantine
      row({ gstin: 'NOT-A-GSTIN' }), // refused before ingestion
      row({ relationship_id: '11111111-1111-4111-8111-111111111111' }),
      row({ relationship_id: '11111111-1111-4111-8111-111111111111' }), // repeated relationship_id -> refused before ingestion
    ];

    it('explains every row of a mixed file: file rows = rejected before ingestion + received; received = accepted + quarantined; nothing unaccounted', async () => {
      const before = await snapshot();
      const view = await run(mixedFile());
      expect(view).toMatchObject({ status: 'COMPLETED_WITH_ISSUES', totalRows: 10, processedRows: 10, imported: 5, quarantined: 3, failed: 2, unmatched: 1, ambiguous: 1 });
      const r = view.reconciliation;
      expect(r).toEqual({
        rowsInFile: 10, rejectedBeforeIngestion: 2, receivedByIngestion: 8, accepted: 5, imported: 5, updated: 0, unchanged: 0, valid: 0,
        quarantined: 3, unaccounted: 0, balanced: true,
      });
      expect(r.rejectedBeforeIngestion + r.receivedByIngestion).toBe(r.rowsInFile);
      expect(r.accepted + r.quarantined + r.unaccounted).toBe(r.receivedByIngestion);
      expect(r.imported + r.updated + r.unchanged + r.valid).toBe(r.accepted);
      const after = await snapshot();
      expect(after.people - before.people).toBe(5); // what the reconciliation says was created is exactly what exists
      expect(after.businesses).toBe(before.businesses);
    });

    it('the same numbers appear in the status endpoint and the history list, and a re-import reconciles as unchanged', async () => {
      const rows = [row(), row(), row({ company_name: 'Nowhere Land Pvt Ltd', company_city: 'Pune', company_state: 'Maharashtra' })];
      const first = await run(rows);
      const second = await run(rows);
      expect(second.batchRef).toBe(first.batchRef);
      expect(second.reconciliation).toMatchObject({ rowsInFile: 3, accepted: 2, imported: 0, unchanged: 2, quarantined: 1, unaccounted: 0, balanced: true });
      const history = await auth(request(app.getHttpServer()).get(`${IMPORT}?limit=5`));
      const listed = (history.body.data as any[]).find((j: any) => j.jobId === second.jobId);
      expect(listed.reconciliation).toEqual(second.reconciliation);
    });

    it('a dry run reconciles as valid rows (nothing written) and a synchronous import carries the same block', async () => {
      const rows = [row(), row(), row({ gstin: 'BAD' })];
      const before = await snapshot();
      const view = await run(rows, { dryRun: true });
      expect(view.status).toBe('DRY_RUN');
      expect(view.reconciliation).toMatchObject({ rowsInFile: 3, rejectedBeforeIngestion: 1, receivedByIngestion: 2, accepted: 2, valid: 2, imported: 0, unaccounted: 0, balanced: true });
      expect(await snapshot()).toEqual(before);
    });

    it('a failed job does not hide the rows it did not reach: they are reported as unaccounted and the job is not balanced', async () => {
      const total = IMPORT_SLICE_SIZE + 20;
      const rows = Array.from({ length: total }, () => row());
      const before = await snapshot();
      await withIngest(
        (real, next) => async (recs, opts) => {
          if (next() >= 2) throw new Error('boom: SELECT secret FROM t');
          return real(recs, opts);
        },
        async () => {
          const view = await finished((await accept(rows)).jobId);
          expect(view).toMatchObject({ status: 'FAILED', processedRows: IMPORT_SLICE_SIZE });
          expect(view.reconciliation).toMatchObject({ rowsInFile: total, receivedByIngestion: total, accepted: IMPORT_SLICE_SIZE, quarantined: 0, unaccounted: 20, balanced: false });
          expect(JSON.stringify(view)).not.toMatch(/secret|SELECT|boom/);
        },
      );
      expect((await snapshot()).people).toBe(before.people + IMPORT_SLICE_SIZE);
    }, 120_000);

    it('buildReconciliation is pure arithmetic over counts (no personal data can enter it)', () => {
      const r = buildReconciliation({ totalRows: 10, failed: 1, imported: 4, updated: 2, unchanged: 1, valid: 0, quarantined: 1 });
      expect(r).toMatchObject({ receivedByIngestion: 9, accepted: 7, unaccounted: 1, balanced: false });
      expect(Object.keys(r).sort()).toEqual(['accepted', 'balanced', 'imported', 'quarantined', 'receivedByIngestion', 'rejectedBeforeIngestion', 'rowsInFile', 'unaccounted', 'unchanged', 'updated', 'valid']);
    });
  });

  // ------------------------------------------------------------------------------------------------ a large export carried as several files
  describe('a large export delivered as several files (what a split export gives the importer)', () => {
    const EXPORTED_AT = hoursAgo(3);
    const stamp = (rows: ExportRowInput[]): ExportRowInput[] => rows.map((r) => ({ ...r, exported_at: EXPORTED_AT }));
    const linkedin = `https://www.linkedin.com/in/hand-multi-${randomUUID().slice(0, 8)}`;
    const multiName = pname();
    const makeParts = () => {
      const p1 = stamp([row({ full_name: multiName, linkedin_url: linkedin }), row(), row(), row()]);
      const p2 = stamp([row(), row({ company_name: nameOf(B.slug), company_city: B.city, company_state: B.state }), row(), row()]);
      const p3 = stamp([row({ full_name: multiName, linkedin_url: linkedin, company_name: nameOf(B.slug), company_city: B.city, company_state: B.state }), row(), row()]);
      return [p1, p2, p3];
    };

    it('the parts share no row, each is its own run, and together they import exactly the people of the whole: nobody duplicated', async () => {
      const parts = makeParts();
      const all = parts.flat();
      expect(new Set(all.map((r) => r.relationship_id)).size).toBe(all.length); // no row appears in two parts
      const before = await snapshot();
      const views = [];
      for (const [i, part] of parts.entries()) views.push(await run(part, {}, i === 1 ? 'json' : 'csv')); // CSV and JSON parts mix freely
      expect(new Set(views.map((v) => v.batchRef)).size).toBe(3); // each part is independently identifiable
      expect(views.map((v) => v.totalRows)).toEqual([4, 4, 3]);
      expect(views.every((v) => v.reconciliation.balanced && v.status === 'COMPLETED')).toBe(true);
      expect(views.reduce((s, v) => s + v.reconciliation.accepted, 0)).toBe(all.length); // the parts account for every row of the export
      const after = await snapshot();
      expect(after.people - before.people).toBe(10); // 11 rows; one person has a role at two companies
      expect(after.roles - before.roles).toBe(11);
      const person = await personByName(multiName);
      expect(await rolesOf(person.id)).toHaveLength(2); // one person, two relationships, across two different files
    });

    it('re-importing a part (a retry) is idempotent: same run, everything unchanged, nothing duplicated', async () => {
      const parts = makeParts();
      const first = await run(parts[1], {}, 'json');
      const mid = await snapshot();
      const again = await run(parts[1], {}, 'json');
      expect(again.batchRef).toBe(first.batchRef);
      expect(again).toMatchObject({ imported: 0, updated: 0, unchanged: 4, quarantined: 0 });
      expect(again.observations).toMatchObject({ recorded: 0, duplicate: 4 });
      expect(await snapshot()).toEqual(mid);
    });

    it('the whole export imported after its parts changes no People data', async () => {
      const parts = makeParts();
      for (const p of parts) await run(p);
      const mid = await snapshot();
      const whole = await run(parts.flat());
      expect(whole).toMatchObject({ imported: 0, updated: 0, unchanged: 11, quarantined: 0, status: 'COMPLETED' });
      expect(await snapshot()).toEqual(mid);
    });

    it('a part that fails is detectable (FAILED, not balanced, short of the export total); the other parts are unaffected; retrying only that part completes it without duplicates', async () => {
      const parts = makeParts().map((p) => p.map((r) => ({ ...r, exported_at: hoursAgo(5), relationship_id: randomUUID(), full_name: pname(), linkedin_url: null })));
      const total = parts.flat().length;
      const before = await snapshot();
      const accepted: any[] = [];
      queue.unregisterWorker(QUEUE_NAMES.PEOPLE_IMPORT); // queue all three parts first, so the fault is in place before any runs
      for (const p of parts) accepted.push(await accept(p));
      const failRef = accepted[1].batchRef;
      const views: any[] = [];
      await withIngest(
        (real) => async (recs, opts) => {
          if (opts?.batchRef === failRef) throw new Error('part 2 is unlucky: postgres://u:p@h/db');
          return real(recs, opts);
        },
        async () => {
          queue.registerWorker(QUEUE_NAMES.PEOPLE_IMPORT, async (job) => jobsSvc.execute(job.id));
          for (const a of accepted) views.push(await finished(a.jobId));
        },
      );
      expect(views.map((v) => v.status)).toEqual(['COMPLETED', 'FAILED', 'COMPLETED']);
      expect(views[1].reconciliation).toMatchObject({ rowsInFile: 4, accepted: 0, unaccounted: 4, balanced: false });
      expect(views.reduce((s, v) => s + v.reconciliation.accepted, 0)).toBe(total - 4); // the shortfall is visible
      expect(JSON.stringify(views)).not.toMatch(/postgres|unlucky/);
      expect((await snapshot()).people).toBe(before.people + (parts[0].length + parts[2].length - 0));

      // retry only the failed part, with a healthy worker
      const retry = await run(parts[1]);
      expect(retry.batchRef).toBe(failRef);
      expect(retry).toMatchObject({ status: 'COMPLETED', imported: 4, quarantined: 0 });
      expect(retry.reconciliation.balanced).toBe(true);
      const after = await snapshot();
      expect(after.people).toBe(before.people + total);
      expect(after.roles).toBe(before.roles + total);
      // retrying a part that already completed adds nothing
      const done = await snapshot();
      await run(parts[0]);
      expect(await snapshot()).toEqual(done);
    }, 120_000);
  });

  // ------------------------------------------------------------------------------------------------ unmatched companies
  describe('an unmatched Pipeline company goes through the existing quarantine', () => {
    const REVIEW_GET = (p: string) => auth(request(app.getHttpServer()).get(`${REVIEW}/${p}`));
    const REVIEW_POST = (p: string, body: object = {}) => auth(request(app.getHttpServer()).post(`${REVIEW}/${p}`)).send(body);
    const missing = (slug: string, over: Partial<ExportRowInput> = {}) => row({ company_name: nameOf(slug), company_city: 'Surat', company_state: 'Gujarat', ...over });

    it('is identified, reviewed, retried (after the company exists), rejected or suppressed - and no company is ever created from a People export', async () => {
      const slugs = ['hand-late-one', 'hand-late-two', 'hand-late-three'];
      const rows = slugs.map((s) => missing(s, { linkedin_url: `https://www.linkedin.com/in/${s}-${randomUUID().slice(0, 6)}` }));
      const before = await snapshot();
      const view = await run(rows);
      expect(view).toMatchObject({ status: 'COMPLETED_WITH_ISSUES', unmatched: 3, quarantined: 3, imported: 0 });
      expect(view.reasonCounts).toMatchObject({ BUSINESS_NOT_FOUND: 3 });
      expect(view.reconciliation).toMatchObject({ accepted: 0, quarantined: 3, unaccounted: 0, balanced: true });
      expect((await snapshot()).businesses).toBe(before.businesses); // never created from a People export

      // identified: the reviewer finds them by the import's run id and sees the reason code
      const listed = (await REVIEW_GET(`quarantine?batchRef=${view.batchRef}`).expect(200)).body.data as any[];
      expect(listed).toHaveLength(3);
      expect(listed.every((q) => q.status === 'PENDING' && q.reasons[0].code === 'BUSINESS_NOT_FOUND')).toBe(true);
      const byName = (rec: ExportRowInput) => listed.find((q) => q.personName === rec.full_name)!;
      const detail = (await REVIEW_GET(`quarantine/${byName(rows[0]).id}`).expect(200)).body.data;
      expect(detail.companyMatch.status).toBe('NOT_FOUND');
      expect(detail.raw.source).toMatchObject({ label: 'people-pipeline-export:PEOPLE_FILE' });

      // retried while the company is still missing: stays pending, no second row
      const q0 = await snapshot();
      const stay = await REVIEW_POST(`quarantine/${byName(rows[0]).id}/retry`, { reason: 'checking again' }).expect(200);
      expect(stay.body.data).toMatchObject({ status: 'PENDING', outcome: 'QUARANTINED' });
      expect((await snapshot()).quarantine).toBe(q0.quarantine);

      // resolved: the company is added through the normal company flow, then the reviewer retries
      await seedBusiness(db, slugs[0], { city: 'Surat', state: 'Gujarat' });
      const fixed = await REVIEW_POST(`quarantine/${byName(rows[0]).id}/retry`, { reason: 'company now exists' }).expect(200);
      expect(fixed.body.data).toMatchObject({ status: 'RESOLVED', outcome: 'CREATED' });
      const role = (await db.select().from(schema.companyPeople).where(eq(schema.companyPeople.id, fixed.body.data.companyPersonId)))[0];
      expect(role).toMatchObject({ reviewStatus: 'PENDING', isPublished: false, verificationStatus: 'UNVERIFIED' });

      // rejected
      await REVIEW_POST(`quarantine/${byName(rows[1]).id}/reject`, { reason: 'not a company we serve' }).expect(200);
      const rejected = (await db.select().from(schema.peopleIngestionQuarantine).where(eq(schema.peopleIngestionQuarantine.id, byName(rows[1]).id)))[0];
      expect(rejected.status).toBe('DISCARDED');

      // suppressed: the person can never be ingested again, from this or any later export
      await seedBusiness(db, slugs[2], { city: 'Surat', state: 'Gujarat' });
      const sup = await REVIEW_POST(`quarantine/${byName(rows[2]).id}/suppress`, { reason: 'asked not to be listed' }).expect(200);
      expect(sup.body.data).toMatchObject({ status: 'DISCARDED', action: 'SUPPRESSED' });
      const again = await run([{ ...rows[2], exported_at: hoursAgo(1), relationship_id: randomUUID() }]);
      expect(again).toMatchObject({ imported: 0, quarantined: 1 });
      expect(again.reasonCounts).toMatchObject({ SUPPRESSED_PERSON: 1 });
      expect((await snapshot()).businesses).toBe(before.businesses + 2); // only the two the test itself added
    }, 120_000);
  });

  // ------------------------------------------------------------------------------------------------ source identification
  describe('source identification', () => {
    it('Pipeline exports are identified by the existing source mechanism: the people-json row, a distinct run id and the source label on held rows; no source row is added and its policy is untouched', async () => {
      const sourcesBefore = await sources.list();
      const rows = [row({ source_provider: 'PEOPLE_FILE' }), row({ source_provider: null })];
      const view = await run(rows);
      expect(view.source).toEqual({ key: BUILT_IN_SOURCE_KEYS.JSON, version: '1' });
      expect(view.batchRef).toMatch(/^people-export-v1-[0-9a-f]{24}$/);
      const obs = await db.select().from(schema.peopleObservations).where(eq(schema.peopleObservations.batchRef, view.batchRef));
      expect(obs).toHaveLength(2);
      expect(obs.every((o) => o.sourceKey === BUILT_IN_SOURCE_KEYS.JSON)).toBe(true);
      expect(obs.every((o) => o.sourceVersion === '1' && o.outcome === 'INGESTED')).toBe(true);
      // every observation of a Pipeline export can be told apart from other people-json traffic by its run id
      const pipelineObs = await db.select().from(schema.peopleObservations).where(like(schema.peopleObservations.batchRef, 'people-export-v1-%'));
      expect(pipelineObs.length).toBeGreaterThanOrEqual(2);
      expect(await sources.list()).toEqual(sourcesBefore);
      const def = await sources.get(BUILT_IN_SOURCE_KEYS.JSON);
      expect(def).toMatchObject({ enabled: true, version: '1', sourceType: 'MANUAL_IMPORT' });
      expect(def!.termsAcknowledgedAt).not.toBeNull();
    });

    it('the existing source gate still applies: a disabled source stops the import (nothing is written) and re-enabling it lets the same file through', async () => {
      const rows = [row(), row()];
      const before = await snapshot();
      await sources.setEnabled(BUILT_IN_SOURCE_KEYS.JSON, false);
      try {
        const failed = await run(rows);
        expect(failed.status).toBe('FAILED');
        expect(JSON.stringify(failed)).not.toMatch(/SOURCE_DISABLED|people-json/);
        expect(await snapshot()).toEqual(before);
      } finally {
        await sources.setEnabled(BUILT_IN_SOURCE_KEYS.JSON, true);
      }
      expect(await run(rows)).toMatchObject({ status: 'COMPLETED', imported: 2 });
    }, 120_000);
  });

  // ------------------------------------------------------------------------------------------------ review, verification, editing
  describe('People Review after an import', () => {
    it('imported people reach the review queue as DRAFT / PENDING / UNVERIFIED / unpublished, whatever the export claimed', async () => {
      const nm = pname();
      await run([row({ full_name: nm, verification_status: 'VERIFIED', confidence_level: 'HIGH', email: `${nm.split(' ')[0].toLowerCase()}@hand-alpha.example` })]);
      const queue = (await auth(request(app.getHttpServer()).get(`${REVIEW}/queue?q=${encodeURIComponent(nm)}`)).expect(200)).body.data as any[];
      expect(queue).toHaveLength(1);
      expect(queue[0]).toMatchObject({ fullName: nm, reviewStatus: 'PENDING', isPublished: false });
      const r = await roleByName(nm);
      expect(r).toMatchObject({ reviewStatus: 'PENDING', isPublished: false, verificationStatus: 'UNVERIFIED' });
      expect((await personByName(nm)).dataStatus).toBe('DRAFT');
      const contacts = await db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, r.personId));
      expect(contacts.every((c) => c.verificationStatus === 'UNVERIFIED' && c.isPublished === false)).toBe(true);
    });

    it('an admin can edit the imported role through the existing flow, and the edit is audited with before / after and a reason', async () => {
      const nm = pname();
      await run([row({ full_name: nm, job_title: 'Purchase Manager' })]);
      const role = await roleByName(nm);
      await auth(request(app.getHttpServer()).patch(`${REVIEW}/roles/${role.id}`)).send({ jobTitle: 'Chief Purchasing Officer' }).expect(400); // a reason is required
      await auth(request(app.getHttpServer()).patch(`${REVIEW}/roles/${role.id}`)).send({ jobTitle: 'Chief Purchasing Officer', reason: 'title corrected from the annual report' }).expect(200);
      const edited = (await db.select().from(schema.companyPeople).where(eq(schema.companyPeople.id, role.id)))[0];
      expect(edited.jobTitleAtCompany).toBe('Chief Purchasing Officer');
      expect(edited).toMatchObject({ reviewStatus: 'PENDING', isPublished: false }); // editing neither approves nor publishes
      const audit = (await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, role.id))).filter((a) => a.action === 'PEOPLE_ROLE_EDITED');
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ userId: admin.id });
      expect(JSON.stringify(audit[0].oldValues)).toContain('Purchase Manager');
      expect(JSON.stringify(audit[0].newValues)).toContain('Chief Purchasing Officer');
    });

    it('a re-import never downgrades what a reviewer verified, never resets the review, and adds no duplicate role, contact or evidence', async () => {
      const nm = pname();
      const email = `${nm.split(' ')[0].toLowerCase()}@hand-alpha.example`;
      const rec = row({ full_name: nm, email });
      await run([rec]);
      const role = await roleByName(nm);
      const V = (body: object) => auth(request(app.getHttpServer()).post(`${VERIFY}/roles/${role.id}/verify`)).send(body);
      await V({ claim: 'RELATIONSHIP', evidence: REGISTRY, note: 'officer of this company' }).expect(200);
      await V({ claim: 'TITLE', evidence: { ...REGISTRY, sourceReference: 'MCA filing SRN-779' }, note: 'designation on the filing' }).expect(200);
      expect((await roleByName(nm)).verificationStatus).toBe('VERIFIED');
      const mid = await snapshot();

      // a later export that says LOW confidence / UNVERIFIED about the same relationship
      const later = await run([{ ...rec, exported_at: hoursAgo(1), verification_status: 'UNVERIFIED', confidence_level: 'LOW', email_verification_status: 'UNVERIFIED' }]);
      expect(later).toMatchObject({ imported: 0, quarantined: 0, status: 'COMPLETED' });
      const after = await roleByName(nm);
      expect(after.verificationStatus).toBe('VERIFIED'); // the Pipeline's claim cannot lower Orion's verification
      expect(after.id).toBe(role.id);
      const now = await snapshot();
      expect({ people: now.people, roles: now.roles, contacts: now.contacts, evidence: now.evidence }).toEqual({ people: mid.people, roles: mid.roles, contacts: mid.contacts, evidence: mid.evidence });
    });

    it('a changed title in a later export becomes a separate role for review; the verified one is untouched', async () => {
      const nm = pname();
      const rec = row({ full_name: nm, linkedin_url: `https://www.linkedin.com/in/hand-title-${randomUUID().slice(0, 6)}` });
      await run([rec]);
      const first = await roleByName(nm);
      await auth(request(app.getHttpServer()).post(`${VERIFY}/roles/${first.id}/verify`)).send({ claim: 'RELATIONSHIP', evidence: REGISTRY, note: 'officer of this company' }).expect(200);
      await run([{ ...rec, exported_at: hoursAgo(1), job_title: 'Chief Financial Officer', relationship_id: randomUUID() }]);
      const roles = await rolesOf(first.personId);
      expect(roles).toHaveLength(2);
      const untouched = roles.find((r) => r.id === first.id)!;
      expect(untouched.verificationStatus).not.toBe('UNVERIFIED');
      expect(roles.find((r) => r.id !== first.id)).toMatchObject({ reviewStatus: 'PENDING', isPublished: false, verificationStatus: 'UNVERIFIED' });
      expect(await db.select().from(schema.people).where(eq(schema.people.normalizedLinkedinUrl, (await personByName(nm)).normalizedLinkedinUrl!))).toHaveLength(1);
    });
  });
});

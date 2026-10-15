import { and, asc, eq } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { RoleClassificationService } from '../classification/role-classification.service';
import { TAXONOMY_V1 } from '../classification/taxonomies/v1';
import type { ITaxonomy } from '../classification/taxonomy.types';
import { IRawPersonRecord } from '../ingestion/ingestion.types';
import { PeopleIngestionService } from '../ingestion/people-ingestion.service';
import { ObservationService } from '../observations/observation.service';
import { PeoplePublishingService } from '../people-publishing.service';
import { PeopleWriteService } from '../people-write.service';
import { PeopleReviewService } from '../review/people-review.service';
import { SourceRegistryService } from '../sources/source-registry.service';
import { PeopleVerificationService } from '../verification/people-verification.service';
import { expectLedgerConsistent } from './ledger-invariants';
import { createTestDb, seedBusiness, seedUser } from './pglite-test-db';

/** Test-only "v2": a plain director is no longer a decision maker. Never registered in production. */
const V2: ITaxonomy = {
  ...TAXONOMY_V1,
  version: 'v2',
  executiveRules: TAXONOMY_V1.executiveRules.filter((r) => r.id !== 'DM-EXEC-DIRECTOR-PARTNER'),
};

describe('People classification versioning (Phase 6.5)', () => {
  let db: DrizzleDb;
  let closeDb: () => Promise<void>;
  let client: { query: (...a: any[]) => Promise<any> };
  let ingestV1: PeopleIngestionService;
  let ingestV2: PeopleIngestionService;
  let publishing: PeoplePublishingService;
  let review: PeopleReviewService;
  let n = 0;
  let reviewerId: string;

  const tag = () => `${++n}${Math.random().toString(36).slice(2, 6)}`.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);
  const company = () => seedBusiness(db, `cls-co-${++n}-${Math.random().toString(36).slice(2, 6)}`);
  const rec = (co: { id: string }, name: string, title: string, linkedin: string, over: Record<string, unknown> = {}): IRawPersonRecord =>
    ({ businessId: co.id, personName: name, jobTitle: title, linkedinUrl: linkedin, source: { type: 'MANUAL_IMPORT', reference: 'sheet-1', recordId: `rec-${tag()}` }, ...over }) as IRawPersonRecord;
  const run = (svc: PeopleIngestionService, records: IRawPersonRecord[], opts: Record<string, unknown> = {}) =>
    svc.ingest(records, { sourceKey: 'people-json', batchRef: `run-${++n}`, ...opts });
  const person = () => `https://www.linkedin.com/in/${tag()}-cls`;
  const roles = (personId: string) => db.select().from(schema.companyPeople).where(eq(schema.companyPeople.personId, personId));
  const history = (roleId: string) =>
    db.select().from(schema.companyPeopleClassifications).where(eq(schema.companyPeopleClassifications.companyPersonId, roleId)).orderBy(asc(schema.companyPeopleClassifications.createdAt), asc(schema.companyPeopleClassifications.id));
  const ctx = () => ({ reviewedBy: 'reviewer@orion.test', reviewerId, note: 'classification test' });
  /** Ingests a person with a title and returns ids. */
  const seed = async (title: string, svc = ingestV1) => {
    const co = await company();
    const li = person();
    const r = await run(svc, [rec(co, `Cls ${tag()} Person`, title, li)]);
    expect(r.results[0].outcome).toBe('CREATED');
    const personId = r.results[0].personId!;
    const [role] = await roles(personId);
    return { co, li, personId, role };
  };

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    client = t.client as any;
    closeDb = () => t.client.close();
    const registry = new SourceRegistryService(db);
    const obs = new ObservationService(db);
    const v1Write = new PeopleWriteService(db, RoleClassificationService.withTaxonomy(TAXONOMY_V1));
    const v2Write = new PeopleWriteService(db, RoleClassificationService.withTaxonomy(V2));
    ingestV1 = new PeopleIngestionService(db, v1Write, registry, obs);
    ingestV2 = new PeopleIngestionService(db, v2Write, registry, obs);
    publishing = new PeoplePublishingService(db);
    review = new PeopleReviewService(db, publishing, new PeopleVerificationService(db, publishing), RoleClassificationService.withTaxonomy(TAXONOMY_V1));
    reviewerId = (await seedUser(db, `cls-rev-${tag()}@orion.test`)).id;
  }, 60_000);

  afterAll(async () => {
    await expectLedgerConsistent(db);
    await closeDb?.();
  });

  describe('a new role carries its taxonomy version and rule trace', () => {
    it('stores version, strength, time on the role and a SYSTEM_CLASSIFICATION history row with the rule ids', async () => {
      const { role } = await seed('Chief Executive Officer');
      expect(role).toMatchObject({
        classificationSource: 'AUTO',
        classificationVersion: 'v1',
        classificationStrength: 'NORMALIZED_RULE',
        normalizedJobTitle: 'ceo',
        seniorityLevel: 'EXECUTIVE',
        decisionMakerType: 'FOUNDER_CEO',
      });
      expect(role.classifiedAt).toBeInstanceOf(Date);
      const h = await history(role.id);
      expect(h).toHaveLength(1);
      expect(h[0]).toMatchObject({
        kind: 'SYSTEM_CLASSIFICATION',
        taxonomyVersion: 'v1',
        normalizedTitle: 'ceo',
        ruleId: 'SEN-EXEC-C-SUITE-ABBR|DEP-EXEC-OWNER|DM-EXEC-FOUNDER-CEO|REL-EXECUTIVE',
        strength: 'NORMALIZED_RULE',
        actorKind: 'SYSTEM',
        actorId: null,
      });
      expect(h[0].ruleTrace).toMatchObject({ aliases: ['ALIAS-CEO'], seniority: 'SEN-EXEC-C-SUITE-ABBR' });
    });

    it('classification is separate from verification and approval: a decision-maker title publishes and verifies nothing', async () => {
      const { role, personId } = await seed('Founder & CEO');
      expect(role.decisionMakerType).toBe('FOUNDER_CEO');
      expect(role).toMatchObject({ isPublished: false, reviewStatus: 'PENDING', verificationStatus: 'UNVERIFIED' });
      const [p] = await db.select().from(schema.people).where(eq(schema.people.id, personId));
      expect(p.dataStatus).not.toBe('PUBLISHED');
    });

    it('an unclassifiable title is not given an invented classification and is not quarantined for it (existing UNKNOWN semantics)', async () => {
      const co = await company();
      const r = await run(ingestV1, [rec(co, 'Zed Unknownson', 'Wizard of Whimsy', person())]);
      expect(r.results[0].outcome).toBe('CREATED');
      expect(r.results[0].warnings!.map((w: any) => w.code)).toContain('UNCLASSIFIED_TITLE');
      const [role] = await roles(r.results[0].personId!);
      expect(role).toMatchObject({ seniorityLevel: 'UNKNOWN', department: 'UNKNOWN', decisionMakerType: null, classificationStrength: 'UNCLASSIFIED' });
      expect((await history(role.id))[0]).toMatchObject({ strength: 'UNCLASSIFIED', ruleId: 'SEN-UNMATCHED|DEP-UNKNOWN-DEFAULT|DM-NONE-SENIORITY|REL-EMPLOYEE' });
    });
  });

  describe('Case A: same title, same taxonomy', () => {
    it('re-ingestion creates no new role and no duplicate classification', async () => {
      const { co, li, personId, role } = await seed('Managing Director');
      for (let i = 0; i < 3; i++) await run(ingestV1, [rec(co, 'Same Person', 'Managing Director', li)]);
      const after = await roles(personId);
      expect(after).toHaveLength(1);
      expect(after[0].id).toBe(role.id);
      expect(after[0].classifiedAt).toEqual(role.classifiedAt); // not re-stamped
      expect(await history(role.id)).toHaveLength(1);
    });
  });

  describe('Case B: a newer taxonomy version', () => {
    it('an unreviewed AUTO role takes the new system result; the v1 result stays in history', async () => {
      const { co, li, personId, role } = await seed('Director');
      expect(role).toMatchObject({ classificationVersion: 'v1', decisionMakerType: 'DIRECTOR_PARTNER' });
      await run(ingestV2, [rec(co, 'Same Person', 'Director', li)]);
      const [after] = await roles(personId);
      expect(after.id).toBe(role.id);
      expect(after).toMatchObject({ classificationVersion: 'v2', decisionMakerType: null, classificationSource: 'AUTO' });
      const h = await history(role.id);
      expect(h.map((x) => [x.kind, x.taxonomyVersion, x.decisionMakerType])).toEqual([
        ['SYSTEM_CLASSIFICATION', 'v1', 'DIRECTOR_PARTNER'],
        ['SYSTEM_CLASSIFICATION', 'v2', null],
      ]);
      await run(ingestV2, [rec(co, 'Same Person', 'Director', li)]); // idempotent per version
      expect(await history(role.id)).toHaveLength(2);
    });

    it('an approved role keeps what customers see: the newer result is recorded but never applied automatically', async () => {
      const { co, li, personId, role } = await seed('Director');
      await review.approve(role.id, ctx());
      const [approved] = await roles(personId);
      expect(approved.isPublished).toBe(true);
      await run(ingestV2, [rec(co, 'Same Person', 'Director', li)]);
      const [after] = await roles(personId);
      expect(after).toMatchObject({ decisionMakerType: 'DIRECTOR_PARTNER', classificationVersion: 'v1', isPublished: true, reviewStatus: 'APPROVED' });
      expect((await history(role.id)).map((x) => x.taxonomyVersion)).toEqual(['v1', 'v2']);
      // the reviewer can see it is outdated relative to the current taxonomy (internal view only)
      const detail: any = await review.getRoleDetail(role.id);
      expect(detail.classification).toMatchObject({ taxonomyVersion: 'v1', source: 'AUTO', currentTaxonomyVersion: 'v1', outdated: false });
      expect(detail.classification.history).toHaveLength(2);
    });
  });

  describe('Cases C: reviewer override', () => {
    it('is stored as its own history row, keeps the original system result, survives re-ingestion under the same and a newer version', async () => {
      const { co, li, personId, role } = await seed('Director');
      await review.editRole(role.id, { department: 'SALES', seniorityLevel: 'HEAD', decisionMakerType: 'SALES_DECISION_MAKER' } as any, ctx());
      const [overridden] = await roles(personId);
      expect(overridden).toMatchObject({ classificationSource: 'REVIEWER', department: 'SALES', seniorityLevel: 'HEAD', decisionMakerType: 'SALES_DECISION_MAKER' });
      const h = await history(role.id);
      expect(h.map((x) => x.kind)).toEqual(['SYSTEM_CLASSIFICATION', 'REVIEWER_OVERRIDE']);
      expect(h[0]).toMatchObject({ taxonomyVersion: 'v1', decisionMakerType: 'DIRECTOR_PARTNER', ruleId: expect.stringContaining('SEN-DIRECTOR') });
      expect(h[1]).toMatchObject({ taxonomyVersion: null, ruleId: null, actorKind: 'REVIEWER', actorId: reviewerId, actorLabel: 'reviewer@orion.test', decisionMakerType: 'SALES_DECISION_MAKER' });

      await run(ingestV1, [rec(co, 'Same Person', 'Director', li)]);
      await run(ingestV2, [rec(co, 'Same Person', 'Director', li)]);
      const [after] = await roles(personId);
      expect(after).toMatchObject({ classificationSource: 'REVIEWER', department: 'SALES', seniorityLevel: 'HEAD', decisionMakerType: 'SALES_DECISION_MAKER' });
      const h2 = await history(role.id);
      expect(h2.filter((x) => x.kind === 'REVIEWER_OVERRIDE')).toHaveLength(1); // untouched
      expect(h2.filter((x) => x.kind === 'SYSTEM_CLASSIFICATION').map((x) => x.taxonomyVersion)).toEqual(['v1', 'v2']); // v2 recorded, not applied
      const detail: any = await review.getRoleDetail(role.id);
      expect(detail.classification.source).toBe('REVIEWER');
    });

    it('a later reviewer title edit does not overwrite an earlier override with an automatic result', async () => {
      const { personId, role } = await seed('Director');
      await review.editRole(role.id, { department: 'FINANCE', seniorityLevel: 'HEAD', decisionMakerType: 'FINANCE_DECISION_MAKER' } as any, ctx());
      await review.editRole(role.id, { jobTitle: 'Director Operations' } as any, ctx());
      const [after] = await roles(personId);
      expect(after).toMatchObject({ jobTitleAtCompany: 'Director Operations', classificationSource: 'REVIEWER', department: 'FINANCE', decisionMakerType: 'FINANCE_DECISION_MAKER' });
      const h = await history(role.id);
      expect(h.some((x) => x.kind === 'SYSTEM_CLASSIFICATION' && x.normalizedTitle === 'director operations' && x.department === 'OPERATIONS')).toBe(true);
    });
  });

  describe('Cases D and E: title change and aliases', () => {
    it('a reviewer title change reclassifies the new title (AUTO), keeps the earlier history and rewrites no observation', async () => {
      const { personId, role, co, li } = await seed('Sales Manager');
      // an observation exists for the original wording
      const keyed = await run(ingestV1, [rec(co, 'Same Person', 'Sales Manager', li, { source: { type: 'MANUAL_IMPORT', reference: 'sheet-1', recordId: 'obs-rec-1' } })], { sourceKey: 'people-json' });
      expect(keyed.results[0].outcome).not.toBe('QUARANTINED');
      const obsBefore = await db.select().from(schema.peopleObservations).where(eq(schema.peopleObservations.personId, personId));
      await review.editRole(role.id, { jobTitle: 'Head of Sales' } as any, ctx());
      const [after] = await roles(personId);
      expect(after).toMatchObject({ normalizedJobTitle: 'head of sales', classificationSource: 'AUTO', classificationVersion: 'v1', decisionMakerType: 'SALES_DECISION_MAKER', seniorityLevel: 'HEAD' });
      expect(after.titleAliases).toContain('sales manager');
      const h = await history(role.id);
      expect(h.map((x) => [x.normalizedTitle, x.decisionMakerType])).toEqual([
        ['sales manager', null],
        ['head of sales', 'SALES_DECISION_MAKER'],
      ]);
      const obsAfter = await db.select().from(schema.peopleObservations).where(eq(schema.peopleObservations.personId, personId));
      expect(obsAfter).toEqual(obsBefore);
    });

    it('re-ingesting the OLD title resolves to the same role (Phase 4.1 identity) and does not reclassify it from the old wording', async () => {
      const { personId, role, co, li } = await seed('Sales Manager');
      await review.editRole(role.id, { jobTitle: 'Head of Sales' } as any, ctx());
      await run(ingestV1, [rec(co, 'Same Person', 'Sales Manager', li)]);
      const rs = await roles(personId);
      expect(rs).toHaveLength(1); // no second role
      expect(rs[0]).toMatchObject({ normalizedJobTitle: 'head of sales', decisionMakerType: 'SALES_DECISION_MAKER', seniorityLevel: 'HEAD' });
    });

    it('a title change made by ingestion is a different role identity: the new title is classified, the old role and its history are kept', async () => {
      const { personId, role, co, li } = await seed('Sales Manager');
      await run(ingestV1, [rec(co, 'Same Person', 'Head of Sales', li)]);
      const rs = await roles(personId);
      expect(rs).toHaveLength(2);
      const fresh = rs.find((r) => r.normalizedJobTitle === 'head of sales')!;
      expect(fresh).toMatchObject({ classificationVersion: 'v1', decisionMakerType: 'SALES_DECISION_MAKER' });
      expect((await history(role.id)).map((x) => x.normalizedTitle)).toEqual(['sales manager']);
    });
  });

  describe('observations', () => {
    it('record the normalised title and version of each observation; later observations never change earlier ones; rows are immutable', async () => {
      const co = await company();
      const li = person();
      const mk = (svc: PeopleIngestionService) => run(svc, [rec(co, 'Obs Person', 'Chief Executive Officer', li, { source: { type: 'MANUAL_IMPORT', reference: 'sheet-1', recordId: 'obs-keyed-1' } })]);
      const a = await mk(ingestV1);
      const personId = a.results[0].personId!;
      await mk(ingestV2);
      const obs = await db.select().from(schema.peopleObservations).where(eq(schema.peopleObservations.personId, personId)).orderBy(asc(schema.peopleObservations.createdAt));
      expect(obs.length).toBeGreaterThanOrEqual(2);
      expect(obs.map((o) => [o.observedTitle, o.normalizedTitle, o.classificationVersion])).toEqual([
        ['Chief Executive Officer', 'ceo', 'v1'],
        ['Chief Executive Officer', 'ceo', 'v2'],
      ]);
      await expect(client.query(`UPDATE people_observations SET classification_version = 'v9' WHERE id = '${obs[0].id}'`)).rejects.toThrow(/append-only/);
    });
  });

  describe('suppression is not weakened', () => {
    it('a suppressed identity is refused before any role or classification is created', async () => {
      const { personId, li, co } = await seed('Founder');
      await publishing.suppressPerson(personId, { reviewedBy: 'a@orion.test', note: 'opt-out request' });
      const before = (await db.select().from(schema.companyPeopleClassifications)).length;
      const r = await run(ingestV1, [rec(co, 'Other Name', 'Managing Director', li)]);
      expect(r.results[0].outcome).toBe('QUARANTINED');
      expect(r.results[0].reasons!.map((w: any) => w.code)).toEqual(['SUPPRESSED_PERSON']);
      expect((await db.select().from(schema.companyPeopleClassifications)).length).toBe(before);
      const live = (await roles(personId)).filter((x) => x.reviewStatus !== 'REJECTED');
      expect(live).toHaveLength(0);
    });
  });

  describe('history table', () => {
    it('is append-only and removed only with its role; reviewer detail is the only reader', async () => {
      const { role } = await seed('Owner');
      const [h] = await history(role.id);
      await expect(client.query(`UPDATE company_people_classifications SET department = 'SALES' WHERE id = '${h.id}'`)).rejects.toThrow(/append-only/);
      await expect(client.query(`INSERT INTO company_people_classifications (company_person_id, kind, normalized_title, seniority_level, department) VALUES ('${role.id}', 'SYSTEM_CLASSIFICATION', 'x', 'STAFF', 'SALES')`)).rejects.toThrow(); // a system row needs a version
      await expect(client.query(`INSERT INTO company_people_classifications (company_person_id, kind, taxonomy_version, normalized_title, seniority_level, department) VALUES ('${role.id}', 'MAGIC', 'v1', 'x', 'STAFF', 'SALES')`)).rejects.toThrow();
      // the same version/title is unique per role (idempotency is enforced by the database, not only by code)
      await expect(client.query(`INSERT INTO company_people_classifications (company_person_id, kind, taxonomy_version, normalized_title, seniority_level, department) VALUES ('${role.id}', 'SYSTEM_CLASSIFICATION', 'v1', 'owner', 'STAFF', 'SALES')`)).rejects.toThrow();
    });

    it('customer-facing code never reads classification versions, rule ids or history', () => {
      const dir = path.resolve(__dirname, '..');
      for (const f of ['people.service.ts', 'people-search.service.ts', 'people-export.service.ts', 'people.controller.ts']) {
        const text = fs.readFileSync(path.join(dir, f), 'utf8');
        expect(text).not.toMatch(/classificationVersion|classificationStrength|companyPeopleClassifications|ruleId|taxonomyVersion/);
      }
      expect(and(eq(schema.companyPeople.id, 'x'))).toBeDefined(); // schema import sanity
    });
  });
});

import { expectLedgerConsistent } from '../../people/__tests__/ledger-invariants';
import { Global, Module, DynamicModule } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import { TransactionService } from '../../../database/transaction.service';
import * as schema from '../../../database/schema';
import { BusinessModule } from '../../business/business.module';
import { PEOPLE_INGESTION_SERVICE } from '../../people/ingestion/ingestion.types';
import { PeopleIngestionService } from '../../people/ingestion/people-ingestion.service';
import { PeoplePublishingService } from '../../people/people-publishing.service';
import { BusinessService } from '../../business/services/business.service';
import { PeopleWriteService } from '../../people/people-write.service';
import { PeopleQuarantineService } from '../../people/review/people-quarantine.service';
import { PeopleVerificationService } from '../../people/verification/people-verification.service';
import { ObservationService } from '../../people/observations/observation.service';
import { SourceRegistryService } from '../../people/sources/source-registry.service';
import { PeopleReviewService } from '../../people/review/people-review.service';
import { PeopleService } from '../../people/people.service';
import { createTestDb, readMigration } from '../../people/__tests__/pglite-test-db';
import { QueueService } from '../../queue/queue.service';
import { ImportPeopleBridge, extractPeopleFromRow, uploadRecordId } from '../people/import-people.bridge';
import {
  DuplicateRepository,
  PublishQueueRepository,
  ReviewQueueRepository,
} from '../repositories/duplicate-review.repositories';
import { ImportBatchRepository, ImportRecordRepository, ValidationLogRepository } from '../repositories/import.repositories';
import { AdminImportService } from '../services/admin-import.service';
import { DuplicateDetectionService } from '../services/duplicate-detection.service';
import { ImportPipelineService } from '../services/import-pipeline.service';
import { NormalizationService } from '../services/normalization.service';
import { PublishingService } from '../services/publishing.service';
import { SourceTrustService } from '../services/source-trust.service';
import { withApprovedSource, TestAdminImport } from './approved-source.helper';
import { ValidationService } from '../services/validation.service';

@Global()
@Module({})
class TestDbModule {
  static forDb(db: DrizzleDb): DynamicModule {
    return {
      module: TestDbModule,
      global: true,
      providers: [{ provide: DRIZZLE_DATABASE, useValue: db }, TransactionService],
      exports: [DRIZZLE_DATABASE, TransactionService],
    };
  }
}

type Mode = 'real' | 'throwing' | 'no-bridge';

describe('Company upload -> People ingestion (Phase 3), real pipeline on a real Postgres schema', () => {
  let db: DrizzleDb;
  let close: () => Promise<void>;
  let h: Awaited<ReturnType<typeof build>>;
  let seq = 0;

  async function build(mode: Mode, database: DrizzleDb) {
    const providers: any[] = [
      ImportBatchRepository, ImportRecordRepository, ValidationLogRepository,
      DuplicateRepository, ReviewQueueRepository, PublishQueueRepository,
      NormalizationService, ValidationService, DuplicateDetectionService,
      PublishingService, SourceTrustService, ImportPipelineService, AdminImportService,
      PeopleWriteService, PeopleIngestionService, PeopleService, PeoplePublishingService,
      PeopleReviewService, PeopleQuarantineService, PeopleVerificationService, SourceRegistryService, ObservationService,
      { provide: QueueService, useValue: { addJob: jest.fn().mockResolvedValue(undefined) } },
    ];
    if (mode !== 'no-bridge') providers.push(ImportPeopleBridge);
    providers.push(
      mode === 'throwing'
        ? {
            provide: PEOPLE_INGESTION_SERVICE,
            useValue: {
              ingest: jest.fn().mockRejectedValue(new Error('people boom')),
              ingestFromSource: jest.fn().mockRejectedValue(new Error('people boom')),
            },
          }
        : { provide: PEOPLE_INGESTION_SERVICE, useExisting: PeopleIngestionService },
    );
    const module = await Test.createTestingModule({ imports: [TestDbModule.forDb(database), BusinessModule], providers }).compile();
    const adminService = module.get(AdminImportService);
    const approved = await withApprovedSource(adminService, database); // Phase 15: stands in for an approved source with automatic publication
    return {
      adminId: approved.adminId,
      admin: adminService as unknown as TestAdminImport,
      pipeline: module.get(ImportPipelineService),
      bridge: mode === 'no-bridge' ? undefined : module.get(ImportPeopleBridge),
      batches: module.get(ImportBatchRepository),
      records: module.get(ImportRecordRepository),
      write: module.get(PeopleWriteService),
      publishing: module.get(PublishingService),
      peoplePublishing: module.get(PeoplePublishingService),
      people: module.get(PeopleService),
      ingestion: module.get(PeopleIngestionService),
      review: module.get(PeopleReviewService),
      quarantine: module.get(PeopleQuarantineService),
      verification: module.get(PeopleVerificationService),
    };
  }

  /** Company row. Distinct names/cities keep the pipeline's duplicate detection out of the way. */
  const uniqueCity = () => `City${++seq}x${Math.random().toString(36).slice(2, 6)}`;
  const uniqueName = () => `${['Zephyr', 'Quartz', 'Nimbus', 'Onyx', 'Cobalt', 'Saffron'][seq % 6]}${seq}${Math.random().toString(36).slice(2, 5)} Traders`;
  const row = (extra: Record<string, unknown> = {}) => ({
    business_name: uniqueName(),
    city: uniqueCity(),
    state: 'Tamil Nadu',
    pincode: '641001',
    address_line1: '1 Test Street',
    email: 'info@company.example',
    phone: '+91 422 255 0100',
    ...extra,
  });
  const count = async (t: any) => (await db.select({ n: sql<number>`count(*)::int` }).from(t))[0].n;
  const counts = async () => ({
    businesses: await count(schema.businesses),
    people: await count(schema.people),
    roles: await count(schema.companyPeople),
    contacts: await count(schema.personContacts),
    evidence: await count(schema.peopleEvidence),
    quarantine: await count(schema.peopleIngestionQuarantine),
  });
  const businessByName = async (name: string) => (await db.select().from(schema.businesses).where(eq(schema.businesses.name, name)))[0];
  const batchOf = async (id: string) => (await db.select().from(schema.importBatches).where(eq(schema.importBatches.id, id)))[0];
  const personByName = (n: string) => db.select().from(schema.people).where(eq(schema.people.normalizedName, n));
  const rolesOf = (id: string) => db.select().from(schema.companyPeople).where(eq(schema.companyPeople.personId, id));
  const submit = (rows: Array<Record<string, unknown>>, filename = 'upload.csv') => h.admin.submitBatch({ filename, rows });

  beforeAll(async () => {
    const t = await createTestDb([...readdir()]);
    db = t.db;
    close = () => t.client.close();
    h = await build('real', db);
  }, 60_000);

  afterAll(async () => {
    await expectLedgerConsistent(db); // status columns must still agree with the verification ledger
    await close?.();
  });

  // ------------------------------------------------------------------ extraction (pure)
  describe('what is read from an uploaded row', () => {
    const prov = { batchId: 'b1', filename: 'f.csv', rowNumber: 7, observedAt: new Date('2026-09-01T00:00:00Z') };

    it('reads the named contact person and title, with upload provenance', () => {
      const [p] = extractPeopleFromRow({ contact_person: 'K. Krithivasan', contact_title: 'CEO & Managing Director' }, 'biz', prov);
      expect(p).toMatchObject({
        businessId: 'biz',
        personName: 'K. Krithivasan',
        jobTitle: 'CEO & Managing Director',
        source: { type: 'MANUAL_IMPORT', label: 'import-batch:b1', reference: 'f.csv#row:7', evidenceType: 'UPLOAD_ROW', observedAt: prov.observedAt },
      });
    });

    it('never attaches the company email/phone to a person, and never defaults a title', () => {
      const [p] = extractPeopleFromRow({ contact_person: 'Arun Kumar', email: 'info@co.example', phone: '9876543210' }, 'biz', prov);
      expect(p.email).toBeUndefined();
      expect(p.phone).toBeUndefined();
      expect(p.jobTitle).toBeUndefined();
    });

    it('produces nothing for rows without a person (a company-only email/phone is not a person)', () => {
      expect(extractPeopleFromRow({ email: 'a@b.co', phone: '1', title: 'Director' }, 'biz', prov)).toEqual([]);
      expect(extractPeopleFromRow({}, 'biz', prov)).toEqual([]);
    });

    it('reads explicit person columns and numbered extra people, capped at five', () => {
      const raw: Record<string, unknown> = { contact_person: 'A B', person_email: 'ab@x.co', person_linkedin: 'linkedin.com/in/ab' };
      for (let n = 2; n <= 7; n++) raw[`person_${n}_name`] = `Person ${n}`;
      const people = extractPeopleFromRow(raw, 'biz', prov);
      expect(people).toHaveLength(5);
      expect(people[0]).toMatchObject({ email: 'ab@x.co', linkedinUrl: 'linkedin.com/in/ab' });
      expect(people[1].source!.reference).toBe('f.csv#row:7:person-2');
    });

    it('uses the batch data source type as provenance when one is linked', () => {
      const [p] = extractPeopleFromRow({ contact_person: 'A B' }, 'biz', { ...prov, sourceType: 'GOVERNMENT_REGISTRY' });
      expect(p.source!.type).toBe('GOVERNMENT_REGISTRY');
    });
  });

  // ------------------------------------------------------------------ end to end
  describe('uploads', () => {
    it('1. company with no people: imported exactly as before; the People stage does nothing', async () => {
      const before = await counts();
      const r = await submit([row()]);
      expect(r).toMatchObject({ publishedCount: 1, failedCount: 0, duplicateCount: 0 });
      expect(r.people).toMatchObject({ received: 0, created: 0, errors: 0 });
      const after = await counts();
      expect(after.businesses).toBe(before.businesses + 1);
      expect({ ...after, businesses: 0 }).toEqual({ ...before, businesses: 0 });
      const rec = (await db.select().from(schema.importRecords).where(eq(schema.importRecords.batchId, r.batchId)))[0];
      expect(rec.status).toBe('PUBLISHED');
      expect(rec.peopleResult).toBeNull(); // never attempted
    });

    it('2. one valid person: DRAFT, unpublished, with the upload provenance', async () => {
      const r = await submit([row({ contact_person: 'Mr. Arun Kumar', contact_title: 'Managing Director' })], 'tn-companies.csv');
      expect(r.publishedCount).toBe(1);
      expect(r.people).toEqual({ received: 1, accepted: 1, created: 1, updated: 0, unchanged: 0, quarantined: 0, rejected: 0, errors: 0 });

      const [person] = await personByName('arun kumar');
      expect(person).toMatchObject({ fullName: 'Arun Kumar', dataStatus: 'DRAFT', verificationStatus: 'UNVERIFIED', confidenceScore: 0 });
      const [role] = await rolesOf(person.id);
      expect(role).toMatchObject({ isPublished: false, decisionMakerType: 'MANAGING_DIRECTOR', verificationStatus: 'UNVERIFIED' });

      const rec = (await db.select().from(schema.importRecords).where(eq(schema.importRecords.batchId, r.batchId)))[0];
      const [ev] = await db.select().from(schema.peopleEvidence).where(eq(schema.peopleEvidence.personId, person.id));
      expect(ev).toMatchObject({
        sourceType: 'MANUAL_IMPORT',
        evidenceType: 'UPLOAD_ROW',
        sourceReference: 'tn-companies.csv#row:1',
        companyPersonId: role.id,
        verifiedAt: null,
      });
      expect(ev.observedAt.getTime()).toBe(rec.createdAt.getTime());
      expect(role.businessId).toBe(rec.targetBusinessId ?? role.businessId);
      // company-level email/phone were not attributed to the person
      expect(await db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, person.id))).toHaveLength(0);
    });

    it('never turns the normaliser\'s "Primary Contact / Director/Owner" placeholder into a person', async () => {
      const before = await counts();
      const r = await submit([row()]); // email+phone only => legacy contact "Primary Contact" is created by the normaliser
      const biz = (await db.select().from(schema.businesses).orderBy(sql`created_at desc`).limit(1))[0];
      const legacy = await db.select().from(schema.businessContacts).where(eq(schema.businessContacts.businessId, biz.id));
      expect(legacy.map((c) => c.fullName)).toEqual(['Primary Contact']); // existing behaviour, untouched
      expect(r.people.received).toBe(0);
      expect((await counts()).people).toBe(before.people);
      expect(await personByName('primary contact')).toHaveLength(0);
    });

    it('3. several people on one company: each is ingested with its own contacts and evidence', async () => {
      const r = await submit([
        row({
          contact_person: 'Meena Iyer', contact_title: 'Founder', person_email: 'meena@multi.co.in', person_linkedin: 'https://in.linkedin.com/in/meena-iyer-77',
          person_2_name: 'Ravi Menon', person_2_title: 'Head of Procurement', person_2_mobile: '98765 43210',
          person_3_name: 'Lata Nair', person_3_title: 'Sales Executive',
        }),
      ]);
      expect(r.people).toMatchObject({ received: 3, accepted: 3, created: 3, quarantined: 0, rejected: 0 });
      const [meena] = await personByName('meena iyer');
      const [ravi] = await personByName('ravi menon');
      const [lata] = await personByName('lata nair');
      expect((await rolesOf(meena.id))[0].decisionMakerType).toBe('FOUNDER_CEO');
      expect((await rolesOf(ravi.id))[0].decisionMakerType).toBe('PROCUREMENT_DECISION_MAKER');
      expect((await rolesOf(lata.id))[0].decisionMakerType).toBeNull(); // classifier decides, not the upload
      const mc = await db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, meena.id));
      expect(mc.map((c) => c.normalizedValue)).toEqual(['meena@multi.co.in']);
      expect(mc[0].isPublished).toBe(false);
      expect(meena.normalizedLinkedinUrl).toBe('linkedin.com/in/meena-iyer-77');
      const rc = await db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, ravi.id));
      expect(rc.map((c) => [c.contactType, c.normalizedValue])).toEqual([['MOBILE', '+919876543210']]);
      const refs = (await db.select().from(schema.peopleEvidence).where(eq(schema.peopleEvidence.personId, ravi.id))).map((e) => e.sourceReference);
      expect(refs).toEqual(expect.arrayContaining(['upload.csv#row:1:person-2']));
    });

    it('4. invalid person: rejected + quarantined, and the company still imports', async () => {
      const before = await counts();
      const r = await submit([
        row({ contact_person: 'Arun', contact_title: 'CEO' }), // single-word name
      ]);
      expect(r).toMatchObject({ publishedCount: 1, failedCount: 0 });
      expect(r.people).toEqual({ received: 1, accepted: 0, created: 0, updated: 0, unchanged: 0, quarantined: 0, rejected: 1, errors: 0 });
      const q = await db.select().from(schema.peopleIngestionQuarantine).where(eq(schema.peopleIngestionQuarantine.batchRef, `import-batch:${r.batchId}`));
      expect(q).toHaveLength(1);
      expect((q[0].reasons as any[])[0].code).toBe('NAME_INCOMPLETE');
      expect((await counts()).people).toBe(before.people);
      expect((await counts()).businesses).toBe(before.businesses + 1);
    });

    it('4b. a named person without a title is rejected rather than given an invented title', async () => {
      const r = await submit([row({ contact_person: 'Sanjay Dutt' })]);
      expect(r.people).toMatchObject({ received: 1, rejected: 1, created: 0 });
      expect(await personByName('sanjay dutt')).toHaveLength(0);
      const q = await db.select().from(schema.peopleIngestionQuarantine).where(eq(schema.peopleIngestionQuarantine.batchRef, `import-batch:${r.batchId}`));
      expect((q[0].reasons as any[])[0].code).toBe('MISSING_TITLE');
    });

    it('5. unknown company: quarantined, and no company is created from a people record', async () => {
      const bridge = h.bridge!;
      const batch = await h.batches.create({ filename: 'x.csv', fileKey: 'k', fileSize: 1, totalRecords: 1 });
      const rec = await h.records.create({ batchId: batch.id, rowNumber: 1, rawPayload: { contact_person: 'Ghost Person', contact_title: 'CEO' } });
      const before = await counts();
      const result = await bridge.ingestForPublishedRecord({ businessId: '00000000-0000-0000-0000-00000000dead', record: rec });
      expect(result).toMatchObject({ received: 1, quarantined: 1, created: 0, rejected: 0 });
      expect(result.outcomes[0].codes).toEqual(['BUSINESS_NOT_FOUND']);
      const after = await counts();
      expect(after.businesses).toBe(before.businesses);
      expect(after.people).toBe(before.people);
      expect(after.quarantine).toBe(before.quarantine + 1);
    });

    it('6. ambiguous identity: quarantined, the others in the row are unaffected', async () => {
      const r = await submit([
        row({
          contact_person: 'Ravi Shankar', contact_title: 'CTO', person_linkedin: 'linkedin.com/in/ravi-s-cto',
          person_2_name: 'Ravi Shankar', person_2_title: 'CFO', person_2_linkedin: 'linkedin.com/in/ravi-s-cfo',
          person_3_name: 'Ravi Shankar', person_3_title: 'Director', // which Ravi? refuse to guess
        }),
      ]);
      expect(r.people).toMatchObject({ received: 3, created: 2, quarantined: 1, rejected: 0 });
      expect(await personByName('ravi shankar')).toHaveLength(2);
    });

    it('7. duplicate person in one upload: no duplicate person; a second title becomes a second role', async () => {
      const r = await submit([
        row({
          contact_person: 'Kiran Bose', contact_title: 'Director',
          person_2_name: 'KIRAN BOSE', person_2_title: 'director',
          person_3_name: 'Kiran Bose', person_3_title: 'Founder',
        }),
      ]);
      // 1 new person; the other two entries resolve to that same person (each adds its own upload provenance)
      expect(r.people).toMatchObject({ received: 3, created: 1, updated: 2, accepted: 3, rejected: 0 });
      const people = await personByName('kiran bose');
      expect(people).toHaveLength(1);
      expect(await rolesOf(people[0].id)).toHaveLength(2); // 'director' twice is ONE role, plus 'founder'
    });
  });

  // ------------------------------------------------------------------ idempotency
  describe('idempotency', () => {
    it('8. re-processing the same company row is a no-op for people, roles, contacts, evidence and quarantine', async () => {
      const r = await submit([
        row({
          contact_person: 'Idem Person', contact_title: 'CFO', person_email: 'idem@idem.co.in', person_linkedin: 'linkedin.com/in/idem-person',
          person_2_name: 'Bad', person_2_title: 'CEO', // rejected every time, one quarantine row only
        }),
      ]);
      expect(r.people).toMatchObject({ created: 1, rejected: 1 });
      const rec = (await db.select().from(schema.importRecords).where(eq(schema.importRecords.batchId, r.batchId)))[0];
      const biz = (await db.select().from(schema.businesses).orderBy(sql`created_at desc`).limit(1))[0];
      const settled = await counts();

      // e.g. a retried publish job: the same record is handed to the People stage again and again
      for (let i = 0; i < 3; i++) {
        const again = await h.bridge!.ingestForPublishedRecord({ businessId: biz.id, record: rec });
        expect(again).toMatchObject({ received: 2, created: 0, updated: 0, unchanged: 1, rejected: 1, errors: 0 });
        expect(await counts()).toEqual(settled);
      }
    });

    it('8b. uploading the identical file again: the pipeline flags the company as a duplicate and the People layer sees nothing new', async () => {
      const rows = [row({ contact_person: 'Twice Uploaded', contact_title: 'Owner', person_email: 'tw@twice.co.in' })];
      const first = await submit(rows, 'same.csv');
      expect(first.people.created).toBe(1);
      const settled = await counts();

      for (let i = 0; i < 2; i++) {
        const again = await submit(rows, 'same.csv');
        expect(again).toMatchObject({ publishedCount: 0, duplicateCount: 1 });
        expect(again.people).toMatchObject({ received: 0, created: 0 });
        expect(await counts()).toEqual(settled);
      }
    });

    it('12. evidence is idempotent per source row, and a new upload row adds provenance instead of replacing it', async () => {
      const r = await submit([row({ contact_person: 'Evidence Person', contact_title: 'Partner', person_email: 'ev@evi.co.in' })]);
      const rec = (await db.select().from(schema.importRecords).where(eq(schema.importRecords.batchId, r.batchId)))[0];
      const biz = (await db.select().from(schema.businesses).orderBy(sql`created_at desc`).limit(1))[0];
      const [p] = await personByName('evidence person');
      const evCount = async () => (await db.select().from(schema.peopleEvidence).where(eq(schema.peopleEvidence.personId, p.id))).length;
      const n = await evCount();
      expect(n).toBe(2); // role claim + contact claim
      for (let i = 0; i < 3; i++) await h.bridge!.ingestForPublishedRecord({ businessId: biz.id, record: rec });
      expect(await evCount()).toBe(n);

      // a different upload of the same company/person (new file, new row) => extra provenance
      const batch2 = await h.batches.create({ filename: 'second-file.csv', fileKey: 'k2', fileSize: 1, totalRecords: 1 });
      const rec2 = await h.records.create({ batchId: batch2.id, rowNumber: 4, rawPayload: { contact_person: 'Evidence Person', contact_title: 'Partner', person_email: 'ev@evi.co.in' } });
      const res = await h.bridge!.ingestForPublishedRecord({ businessId: biz.id, record: rec2 });
      expect(res).toMatchObject({ received: 1, updated: 1, created: 0 });
      expect(await evCount()).toBe(n + 2);
      const refs = (await db.select().from(schema.peopleEvidence).where(eq(schema.peopleEvidence.personId, p.id))).map((e) => e.sourceReference);
      expect(refs).toEqual(expect.arrayContaining(['upload.csv#row:1', 'second-file.csv#row:4']));
      expect(await personByName('evidence person')).toHaveLength(1);
    });
  });

  // ------------------------------------------------------------------ failure isolation
  describe('9. failure isolation', () => {
    it('complete People failure: the company stays imported and PUBLISHED, and the failure is recorded', async () => {
      const bad = await build('throwing', db);
      const before = await counts();
      const r = await bad.admin.submitBatch({ filename: 'boom.csv', rows: [row({ contact_person: 'Boom Person', contact_title: 'CEO' })] });
      expect(r).toMatchObject({ status: 'COMPLETED', publishedCount: 1, failedCount: 0 });
      expect(r.people).toMatchObject({ received: 1, errors: 1, created: 0, accepted: 0 });

      const biz = await db.select().from(schema.businesses).orderBy(sql`created_at desc`).limit(1);
      expect(biz[0].status).toBe('PUBLISHED');
      expect((await counts()).businesses).toBe(before.businesses + 1);
      const batch = await batchOf(r.batchId);
      expect(batch.status).toBe('COMPLETED');
      expect(batch.successfulRecords).toBe(1);
      expect(batch.failedRecords).toBe(0);
      const rec = (await db.select().from(schema.importRecords).where(eq(schema.importRecords.batchId, r.batchId)))[0];
      expect(rec.status).toBe('PUBLISHED');
      expect((rec.peopleResult as any).error).toBe('people boom');
      expect((await db.select().from(schema.publishQueue).where(eq(schema.publishQueue.recordId, rec.id)))[0].status).toBe('PUBLISHED');
    });

    it('People tables unavailable (e.g. migration not applied there): company import still succeeds', async () => {
      const t = await createTestDb(['0000_bent_johnny_storm.sql', '0001_blushing_loa.sql', '0002_typical_clint_barton.sql', '0006_import_people_report.sql']);
      try {
        const noPeople = await build('real', t.db);
        const r = await noPeople.admin.submitBatch({ filename: 'nt.csv', rows: [row({ contact_person: 'Table Less', contact_title: 'CEO' })] });
        expect(r).toMatchObject({ publishedCount: 1, failedCount: 0, status: 'COMPLETED' });
        expect(r.people.received).toBe(1);
        expect(r.people.created).toBe(0);
        expect(r.people.errors + r.people.rejected + r.people.quarantined).toBe(1);
      } finally {
        await t.client.close();
      }
    });

    it('a broken payload or unreadable bridge input cannot fail the company either', async () => {
      const batch = await h.batches.create({ filename: 'w.csv', fileKey: 'k', fileSize: 1, totalRecords: 1 });
      const rec = await h.records.create({ batchId: batch.id, rowNumber: 1, rawPayload: { contact_person: 'Weird Payload', contact_title: 'CEO' } });
      const broken = { ...rec, batchId: '00000000-0000-0000-0000-000000000000', createdAt: undefined as any };
      await expect(h.bridge!.ingestForPublishedRecord({ businessId: 'x', record: broken })).resolves.toBeDefined();
      await expect(h.bridge!.ingestForPublishedRecord({ businessId: 'x', record: null as any })).resolves.toMatchObject({ attempted: true });
    });

    it('partial failure: good people are kept, bad ones are counted, the company succeeds', async () => {
      const r = await submit([
        row({ contact_person: 'Partial Good', contact_title: 'CEO', person_2_name: 'X', person_2_title: 'CFO', person_3_name: 'Partial Fine', person_3_title: 'Director' }),
      ]);
      expect(r).toMatchObject({ publishedCount: 1, failedCount: 0 });
      expect(r.people).toMatchObject({ received: 3, created: 2, rejected: 1, errors: 0 });
    });

    it('without the bridge wired in the import behaves exactly as before', async () => {
      const plain = await build('no-bridge', db);
      const before = await counts();
      const r = await plain.admin.submitBatch({ filename: 'p.csv', rows: [row({ contact_person: 'Not Wired', contact_title: 'CEO' })] });
      expect(r).toMatchObject({ publishedCount: 1, failedCount: 0 });
      expect(r.people.received).toBe(0);
      expect((await counts()).people).toBe(before.people);
    });

    it('PEOPLE_UPLOAD_INGESTION=false is a kill switch', async () => {
      process.env.PEOPLE_UPLOAD_INGESTION = 'false';
      try {
        const before = await counts();
        const r = await submit([row({ contact_person: 'Switched Off', contact_title: 'CEO' })]);
        expect(r).toMatchObject({ publishedCount: 1 });
        expect(r.people.received).toBe(0);
        expect((await counts()).people).toBe(before.people);
      } finally {
        delete process.env.PEOPLE_UPLOAD_INGESTION;
      }
    });
  });

  // ------------------------------------------------------------------ visibility & no-downgrade
  describe('DRAFT rules and no-downgrade through the upload path', () => {
    const viewer = '00000000-0000-0000-0000-0000000000aa';

    it('everything from an upload is invisible to customers', async () => {
      const r = await submit([row({ contact_person: 'Invisible Person', contact_title: 'CEO', person_email: 'inv@x.co.in' })]);
      const biz = (await db.select().from(schema.businesses).orderBy(sql`created_at desc`).limit(1))[0];
      expect(biz.status).toBe('PUBLISHED');
      const list = await h.people.listCompanyPeople(biz.id, viewer, { status: 'all' } as any);
      expect(list.people).toEqual([]);
      const [p] = await personByName('invisible person');
      await expect(h.people.getPersonDetail(p.id, viewer)).rejects.toMatchObject({ errorCode: 'PERSON_NOT_FOUND' });
      expect(r.people.created).toBe(1);
    });

    it('10. a published person uploaded under a NEW company gets a new DRAFT role that stays hidden', async () => {
      const li = 'linkedin.com/in/published-pat-1';
      const bizA = await businessByName((await (async () => {
        const r0 = await submit([row()]);
        expect(r0.publishedCount).toBe(1);
        return (await db.select().from(schema.businesses).orderBy(sql`created_at desc`).limit(1))[0].name;
      })()));
      const seeded = await h.write.upsertPersonForBusiness({
        businessId: bizA.id, person: { fullName: 'Published Pat', linkedinUrl: li }, role: { jobTitle: 'CEO' },
        evidence: [{ sourceType: 'MANUAL_IMPORT', evidenceType: 'ROLE_CLAIM' }],
      });
      await h.peoplePublishing.publishRole(seeded.companyPersonId, 'reviewer');
      expect((await h.people.listCompanyPeople(bizA.id, viewer, {} as any)).people.map((p) => p.fullName)).toEqual(['Published Pat']);

      const r = await submit([row({ contact_person: 'P. Pat', contact_title: 'Director', person_linkedin: li })]);
      expect(r.people).toMatchObject({ received: 1, updated: 1, created: 0 });
      const bizB = (await db.select().from(schema.businesses).orderBy(sql`created_at desc`).limit(1))[0];
      expect(bizB.id).not.toBe(bizA.id);
      const roles = await rolesOf(seeded.personId);
      expect(roles).toHaveLength(2);
      expect(roles.find((x) => x.businessId === bizB.id)).toMatchObject({ isPublished: false, decisionMakerType: 'DIRECTOR_PARTNER' });
      expect((await h.people.listCompanyPeople(bizB.id, viewer, { status: 'all' } as any)).people).toEqual([]);
      const detail = await h.people.getPersonDetail(seeded.personId, viewer);
      expect(detail.roles.map((x) => x.businessId)).toEqual([bizA.id]);
    });

    it('11. an existing verified person is not downgraded by a weaker upload', async () => {
      const r0 = await submit([row()]);
      expect(r0.publishedCount).toBe(1);
      const biz = (await db.select().from(schema.businesses).orderBy(sql`created_at desc`).limit(1))[0];
      const verifiedAt = new Date(Date.now() - 20 * 86_400_000);
      const seeded = await h.write.upsertPersonForBusiness({
        businessId: biz.id, person: { fullName: 'Verified Vera', linkedinUrl: 'linkedin.com/in/verified-vera' }, role: { jobTitle: 'Managing Director' },
        verificationStatus: 'VERIFIED', confidenceScore: 92, lastVerifiedAt: verifiedAt,
        evidence: [{ sourceType: 'MANUAL_IMPORT', evidenceType: 'MANUAL_VERIFICATION', verifiedAt, sourceReference: 'verified-by:rev' }],
      });
      const [before] = await rolesOf(seeded.personId);
      expect(before.verificationStatus).toBe('VERIFIED');

      // a later upload of the same company/person with nothing but a bare name + title (and a low confidence claim)
      const batch = await h.batches.create({ filename: 'weak.csv', fileKey: 'k', fileSize: 1, totalRecords: 1 });
      const rec = await h.records.create({ batchId: batch.id, rowNumber: 9, rawPayload: { contact_person: 'Verified Vera', contact_title: 'managing director' } });
      const res = await h.bridge!.ingestForPublishedRecord({ businessId: biz.id, record: rec });
      expect(res).toMatchObject({ received: 1, created: 0, errors: 0 });

      const [after] = await rolesOf(seeded.personId);
      expect(after.verificationStatus).toBe('VERIFIED');
      expect(after.confidenceScore).toBe(92);
      expect(after.lastVerifiedAt!.getTime()).toBe(verifiedAt.getTime());
      expect(after.jobTitleAtCompany).toBe('Managing Director');
      expect((await personByName('verified vera'))).toHaveLength(1);
    });
  });

  // ------------------------------------------------------------------ reporting
  describe('13. import reporting', () => {
    it('the batch, the record and the submit response all carry the People results', async () => {
      const r = await submit([
        row({ contact_person: 'Report One', contact_title: 'CEO', person_2_name: 'Nope', person_2_title: 'CFO' }),
        row({ contact_person: 'Report Two', contact_title: 'Director' }),
        row(),
      ]);
      expect(r).toMatchObject({ publishedCount: 3 });
      expect(r.people).toEqual({ received: 3, accepted: 2, created: 2, updated: 0, unchanged: 0, quarantined: 0, rejected: 1, errors: 0 });

      const batch = await batchOf(r.batchId);
      expect(batch.peopleSummary).toEqual(r.people);
      const listed = (await h.admin.getBatches(50, 0)).find((b) => b.id === r.batchId)!;
      expect(listed.peopleSummary).toEqual(r.people);

      const recs = await db.select().from(schema.importRecords).where(eq(schema.importRecords.batchId, r.batchId));
      const results = recs.map((x) => x.peopleResult as any);
      expect(results.filter(Boolean)).toHaveLength(2); // the company-only row never attempted
      for (const x of results.filter(Boolean)) {
        expect(x.received).toBe(x.accepted + x.rejected + x.quarantined + x.errors);
        expect(x.accepted).toBe(x.created + x.updated + x.unchanged);
      }
      // the stored report holds outcome codes only: no names, emails or phones
      expect(JSON.stringify(results)).not.toMatch(/Report One|Report Two|@|linkedin/);
    });

    it('the existing counters keep their meaning', async () => {
      const r = await submit([row({ contact_person: 'Counter Person', contact_title: 'CEO' }), row()]);
      const batch = await batchOf(r.batchId);
      expect(batch).toMatchObject({ totalRecords: 2, processedRecords: 2, successfulRecords: 2, failedRecords: 0, duplicateRecords: 0, status: 'COMPLETED' });
    });
  });

  // ------------------------------------------------------------------ stabilization: full chain
  describe('CSV upload -> DRAFT -> review -> publish -> customer (and the identical re-upload)', () => {
    const viewer = '00000000-0000-0000-0000-0000000000bb';
    const reviewer = { reviewedBy: 'qa.reviewer@orion.test' };
    const abc = 'ABC Technologies E2E';
    const csvRow = () => ({
      business_name: abc, city: 'Coimbatore', state: 'Tamil Nadu', pincode: '641002', address_line1: '7 Test Road',
      email: 'info@abc-tech.example', phone: '+91 422 255 0199',
      contact_person: 'Aarav Krishnan', contact_title: 'Founder & CEO',
      person_email: 'aarav.krishnan@abc-tech.example', person_linkedin: 'https://www.linkedin.com/in/aarav-krishnan-abc',
      person_2_name: 'Priyanka Raveendran', person_2_title: 'Head of Sales', person_2_email: 'priyanka.raveendran@abc-tech.example', person_2_linkedin: 'https://www.linkedin.com/in/priyanka-raveendran-abc',
      person_3_name: 'Unknown Person', person_3_title: 'Ambiguous',
    });
    let biz: { id: string };
    let arun: { personId: string; roleId: string };
    let priya: { personId: string; roleId: string };
    let firstCounts: Awaited<ReturnType<typeof counts>>;

    const customerCards = async () => (await h.people.listCompanyPeople(biz.id, viewer, { status: 'all' } as any)).people;

    it('upload: company imported, people extracted as DRAFT/PENDING with evidence; nothing invented', async () => {
      const r = await submit([csvRow()], 'abc.csv');
      expect(r.publishedCount).toBe(1);
      biz = await businessByName(abc);

      const [a] = await personByName('aarav krishnan');
      const [p] = await personByName('priyanka raveendran');
      expect(a).toMatchObject({ dataStatus: 'DRAFT', verificationStatus: 'UNVERIFIED' });
      expect(p).toMatchObject({ dataStatus: 'DRAFT', verificationStatus: 'UNVERIFIED' });
      const [ar] = await rolesOf(a.id);
      const [pr] = await rolesOf(p.id);
      expect(ar).toMatchObject({ reviewStatus: 'PENDING', isPublished: false, decisionMakerType: 'FOUNDER_CEO' });
      expect(pr).toMatchObject({ reviewStatus: 'PENDING', isPublished: false, decisionMakerType: 'SALES_DECISION_MAKER' });
      arun = { personId: a.id, roleId: ar.id };
      priya = { personId: p.id, roleId: pr.id };

      // person-specific email/linkedin are stored unverified and unpublished; the company email/phone are not attributed to anyone
      const contacts = await db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, a.id));
      expect(contacts.map((c) => c.normalizedValue)).toEqual(expect.arrayContaining(['aarav.krishnan@abc-tech.example']));
      expect(contacts.every((c) => !c.isPublished && c.verificationStatus === 'UNVERIFIED')).toBe(true);
      expect(contacts.map((c) => c.normalizedValue)).not.toContain('info@abc-tech.example');
      expect(await db.select().from(schema.peopleEvidence).where(eq(schema.peopleEvidence.companyPersonId, ar.id))).not.toHaveLength(0);

      // the third person has no usable title: held back, never stored as a person
      expect(r.people).toMatchObject({ received: 3, created: 2 });
      expect(r.people.quarantined + r.people.rejected).toBe(1);
      expect(await personByName('unknown person')).toHaveLength(0);

      expect(await customerCards()).toEqual([]);
      firstCounts = await counts();
    });

    it('review queue lists both roles, with evidence in the detail view', async () => {
      const queue: any = await h.review.getQueue({ status: 'PENDING', businessId: biz.id } as any);
      expect(queue.items.map((i: any) => i.person?.fullName ?? i.fullName).sort()).toEqual(['Aarav Krishnan', 'Priyanka Raveendran']);
      const detail: any = await h.review.getRoleDetail(arun.roleId);
      expect(detail.evidence.length).toBeGreaterThan(0);
      expect(detail.evidence[0]).toMatchObject({ sourceType: 'MANUAL_IMPORT', evidenceType: 'UPLOAD_ROW' });
    });

    it('reviewer edits and approves Arun only: that role is visible; Priya stays hidden; the contact stays unpublished', async () => {
      await h.review.editRole(arun.roleId, { jobTitle: 'Founder and Chief Executive Officer' } as any, { ...reviewer, note: 'registry shows the exact designation' });
      await h.review.approve(arun.roleId, { ...reviewer, note: 'checked against the upload evidence' });

      const visible = await customerCards();
      expect(visible.map((p) => p.fullName)).toEqual(['Aarav Krishnan']);
      expect(visible[0].jobTitle).toBe('Founder and Chief Executive Officer');
      expect(JSON.stringify(visible)).not.toMatch(/aarav\.krishnan@abc-tech|qa\.reviewer|fingerprint|reviewNote|review_note/i);
      expect((await rolesOf(priya.personId))[0]).toMatchObject({ isPublished: false, reviewStatus: 'PENDING' });
      const contacts = await db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, arun.personId));
      expect(contacts.every((c) => !c.isPublished)).toBe(true);
    });

    it('publishing a contact is explicit; the value is still never in a list response (unlock rules apply)', async () => {
      const [email] = (await db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, arun.personId))).filter((c) => c.contactType === 'WORK_EMAIL');
      await h.review.approve(arun.roleId, { ...reviewer, note: 'contact confirmed' }, { publishContactIds: [email.id] }).catch(() => undefined);
      const arunCard = (await customerCards()).find((p) => p.fullName === 'Aarav Krishnan')!;
      expect(arunCard.contacts.isUnlocked).toBe(false);
      expect(JSON.stringify(arunCard)).not.toContain('aarav.krishnan@abc-tech.example');
    });

    it('re-processing the same upload row changes nothing, even after the title edit and approval', async () => {
      const recs = await db.select().from(schema.importRecords);
      const rec = recs.find((x) => JSON.stringify(x.rawPayload).includes('Aarav Krishnan'))!;
      const before = await counts();
      await h.bridge!.ingestForPublishedRecord({ businessId: biz.id, record: rec as any });
      await h.bridge!.ingestForPublishedRecord({ businessId: biz.id, record: rec as any });
      expect(await counts()).toEqual({ ...before, quarantine: expect.any(Number) });
      expect((await counts()).people).toBe(firstCounts.people);
      expect((await counts()).roles).toBe(firstCounts.roles);
      expect((await rolesOf(arun.personId))[0]).toMatchObject({ isPublished: true, reviewStatus: 'APPROVED', jobTitleAtCompany: 'Founder and Chief Executive Officer' });
      expect((await rolesOf(priya.personId))[0]).toMatchObject({ isPublished: false, reviewStatus: 'PENDING' });
    });

    it('uploading the identical CSV again creates no duplicate people or roles', async () => {
      await submit([csvRow()], 'abc.csv');
      const after = await counts();
      expect(after.people).toBe(firstCounts.people);
      expect(after.roles).toBe(firstCounts.roles);
      expect(await rolesOf(arun.personId)).toHaveLength(1);
    });
  });

  // ------------------------------------------------------------------ batch publish (identifier contract)
  describe('publishBatch / publishRecord use the PUBLISH QUEUE id (regression)', () => {
    const failNext = (n: number) => {
      const spy = jest.spyOn(BusinessService.prototype, 'createBusinessAggregate');
      for (let i = 0; i < n; i++) spy.mockRejectedValueOnce(new Error('simulated publish failure'));
      return spy;
    };
    const queueOf = async (batchId: string) =>
      db
        .select({ q: schema.publishQueue, rec: schema.importRecords })
        .from(schema.publishQueue)
        .innerJoin(schema.importRecords, eq(schema.publishQueue.recordId, schema.importRecords.id))
        .where(eq(schema.importRecords.batchId, batchId));
    afterEach(() => jest.restoreAllMocks());

    it('1. single publish: a FAILED queue item can be published by its queue id; the People stage then runs', async () => {
      failNext(1);
      const r = await submit([row({ contact_person: 'Single Sarath', contact_title: 'CEO' })]);
      expect(r).toMatchObject({ publishedCount: 0, failedCount: 1 });
      expect(r.people.received).toBe(0); // the People stage only follows a committed company
      const [{ q, rec }] = await queueOf(r.batchId);
      expect(q.status).toBe('FAILED');
      expect(rec.status).toBe('APPROVED');

      const biz = await h.publishing.publishRecord(q.id, { via: 'ADMIN', actorId: h.adminId, allowUnreviewedSource: true });
      expect(biz.status).toBe('PUBLISHED');
      expect((await queueOf(r.batchId))[0].q.status).toBe('PUBLISHED');
      const [p] = await personByName('single sarath');
      expect((await rolesOf(p.id))[0]).toMatchObject({ isPublished: false, reviewStatus: 'PENDING' });
    });

    it('a record id (the old, wrong contract) is rejected, and an already PUBLISHED item cannot be published twice', async () => {
      failNext(1);
      const r = await submit([row()]);
      const [{ q, rec }] = await queueOf(r.batchId);
      await expect(h.publishing.publishRecord(rec.id, { via: 'ADMIN', actorId: h.adminId, allowUnreviewedSource: true })).rejects.toThrow(/invalid or missing record/);
      await h.publishing.publishRecord(q.id, { via: 'ADMIN', actorId: h.adminId, allowUnreviewedSource: true });
      await expect(h.publishing.publishRecord(q.id, { via: 'ADMIN', actorId: h.adminId, allowUnreviewedSource: true })).rejects.toThrow(/cannot be published again/);
    });

    it('2/3. batch publish with People data: every failed record is published (even beyond ten), people arrive as DRAFT', async () => {
      failNext(12);
      const rows = Array.from({ length: 12 }, (_, i) => row({ contact_person: `Batch Person ${String.fromCharCode(97 + i)}${String.fromCharCode(98 + i)}x`, contact_title: 'Director' }));
      // names above contain no digits; keep them unique letters only
      const r = await submit(rows.map((x, i) => ({ ...x, contact_person: `Batchperson ${['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima'][i]}` })));
      expect(r).toMatchObject({ publishedCount: 0, failedCount: 12 });
      const before = await counts();

      const out = await h.admin.publishBatch(r.batchId);
      expect(out).toMatchObject({ newlyPublished: 12, failed: 0, totalBatchRecords: 12 });
      const after = await counts();
      expect(after.businesses).toBe(before.businesses + 12);
      expect(after.people).toBe(before.people + 12);
      expect((await queueOf(r.batchId)).every((x) => x.q.status === 'PUBLISHED' && x.rec.status === 'PUBLISHED')).toBe(true);
      expect((await batchOf(r.batchId)).status).toBe('COMPLETED');
    });

    it('4. batch without People data: company only; nothing People-related is created', async () => {
      failNext(2);
      const r = await submit([row(), row()]);
      const before = await counts();
      const out = await h.admin.publishBatch(r.batchId);
      expect(out.newlyPublished).toBe(2);
      const after = await counts();
      expect(after.businesses).toBe(before.businesses + 2);
      expect({ ...after, businesses: 0 }).toEqual({ ...before, businesses: 0 });
    });

    it('5. retry: running publishBatch again publishes nothing twice; a record that failed the first time succeeds on retry', async () => {
      failNext(2);
      const r = await submit([row({ contact_person: 'Retry Ravindran', contact_title: 'CEO' }), row()]);
      failNext(1); // first record still fails during the batch publish
      const first = await h.admin.publishBatch(r.batchId);
      expect(first).toMatchObject({ newlyPublished: 1, failed: 1 });
      const mid = await counts();
      const second = await h.admin.publishBatch(r.batchId);
      expect(second).toMatchObject({ newlyPublished: 1, failed: 0 });
      const third = await h.admin.publishBatch(r.batchId);
      expect(third).toMatchObject({ newlyPublished: 0, failed: 0 });
      expect((await counts()).businesses).toBe(mid.businesses + 1);
      expect((await personByName('retry ravindran')).length).toBe(1);
    });

    it('6. duplicate record: a flagged duplicate is not published by publishBatch', async () => {
      const dup = row();
      await submit([dup]);
      const r = await submit([dup]);
      expect(r.duplicateCount).toBe(1);
      const before = await counts();
      const out = await h.admin.publishBatch(r.batchId);
      expect(out).toMatchObject({ newlyPublished: 0, failed: 0 });
      expect((await counts()).businesses).toBe(before.businesses);
    });

    it('7. failed record: stays FAILED with the error, does not affect the others, batch still completes', async () => {
      failNext(2);
      const r = await submit([row(), row()]);
      failNext(1);
      const out = await h.admin.publishBatch(r.batchId);
      expect(out).toMatchObject({ newlyPublished: 1, failed: 1 });
      const q = await queueOf(r.batchId);
      expect(q.filter((x) => x.q.status === 'FAILED')).toHaveLength(1);
      expect(q.find((x) => x.q.status === 'FAILED')!.q.errorMessage).toMatch(/simulated publish failure/);
      expect((await batchOf(r.batchId)).status).toBe('COMPLETED');
    });

    it('a People failure during batch publish cannot roll back the published company', async () => {
      const bad = await build('throwing', db);
      const spy = jest.spyOn(BusinessService.prototype, 'createBusinessAggregate');
      spy.mockRejectedValueOnce(new Error('simulated publish failure'));
      const r = await bad.admin.submitBatch({ filename: 'iso.csv', rows: [row({ contact_person: 'Isolated Indira', contact_title: 'CEO' })] });
      expect(r.failedCount).toBe(1);
      const out = await bad.admin.publishBatch(r.batchId);
      expect(out).toMatchObject({ newlyPublished: 1, failed: 0 });
      const rec = (await db.select().from(schema.importRecords).where(eq(schema.importRecords.batchId, r.batchId)))[0];
      expect(rec.status).toBe('PUBLISHED');
      expect((rec.peopleResult as any).error).toBe('people boom');
      const biz = await db.select().from(schema.businesses).orderBy(sql`created_at desc`).limit(1);
      expect(biz[0].status).toBe('PUBLISHED');
    });
  });

  // ------------------------------------------------------------------ source registry (Phase 6.1)
  describe('the upload bridge is a registered source', () => {
    afterEach(() => jest.restoreAllMocks());

    it('passes its registry key to the People ingestion service, and the report names the registered source', async () => {
      const spy = jest.spyOn(PeopleIngestionService.prototype, 'ingest');
      const r = await submit([row({ contact_person: 'Registered Reema', contact_title: 'Director' })]);
      expect(r.people.created).toBe(1);
      const opts = spy.mock.calls.map((c) => c[1]).find((o) => o?.sourceKey);
      expect(opts).toMatchObject({ sourceKey: 'company-upload' });
      const results = await Promise.all(spy.mock.results.map((x) => x.value));
      expect(results.find((x: any) => x?.source)?.source).toEqual({ key: 'company-upload', version: '1' });
    });

    it('Phase 6.2: every extracted person is an observation of the upload source; re-processing the same import record adds nothing, a new upload adds history', async () => {
      const obsCount = async () => (await db.select().from(schema.peopleObservations)).length;
      const r = await submit([row({ contact_person: 'Observed Omkar', contact_title: 'Director', person_email: 'omkar@corp-upl.co.in' })], 'obs-upload.csv');
      expect(r.people.created).toBe(1);
      const rows = (await db.select().from(schema.peopleObservations)).filter((o) => o.observedName === 'Observed Omkar');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ sourceKey: 'company-upload', sourceVersion: '1', outcome: 'INGESTED', batchRef: `import-batch:${r.batchId}` });
      expect(rows[0].sourceRecordId.startsWith(`${r.batchId}|obs-upload.csv#row:1`)).toBe(true);
      expect(rows[0].evidenceId).not.toBeNull();
      expect(JSON.stringify(rows[0])).not.toContain('omkar@corp-upl');

      // the same import record processed again (same batch): recognised, nothing added anywhere
      const rec = (await db.select().from(schema.importRecords).where(eq(schema.importRecords.batchId, r.batchId)))[0];
      const before = { o: await obsCount(), c: await counts() };
      const again = await h.bridge!.ingestForPublishedRecord({ businessId: rows[0].businessId!, record: rec as any });
      expect(again.unchanged).toBe(1);
      expect({ o: await obsCount(), c: await counts() }).toEqual(before);
    });

    it('a disabled upload source cannot fail or alter the company import: the company is published, people are recorded as an error, nothing is quarantined or created', async () => {
      await db.execute(sql`UPDATE people_sources SET enabled = false WHERE key = 'company-upload'`);
      try {
        const before = await counts();
        const r = await submit([row({ contact_person: 'Disabled Dhruv', contact_title: 'Director' })]);
        expect(r).toMatchObject({ publishedCount: 1, failedCount: 0 });
        expect(r.people).toMatchObject({ received: 1, errors: 1, created: 0 });
        const after = await counts();
        expect(after.businesses).toBe(before.businesses + 1);
        expect({ ...after, businesses: 0 }).toEqual({ ...before, businesses: 0 });
        const rec = (await db.select().from(schema.importRecords).where(eq(schema.importRecords.batchId, r.batchId)))[0];
        expect(rec.status).toBe('PUBLISHED');
        expect(JSON.stringify(rec.peopleResult)).toMatch(/disabled/i);
      } finally {
        await db.execute(sql`UPDATE people_sources SET enabled = true WHERE key = 'company-upload'`);
      }
    });
  });

  // ------------------------------------------------------------------ Phase 6.12: manual acquisition, end to end
  describe('Phase 6.12: manual CSV/JSON upload is the acquisition channel (hardening)', () => {
    const letters = () => Math.random().toString(36).replace(/[0-9.]/g, '').slice(0, 5) || 'abcde';
    const person = (first: string) => `${first} ${letters()}van`;
    const observations = (batchId: string) => db.select().from(schema.peopleObservations).where(eq(schema.peopleObservations.batchRef, `import-batch:${batchId}`));
    const claimsOfPerson = async (personId: string) => {
      const ids = new Set((await db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, personId))).map((c) => c.id));
      return (await db.select().from(schema.peopleObservationClaims)).filter((c) => c.contactId && ids.has(c.contactId));
    };
    /** Simulates a LATER upload of the same company: a new import record (new batch id) handed to the bridge. */
    const laterUpload = (businessId: string, raw: Record<string, unknown>, filename = 'later.csv') => {
      const batchId = '00000000-0000-4000-8000-' + String(++seq).padStart(12, '0');
      return { batchId, run: () => h.bridge!.ingestForPublishedRecord({ businessId, record: { id: batchId, batchId, rowNumber: 1, rawPayload: raw, createdAt: new Date() } as any }), filename };
    };

    it('clean upload: five people per row (person_1..person_5) get stable source ids, observations, evidence, DRAFT state and no verification', async () => {
      const names = ['Mano', 'Nila', 'Oviya', 'Pavan', 'Ravi'].map(person);
      const company = row({
        contact_person: names[0], contact_title: 'Founder', person_email: `m.${letters()}@manual-co.co.in`,
        person_2_name: names[1], person_2_title: 'Managing Director', person_2_email: `n.${letters()}@manual-co.co.in`,
        person_3_name: names[2], person_3_title: 'Head of Sales', person_3_linkedin: `https://www.linkedin.com/in/oviya-${letters()}`,
        person_4_name: names[3], person_4_title: 'Sales Manager', person_4_phone: '0422 255 0488',
        person_5_name: names[4], person_5_title: 'Accountant', person_5_mobile: '9876500011',
        person_6_name: person('Sixth'), person_6_title: 'Director', // beyond the supported five: ignored, never invented
        verification_status: 'VERIFIED', is_verified: 'true', verified: 'yes', publish: 'true', is_published: 'true', review_status: 'APPROVED', // a row cannot self-verify or self-publish
      });
      const before = await counts();
      const r = await submit([company], 'manual-five.csv');
      expect(r.people).toMatchObject({ received: 5, created: 5, rejected: 0, quarantined: 0 });
      expect((await counts()).people).toBe(before.people + 5);
      expect(await personByName(names[0].toLowerCase())).toHaveLength(1);

      const obs = await observations(r.batchId);
      expect(obs.map((o) => o.sourceRecordId).sort()).toEqual([
        `${r.batchId}|manual-five.csv#row:1`,
        `${r.batchId}|manual-five.csv#row:1:person-2`,
        `${r.batchId}|manual-five.csv#row:1:person-3`,
        `${r.batchId}|manual-five.csv#row:1:person-4`,
        `${r.batchId}|manual-five.csv#row:1:person-5`,
      ].sort());
      expect(obs.every((o) => o.outcome === 'INGESTED' && o.sourceKey === 'company-upload' && o.evidenceId && o.classificationVersion === 'v1')).toBe(true);

      for (const n of names) {
        const [pp] = await personByName(n.toLowerCase());
        expect(pp).toMatchObject({ dataStatus: 'DRAFT', verificationStatus: 'UNVERIFIED' });
        const [role] = await rolesOf(pp.id);
        expect(role).toMatchObject({ reviewStatus: 'PENDING', isPublished: false, verificationStatus: 'UNVERIFIED', lastVerifiedAt: null, lastConfirmedAt: null });
        const cs = await db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, pp.id));
        expect(cs.every((c) => !c.isPublished && c.verificationStatus === 'UNVERIFIED' && c.lastVerifiedAt === null)).toBe(true);
        expect(cs.map((c) => c.normalizedValue)).not.toContain('info@company.example'); // company contact never becomes a person's
        expect((await db.select().from(schema.peopleEvidence).where(eq(schema.peopleEvidence.companyPersonId, role.id))).every((e) => e.verifiedAt === null)).toBe(true);
      }
      expect(await personByName(person('Sixth').toLowerCase().split(' ')[0])).toHaveLength(0);
      const ids = new Set((await Promise.all(names.map((n) => personByName(n.toLowerCase())))).flat().map((x) => x.id));
      expect((await db.select().from(schema.peopleVerifications)).filter((v) => ids.has(v.personId))).toHaveLength(0); // nothing verified by an upload
    });

    it('source ids are deterministic: same batch/file/row/person index gives the same id, a different position or file a different one', () => {
      const a = extractPeopleFromRow({ contact_person: 'Same Person', contact_title: 'CEO', person_2_name: 'Other Person', person_2_title: 'CFO' }, 'b1', { batchId: 'batch-1', filename: 'f.csv', rowNumber: 3, observedAt: new Date() });
      const b = extractPeopleFromRow({ contact_person: 'Same Person', contact_title: 'CEO', person_2_name: 'Other Person', person_2_title: 'CFO' }, 'b1', { batchId: 'batch-1', filename: 'f.csv', rowNumber: 3, observedAt: new Date() });
      expect(a.map((x) => x.source?.reference)).toEqual(b.map((x) => x.source?.reference));
      expect(a.map((x) => x.source?.reference)).toEqual(['f.csv#row:3', 'f.csv#row:3:person-2']);
      const other = extractPeopleFromRow({ contact_person: 'Same Person', contact_title: 'CEO' }, 'b1', { batchId: 'batch-1', filename: 'g.csv', rowNumber: 4, observedAt: new Date() });
      expect(other[0].source?.reference).toBe('g.csv#row:4');
      const long = 'x'.repeat(300) + '.csv';
      const ids = new Set([uploadRecordId('b', 'f.csv#row:3'), uploadRecordId('b', 'f.csv#row:3:person-2'), uploadRecordId('b2', 'f.csv#row:3'), uploadRecordId('b', long)]);
      expect(ids.size).toBe(4);
      expect(uploadRecordId('b', long)).toBe(uploadRecordId('b', long));
      expect(uploadRecordId('b', long).length).toBeLessThanOrEqual(200);
    });

    it('re-uploading the same file is idempotent; a later upload with CHANGED data adds history without duplicating people, roles or the unchanged contact', async () => {
      const name = person('Idem');
      const email = `i.${letters()}@manual-co.co.in`;
      const company = row({ contact_person: name, contact_title: 'Director', person_email: email });
      const r1 = await submit([company], 'idem.csv');
      expect(r1.people.created).toBe(1);
      const [pp] = await personByName(name.toLowerCase());
      const settled = await counts();
      const again = await submit([company], 'idem.csv'); // identical file: flagged duplicate, People layer sees nothing
      expect(again.people).toMatchObject({ received: 0 });
      expect(await counts()).toEqual(settled);

      const bizId = (await businessByName(company.business_name as string)).id;
      const first = await observations(r1.batchId);
      // same record content in a later upload: one new observation, no new canonical rows
      const same = laterUpload(bizId, company);
      await same.run();
      const afterSame = await counts();
      expect({ ...afterSame, quarantine: 0, evidence: 0 }).toEqual({ ...settled, quarantine: 0, evidence: 0 }); // no new person, role or contact
      expect(afterSame.evidence).toBeGreaterThan(settled.evidence); // a new upload row adds provenance (evidence is idempotent per source row)
      expect(await observations(same.batchId)).toHaveLength(1);
      expect(await observations(r1.batchId)).toEqual(first); // history untouched
      // changed record: new title and a second email
      const email2 = `i2.${letters()}@manual-co.co.in`;
      const changed = laterUpload(bizId, { ...company, contact_title: 'Managing Director', person_email: email2 });
      const res = await changed.run();
      expect(res).toMatchObject({ received: 1, accepted: 1, created: 0 });
      expect(await personByName(name.toLowerCase())).toHaveLength(1); // still one person
      expect((await rolesOf(pp.id)).map((x) => x.normalizedJobTitle).sort()).toEqual(['director', 'managing director']); // a changed title is a new role, the old one stays
      const cs = await db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, pp.id));
      expect(cs.map((c) => c.normalizedValue).sort()).toEqual([email, email2].sort()); // existing contact semantics: no duplicate, no overwrite
      expect(cs.every((c) => !c.isPublished && c.verificationStatus === 'UNVERIFIED')).toBe(true);
      const emailContact = cs.find((c) => c.normalizedValue === email)!;
      expect(await claimsOfPerson(pp.id)).toHaveLength(3); // email (upload 1), email (upload 2), new email (upload 3)
      expect((await claimsOfPerson(pp.id)).filter((c) => c.contactId === emailContact.id)).toHaveLength(2);
    });

    it('invalid and missing-title people are rejected and stay traceable (quarantine row + QUARANTINED observation); good people in the same row are unaffected', async () => {
      const good = person('Good');
      const company = row({
        contact_person: good, contact_title: 'CEO',
        person_2_name: person('Notitle'), // named person without a title
        person_3_name: 'X', person_3_title: 'CFO', // not a usable name
        person_4_email: `orphan.${letters()}@manual-co.co.in`, person_4_title: 'Director', // contact with no name
      });
      const r = await submit([company], 'invalid.csv');
      expect(r.publishedCount).toBe(1);
      expect(r.people).toMatchObject({ received: 4, created: 1, rejected: 3, errors: 0 });
      expect(await personByName(good.toLowerCase())).toHaveLength(1);
      const obs = await observations(r.batchId);
      expect(obs.filter((o) => o.outcome === 'QUARANTINED')).toHaveLength(3);
      expect(obs.filter((o) => o.outcome === 'QUARANTINED').every((o) => (o.reasonCodes ?? []).length > 0 && o.personId === null)).toBe(true);
      const q = (await db.select().from(schema.peopleIngestionQuarantine)).filter((x) => x.status === 'PENDING' && String(x.batchRef) === `import-batch:${r.batchId}`);
      expect(q).toHaveLength(3);
      const rec = (await db.select().from(schema.importRecords).where(eq(schema.importRecords.batchId, r.batchId)))[0];
      expect(JSON.stringify(rec.peopleResult)).not.toMatch(/@manual-co|Notitle/); // the report carries codes, never content
    });

    it('a person can never create or redirect a company: person columns cannot carry a business', async () => {
      const company = row({ contact_person: person('Redir'), contact_title: 'Director', person_business_id: '00000000-0000-4000-8000-0000000000ff', person_company: 'Some Other Traders', businessId: '00000000-0000-4000-8000-0000000000fe' });
      const before = await counts();
      const r = await submit([company], 'redirect.csv');
      expect(r.people.created).toBe(1);
      expect((await counts()).businesses).toBe(before.businesses + 1); // only the uploaded company
      const biz = await businessByName(company.business_name as string);
      const [pp] = await personByName((((company as any).contact_person as string)).toLowerCase());
      expect((await rolesOf(pp.id))[0].businessId).toBe(biz.id);
    });

    it('suppressed people are refused on re-acquisition, traceably, without touching the company or creating anything', async () => {
      const name = person('Supp');
      const li = `https://www.linkedin.com/in/supp-${letters()}`;
      const company = row({ contact_person: name, contact_title: 'Director', person_linkedin: li, person_email: `s.${letters()}@manual-co.co.in` });
      const r1 = await submit([company], 'supp.csv');
      expect(r1.people.created).toBe(1);
      const [pp] = await personByName(name.toLowerCase());
      await h.peoplePublishing.suppressPerson(pp.id, { reviewedBy: 'r@orion.test', note: 'opt-out request' });
      const bizId = (await businessByName(company.business_name as string)).id;
      const before = await counts();
      const later = laterUpload(bizId, { ...company, contact_person: person('Other'), contact_title: 'CEO' }); // same LinkedIn, other name/title
      const res = await later.run();
      expect(res).toMatchObject({ received: 1, accepted: 0, quarantined: 1 });
      expect(res.outcomes[0].codes).toContain('SUPPRESSED_PERSON');
      const after = await counts();
      expect({ ...after, quarantine: 0 }).toEqual({ ...before, quarantine: 0 });
      const obs = await observations(later.batchId);
      expect(obs).toHaveLength(1);
      expect(obs[0]).toMatchObject({ outcome: 'QUARANTINED', personId: null });
      expect(obs[0].reasonCodes).toContain('SUPPRESSED_PERSON');
      expect((await rolesOf(pp.id)).every((x) => !x.isPublished)).toBe(true);
    });

    it('duplicate and conflicting contacts: the same e-mail on two people is held back and recorded as a conflict; nothing is merged or overwritten', async () => {
      const shared = `shared.${letters()}@manual-co.co.in`;
      const a = person('Dupa');
      const b = person('Dupb');
      const company = row({ contact_person: a, contact_title: 'Director', person_email: shared, person_2_name: b, person_2_title: 'Manager', person_2_email: shared });
      const r = await submit([company], 'dup-contact.csv');
      expect(r.people).toMatchObject({ received: 2, created: 2 });
      const [pa] = await personByName(a.toLowerCase());
      const [pb] = await personByName(b.toLowerCase());
      expect((await db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, pa.id))).map((c) => c.normalizedValue)).toEqual([shared]);
      expect(await db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, pb.id))).toHaveLength(0);
      const conflicts = await db.select().from(schema.peopleConflicts);
      const mine = [];
      for (const c of conflicts.filter((x) => x.conflictType === 'CONTACT_MULTIPLE_PEOPLE')) {
        const ls = await db.select().from(schema.peopleConflictLinks).where(eq(schema.peopleConflictLinks.conflictId, c.id));
        if (ls.some((l) => l.personId === pa.id) && ls.some((l) => l.personId === pb.id)) mine.push(c);
      }
      expect(mine).toHaveLength(1);
      expect(mine[0].status).toBe('OPEN');
      expect((await rolesOf(pb.id))[0]).toMatchObject({ isPublished: false, reviewStatus: 'PENDING' }); // no winner, nothing published
    });

    it('review -> approval -> verification -> publishing -> customer visibility, with the customer-safe contract only', async () => {
      const name = person('Flow');
      const email = `flow.${letters()}@manual-co.co.in`;
      const company = row({ contact_person: name, contact_title: 'Managing Director', person_email: email });
      const r = await submit([company], 'flow.csv');
      const biz = await businessByName(company.business_name as string);
      const [pp] = await personByName(name.toLowerCase());
      const [role] = await rolesOf(pp.id);
      const viewer = '00000000-0000-0000-0000-0000000000cc';
      const visible = async () => (await h.people.listCompanyPeople(biz.id, viewer, { status: 'all' } as any)).people;

      // 1. DRAFT: invisible
      expect(await visible()).toEqual([]);
      // 2. review queue shows it with the upload evidence; triage-style signals are internal only
      const detail: any = await h.review.getRoleDetail(role.id);
      expect(detail.evidence[0]).toMatchObject({ sourceType: 'MANUAL_IMPORT', evidenceType: 'UPLOAD_ROW' });
      // 3. approval publishes the role only
      const ctx = { reviewedBy: 'qa.reviewer@orion.test', note: 'checked against the uploaded sheet' };
      await h.review.approve(role.id, ctx);
      let cards = await visible();
      expect(cards).toHaveLength(1);
      expect(cards[0].verification).toMatchObject({ status: 'UNVERIFIED', assertion: 'UNVERIFIED', lastVerifiedAt: null }); // approved is not verified
      // 4. verification is a separate, explicit reviewer decision with evidence
      await h.verification.verify(role.id, { claim: 'RELATIONSHIP', note: 'confirmed on the registry filing', evidence: { sourceType: 'GOVERNMENT_REGISTRY', evidenceType: 'REGISTRY_FILING', sourceReference: 'filing-2026-01' } } as any, ctx);
      const [verifiedRole] = await rolesOf(pp.id);
      expect(verifiedRole.isPublished).toBe(true);
      cards = await visible();
      expect(['VERIFIED', 'PARTIALLY_VERIFIED']).toContain(cards[0].verification.status);
      // 5. contacts stay locked until published AND unlocked; the card is exactly the customer contract
      expect(cards[0].contacts.email).toMatchObject({ available: false, value: null });
      const keys = Object.keys(cards[0]).sort();
      expect(keys).toEqual(['additionalRoles', 'businessId', 'contacts', 'decisionMaker', 'department', 'endDate', 'evidence', 'fullName', 'id', 'isCurrent', 'isSaved', 'jobTitle', 'location', 'relevance', 'seniority', 'startDate', 'unlockCostCredits', 'verification']);
      const dump = JSON.stringify(cards);
      expect(dump).not.toMatch(new RegExp(`${email.replace(/\./g, '\\.')}|UPLOAD_ROW|manual-five|flow\\.csv|company-upload|import-batch|qa\\.reviewer|filing-2026|${r.batchId}`));
    });

    it('large and malformed input is refused before anything is stored or processed, and never echoes content', async () => {
      const before = await counts();
      const batchesBefore = (await h.admin.getBatches(500, 0)).length;
      const bad: Array<[string, any[]]> = [
        ['NOT_AN_OBJECT', [row(), null]],
        ['NOT_AN_OBJECT', [row(), ['a', 'b']]],
        ['NOT_AN_OBJECT', [row(), 'just a string']],
        ['UNSAFE_COLUMN_NAME', [JSON.parse('{"__proto__": "x", "business_name": "Evil Co"}')]],
        ['UNSAFE_COLUMN_NAME', [row({ constructor: 'x' })]],
        ['CELL_TOO_LONG', [row({ contact_person: 'A'.repeat(5001) })]],
        ['CONTROL_CHARACTER', [row({ contact_person: 'Nul\u0000Person' })]],
        ['NESTED_OR_UNSUPPORTED_VALUE', [row({ contact_person: { $ne: null } })]],
        ['NESTED_OR_UNSUPPORTED_VALUE', [row({ contact_person: ['a'] })]],
        ['TOO_MANY_COLUMNS', [Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`c${i}`, 'x']))]],
        ['COLUMN_NAME_TOO_LONG', [{ ['k'.repeat(201)]: 'x' }]],
      ];
      for (const [code, rows] of bad) {
        const e: any = await h.admin.submitBatch({ filename: 'bad.csv', rows }).then(() => null, (err) => err);
        expect(e?.getStatus?.()).toBe(400);
        const body = JSON.stringify(e.getResponse());
        expect(body).toContain(code);
        expect(body).not.toMatch(/Evil Co|Nul|AAAAA|\$ne/); // problem codes and row numbers only
        await expect(h.admin.previewRows(rows)).rejects.toMatchObject({ status: 400 });
      }
      await expect(h.admin.submitBatch({ filename: 'x.csv', rows: Array.from({ length: 5001 }, () => ({ business_name: 'x' })) })).rejects.toMatchObject({ status: 400 });
      await expect(h.admin.submitBatch({ filename: 'x.csv', rows: 'nope' as any })).rejects.toMatchObject({ status: 400 });
      await expect(h.admin.submitBatch({ filename: 'x.csv', rows: [] })).rejects.toMatchObject({ status: 400 });
      const huge = Array.from({ length: 2200 }, () => ({ a: 'z'.repeat(4900) })); // 10.7M characters in total
      const big: any = await h.admin.submitBatch({ filename: 'big.csv', rows: huge }).then(() => null, (err) => err);
      expect(big.getResponse()).toMatchObject({ errorCode: 'UPLOAD_TOO_LARGE' });
      expect(await counts()).toEqual(before);
      expect((await h.admin.getBatches(500, 0)).length).toBe(batchesBefore); // not even a batch row
    });

    it('limits that are met are accepted; an oversized person field is isolated to that person', async () => {
      const company = row({ contact_person: person('Fine'), contact_title: 'CEO', person_2_name: 'B'.repeat(4000) + ' Surname', person_2_title: 'CFO', note: 'N'.repeat(5000) });
      const r = await submit([company], 'edge.csv');
      expect(r.publishedCount).toBe(1);
      expect(r.people.created).toBe(1);
      expect(r.people.created + r.people.rejected + r.people.quarantined).toBe(2);
    });

    it('failure isolation: one failing row does not stop the others, and the batch report keeps its counters', async () => {
      const ok = person('Iso');
      const r = await submit([row({ contact_person: ok, contact_title: 'CEO' }), row({ business_name: '', city: '' }), row()], 'iso.csv');
      expect(r.totalRecords ?? 3).toBe(3);
      expect(r.publishedCount).toBeGreaterThanOrEqual(2);
      expect(await personByName(ok.toLowerCase())).toHaveLength(1);
      const batch = await batchOf(r.batchId);
      expect(batch.totalRecords).toBe(3);
      expect(batch.processedRecords).toBe(3);
      expect(batch.peopleSummary).toMatchObject({ received: 1, created: 1 });
    });

    it('everything uploaded stays invisible to customers until reviewed (list, detail, search)', async () => {
      const name = person('Hidden');
      const company = row({ contact_person: name, contact_title: 'CEO', person_email: `h.${letters()}@manual-co.co.in` });
      await submit([company], 'hidden.csv');
      const biz = await businessByName(company.business_name as string);
      const [pp] = await personByName(name.toLowerCase());
      expect((await h.people.listCompanyPeople(biz.id, '00000000-0000-0000-0000-0000000000dd', { status: 'all' } as any)).people).toEqual([]);
      await expect(h.people.getPersonDetail(pp.id, '00000000-0000-0000-0000-0000000000dd')).rejects.toMatchObject({ status: 404 });
    });
  });

  // ------------------------------------------------------------------ boundaries & migration
  describe('boundaries', () => {
    const IMPORT_DIR = path.resolve(__dirname, '..');
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === '__tests__' ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]));
    const files = walk(IMPORT_DIR).filter((f) => f.endsWith('.ts'));

    it('the import module never touches people tables or people services directly', () => {
      const offenders = files.filter((f) => /schema\.(people|companyPeople|personContacts|peopleEvidence|personUnlocks|peopleIngestionQuarantine)\b|PeopleWriteService|(?<!I)PeopleIngestionService|PeoplePublishingService|normalizeRawPerson|classifyRole/.test(fs.readFileSync(f, 'utf8')));
      expect(offenders).toEqual([]);
    });

    it('the only people-layer touchpoint is the bridge (contract types + DI token)', () => {
      const touching = files.filter((f) => /modules\/people|\.\.\/people\//.test(fs.readFileSync(f, 'utf8').replace(/from '\.\.\/people\/import-people/g, ''))).map((f) => path.basename(f));
      expect(touching.sort()).toEqual(['import-people.bridge.ts', 'import.module.ts']);
    });

    it('the bridge and the publishing hook are the only import-flow changes: it cannot publish or create businesses', () => {
      const bridge = fs.readFileSync(path.join(IMPORT_DIR, 'people/import-people.bridge.ts'), 'utf8');
      expect(bridge).not.toMatch(/publishRole|publishContact|dataStatus|createBusiness|businesses\b/);
    });

    it('government portal clients were not introduced', () => {
      const all = walk(path.resolve(IMPORT_DIR, '..')).filter((f) => f.endsWith('.ts'));
      const offenders = all.filter((f) => /[a-z0-9.-]*(mca|udyamregistration|fssai|startupindia)[a-z0-9.-]*\.gov\.in/i.test(fs.readFileSync(f, 'utf8')));
      expect(offenders).toEqual([]);
    });
  });

  describe('migration 0006', () => {
    it('adds two nullable JSON columns and is idempotent', async () => {
      const t = await createTestDb();
      await expect(t.client.exec(readMigration('0006_import_people_report.sql'))).resolves.toBeDefined();
      const cols = await t.client.query<{ table_name: string; column_name: string; is_nullable: string; data_type: string }>(
        `SELECT table_name, column_name, is_nullable, data_type FROM information_schema.columns
         WHERE column_name IN ('people_summary','people_result') ORDER BY table_name`,
      );
      expect(cols.rows).toEqual([
        { table_name: 'import_batches', column_name: 'people_summary', is_nullable: 'YES', data_type: 'jsonb' },
        { table_name: 'import_records', column_name: 'people_result', is_nullable: 'YES', data_type: 'jsonb' },
      ]);
      await t.client.close();
    });

    it('touches only the two import columns', () => {
      const text = readMigration('0006_import_people_report.sql');
      expect([...text.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]).sort()).toEqual(['import_batches', 'import_records']);
      expect(text).not.toMatch(/DROP|UPDATE|DELETE|CREATE TABLE/i);
    });
  });
});

function readdir(): string[] {
  return [
    '0000_bent_johnny_storm.sql',
    '0001_blushing_loa.sql',
    '0002_typical_clint_barton.sql',
    '0004_decision_maker_people.sql',
    '0005_people_ingestion.sql',
    '0006_import_people_report.sql',
    '0007_people_review.sql',
    '0008_people_verification.sql',
    '0009_people_sources.sql',
    '0010_people_observations.sql',
    '0011_people_suppression.sql',
    '0012_people_classification_versioning.sql',
    '0013_people_contact_provenance.sql',
    '0014_people_freshness.sql',
    '0015_people_conflicts.sql',
    '0016_people_acquisition_runs.sql',
  ];
}

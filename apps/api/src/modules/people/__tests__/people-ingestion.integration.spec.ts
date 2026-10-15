import { expectLedgerConsistent } from './ledger-invariants';
import { Test } from '@nestjs/testing';
import { and, eq, sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { PEOPLE_INGESTION_PORT, IPeopleIngestionPort } from '../contracts/people-ingestion.contract';
import { PEOPLE_INGESTION_SERVICE, IPeopleIngestionService, IRawPersonRecord } from '../ingestion/ingestion.types';
import { PeopleIngestionService } from '../ingestion/people-ingestion.service';
import { CsvPeopleSource, JsonPeopleSource } from '../ingestion/sources/people-sources';
import { PeoplePublishingService } from '../people-publishing.service';
import { PeopleWriteService } from '../people-write.service';
import { PeopleService } from '../people.service';
import { PeopleController } from '../people.controller';
import { ObservationService } from '../observations/observation.service';
import { SourceRegistryService } from '../sources/source-registry.service';
import { createTestDb, JOURNALED_MIGRATIONS, readMigration, seedBusiness } from './pglite-test-db';

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const SRC = { type: 'MANUAL_IMPORT', label: 'unit-test', reference: 'sheet-1' };

describe('People ingestion (Phase 2) on a real Postgres schema', () => {
  let db: DrizzleDb;
  let close: () => Promise<void>;
  let write: PeopleWriteService;
  let ingest: PeopleIngestionService;
  let publishing: PeoplePublishingService;
  let people: PeopleService;
  let acme: { id: string; slug: string };
  let beta: { id: string; slug: string };
  let draftCo: { id: string; slug: string };

  const rec = (over: Partial<IRawPersonRecord> = {}): IRawPersonRecord => ({
    businessSlug: 'acme',
    personName: 'Arun Kumar',
    jobTitle: 'CEO',
    source: SRC,
    ...over,
  });
  const count = async (table: any) => (await db.select({ n: sql<number>`count(*)::int` }).from(table))[0].n;
  const snapshotCounts = async () => ({
    people: await count(schema.people),
    roles: await count(schema.companyPeople),
    contacts: await count(schema.personContacts),
    evidence: await count(schema.peopleEvidence),
    quarantine: await count(schema.peopleIngestionQuarantine),
  });
  const personByName = (n: string) => db.select().from(schema.people).where(eq(schema.people.normalizedName, n));
  const rolesOf = (personId: string) => db.select().from(schema.companyPeople).where(eq(schema.companyPeople.personId, personId));
  const one = async (r: IRawPersonRecord) => (await ingest.ingest([r])).results[0];
  /** A fresh company per test group keeps groups independent. */
  let seq = 0;
  const newCompany = async () => {
    const b = await seedBusiness(db, `co-${++seq}-${Math.random().toString(36).slice(2, 6)}`);
    return b;
  };

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    close = () => t.client.close();
    write = new PeopleWriteService(db);
    ingest = new PeopleIngestionService(db, write, new SourceRegistryService(db), new ObservationService(db));
    publishing = new PeoplePublishingService(db);
    people = new PeopleService(db);
    acme = await seedBusiness(db, 'acme');
    beta = await seedBusiness(db, 'beta-foods', { city: 'Chennai' });
    draftCo = await seedBusiness(db, 'draft-co', { status: 'DRAFT' });
    await db.insert(schema.businessIdentifiers).values({
      businessId: acme.id, type: 'CIN', value: 'U12345TN2010PTC000001', normalizedValue: 'U12345TN2010PTC000001',
    });
  }, 60_000);

  afterAll(async () => {
    await expectLedgerConsistent(db); // status columns must still agree with the verification ledger
    await close?.();
  });

  // ---------------------------------------------------------------- identity
  describe('identity', () => {
    it('creates a new person as an invisible DRAFT', async () => {
      const r = await one(rec({ personName: 'Sunita Rao', jobTitle: 'Founder' }));
      expect(r.outcome).toBe('CREATED');
      const [p] = await personByName('sunita rao');
      expect(p).toMatchObject({ fullName: 'Sunita Rao', dataStatus: 'DRAFT', verificationStatus: 'UNVERIFIED', confidenceScore: 0 });
      const [role] = await rolesOf(p.id);
      expect(role).toMatchObject({ isPublished: false, verificationStatus: 'UNVERIFIED', decisionMakerType: 'FOUNDER_CEO' });
    });

    it('matches an existing person instead of duplicating', async () => {
      const first = await one(rec({ personName: 'Kiran Bose', jobTitle: 'Director' }));
      const again = await one(rec({ personName: 'Kiran Bose', jobTitle: 'Director' }));
      expect(again.outcome).toBe('UNCHANGED');
      expect(again.personId).toBe(first.personId);
    });

    it('normalised variants of one name are the same person', async () => {
      const results = (
        await ingest.ingest([
          rec({ personName: 'Mr. Vikram Sethi - CEO', jobTitle: undefined }),
          rec({ personName: 'VIKRAM SETHI', jobTitle: 'CEO' }),
          rec({ personName: 'Vikram  Sethi', jobTitle: 'ceo' }),
        ])
      ).results;
      expect(new Set(results.map((r) => r.personId)).size).toBe(1);
      expect(results.map((r) => r.outcome)).toEqual(['CREATED', 'UNCHANGED', 'UNCHANGED']);
      expect(await personByName('vikram sethi')).toHaveLength(1);
      expect(await rolesOf(results[0].personId!)).toHaveLength(1);
    });

    it('does NOT merge merely similar names', async () => {
      const a = await one(rec({ personName: 'Arun Kumar', jobTitle: 'CEO' }));
      const b = await one(rec({ personName: 'Arun Kumaran', jobTitle: 'CEO' }));
      const c = await one(rec({ personName: 'Varun Kumar', jobTitle: 'CEO' }));
      expect(new Set([a.personId, b.personId, c.personId]).size).toBe(3);
    });

    it('same name at different companies is a different person unless a strong identifier ties them', async () => {
      const a = await one(rec({ personName: 'Deepak Menon', jobTitle: 'CEO', businessSlug: 'acme' }));
      const b = await one(rec({ personName: 'Deepak Menon', jobTitle: 'CEO', businessSlug: 'beta-foods' }));
      expect(a.personId).not.toBe(b.personId);
    });

    it('same name at one company but different LinkedIn profiles are two people', async () => {
      const co = await newCompany();
      const a = await one(rec({ businessSlug: co.slug, personName: 'Ravi Shankar', jobTitle: 'Director', linkedinUrl: 'linkedin.com/in/ravi-s-1' }));
      const b = await one(rec({ businessSlug: co.slug, personName: 'Ravi Shankar', jobTitle: 'Director', linkedinUrl: 'linkedin.com/in/ravi-s-2' }));
      expect(a.personId).not.toBe(b.personId);
      expect(b.outcome).toBe('CREATED');
    });

    it('refuses to guess between several same-named people (ambiguous identity is quarantined)', async () => {
      const co = await newCompany();
      await one(rec({ businessSlug: co.slug, personName: 'Ravi Shankar', jobTitle: 'CTO', linkedinUrl: 'linkedin.com/in/rs-cto' }));
      await one(rec({ businessSlug: co.slug, personName: 'Ravi Shankar', jobTitle: 'CFO', linkedinUrl: 'linkedin.com/in/rs-cfo' }));
      const before = await snapshotCounts();
      const r = await one(rec({ businessSlug: co.slug, personName: 'Ravi Shankar', jobTitle: 'Director' }));
      expect(r.outcome).toBe('QUARANTINED');
      expect(r.reasons![0].code).toBe('AMBIGUOUS_IDENTITY');
      const after = await snapshotCounts();
      expect(after.people).toBe(before.people);
      // ...but the exact-role holder is unambiguous
      const same = await one(rec({ businessSlug: co.slug, personName: 'Ravi Shankar', jobTitle: 'CFO' }));
      expect(same.outcome).toBe('UNCHANGED');
    });

    it('the same person across sources: LinkedIn, then a name variant via shared work email', async () => {
      const a = await one(rec({ personName: 'Anil Kapoor', jobTitle: 'Owner', linkedinUrl: 'https://in.linkedin.com/in/anil-kapoor-77/', source: { type: 'WEB_SCRAPING', url: 'https://example.com/a' } }));
      const b = await one(rec({ personName: 'ANIL KAPOOR', jobTitle: 'Owner', linkedinUrl: 'linkedin.com/in/ANIL-KAPOOR-77', email: 'anil@acme.co.in', source: { type: 'PARTNER_FEED', reference: 'feed-9' } }));
      const c = await one(rec({ businessSlug: 'beta-foods', personName: 'A. Kapoor', jobTitle: 'Advisor', email: 'Anil@Acme.co.in', source: { type: 'USER_SUBMISSION' } }));
      expect(b.personId).toBe(a.personId);
      expect(c.personId).toBe(a.personId); // same work email + compatible name
      const roles = await rolesOf(a.personId!);
      expect(roles.map((r) => r.businessId).sort()).toEqual([acme.id, beta.id].sort());
      const evidence = await db.select().from(schema.peopleEvidence).where(eq(schema.peopleEvidence.personId, a.personId!));
      expect(new Set(evidence.map((e) => e.sourceType))).toEqual(new Set(['WEB_SCRAPING', 'PARTNER_FEED', 'USER_SUBMISSION']));
    });

    it('an email owned by a different person is never attached to the wrong one', async () => {
      const owner = await one(rec({ personName: 'Meera Joshi', jobTitle: 'CFO', email: 'meera@acme.co.in' }));
      const other = await one(rec({ personName: 'Sanjay Dutt', jobTitle: 'COO', email: 'meera@acme.co.in' }));
      expect(other.personId).not.toBe(owner.personId);
      expect(other.warnings!.map((w) => w.code)).toContain('CONTACT_BELONGS_TO_ANOTHER_PERSON');
      const contacts = await db.select().from(schema.personContacts).where(eq(schema.personContacts.normalizedValue, 'meera@acme.co.in'));
      expect(contacts).toHaveLength(1);
      expect(contacts[0].personId).toBe(owner.personId);
    });

    it('LinkedIn beats a conflicting email and reports the conflict', async () => {
      const a = await one(rec({ personName: 'Nikhil Rao', jobTitle: 'CEO', linkedinUrl: 'linkedin.com/in/nikhil-r', email: 'nikhil@acme.co.in' }));
      const b = await one(rec({ personName: 'Other Person', jobTitle: 'CTO', email: 'other@acme.co.in' }));
      const r = await one(rec({ personName: 'Nikhil Rao', jobTitle: 'CEO', linkedinUrl: 'linkedin.com/in/nikhil-r', email: 'other@acme.co.in' }));
      expect(r.personId).toBe(a.personId);
      expect(r.warnings!.map((w) => w.code)).toContain('IDENTITY_CONFLICT');
      const otherEmail = await db.select().from(schema.personContacts).where(eq(schema.personContacts.normalizedValue, 'other@acme.co.in'));
      expect(otherEmail.map((c) => c.personId)).toEqual([b.personId]);
    });

    it('a suppressed person is never resurrected or duplicated', async () => {
      const a = await one(rec({ personName: 'Opt Outer', jobTitle: 'CEO', linkedinUrl: 'linkedin.com/in/opt-outer' }));
      await publishing.suppressPerson(a.personId!, 'ops');
      const before = await snapshotCounts();
      const r = await one(rec({ personName: 'Opt Outer', jobTitle: 'CEO', linkedinUrl: 'linkedin.com/in/opt-outer', email: 'opt@acme.co.in' }));
      expect(r.outcome).toBe('QUARANTINED');
      expect(r.reasons![0].code).toBe('SUPPRESSED_PERSON'); // renamed in Phase 6.4 (was PERSON_SUPPRESSED); publishing still uses PERSON_SUPPRESSED
      expect((await snapshotCounts()).people).toBe(before.people);
      expect((await snapshotCounts()).contacts).toBe(before.contacts);
    });
  });

  // ---------------------------------------------------------------- company <-> person
  describe('company relationship', () => {
    it('links a person to an existing company; identity stays separate from the role', async () => {
      const r = await one(rec({ personName: 'Geeta Iyer', jobTitle: 'Managing Director', city: 'Coimbatore' }));
      const [p] = await personByName('geeta iyer');
      const [role] = await rolesOf(p.id);
      expect(role.businessId).toBe(acme.id);
      expect(role).toMatchObject({ jobTitleAtCompany: 'Managing Director', seniorityLevel: 'EXECUTIVE', decisionMakerType: 'MANAGING_DIRECTOR' });
      expect(r.companyPersonId).toBe(role.id);
      expect(p).not.toHaveProperty('jobTitle'); // no company-specific role data on the identity
    });

    it('one person, several companies, each with its own role - global identity untouched', async () => {
      const li = 'linkedin.com/in/hari-prasad-9';
      const a = await one(rec({ personName: 'Hari Prasad', jobTitle: 'CEO', linkedinUrl: li, city: 'Coimbatore', state: 'Tamil Nadu' }));
      const b = await one(rec({ businessSlug: 'beta-foods', personName: 'H. Prasad', jobTitle: 'Director', linkedinUrl: li, city: 'Chennai' }));
      expect(b.personId).toBe(a.personId);
      const roles = await rolesOf(a.personId!);
      expect(roles).toHaveLength(2);
      expect(roles.find((r) => r.businessId === acme.id)!.decisionMakerType).toBe('FOUNDER_CEO');
      expect(roles.find((r) => r.businessId === beta.id)!.decisionMakerType).toBe('DIRECTOR_PARTNER');
      const [p] = await db.select().from(schema.people).where(eq(schema.people.id, a.personId!));
      expect(p).toMatchObject({ fullName: 'Hari Prasad', city: 'Coimbatore', state: 'Tamil Nadu' }); // first-seen wins
    });

    it('multiple roles at the same company', async () => {
      const co = await newCompany();
      const a = await one(rec({ businessSlug: co.slug, personName: 'Lata Menon', jobTitle: 'Founder' }));
      const b = await one(rec({ businessSlug: co.slug, personName: 'Lata Menon', jobTitle: 'Managing Director' }));
      expect(b.personId).toBe(a.personId);
      expect(await rolesOf(a.personId!)).toHaveLength(2);
    });

    it('former vs current roles, and a weaker re-import never flips them', async () => {
      const co = await newCompany();
      const r = await one(rec({ businessSlug: co.slug, personName: 'Old Hand', jobTitle: 'CFO', startDate: '2015-04-01', endDate: '2021-03-31' }));
      let [role] = await rolesOf(r.personId!);
      expect(role).toMatchObject({ isCurrent: false, startDate: '2015-04-01', endDate: '2021-03-31' });
      await one(rec({ businessSlug: co.slug, personName: 'Old Hand', jobTitle: 'CFO' })); // no dates, no flag
      [role] = await rolesOf(r.personId!);
      expect(role).toMatchObject({ isCurrent: false, endDate: '2021-03-31' });

      const cur = await one(rec({ businessSlug: co.slug, personName: 'New Blood', jobTitle: 'COO', isCurrent: 'yes', startDate: '2024-01-01' }));
      expect((await rolesOf(cur.personId!))[0].isCurrent).toBe(true);
    });

    it('impossible current/end-date combination is quarantined', async () => {
      const r = await one(rec({ personName: 'Time Traveler', isCurrent: true, endDate: '2019-01-01' }));
      expect(r.outcome).toBe('QUARANTINED');
      expect(r.reasons![0].code).toBe('CONFLICTING_CURRENT_FLAG');
    });

    it('resolves the company by slug, id and identifier; rejects unknown or conflicting references', async () => {
      const bySlug = await one(rec({ personName: 'Slug Person' }));
      const byId = await one(rec({ businessSlug: undefined, businessId: acme.id, personName: 'Id Person' }));
      const byCin = await one(rec({ businessSlug: undefined, businessIdentifier: { type: 'cin', value: 'u12345tn2010ptc000001' }, personName: 'Cin Person' }));
      for (const r of [bySlug, byId, byCin]) expect(r.outcome).toBe('CREATED');
      expect((await rolesOf(byCin.personId!))[0].businessId).toBe(acme.id);

      const missing = await one(rec({ businessSlug: 'no-such-company', personName: 'Ghost Person' }));
      expect(missing.reasons![0].code).toBe('BUSINESS_NOT_FOUND');
      const conflicting = await one(rec({ businessSlug: 'beta-foods', businessId: acme.id, personName: 'Torn Person' }));
      expect(conflicting.reasons![0].code).toBe('AMBIGUOUS_COMPANY_MATCH'); // renamed in Phase 6.3 (was AMBIGUOUS_BUSINESS)
      expect(await personByName('ghost person')).toHaveLength(0);
      expect(await personByName('torn person')).toHaveLength(0);
    });

    it('never creates or edits businesses', async () => {
      const before = await db.select().from(schema.businesses);
      await one(rec({ personName: 'Harmless Person' }));
      await one(rec({ businessSlug: 'invented-co', personName: 'Harmless Person' }));
      const after = await db.select().from(schema.businesses);
      expect(after.map((b) => [b.id, b.updatedAt.getTime()])).toEqual(before.map((b) => [b.id, b.updatedAt.getTime()]));
    });
  });

  // ---------------------------------------------------------------- roles
  describe('role classification (shared classifier)', () => {
    it.each([
      ['CEO', 'EXECUTIVE', 'EXECUTIVE', 'FOUNDER_CEO'],
      ['Co-Founder', 'EXECUTIVE', 'EXECUTIVE', 'FOUNDER_CEO'],
      ['Founder & CEO', 'EXECUTIVE', 'EXECUTIVE', 'FOUNDER_CEO'],
      ['Owner', 'EXECUTIVE', 'EXECUTIVE', 'FOUNDER_CEO'],
      ['Managing Director', 'EXECUTIVE', 'EXECUTIVE', 'MANAGING_DIRECTOR'],
      ['Director', 'DIRECTOR', 'EXECUTIVE', 'DIRECTOR_PARTNER'],
      ['Partner', 'EXECUTIVE', 'EXECUTIVE', 'DIRECTOR_PARTNER'],
      ['General Manager', 'HEAD', 'EXECUTIVE', 'GENERAL_MANAGER'],
      ['Head of Procurement', 'HEAD', 'PROCUREMENT', 'PROCUREMENT_DECISION_MAKER'],
      ['VP Sales', 'HEAD', 'SALES', 'SALES_DECISION_MAKER'],
      ['CTO', 'EXECUTIVE', 'TECHNOLOGY', 'TECHNOLOGY_DECISION_MAKER'],
    ])('%s is stored as %s / %s / %s', async (title, seniority, department, type) => {
      const co = await newCompany();
      const r = await one(rec({ businessSlug: co.slug, personName: `Role Tester ${title.replace(/\W/g, '')}`, jobTitle: title }));
      const [role] = await rolesOf(r.personId!);
      expect(role).toMatchObject({ seniorityLevel: seniority, department, decisionMakerType: type });
    });

    it('ambiguous / unknown titles are stored honestly - no invented decision-maker status', async () => {
      const co = await newCompany();
      const unknown = await one(rec({ businessSlug: co.slug, personName: 'Puzzling Title', jobTitle: 'Chief Vibes Wrangler' }));
      const staff = await one(rec({ businessSlug: co.slug, personName: 'Junior Person', jobTitle: 'Sales Executive' }));
      const nonsense = await one(rec({ businessSlug: co.slug, personName: 'Odd Title', jobTitle: 'xyzzy' }));
      const [ur] = await rolesOf(unknown.personId!);
      expect(ur.decisionMakerType).toBeNull();
      expect((await rolesOf(staff.personId!))[0].decisionMakerType).toBeNull();
      const [nr] = await rolesOf(nonsense.personId!);
      expect(nr).toMatchObject({ seniorityLevel: 'UNKNOWN', department: 'UNKNOWN', decisionMakerType: null });
      expect(nonsense.warnings!.map((w) => w.code)).toContain('UNCLASSIFIED_TITLE');
    });

    it('a caller hint cannot promote a role; the classifier wins', async () => {
      const co = await newCompany();
      const r = await one(rec({ businessSlug: co.slug, personName: 'Hint Person', jobTitle: 'Sales Executive', seniority: 'EXECUTIVE', decisionMakerType: 'FOUNDER_CEO' }));
      expect(r.outcome).toBe('CREATED');
      const [role] = await rolesOf(r.personId!);
      expect(role).toMatchObject({ seniorityLevel: 'STAFF', decisionMakerType: null });
      expect(r.warnings!.map((w) => w.code)).toContain('HINT_CONFLICT_DECISION_MAKER');
    });

    it('contradictory hints are quarantined', async () => {
      const r = await one(rec({ personName: 'Impossible Person', seniority: 'STAFF', decisionMakerType: 'FOUNDER_CEO' }));
      expect(r.outcome).toBe('QUARANTINED');
      expect(r.reasons![0].code).toBe('INVALID_ROLE_COMBINATION');
    });

    it('keeps the first-seen wording of the title on re-import', async () => {
      const co = await newCompany();
      const r = await one(rec({ businessSlug: co.slug, personName: 'Wording Person', jobTitle: 'Head of Procurement' }));
      await one(rec({ businessSlug: co.slug, personName: 'Wording Person', jobTitle: 'HEAD OF  PROCUREMENT' }));
      expect((await rolesOf(r.personId!))[0].jobTitleAtCompany).toBe('Head of Procurement');
    });
  });

  // ---------------------------------------------------------------- contacts
  describe('contacts', () => {
    const contactsOf = (personId: string) => db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, personId));

    it('stores valid work email and phones normalised, unpublished by default', async () => {
      const co = await newCompany();
      const r = await one(rec({ businessSlug: co.slug, personName: 'Chandra Sekaran', email: ' Contact.Person@Corp.CO.in ', phone: '0422 255 0100', mobile: '98765 43210', linkedinUrl: 'https://in.linkedin.com/in/contact-person-1/' }));
      const cs = await contactsOf(r.personId!);
      expect(cs.map((c) => [c.contactType, c.normalizedValue]).sort()).toEqual([
        ['MOBILE', '+919876543210'],
        ['PHONE', '+914222550100'],
        ['WORK_EMAIL', 'contact.person@corp.co.in'],
      ]);
      expect(cs.every((c) => !c.isPublished && c.verificationStatus === 'UNVERIFIED' && c.sourceType === 'MANUAL_IMPORT')).toBe(true);
      const [p] = await db.select().from(schema.people).where(eq(schema.people.id, r.personId!));
      expect(p.linkedinUrl).toBe('https://www.linkedin.com/in/contact-person-1');
    });

    it('invalid contacts are dropped with warnings, never stored; the person is still ingested', async () => {
      const co = await newCompany();
      const r = await one(rec({ businessSlug: co.slug, personName: 'Bad Contacts', email: 'not-an-email', phone: '12345', mobile: '0000000000', linkedinUrl: 'https://linkedin.com/company/acme' }));
      expect(r.outcome).toBe('CREATED');
      expect(await contactsOf(r.personId!)).toHaveLength(0);
      expect(r.warnings!.map((w) => w.code)).toEqual(expect.arrayContaining(['INVALID_EMAIL', 'INVALID_PHONE', 'INVALID_LINKEDIN']));
      const [p] = await db.select().from(schema.people).where(eq(schema.people.id, r.personId!));
      expect(p.linkedinUrl).toBeNull();
    });

    it('shared mailboxes are not attached to people', async () => {
      const co = await newCompany();
      const r = await one(rec({ businessSlug: co.slug, personName: 'Mailbox Person', email: 'info@corp.co.in' }));
      expect(await contactsOf(r.personId!)).toHaveLength(0);
    });

    it('duplicate contacts collapse; case and formatting differences do not create rows', async () => {
      const co = await newCompany();
      const r = await one(rec({ businessSlug: co.slug, personName: 'Dup Contact', email: 'dup@corp.co.in', mobile: '98765 43211' }));
      await one(rec({ businessSlug: co.slug, personName: 'Dup Contact', email: 'DUP@Corp.co.in', mobile: '+91-98765-43211' }));
      expect(await contactsOf(r.personId!)).toHaveLength(2);
    });

    it('a changed contact adds the new value, keeps the old, and moves the primary flag', async () => {
      const co = await newCompany();
      const r = await one(rec({ businessSlug: co.slug, personName: 'Mover Person', email: 'old@corp.co.in' }));
      await one(rec({ businessSlug: co.slug, personName: 'Mover Person', email: 'new@corp.co.in' }));
      const cs = await contactsOf(r.personId!);
      expect(cs.map((c) => c.normalizedValue).sort()).toEqual(['new@corp.co.in', 'old@corp.co.in']);
      expect(cs.filter((c) => c.isPrimary).map((c) => c.normalizedValue)).toEqual(['new@corp.co.in']);
    });

    it('never fabricates a contact from a name or company', async () => {
      const co = await newCompany();
      const r = await one(rec({ businessSlug: co.slug, personName: 'No Contact Person' }));
      expect(await contactsOf(r.personId!)).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------- evidence
  describe('evidence', () => {
    const evidenceOf = (personId: string) => db.select().from(schema.peopleEvidence).where(eq(schema.peopleEvidence.personId, personId));

    it('records role, identity and contact claims, all unverified, with provenance', async () => {
      const co = await newCompany();
      const r = await one(rec({
        businessSlug: co.slug, personName: 'Evidence Person', email: 'ev@corp.co.in', linkedinUrl: 'linkedin.com/in/evidence-p',
        source: { type: 'WEB_SCRAPING', url: 'https://corp.example/team', reference: 'crawl-42', observedAt: '2026-05-01T00:00:00Z' },
      }));
      const ev = await evidenceOf(r.personId!);
      expect(ev.map((e) => e.evidenceType).sort()).toEqual(['CONTACT_CLAIM', 'IDENTITY_CLAIM', 'ROLE_CLAIM']);
      expect(ev.every((e) => e.verifiedAt === null && e.sourceType === 'WEB_SCRAPING' && e.sourceUrl === 'https://corp.example/team')).toBe(true);
      expect(ev.every((e) => e.observedAt.toISOString() === '2026-05-01T00:00:00.000Z')).toBe(true);
    });

    it('attaches evidence to the correct role, contact and person', async () => {
      const li = 'linkedin.com/in/two-roles-1';
      const a = await one(rec({ personName: 'Two Roles', jobTitle: 'CEO', linkedinUrl: li, email: 'tr@acme.co.in' }));
      const b = await one(rec({ businessSlug: 'beta-foods', personName: 'Two Roles', jobTitle: 'Director', linkedinUrl: li, source: { type: 'PARTNER_FEED', reference: 'p1' } }));
      const ev = await evidenceOf(a.personId!);
      const roleEv = (roleId: string) => ev.filter((e) => e.companyPersonId === roleId);
      expect(roleEv(a.companyPersonId!).map((e) => e.sourceType)).toEqual(['MANUAL_IMPORT']);
      expect(roleEv(b.companyPersonId!).map((e) => e.sourceType)).toEqual(['PARTNER_FEED']);
      const contactEv = ev.filter((e) => e.contactId);
      expect(contactEv).toHaveLength(1);
      const [contact] = await db.select().from(schema.personContacts).where(eq(schema.personContacts.id, contactEv[0].contactId!));
      expect(contact.normalizedValue).toBe('tr@acme.co.in');
      // one identity claim per source that asserted the person (two sources -> two rows, no role attached)
      const identity = ev.filter((e) => e.companyPersonId === null && e.contactId === null);
      expect(identity.map((e) => `${e.evidenceType}:${e.sourceType}`).sort()).toEqual(['IDENTITY_CLAIM:MANUAL_IMPORT', 'IDENTITY_CLAIM:PARTNER_FEED']);
    });

    it('merges evidence from a second source without losing the first', async () => {
      const co = await newCompany();
      const a = await one(rec({ businessSlug: co.slug, personName: 'Merge Evidence', source: { type: 'MANUAL_IMPORT', reference: 'sheet-A' } }));
      await one(rec({ businessSlug: co.slug, personName: 'Merge Evidence', source: { type: 'MANUAL_IMPORT', reference: 'sheet-B' } }));
      await one(rec({ businessSlug: co.slug, personName: 'Merge Evidence', source: { type: 'PARTNER_FEED', reference: 'sheet-A' } }));
      const refs = (await evidenceOf(a.personId!)).map((e) => `${e.sourceType}:${e.sourceReference}`).sort();
      expect(refs).toEqual(['MANUAL_IMPORT:sheet-A', 'MANUAL_IMPORT:sheet-B', 'PARTNER_FEED:sheet-A']);
    });

    it('re-observing a source updates it (later observation / verification) instead of duplicating', async () => {
      const co = await newCompany();
      const src = { type: 'WEB_SCRAPING', url: 'https://corp.example/leadership', evidenceType: 'COMPANY_WEBSITE' };
      const a = await one(rec({ businessSlug: co.slug, personName: 'Reobserved Person', source: { ...src, observedAt: '2026-01-01' } }));
      const r = await one(rec({ businessSlug: co.slug, personName: 'Reobserved Person', source: { ...src, observedAt: '2026-06-01' } }));
      expect(r.outcome).toBe('UPDATED');
      const ev = await evidenceOf(a.personId!);
      expect(ev).toHaveLength(1);
      expect(ev[0].observedAt.toISOString().slice(0, 10)).toBe('2026-06-01');
      await one(rec({ businessSlug: co.slug, personName: 'Reobserved Person', source: { ...src, observedAt: '2026-02-01' } })); // older: ignored
      expect((await evidenceOf(a.personId!))[0].observedAt.toISOString().slice(0, 10)).toBe('2026-06-01');
    });

    it('a genuine verification is recorded as evidence and lifts the role', async () => {
      const co = await newCompany();
      const r = await one(rec({
        businessSlug: co.slug, personName: 'Verified Person', confidenceScore: 85,
        verification: { status: 'VERIFIED', verifiedAt: daysAgo(10), verifiedBy: 'reviewer@orion.test' },
      }));
      const [role] = await rolesOf(r.personId!);
      expect(role).toMatchObject({ verificationStatus: 'VERIFIED', confidenceScore: 85 });
      expect(role.lastVerifiedAt).not.toBeNull();
      const ev = await evidenceOf(r.personId!);
      const v = ev.find((e) => e.evidenceType === 'MANUAL_VERIFICATION')!;
      expect(v.verifiedAt).not.toBeNull();
      expect(v.sourceReference).toBe('verified-by:reviewer@orion.test');
      expect(v.companyPersonId).toBe(role.id);
    });

    it('a verification claim without the verifier is quarantined, not trusted', async () => {
      const r = await one(rec({ personName: 'Unbacked Claim', verification: { status: 'VERIFIED', verifiedAt: daysAgo(1) } }));
      expect(r.outcome).toBe('QUARANTINED');
      expect(r.reasons![0].code).toBe('INVALID_VERIFICATION');
      expect(await personByName('unbacked claim')).toHaveLength(0);
    });

    it('a weaker re-import never downgrades verification, confidence or verification date', async () => {
      const co = await newCompany();
      const v = { status: 'VERIFIED', verifiedAt: daysAgo(30), verifiedBy: 'rev' };
      const a = await one(rec({ businessSlug: co.slug, personName: 'Strong Record', confidenceScore: 90, verification: v }));
      const [before] = await rolesOf(a.personId!);
      await one(rec({ businessSlug: co.slug, personName: 'Strong Record', confidenceScore: 10, verification: { status: 'UNVERIFIED' } }));
      await one(rec({ businessSlug: co.slug, personName: 'Strong Record' }));
      const [after] = await rolesOf(a.personId!);
      expect(after).toMatchObject({ verificationStatus: 'VERIFIED', confidenceScore: 90 });
      expect(after.lastVerifiedAt!.getTime()).toBe(before.lastVerifiedAt!.getTime());
    });

    it('an explicit CONFLICTED report does downgrade', async () => {
      const co = await newCompany();
      const a = await one(rec({ businessSlug: co.slug, personName: 'Disputed Person', verification: { status: 'VERIFIED', verifiedAt: daysAgo(3), verifiedBy: 'rev' } }));
      await one(rec({ businessSlug: co.slug, personName: 'Disputed Person', verification: { status: 'CONFLICTED' } }));
      expect((await rolesOf(a.personId!))[0].verificationStatus).toBe('CONFLICTED');
    });

    it('stale verification is not falsely trusted by the customer-facing policy', async () => {
      const co = await newCompany();
      const a = await one(rec({ businessSlug: co.slug, personName: 'Stale Person', verification: { status: 'VERIFIED', verifiedAt: daysAgo(500), verifiedBy: 'rev' }, confidenceScore: 95 }));
      await publishing.publishRole(a.companyPersonId!, 'rev');
      const res = await people.listCompanyPeople(co.slug, '00000000-0000-0000-0000-000000000001', {} as any);
      const card = res.people.find((p) => p.fullName === 'Stale Person')!;
      expect(card.verification.status).toBe('STALE');
      expect(card.verification.assertion).toBe('UNVERIFIED');
      expect(card.verification.confidence.level).not.toBe('HIGH');
    });

    it('rejects a claimed VERIFIED that reaches the write service without evidence', async () => {
      const co = await newCompany();
      const r = await write.upsertPersonForBusiness({
        businessId: co.id, person: { fullName: 'Direct Caller' }, role: { jobTitle: 'CEO' }, verificationStatus: 'VERIFIED',
      });
      expect(r.storedVerificationStatus).toBe('UNVERIFIED');
      expect(r.warnings).toContain('VERIFICATION_CLAIM_WITHOUT_EVIDENCE');
    });
  });

  // ---------------------------------------------------------------- idempotency
  describe('idempotency', () => {
    const batch = (slug: string): IRawPersonRecord[] => [
      rec({ businessSlug: slug, personName: 'Idem One', jobTitle: 'CEO', email: 'one@idem.co.in', mobile: '98765 00001', linkedinUrl: 'linkedin.com/in/idem-one', source: { type: 'WEB_SCRAPING', url: 'https://idem.example/team', observedAt: '2026-04-01' } }),
      rec({ businessSlug: slug, personName: 'Mr. Idem Two - CFO', jobTitle: undefined, phone: '0422 255 0199', source: { type: 'MANUAL_IMPORT', reference: 'idem-sheet' } }),
      rec({ businessSlug: slug, personName: 'IDEM THREE', jobTitle: 'Head of Sales', verification: { status: 'PARTIALLY_VERIFIED', verifiedAt: '2026-03-01', verifiedBy: 'rev' }, confidenceScore: 60, source: { type: 'PARTNER_FEED' } }),
    ];

    it('running the same ingestion twice creates nothing new and reports UNCHANGED', async () => {
      const co = await newCompany();
      const first = await ingest.ingest(batch(co.slug));
      expect(first).toMatchObject({ created: 3, updated: 0, unchanged: 0, quarantined: 0 });
      const after1 = await snapshotCounts();

      const second = await ingest.ingest(batch(co.slug));
      expect(second).toMatchObject({ created: 0, updated: 0, unchanged: 3, quarantined: 0 });
      expect(await snapshotCounts()).toEqual(after1);
      expect(second.results.map((r) => r.personId)).toEqual(first.results.map((r) => r.personId));

      const third = await ingest.ingest(batch(co.slug));
      expect(third.unchanged).toBe(3);
      expect(await snapshotCounts()).toEqual(after1);
    });

    it('is idempotent for CSV input too', async () => {
      const co = await newCompany();
      const csv = [
        'company_slug,full_name,designation,email,mobile,source_type,source_reference',
        `${co.slug},Csv Person One,Director,csv1@idem.co.in,98765 11111,MANUAL_IMPORT,file-1`,
        `${co.slug},"Csv Person, Two",Partner,,,MANUAL_IMPORT,file-1`,
      ].join('\n');
      await ingest.ingestFromSource(new CsvPeopleSource('people.csv', csv));
      const c1 = await snapshotCounts();
      const rerun = await ingest.ingestFromSource(new CsvPeopleSource('people.csv', csv));
      expect(rerun.unchanged).toBe(2);
      expect(await snapshotCounts()).toEqual(c1);
    });

    it('concurrent identical runs do not create duplicates', async () => {
      const co = await newCompany();
      await Promise.allSettled([1, 2, 3].map(() => ingest.ingest(batch(co.slug))));
      expect(await personByName('idem one')).toHaveLength(1);
      const roles = await db.select().from(schema.companyPeople).where(eq(schema.companyPeople.businessId, co.id));
      expect(roles).toHaveLength(3);
    });

    it('the database itself refuses duplicate roles, contacts and evidence', async () => {
      const co = await newCompany();
      const r = await one(rec({ businessSlug: co.slug, personName: 'Constraint Person', email: 'cp@idem.co.in' }));
      const [role] = await rolesOf(r.personId!);
      await expect(db.insert(schema.companyPeople).values({ businessId: co.id, personId: r.personId!, jobTitleAtCompany: 'CEO', normalizedJobTitle: role.normalizedJobTitle })).rejects.toBeDefined();
      await expect(db.insert(schema.personContacts).values({ personId: r.personId!, contactType: 'WORK_EMAIL', contactValue: 'cp@idem.co.in', normalizedValue: 'cp@idem.co.in' })).rejects.toBeDefined();
      const [ev] = await db.select().from(schema.peopleEvidence).where(eq(schema.peopleEvidence.personId, r.personId!));
      await expect(db.insert(schema.peopleEvidence).values({ personId: r.personId!, fingerprint: ev.fingerprint, sourceType: 'MANUAL_IMPORT', evidenceType: 'X' })).rejects.toBeDefined();
    });
  });

  // ---------------------------------------------------------------- quarantine / dry run / sources
  describe('bad data, dry runs and sources', () => {
    it('quarantines invalid records with reasons instead of inserting them', async () => {
      const before = await snapshotCounts();
      const report = await ingest.ingest([
        { businessSlug: 'acme', jobTitle: 'CEO', source: SRC }, // no name
        rec({ personName: 'No Source', source: undefined }),
        rec({ personName: 'Bad Source', source: { type: 'MANUAL_IMPORT', url: 'javascript:alert(1)' } }),
        rec({ personName: 'Mono' }),
        rec({ personName: 'Good Record Person', jobTitle: 'Owner' }),
      ], { batchRef: 'batch-bad' });
      expect(report).toMatchObject({ total: 5, created: 1, quarantined: 4 });
      const rows = await db.select().from(schema.peopleIngestionQuarantine).where(eq(schema.peopleIngestionQuarantine.batchRef, 'batch-bad'));
      expect(rows).toHaveLength(4);
      expect(rows.every((r) => r.status === 'PENDING' && Array.isArray(r.reasons) && (r.reasons as any[]).length > 0)).toBe(true);
      expect((await snapshotCounts()).people).toBe(before.people + 1);
      expect(await personByName('bad source')).toHaveLength(0);
    });

    it('re-running the same bad file does not multiply quarantine rows', async () => {
      const bad = [rec({ personName: 'Mono2' })];
      await ingest.ingest(bad, { batchRef: 'q1' });
      const n = (await snapshotCounts()).quarantine;
      await ingest.ingest(bad, { batchRef: 'q2' });
      expect((await snapshotCounts()).quarantine).toBe(n);
    });

    it('a quarantined record is marked RESOLVED once it ingests cleanly', async () => {
      const raw = rec({ businessSlug: 'arrives-later', personName: 'Late Company Person' });
      expect((await one(raw)).outcome).toBe('QUARANTINED');
      const b = await seedBusiness(db, 'arrives-later');
      expect(b.id).toBeDefined();
      expect((await one(raw)).outcome).toBe('CREATED');
      const rows = await db.select().from(schema.peopleIngestionQuarantine);
      const mine = rows.filter((r) => (r.raw as any).personName === 'Late Company Person');
      expect(mine).toHaveLength(1);
      expect(mine[0].status).toBe('RESOLVED');
    });

    it('dry run validates and resolves but writes nothing', async () => {
      const before = await snapshotCounts();
      const report = await ingest.ingest([rec({ personName: 'Dry Run Person' }), rec({ personName: 'X' })], { dryRun: true });
      expect(report).toMatchObject({ dryRun: true, valid: 1, quarantined: 1, created: 0 });
      expect(await snapshotCounts()).toEqual(before);
    });

    it('accepts JSON sources and labels them', async () => {
      const report = await ingest.ingestFromSource(new JsonPeopleSource('provider-x', [rec({ personName: 'Json Person One' }), rec({ personName: 'Json Person Two', jobTitle: 'CFO' })]));
      expect(report.created).toBe(2);
    });

    it('one bad record never blocks the rest of the batch', async () => {
      const report = await ingest.ingest([rec({ personName: 'Batch A One' }), { nonsense: true } as any, rec({ personName: 'Batch C Three' })]);
      expect(report.results.map((r) => r.outcome)).toEqual(['CREATED', 'QUARANTINED', 'CREATED']);
    });
  });

  // ---------------------------------------------------------------- customer visibility / lifecycle
  describe('DRAFT -> PUBLISHED lifecycle and customer visibility', () => {
    const viewer = '00000000-0000-0000-0000-0000000000aa';
    const visibleNames = async (slug: string) => (await people.listCompanyPeople(slug, viewer, { status: 'all' } as any)).people.map((p) => p.fullName);

    it('ingested people are invisible to customers (list and detail)', async () => {
      const co = await newCompany();
      const r = await one(rec({ businessSlug: co.slug, personName: 'Hidden Draft', email: 'hd@corp.co.in' }));
      expect(await visibleNames(co.slug)).toEqual([]);
      await expect(people.getPersonDetail(r.personId!, viewer)).rejects.toMatchObject({ errorCode: 'PERSON_NOT_FOUND' });
    });

    it('marking only the person published does not expose an unreviewed role', async () => {
      const co = await newCompany();
      const r = await one(rec({ businessSlug: co.slug, personName: 'Half Published' }));
      await write.setDataStatus(r.personId!, 'PUBLISHED');
      expect(await visibleNames(co.slug)).toEqual([]);
    });

    it('a NEW role for an already-published person stays hidden until reviewed', async () => {
      const li = 'linkedin.com/in/leak-check-1';
      const coA = await newCompany();
      const coB = await newCompany();
      const a = await one(rec({ businessSlug: coA.slug, personName: 'Leak Check', linkedinUrl: li }));
      await publishing.publishRole(a.companyPersonId!, 'rev');
      expect(await visibleNames(coA.slug)).toEqual(['Leak Check']);

      const b = await one(rec({ businessSlug: coB.slug, personName: 'Leak Check', jobTitle: 'Director', linkedinUrl: li }));
      expect(b.personId).toBe(a.personId);
      expect(await visibleNames(coB.slug)).toEqual([]);
      const detail = await people.getPersonDetail(a.personId!, viewer);
      expect(detail.roles.map((x) => x.businessId)).toEqual([coA.id]);
    });

    it('re-ingesting never unpublishes or republishes anything', async () => {
      const co = await newCompany();
      const a = await one(rec({ businessSlug: co.slug, personName: 'Stable Publish' }));
      await publishing.publishRole(a.companyPersonId!, 'rev');
      const r = await one(rec({ businessSlug: co.slug, personName: 'Stable Publish' }));
      expect(r.outcome).toBe('UNCHANGED');
      expect(await visibleNames(co.slug)).toEqual(['Stable Publish']);
    });

    it('unpublished contacts are never returned, even for a published person; publishing needs evidence', async () => {
      const co = await newCompany();
      const r = await one(rec({ businessSlug: co.slug, personName: 'Private Contacts', email: 'pc@corp.co.in', mobile: '98765 22222' }));
      await publishing.publishRole(r.companyPersonId!, 'rev');
      const detail = await people.getPersonDetail(r.personId!, viewer);
      expect(detail.contacts.email).toMatchObject({ available: false, value: null });
      expect(detail.contacts.mobile).toMatchObject({ available: false, value: null });
      expect(JSON.stringify(detail)).not.toMatch(/pc@corp|98765 ?22222|919876522222/);

      const [email] = await db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, r.personId!)).then((cs) => cs.filter((c) => c.contactType === 'WORK_EMAIL'));
      await publishing.publishContact(email.id, 'rev');
      const after = await people.getPersonDetail(r.personId!, viewer);
      expect(after.contacts.email).toMatchObject({ available: true, value: null }); // exists, but locked until unlocked
      expect(after.contacts.mobile.available).toBe(false); // still unpublished
      expect(JSON.stringify(after)).not.toContain('pc@corp.co.in');
    });

    it('publishing without evidence is refused', async () => {
      const co = await newCompany();
      const bare = await write.upsertPersonForBusiness({ businessId: co.id, person: { fullName: 'No Evidence' }, role: { jobTitle: 'CEO' } });
      await expect(publishing.publishRole(bare.companyPersonId, 'rev')).rejects.toMatchObject({ errorCode: 'EVIDENCE_REQUIRED' });
      const withContact = await write.upsertPersonForBusiness({ businessId: co.id, person: { fullName: 'No Contact Evidence' }, role: { jobTitle: 'CEO' }, contacts: [{ type: 'WORK_EMAIL', value: 'nce@corp.co.in' }] });
      const [c] = await db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, withContact.personId));
      await expect(publishing.publishContact(c.id, 'rev')).rejects.toMatchObject({ errorCode: 'EVIDENCE_REQUIRED' });
    });

    it('unpublish and suppress take effect immediately; suppression clears every published role', async () => {
      const co = await newCompany();
      const a = await one(rec({ businessSlug: co.slug, personName: 'Take Down' }));
      await publishing.publishRole(a.companyPersonId!, 'rev');
      await publishing.unpublishRole(a.companyPersonId!, 'rev');
      expect(await visibleNames(co.slug)).toEqual([]);
      await publishing.publishRole(a.companyPersonId!, 'rev');
      await publishing.suppressPerson(a.personId!, 'rev');
      expect(await visibleNames(co.slug)).toEqual([]);
      expect((await rolesOf(a.personId!))[0].isPublished).toBe(false);
      await expect(publishing.publishRole(a.companyPersonId!, 'rev')).rejects.toMatchObject({ errorCode: 'PERSON_SUPPRESSED' });
    });

    it('people at unpublished companies stay hidden even when fully published', async () => {
      const a = await one(rec({ businessSlug: 'draft-co', personName: 'Draft Company Person' }));
      await publishing.publishRole(a.companyPersonId!, 'rev');
      await expect(people.listCompanyPeople('draft-co', viewer, {} as any)).rejects.toMatchObject({ errorCode: 'BUSINESS_NOT_FOUND' });
    });
  });

  // ---------------------------------------------------------------- isolation & contracts
  describe('isolation and the Phase 3 contract', () => {
    const SRC_DIR = path.resolve(__dirname, '../../..');
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === '__tests__' ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]));
    const files = walk(SRC_DIR).filter((f) => f.endsWith('.ts'));

    it('ingestion is not reachable from any HTTP controller', () => {
      const offenders = files.filter((f) => /\.controller\.ts$/.test(f) && !/people-review\.controller\.ts$/.test(f)).filter((f) => /PeopleIngestion|PeopleWriteService|PEOPLE_INGESTION|PeoplePublishing/.test(fs.readFileSync(f, 'utf8')));
      expect(offenders).toEqual([]);
    });

    it('the people controller exposes only customer read/unlock/export routes', () => {
      const proto = PeopleController.prototype as any;
      const routes = Object.getOwnPropertyNames(proto)
        .filter((n) => n !== 'constructor')
        .map((n) => [Reflect.getMetadata('method', proto[n]), Reflect.getMetadata('path', proto[n])]);
      const flat = JSON.stringify(routes).toLowerCase();
      expect(flat).not.toMatch(/ingest|import|publish|quarantine|suppress/);
      // POST routes are exactly unlock and export
      expect(routes.filter(([m]) => m === 1).map(([, p]) => p).sort()).toEqual(['people/:personId/unlock', 'people/export']);
    });

    it('the import pipeline reaches the people layer only through the bridge, by DI token, never its tables or writers', () => {
      const importFiles = files.filter((f) => f.includes(`${path.sep}modules${path.sep}import${path.sep}`));
      expect(importFiles.length).toBeGreaterThan(5);
      const offenders = importFiles.filter((f) =>
        /PeopleWriteService|(?<!I)PeopleIngestionService|PeoplePublishingService|company_people|companyPeople|schema\.people/.test(fs.readFileSync(f, 'utf8')),
      );
      expect(offenders).toEqual([]);
    });

    it('exposes the ingestion port and service through DI tokens for Phase 3', async () => {
      const module = await Test.createTestingModule({
        providers: [
          { provide: DRIZZLE_DATABASE, useValue: db },
          PeopleWriteService,
          PeopleIngestionService,
          { provide: PEOPLE_INGESTION_PORT, useExisting: PeopleWriteService },
          { provide: PEOPLE_INGESTION_SERVICE, useExisting: PeopleIngestionService },
        ],
      }).compile();
      const port = module.get<IPeopleIngestionPort>(PEOPLE_INGESTION_PORT);
      const service = module.get<IPeopleIngestionService>(PEOPLE_INGESTION_SERVICE);

      const viaPort = await port.upsertPersonForBusiness({ businessId: acme.id, person: { fullName: 'Port Person' }, role: { jobTitle: 'CEO' } });
      expect(viaPort.personCreated).toBe(true);
      const viaService = await service.ingest([rec({ personName: 'Service Person' })]);
      expect(viaService.created).toBe(1);
      const [p] = await personByName('port person');
      expect(p.dataStatus).toBe('DRAFT');
    });
  });

  // ---------------------------------------------------------------- migration
  describe('migration 0005', () => {
    it('applies cleanly and is idempotent', async () => {
      const t = await createTestDb();
      await expect(t.client.exec(readMigration('0005_people_ingestion.sql'))).resolves.toBeDefined();
      await t.client.close();
    });

    it('backfills is_published exactly once, keeping phase 1 rows visible and not undoing later unpublishing', async () => {
      const upTo0004 = JOURNALED_MIGRATIONS.filter((f) => f < '0005');
      const t = await createTestDb(upTo0004);
      await t.client.exec(`
        INSERT INTO businesses (id, slug, name, status) VALUES ('11111111-1111-1111-1111-111111111111','m','M','PUBLISHED');
        INSERT INTO people (id, full_name, normalized_name, data_status) VALUES ('22222222-2222-2222-2222-222222222222','A B','a b','PUBLISHED');
        INSERT INTO company_people (id, business_id, person_id, job_title_at_company, normalized_job_title)
          VALUES ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','CEO','ceo');
      `);
      await t.client.exec(readMigration('0005_people_ingestion.sql'));
      const q = () => t.client.query<{ is_published: boolean }>('SELECT is_published FROM company_people');
      expect((await q()).rows[0].is_published).toBe(true);
      await t.client.exec('UPDATE company_people SET is_published = false');
      await t.client.exec(readMigration('0005_people_ingestion.sql'));
      expect((await q()).rows[0].is_published).toBe(false);
      await t.client.close();
    });

    it('does not touch the company upload tables', async () => {
      const sqlText = readMigration('0005_people_ingestion.sql') + readMigration('0004_decision_maker_people.sql');
      const touched = [...sqlText.matchAll(/(?:ALTER TABLE|CREATE TABLE(?: IF NOT EXISTS)?|(?<!ON )UPDATE)\s+"?(\w+)"?/g)].map((m) => m[1]);
      const allowed = new Set(['people', 'company_people', 'person_contacts', 'people_evidence', 'person_unlocks', 'people_ingestion_quarantine', 'saved_leads']);
      expect(touched.filter((t) => !allowed.has(t))).toEqual([]);
    });
  });

  it('draws the quarantine/people tables in the same schema the app uses', async () => {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.peopleIngestionQuarantine).where(and(eq(schema.peopleIngestionQuarantine.status, 'PENDING')));
    expect(n).toBeGreaterThan(0);
  });
});

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { UserRole } from '@orion/shared';
import { and, eq, sql } from 'drizzle-orm';
import * as jwt from 'jsonwebtoken';
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
import { SourceRegistryService } from '../sources/source-registry.service';
import { PeopleController } from '../people.controller';
import { contactAttributionStatus, contactsForAnyCompany, contactsForCompany, isContactEligibleForCompany, loadContactAttribution, type IContactAttribution } from '../people-contact-attribution';
import { PeopleExportService } from '../people-export.service';
import { PeoplePublishingService } from '../people-publishing.service';
import { PeopleSearchService } from '../people-search.service';
import { PeopleUnlockService } from '../people-unlock.service';
import { PeopleWriteService } from '../people-write.service';
import { PeopleService } from '../people.service';
import { expectLedgerConsistent } from './ledger-invariants';
import { createTestDb, seedBusiness, seedUser } from './pglite-test-db';

/** The pure selection rule (Phase 10B): which of a person's contacts may be shown at which company. */
describe('contact attribution rule (unit)', () => {
  const contact = (id: string, personId = 'p1') => ({ id, personId });
  const attribution = (claims: Record<string, string[]>, companies: Record<string, number>): IContactAttribution => ({
    businessesByContact: new Map(Object.entries(claims).map(([k, v]) => [k, new Set(v)])),
    companyCount: new Map(Object.entries(companies)),
  });
  const a = attribution({ onlyM: ['M'], onlyK: ['K'], both: ['M', 'K'] }, { p1: 3, solo: 1 });
  const all = [contact('onlyM'), contact('onlyK'), contact('both'), contact('manual')];

  it('a contact attributed to a company is eligible there and nowhere else; a shared one is eligible at each reporting company', () => {
    expect(contactsForCompany(all, 'M', a).map((c) => c.id)).toEqual(['onlyM', 'both']);
    expect(contactsForCompany(all, 'K', a).map((c) => c.id)).toEqual(['onlyK', 'both']);
  });

  it('no fallback: a third company that reported nothing gets nothing, and an unattributed contact is not guessed into any company', () => {
    expect(contactsForCompany(all, 'L', a)).toEqual([]);
    expect(isContactEligibleForCompany(contact('manual'), 'M', a)).toBe(false);
    expect(isContactEligibleForCompany(contact('manual'), 'K', a)).toBe(false);
  });

  it('an unattributed contact of a one-company person cannot belong to anyone else, so it stays visible there (and only there)', () => {
    expect(isContactEligibleForCompany(contact('manual', 'solo'), 'M', a)).toBe(true);
    expect(isContactEligibleForCompany(contact('unknownPerson', 'ghost'), 'M', a)).toBe(true); // no relationships recorded at all
  });

  it('the person-level view is the union over the visible companies only', () => {
    expect(contactsForAnyCompany(all, ['M'], a).map((c) => c.id)).toEqual(['onlyM', 'both']);
    expect(contactsForAnyCompany(all, ['M', 'K'], a).map((c) => c.id)).toEqual(['onlyM', 'onlyK', 'both']);
    expect(contactsForAnyCompany(all, [], a)).toEqual([]);
  });
});

const SECRET = 'attribution-test-secret';
class TestJwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: SECRET });
  }
  validate(payload: unknown) {
    return payload;
  }
}

/**
 * Multi-company contact attribution on every customer surface (Phase 10B), on real imports (observation claims written by the
 * ingestion path) plus a reviewer-added contact that has no observation. Values are searched for in the raw response bodies.
 */
describe('multi-company contact attribution on customer surfaces (Phase 10B)', () => {
  let app: INestApplication;
  let db: DrizzleDb;
  let closeDb: () => Promise<void>;
  let ingest: PeopleIngestionService;
  let publishing: PeoplePublishingService;
  let searchSvc: PeopleSearchService;
  let user: { id: string; token: string };
  let other: { id: string; token: string };
  let meridian: { id: string; slug: string };
  let kaveri: { id: string; slug: string };
  let lotus: { id: string; slug: string };
  let solo: { id: string; slug: string };
  let personId: string;
  let soloPersonId: string;

  const V = {
    mEmail: 'rohan.m@meridian-synth.example',
    kEmail: 'rohan.k@kaveri-synth.example',
    sharedEmail: 'rohan.shared@group-synth.example',
    mPhone: '+914225550101',
    kMobile: '+919876500011',
    manualPhone: '0422 555 0999',
    linkedin: 'https://www.linkedin.com/in/rohan-synth-10b',
    soloManualEmail: 'solo.manual@solo-synth.example',
  };
  const digits = (s: string) => s.replace(/\D/g, '');
  const ctx = { reviewedBy: 'reviewer@orion.test', note: 'attribution test' };
  const tokenFor = (id: string) => jwt.sign({ sub: id, email: `${id}@t.dev`, role: UserRole.USER }, SECRET);
  const GET = (url: string, t: string) => request(app.getHttpServer()).get(url).set('Authorization', `Bearer ${t}`);
  const POST = (url: string, t: string, body: object = {}) => request(app.getHttpServer()).post(url).set('Authorization', `Bearer ${t}`).send(body);
  const rec = (co: { id: string }, name: string, recordId: string, over: Record<string, unknown> = {}): IRawPersonRecord =>
    ({
      businessId: co.id,
      personName: name,
      jobTitle: 'Managing Director',
      source: { type: 'GOVERNMENT_REGISTRY', reference: `ref-${recordId}`, recordId, evidenceType: 'ROLE_CLAIM' },
      ...over,
    }) as IRawPersonRecord;
  const run = async (records: IRawPersonRecord[]) => (await ingest.ingest(records, { sourceKey: 'attr-feed', batchRef: `attr-${Math.random().toString(36).slice(2, 8)}` })).results;
  const card = async (co: { id: string }, t = user.token, name = 'Rohan Synth') => {
    const res = await GET(`/companies/${co.id}/people?status=all`, t).expect(200);
    return res.body.data.people.find((p: any) => p.fullName === name);
  };
  const contactOf = async (pid: string, value: string) => (await db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, pid))).find((c) => c.contactValue === value || c.normalizedValue === value.toLowerCase() || c.normalizedValue === digits(value))!;

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
    await registry.register({ key: 'attr-feed', displayName: 'attr-feed', sourceType: 'PARTNER_FEED', termsAcknowledged: true, enabled: true, policy: { permissions: { identity: true, title: true, email: true, phone: true, linkedin: true, evidence: true }, allowedEvidenceTypes: ['ROLE_CLAIM', 'IDENTITY_CLAIM', 'CONTACT_CLAIM'], maxAttestation: 'NONE' } } as any);
    ingest = new PeopleIngestionService(db, module.get(PeopleWriteService), registry, new ObservationService(db));
    publishing = module.get(PeoplePublishingService);
    searchSvc = module.get(PeopleSearchService);

    const a = await seedUser(db, 'attr.one@orion.test', { daily: 20, purchased: 20 });
    const b = await seedUser(db, 'attr.two@orion.test', { daily: 20, purchased: 20 });
    user = { id: a.id, token: tokenFor(a.id) };
    other = { id: b.id, token: tokenFor(b.id) };
    meridian = await seedBusiness(db, 'meridian-synth');
    kaveri = await seedBusiness(db, 'kaveri-synth');
    lotus = await seedBusiness(db, 'lotus-synth');
    solo = await seedBusiness(db, 'solo-synth');

    // One person, three companies, one LinkedIn. Meridian reported its own email + phone, Kaveri its own email + mobile, both reported a shared
    // email, Lotus reported no contact at all.
    const results = await run([
      rec(meridian, 'Rohan Synth', 'rel-m', { email: V.mEmail, phone: V.mPhone, linkedinUrl: V.linkedin }),
      rec(kaveri, 'Rohan Synth', 'rel-k', { email: V.kEmail, mobile: V.kMobile, linkedinUrl: V.linkedin }),
      rec(lotus, 'Rohan Synth', 'rel-l', { linkedinUrl: V.linkedin }),
    ]);
    // the shared email is reported by BOTH Meridian and Kaveri (a second observation for each role)
    await run([
      rec(meridian, 'Rohan Synth', 'rel-m', { email: V.sharedEmail, linkedinUrl: V.linkedin }),
      rec(kaveri, 'Rohan Synth', 'rel-k', { email: V.sharedEmail, linkedinUrl: V.linkedin }),
    ]);
    personId = results[0].personId!;
    expect(new Set(results.map((r) => r.personId)).size).toBe(1);
    for (const r of results) await publishing.publishRole(r.companyPersonId!, ctx);

    // a reviewer-added / manual PHONE with no observation and the highest rank on the person, plus ranks that would favour Kaveri's email
    await db.insert(schema.personContacts).values({ personId, contactType: 'PHONE', contactValue: V.manualPhone, normalizedValue: digits(V.manualPhone), isPrimary: true, isPublished: true, confidenceScore: 100 });
    for (const [value, primary, confidence] of [[V.kEmail, true, 95], [V.mEmail, false, 80], [V.sharedEmail, false, 50]] as const) {
      const c = await contactOf(personId, value);
      await db.update(schema.personContacts).set({ isPrimary: primary, confidenceScore: confidence }).where(eq(schema.personContacts.id, c.id));
    }
    for (const c of await db.select().from(schema.personContacts).where(and(eq(schema.personContacts.personId, personId), sql`${schema.personContacts.contactValue} <> ${V.manualPhone}`))) {
      await publishing.publishContact(c.id, ctx);
    }

    // a single-company person whose only contact was added by a reviewer (no observation)
    const s = (await run([rec(solo, 'Solo Synth', 'rel-solo', { linkedinUrl: 'https://www.linkedin.com/in/solo-synth-10b' })]))[0];
    soloPersonId = s.personId!;
    await publishing.publishRole(s.companyPersonId!, ctx);
    await db.insert(schema.personContacts).values({ personId: soloPersonId, contactType: 'WORK_EMAIL', contactValue: V.soloManualEmail, normalizedValue: V.soloManualEmail, isPrimary: true, isPublished: true, confidenceScore: 60 });
  }, 120_000);

  afterAll(async () => {
    await expectLedgerConsistent(db);
    await app?.close();
    await closeDb?.();
  });

  describe('what the data says (the proof that company -> role -> observation claim -> contact works)', () => {
    it('each contact is attributed to the company that reported it; the shared email to both; the manual phone to nobody', async () => {
      const rows = await db
        .select({ value: schema.personContacts.contactValue, businessId: schema.companyPeople.businessId })
        .from(schema.peopleObservationClaims)
        .innerJoin(schema.peopleObservations, eq(schema.peopleObservations.id, schema.peopleObservationClaims.observationId))
        .innerJoin(schema.companyPeople, eq(schema.companyPeople.id, schema.peopleObservations.companyPersonId))
        .innerJoin(schema.personContacts, eq(schema.personContacts.id, schema.peopleObservationClaims.contactId))
        .where(eq(schema.personContacts.personId, personId));
      const at = (value: string) => [...new Set(rows.filter((r) => r.value.toLowerCase() === value.toLowerCase()).map((r) => r.businessId))].sort();
      expect(at(V.mEmail)).toEqual([meridian.id]);
      expect(at(V.kEmail)).toEqual([kaveri.id]);
      expect(at(V.sharedEmail)).toEqual([kaveri.id, meridian.id].sort());
      expect(rows.some((r) => digits(r.value) === digits(V.manualPhone))).toBe(false);
    });
  });

  describe('company card', () => {
    it('before unlock: availability follows the company, and no value is in the body', async () => {
      const m = await card(meridian);
      const k = await card(kaveri);
      const l = await card(lotus);
      expect([m.contacts.email.available, m.contacts.phone.available, m.contacts.mobile.available]).toEqual([true, true, false]);
      expect([k.contacts.email.available, k.contacts.phone.available, k.contacts.mobile.available]).toEqual([true, false, true]);
      expect([l.contacts.email.available, l.contacts.phone.available, l.contacts.mobile.available]).toEqual([false, false, false]);
      for (const x of [m, k, l]) expect(x.contacts.email.value ?? x.contacts.phone.value ?? x.contacts.mobile.value).toBeNull();
    });

    it('unlock is per person, but each card reveals only its own company\'s contacts (Kaveri\'s global primary never shows at Meridian)', async () => {
      await POST(`/people/${personId}/unlock`, user.token).expect(200);
      const m = await card(meridian);
      const k = await card(kaveri);
      const l = await card(lotus);
      expect(m.contacts.email.value).toBe(V.mEmail); // primary + confidence rules apply WITHIN the company's own contacts (m 80 beats shared 50)
      expect(k.contacts.email.value).toBe(V.kEmail);
      expect(m.contacts.phone.value).toBe(V.mPhone); // the manual phone outranks it globally but is attributed to no company
      expect(k.contacts.phone.value).toBeNull();
      expect(m.contacts.mobile.value).toBeNull(); // Kaveri's mobile
      expect(k.contacts.mobile.value).toBe(V.kMobile);
      expect([l.contacts.email.value, l.contacts.phone.value, l.contacts.mobile.value]).toEqual([null, null, null]); // no fallback
      expect(m.contacts.linkedin.value).toBe(V.linkedin); // LinkedIn is person-level and unchanged
      expect(k.contacts.linkedin.value).toBe(V.linkedin);
      expect(l.contacts.linkedin.value).toBe(V.linkedin);
    });

    it('a contact reported by both companies is shown at each when it is the best that company has', async () => {
      const mc = await contactOf(personId, V.mEmail);
      const kc = await contactOf(personId, V.kEmail);
      await db.update(schema.personContacts).set({ isPublished: false }).where(eq(schema.personContacts.id, mc.id));
      await db.update(schema.personContacts).set({ isPublished: false }).where(eq(schema.personContacts.id, kc.id));
      try {
        expect((await card(meridian)).contacts.email.value).toBe(V.sharedEmail);
        expect((await card(kaveri)).contacts.email.value).toBe(V.sharedEmail);
        expect((await card(lotus)).contacts.email.value).toBeNull();
      } finally {
        await db.update(schema.personContacts).set({ isPublished: true }).where(eq(schema.personContacts.id, mc.id));
        await db.update(schema.personContacts).set({ isPublished: true }).where(eq(schema.personContacts.id, kc.id));
      }
    });

    it('another customer who has not unlocked still sees nothing, on every company', async () => {
      for (const co of [meridian, kaveri, lotus]) {
        const c = await card(co, other.token);
        expect([c.contacts.isUnlocked, c.contacts.email.value, c.contacts.phone.value, c.contacts.mobile.value, c.contacts.linkedin.value]).toEqual([false, null, null, null, null]);
      }
    });
  });

  describe('person detail, unlock response, unlocked list, export, discover', () => {
    const body = (o: unknown) => JSON.stringify(o);
    const rolesAt = (detail: any, co: { id: string }) => detail.roles.find((r: any) => r.businessId === co.id);

    it('person detail: every roles[] card is company-specific; the top-level contacts are the person-level view over the visible companies', async () => {
      const d = (await GET(`/people/${personId}`, user.token).expect(200)).body.data;
      expect(rolesAt(d, meridian).contacts.email.value).toBe(V.mEmail);
      expect(rolesAt(d, kaveri).contacts.email.value).toBe(V.kEmail);
      expect(rolesAt(d, lotus).contacts.email.available).toBe(false);
      // person-level (existing contract: the endpoint spans the whole person): the global best among contacts that SOME visible company reported
      expect(d.contacts.email.value).toBe(V.kEmail);
      expect(d.contacts.phone.value).toBe(V.mPhone); // the manual phone is unattributed: not part of any company's contacts, so not here either
    });

    it('an unattributed contact is not in ANY response of the person, even though it is published and ranked first', async () => {
      const detail = body((await GET(`/people/${personId}`, user.token).expect(200)).body);
      const unlockAgain = body((await POST(`/people/${personId}/unlock`, user.token).expect(200)).body);
      const unlocked = body((await GET('/people/unlocked', user.token).expect(200)).body);
      const exp = (await POST('/people/export', user.token, { personIds: [personId] }).expect(200)).text;
      for (const text of [detail, unlockAgain, unlocked, exp]) {
        expect(text).not.toContain(V.manualPhone);
        expect(text).not.toContain(digits(V.manualPhone));
      }
    });

    it('unlock response, unlocked list: company cards carry only their own contacts', async () => {
      const again = (await POST(`/people/${personId}/unlock`, user.token).expect(200)).body.data;
      expect(again.alreadyUnlocked).toBe(true);
      expect(rolesAt(again.person, meridian).contacts.mobile.value).toBeNull();
      expect(rolesAt(again.person, kaveri).contacts.phone.value).toBeNull();
      const list = (await GET('/people/unlocked', user.token).expect(200)).body.data;
      const entry = list.unlocked.find((u: any) => u.roles.some((r: any) => r.id === personId));
      const byCo = (co: { id: string }) => entry.roles.find((r: any) => r.businessId === co.id);
      expect(byCo(meridian).contacts.email.value).toBe(V.mEmail);
      expect(byCo(kaveri).contacts.email.value).toBe(V.kEmail);
      expect(byCo(lotus).contacts.email.value).toBeNull();
    });

    it('export: one row per company, each with only that company\'s contacts', async () => {
      const csv = (await POST('/people/export', user.token, { personIds: [personId] }).expect(200)).text;
      const rows = csv.split('\n').filter((l) => l.includes('Rohan Synth'));
      expect(rows).toHaveLength(3);
      const row = (slug: string) => rows.find((r) => r.includes(`${slug} Pvt Ltd`))!;
      expect(row('meridian-synth')).toContain(V.mEmail);
      expect(row('meridian-synth')).toContain(V.mPhone);
      expect(row('meridian-synth')).not.toContain(V.kEmail);
      expect(row('meridian-synth')).not.toContain(V.kMobile);
      expect(row('kaveri-synth')).toContain(V.kEmail);
      expect(row('kaveri-synth')).toContain(V.kMobile);
      expect(row('kaveri-synth')).not.toContain(V.mEmail);
      expect(row('kaveri-synth')).not.toContain(V.mPhone);
      for (const v of [V.mEmail, V.kEmail, V.sharedEmail, V.mPhone, V.kMobile]) expect(row('lotus-synth')).not.toContain(v);
    });

    it('no company-scoped surface other than the person-level detail ever mentions another company\'s exclusive value', async () => {
      const surfaces: Array<[string, { id: string }, string[]]> = [
        ['meridian', meridian, [V.kEmail, V.kMobile]],
        ['kaveri', kaveri, [V.mEmail, V.mPhone]],
        ['lotus', lotus, [V.mEmail, V.kEmail, V.mPhone, V.kMobile, V.sharedEmail]],
      ];
      for (const [, co, forbidden] of surfaces) {
        const text = body((await GET(`/companies/${co.id}/people?status=all`, user.token).expect(200)).body);
        for (const v of [...forbidden, V.manualPhone]) expect(text).not.toContain(v);
      }
    });

    it('discover: "has a decision-maker contact" follows the company too (Lotus reported no contact, so it is not contactable)', async () => {
      const pred = searchSvc.buildBusinessPredicate({ hasDecisionMakerContact: true }, sql`${schema.businesses.id}`)!;
      const rows = await db.select({ slug: schema.businesses.slug }).from(schema.businesses).where(and(eq(schema.businesses.status, 'PUBLISHED'), pred));
      expect(rows.map((r) => r.slug).sort()).toEqual(['kaveri-synth', 'meridian-synth', 'solo-synth']);
    });
  });

  describe('unattributed contacts', () => {
    it('a one-company person\'s reviewer-added contact is still shown (it cannot belong to another company)', async () => {
      await POST(`/people/${soloPersonId}/unlock`, user.token).expect(200);
      const c = await card(solo, user.token, 'Solo Synth');
      expect(c.contacts.email.value).toBe(V.soloManualEmail);
    });

    it('the same kind of contact stops being shown the moment the person gets a second company (never guessed)', async () => {
      const extra = await seedBusiness(db, 'solo-second-synth');
      const r = (await run([rec(extra, 'Solo Synth', 'rel-solo-2', { linkedinUrl: 'https://www.linkedin.com/in/solo-synth-10b' })]))[0];
      expect(r.personId).toBe(soloPersonId);
      expect((await card(solo, user.token, 'Solo Synth')).contacts.email.available).toBe(false);
      await db.delete(schema.companyPeople).where(eq(schema.companyPeople.id, r.companyPersonId!));
      expect((await card(solo, user.token, 'Solo Synth')).contacts.email.value).toBe(V.soloManualEmail);
    });
  });

  describe('unlock never charges for a contact that no visible company may show', () => {
    it('a person whose only published contact belongs to a company that is not visible (and who has no LinkedIn) cannot be unlocked', async () => {
      const hidden = await seedBusiness(db, 'hidden-synth');
      const shown = await seedBusiness(db, 'shown-synth');
      const res = await run([
        rec(hidden, 'Hidden Hannah', 'rel-h1', { email: 'hannah@hidden-synth.example', linkedinUrl: 'https://www.linkedin.com/in/hannah-synth-10b' }),
        rec(shown, 'Hidden Hannah', 'rel-h2', { linkedinUrl: 'https://www.linkedin.com/in/hannah-synth-10b' }),
      ]);
      expect(res[0].personId).toBe(res[1].personId);
      const pid = res[0].personId!;
      await db.update(schema.people).set({ linkedinUrl: null, normalizedLinkedinUrl: null }).where(eq(schema.people.id, pid)); // nothing but the contact to reveal
      const email = await contactOf(pid, 'hannah@hidden-synth.example');
      await publishing.publishContact(email.id, ctx);
      await publishing.publishRole(res[1].companyPersonId!, ctx); // only the company that reported nothing is visible
      const before = (await db.select().from(schema.personUnlocks).where(eq(schema.personUnlocks.userId, user.id))).length;
      const out = await POST(`/people/${pid}/unlock`, user.token);
      expect([out.status, out.body.errorCode]).toEqual([409, 'NO_CONTACT_AVAILABLE']);
      expect((await db.select().from(schema.personUnlocks).where(eq(schema.personUnlocks.userId, user.id))).length).toBe(before);
    });
  });

  /**
   * Phase 17. Orion treats a contact that arrives on a company's row as REPORTED FOR THAT COMPANY. That is only true because the
   * People Pipeline export now selects contacts from the relationship's own company and never falls back to another company's
   * (before, it did, and a company with no contact of its own received the person's contact from elsewhere). These tests pin Orion's
   * side of that contract: what a correctly scoped export looks like to Orion, and what the old one would have looked like.
   */
  describe('relies on company-scoped export rows (Phase 17)', () => {
    const li = (n: string) => `https://www.linkedin.com/in/scope-${n}-p17`;

    it('a company whose export row carries no contact shows none, and the other company\'s contact is OTHER_COMPANY in its dossier, never THIS_COMPANY', async () => {
      const a = await seedBusiness(db, 'p17-a');
      const b = await seedBusiness(db, 'p17-b');
      const email = 'eve@a-company-p17.example';
      const res = await run([
        rec(a, 'Eve Scope', 'rel-p17-a', { email, linkedinUrl: li('eve') }),
        rec(b, 'Eve Scope', 'rel-p17-b', { linkedinUrl: li('eve') }), // a correctly scoped export: B has no contact of its own, so none on its row
      ]);
      const pid = res[0].personId!;
      expect(res[1].personId).toBe(pid);
      for (const r of res) await publishing.publishRole(r.companyPersonId!, ctx);
      const contact = await contactOf(pid, email);
      await publishing.publishContact(contact.id, ctx);
      await POST(`/people/${pid}/unlock`, user.token).expect(200);
      expect((await card(a, user.token, 'Eve Scope')).contacts.email.value).toBe(email);
      const atB = (await card(b, user.token, 'Eve Scope')).contacts;
      expect([atB.email.available, atB.email.value]).toEqual([false, null]);
      const attribution = await loadContactAttribution(db, [pid]);
      expect(contactAttributionStatus(contact, a.id, attribution)).toEqual({ status: 'THIS_COMPANY', eligibleForThisCompany: true });
      expect(contactAttributionStatus(contact, b.id, attribution)).toEqual({ status: 'OTHER_COMPANY', eligibleForThisCompany: false });
    });

    it('a contact with no company attribution is never THIS_COMPANY for either company of a multi-company person', async () => {
      const a = await seedBusiness(db, 'p17-c');
      const b = await seedBusiness(db, 'p17-d');
      const res = await run([rec(a, 'Una Scope', 'rel-p17-c', { linkedinUrl: li('una') }), rec(b, 'Una Scope', 'rel-p17-d', { linkedinUrl: li('una') })]);
      const pid = res[0].personId!;
      await db.insert(schema.personContacts).values({ personId: pid, contactType: 'WORK_EMAIL', contactValue: 'una@nowhere-p17.example', normalizedValue: 'una@nowhere-p17.example', isPublished: true });
      const manual = await contactOf(pid, 'una@nowhere-p17.example');
      const attribution = await loadContactAttribution(db, [pid]);
      for (const co of [a, b]) expect(contactAttributionStatus(manual, co.id, attribution)).toEqual({ status: 'UNATTRIBUTED', eligibleForThisCompany: false });
    });

    it('the trust it relies on, pinned: a row that DOES carry the contact makes it reported for that row\'s company (what the pre-fix export produced), so the export must not send it', async () => {
      const a = await seedBusiness(db, 'p17-e');
      const b = await seedBusiness(db, 'p17-f');
      const email = 'fay@a-company-p17.example';
      const res = await run([
        rec(a, 'Fay Scope', 'rel-p17-e', { email, linkedinUrl: li('fay') }),
        rec(b, 'Fay Scope', 'rel-p17-f', { email, linkedinUrl: li('fay') }), // the old fallback: A's email copied onto B's row
      ]);
      const contact = await contactOf(res[0].personId!, email);
      const attribution = await loadContactAttribution(db, [res[0].personId!]);
      // Orion cannot tell this from a genuinely shared contact; correctness here is the export's job (Phase 17), not a guess made on this side
      expect(contactAttributionStatus(contact, a.id, attribution).status).toBe('SHARED');
      expect(contactAttributionStatus(contact, b.id, attribution).status).toBe('SHARED');
    });
  });
});

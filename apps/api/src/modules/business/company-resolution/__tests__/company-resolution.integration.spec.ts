import { eq, sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { DrizzleDb } from '../../../../database/database.provider';
import * as schema from '../../../../database/schema';
import { ObservationService } from '../../../people/observations/observation.service';
import { PeopleIngestionService } from '../../../people/ingestion/people-ingestion.service';
import { IRawPersonRecord } from '../../../people/ingestion/ingestion.types';
import { PeopleWriteService } from '../../../people/people-write.service';
import { SourceRegistryService } from '../../../people/sources/source-registry.service';
import { createTestDb } from '../../../people/__tests__/pglite-test-db';
import { expectLedgerConsistent } from '../../../people/__tests__/ledger-invariants';
import {
  isNonIdentifyingDomain,
  normalizeCompanyName,
  normalizeDomain,
  normalizeIdentifierValue,
  normalizedNameSql,
} from '../company-matching';
import { CompanyResolverService } from '../company-resolver.service';
import { MAX_CANDIDATES } from '../company-resolution.types';

const SRC_DIR = path.resolve(__dirname, '../../../..');

describe('Shared company resolution (Phase 6.3)', () => {
  let db: DrizzleDb;
  let closeDb: () => Promise<void>;
  let client: { query: (...a: any[]) => Promise<any>; exec: (s: string) => Promise<any> };
  let resolver: CompanyResolverService;
  let ingest: PeopleIngestionService;
  let registry: SourceRegistryService;
  let n = 0;

  interface ISeed {
    name: string;
    legalName?: string;
    slug?: string;
    identifiers?: Array<[string, string]>;
    domains?: Array<{ domain: string; platform?: string; active?: boolean }>;
    locations?: Array<{ city: string; state?: string; pincode?: string }>;
  }
  const company = async (s: ISeed) => {
    const [b] = await db
      .insert(schema.businesses)
      .values({ name: s.name, legalName: s.legalName ?? null, slug: s.slug ?? `co-${++n}-${Math.random().toString(36).slice(2, 7)}`, status: 'PUBLISHED' })
      .returning();
    for (const [type, value] of s.identifiers ?? []) {
      await db.insert(schema.businessIdentifiers).values({ businessId: b.id, type: type as any, value, normalizedValue: normalizeIdentifierValue(value) });
    }
    for (const d of s.domains ?? []) {
      await db.insert(schema.digitalPresences).values({ businessId: b.id, platform: (d.platform ?? 'WEBSITE') as any, url: `https://${d.domain}`, domain: d.domain, isActive: d.active ?? true });
    }
    for (const l of s.locations ?? []) {
      await db.insert(schema.businessLocations).values({ businessId: b.id, addressLine1: '1 Test Street', city: l.city, district: l.city, state: l.state ?? 'Tamil Nadu', pincode: l.pincode ?? '600001' });
    }
    return b;
  };
  const uniq = (prefix: string) => `${prefix}${++n}${Math.random().toString(36).slice(2, 6)}`.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);
  const dbCounts = async () => ({
    businesses: (await db.select().from(schema.businesses)).length,
    identifiers: (await db.select().from(schema.businessIdentifiers)).length,
    presences: (await db.select().from(schema.digitalPresences)).length,
    locations: (await db.select().from(schema.businessLocations)).length,
    people: (await db.select().from(schema.people)).length,
    roles: (await db.select().from(schema.companyPeople)).length,
  });

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    client = t.client as any;
    closeDb = () => t.client.close();
    resolver = new CompanyResolverService(db);
    registry = new SourceRegistryService(db);
    ingest = new PeopleIngestionService(db, new PeopleWriteService(db), registry, new ObservationService(db), resolver);
  }, 60_000);

  afterAll(async () => {
    await expectLedgerConsistent(db);
    await closeDb?.();
  });

  // ================================================================ identifiers
  describe('tier 1: statutory identifiers', () => {
    it('CIN, GSTIN and UDYAM: an exact normalised identifier resolves to exactly one company', async () => {
      const a = await company({ name: uniq('Idco'), identifiers: [['CIN', 'U12345TN2010PTC000777'], ['GSTIN', '33AAACI4397H1Z5'], ['UDYAM', 'UDYAM-TN-01-0000777']] });
      expect(await resolver.resolve({ identifiers: [{ type: 'CIN', value: 'u12345tn2010ptc000777' }] })).toMatchObject({ status: 'MATCHED', companyId: a.id, matchedBy: 'IDENTIFIER:CIN' });
      expect(await resolver.resolve({ identifiers: [{ type: 'gstin', value: '33 AAACI4397H1Z5' }] })).toMatchObject({ status: 'MATCHED', companyId: a.id, matchedBy: 'IDENTIFIER:GSTIN' });
      expect(await resolver.resolve({ identifiers: [{ type: 'UDYAM', value: 'udyam tn 01 0000777' }] })).toMatchObject({ status: 'MATCHED', companyId: a.id, matchedBy: 'IDENTIFIER:UDYAM' });
      // several identifiers that agree are still one company
      expect(await resolver.resolve({ identifiers: [{ type: 'CIN', value: 'U12345TN2010PTC000777' }, { type: 'GSTIN', value: '33AAACI4397H1Z5' }] })).toMatchObject({ status: 'MATCHED', companyId: a.id });
    });

    it('conflicting identifiers (two different companies) are AMBIGUOUS, never resolved by guessing', async () => {
      const a = await company({ name: uniq('Conflict A'), identifiers: [['CIN', 'U99999TN2011PTC000001']] });
      const b = await company({ name: uniq('Conflict B'), identifiers: [['GSTIN', '33ZZZZZ9999Z1Z9']] });
      const r = await resolver.resolve({ identifiers: [{ type: 'CIN', value: 'U99999TN2011PTC000001' }, { type: 'GSTIN', value: '33ZZZZZ9999Z1Z9' }] });
      expect(r.status).toBe('AMBIGUOUS');
      expect(r.companyId).toBeUndefined();
      expect(r.reasonCodes).toContain('CONFLICTING_COMPANY_REFERENCES');
      expect(r.candidates!.map((c) => c.companyId).sort()).toEqual([a.id, b.id].sort());
    });

    it('an identifier that contradicts a company found another way is a conflict (same type, different value)', async () => {
      const a = await company({ name: uniq('Has Cin'), slug: uniq('has-cin'), identifiers: [['CIN', 'U11111TN2011PTC000001']] });
      const r = await resolver.resolve({ slug: a.slug, identifiers: [{ type: 'CIN', value: 'U22222TN2012PTC000002' }] }); // the slug says A, the supplied CIN is not A's
      expect(r).toMatchObject({ status: 'AMBIGUOUS' });
      expect(r.reasonCodes).toEqual(expect.arrayContaining(['CONFLICTING_IDENTIFIER', 'CONFLICTING_IDENTIFIER:CIN']));
      expect(r.candidates!.map((c) => c.companyId)).toEqual([a.id]);
      // the caller itself supplying two different values for one type cannot be trusted either
      expect((await resolver.resolve({ identifiers: [{ type: 'CIN', value: 'A1' + 'B'.repeat(10) }, { type: 'CIN', value: 'C2' + 'D'.repeat(10) }] })).status).toBe('AMBIGUOUS');
    });

    it('a nonexistent identifier is NOT_FOUND (and nothing is created); unusable types and empty values are ignored', async () => {
      const before = await dbCounts();
      const r = await resolver.resolve({ identifiers: [{ type: 'CIN', value: 'U00000XX0000XXX000000' }] });
      expect(r).toMatchObject({ status: 'NOT_FOUND', reasonCodes: expect.arrayContaining(['IDENTIFIER_NOT_FOUND:CIN']) });
      expect(r.companyId).toBeUndefined();
      const other = await resolver.resolve({ identifiers: [{ type: 'OTHER', value: 'whatever-123' }, { type: 'CIN', value: '   ' }] });
      expect(other.status).toBe('NOT_FOUND');
      expect(other.reasonCodes).toContain('IDENTIFIER_TYPE_NOT_USED:OTHER');
      expect(await dbCounts()).toEqual(before);
    });

    it('internal references: id and slug resolve; disagreeing id and slug are AMBIGUOUS; unknown ones are NOT_FOUND', async () => {
      const a = await company({ name: uniq('Ref A'), slug: uniq('ref-a') });
      const b = await company({ name: uniq('Ref B'), slug: uniq('ref-b') });
      expect(await resolver.resolve({ id: a.id })).toMatchObject({ status: 'MATCHED', companyId: a.id, matchedBy: 'INTERNAL_ID' });
      expect(await resolver.resolve({ slug: b.slug.toUpperCase() })).toMatchObject({ status: 'MATCHED', companyId: b.id, matchedBy: 'INTERNAL_SLUG' });
      expect(await resolver.resolve({ id: a.id, slug: a.slug })).toMatchObject({ status: 'MATCHED', companyId: a.id });
      expect(await resolver.resolve({ id: a.id, slug: b.slug })).toMatchObject({ status: 'AMBIGUOUS', reasonCodes: expect.arrayContaining(['CONFLICTING_COMPANY_REFERENCES']) });
      expect((await resolver.resolve({ id: '00000000-0000-4000-8000-00000000dead' })).status).toBe('NOT_FOUND');
      expect(await resolver.resolve({ id: 'not-a-uuid' })).toMatchObject({ status: 'NOT_FOUND', reasonCodes: expect.arrayContaining(['INTERNAL_ID_INVALID']) });
    });
  });

  // ================================================================ domain
  describe('tier 2: the company website domain', () => {
    it('a normalised exact domain resolves; protocol, www, port, path, query, fragment, case and trailing dot do not matter', async () => {
      const d = `${uniq('acme')}.co.in`;
      const a = await company({ name: uniq('Domain Co'), domains: [{ domain: d }] });
      for (const input of [d, `www.${d}`, `https://${d}`, `HTTP://WWW.${d.toUpperCase()}/About/Us?x=1#team`, `${d}:8080/path`, `https://${d}./`]) {
        expect({ input, r: await resolver.resolve({ website: input }) }).toMatchObject({ r: { status: 'MATCHED', companyId: a.id, matchedBy: 'DOMAIN' } });
      }
      expect(await resolver.resolve({ domain: d })).toMatchObject({ status: 'MATCHED', companyId: a.id });
      // the company's stored domain may carry a leading www
      const w = `${uniq('stored')}.com`;
      const b = await company({ name: uniq('Www Co'), domains: [{ domain: `www.${w}` }] });
      expect(await resolver.resolve({ website: `https://${w}` })).toMatchObject({ status: 'MATCHED', companyId: b.id });
    });

    it('normalisation rules', () => {
      expect(normalizeDomain('HTTPS://WWW.Example.COM./a/b?c#d')).toBe('example.com');
      expect(normalizeDomain('example.com:443')).toBe('example.com');
      expect(normalizeDomain('  ')).toBeNull();
      expect(normalizeDomain('not a domain')).toBeNull();
      expect(normalizeDomain('localhost')).toBeNull();
      expect(normalizeDomain('person@example.com')).toBeNull(); // an e-mail address is never a website
      expect(isNonIdentifyingDomain('gmail.com')).toBe(true);
      expect(isNonIdentifyingDomain('acme.sites.google.com')).toBe(true);
      expect(isNonIdentifyingDomain('acme.co.in')).toBe(false);
    });

    it('a domain shared by several companies is AMBIGUOUS; another strong identifier resolves it', async () => {
      const d = `${uniq('shared')}.com`;
      const a = await company({ name: uniq('Shared A'), domains: [{ domain: d }], identifiers: [['CIN', 'U77777TN2015PTC000001']] });
      const b = await company({ name: uniq('Shared B'), domains: [{ domain: d }] });
      const r = await resolver.resolve({ website: d });
      expect(r.status).toBe('AMBIGUOUS');
      expect(r.reasonCodes).toContain('SHARED_DOMAIN');
      expect(r.candidates!.map((c) => c.companyId)).toEqual([a.id, b.id].sort());
      expect(await resolver.resolve({ website: d, identifiers: [{ type: 'CIN', value: 'U77777TN2015PTC000001' }] })).toMatchObject({ status: 'MATCHED', companyId: a.id, matchedBy: 'IDENTIFIER:CIN' });
    });

    it('an identifier and a website that point at different companies are AMBIGUOUS (strong signals disagree)', async () => {
      const a = await company({ name: uniq('Sig A'), identifiers: [['GSTIN', '33SIGAA1111A1Z1']] });
      const b = await company({ name: uniq('Sig B'), domains: [{ domain: `${uniq('sigb')}.com` }] });
      const b2 = (await db.select().from(schema.digitalPresences).where(eq(schema.digitalPresences.businessId, b.id)))[0];
      const r = await resolver.resolve({ identifiers: [{ type: 'GSTIN', value: '33SIGAA1111A1Z1' }], website: b2.domain! });
      expect(r).toMatchObject({ status: 'AMBIGUOUS', reasonCodes: expect.arrayContaining(['CONFLICTING_DOMAIN']) });
      expect(r.candidates!.map((c) => c.companyId).sort()).toEqual([a.id, b.id].sort());
    });

    it('public platforms, e-mail addresses, inactive and non-website presences never identify a company; an absent domain continues safely', async () => {
      const d = `${uniq('inactive')}.com`;
      await company({ name: uniq('Inactive Co'), domains: [{ domain: d, active: false }] });
      const li = await company({ name: uniq('Social Co'), domains: [{ domain: 'linkedin.com', platform: 'LINKEDIN' }, { domain: 'gmail.com' }] });
      void li;
      for (const input of ['gmail.com', 'https://www.linkedin.com/company/x', 'info@acme.com', d, 'localhost']) {
        expect((await resolver.resolve({ website: input })).status).toBe('NOT_FOUND');
      }
      expect((await resolver.resolve({ website: 'gmail.com' })).reasonCodes).toContain('DOMAIN_NOT_IDENTIFYING');
      expect((await resolver.resolve({ website: 'info@acme.com' })).reasonCodes).toContain('DOMAIN_INVALID');
      // no domain at all: the next tier is consulted, nothing breaks
      const a = await company({ name: 'Continues Safely Private Limited', locations: [{ city: 'Coimbatore' }] });
      expect(await resolver.resolve({ name: 'Continues Safely Pvt Ltd', city: 'Coimbatore' })).toMatchObject({ status: 'MATCHED', companyId: a.id });
      // a known domain that matches nothing falls through to the name tier
      expect(await resolver.resolve({ website: 'nomatch.example.org', name: 'Continues Safely Pvt Ltd', city: 'Coimbatore' })).toMatchObject({ status: 'MATCHED', companyId: a.id, reasonCodes: expect.arrayContaining(['DOMAIN_NOT_FOUND']) });
    });

    it('a unique domain matches even when the name differs, and says so; a conflicting identifier on that company still blocks it', async () => {
      const d = `${uniq('holding')}.com`;
      const a = await company({ name: uniq('Holding Foods'), domains: [{ domain: d }], identifiers: [['CIN', 'U55555TN2014PTC000001']] });
      const r = await resolver.resolve({ website: d, name: 'Some Other Brand Pvt Ltd' });
      expect(r).toMatchObject({ status: 'MATCHED', companyId: a.id, matchedBy: 'DOMAIN' });
      expect(r.reasonCodes).toContain('NAME_DIFFERS_FROM_DOMAIN_OWNER');
      const blocked = await resolver.resolve({ website: d, identifiers: [{ type: 'CIN', value: 'U66666TN2016PTC000009' }] });
      expect(blocked).toMatchObject({ status: 'AMBIGUOUS', reasonCodes: expect.arrayContaining(['CONFLICTING_IDENTIFIER:CIN']) });
    });
  });

  // ================================================================ names and locations
  describe('tier 3: exact normalised name, corroborated by location', () => {
    it('normalisation is formatting-only, and the JavaScript and SQL versions always agree', async () => {
      const samples = ['ABC Technologies Pvt. Ltd.', '  abc   TECHNOLOGIES  PVT LTD ', 'Tata & Sons (P) Ltd', 'M/s. Sri Lakshmi-Traders', 'X', 'ÀÇMÉ Ltd', "O'Neil & Co.", 'Pvt Ltd', 'Computer Pvt_Ltd'];
      for (const s of samples) {
        const row = (await client.query(`SELECT ${normalizedNameSql('$1::text')} AS v`, [s])).rows[0];
        expect({ s, sql: row.v }).toEqual({ s, sql: normalizeCompanyName(s) });
      }
      expect(normalizeCompanyName('ABC  Technologies Pvt. Ltd.')).toBe('abc technologies private limited');
      expect(normalizeCompanyName('ABC Technologies Private Limited')).toBe('abc technologies private limited');
      expect(normalizeCompanyName('Tata & Sons')).toBe('tata and sons');
    });

    it('exact normalised legal name (or name) + matching city => MATCHED, whatever the case, spacing or legal suffix style', async () => {
      const base = uniq('Lumen Works');
      const a = await company({ name: `${base} Pvt Ltd`, legalName: `${base} Private Limited`, locations: [{ city: 'Chennai', pincode: '600001' }] });
      for (const name of [`${base} Private Limited`, `  ${base.toUpperCase()}   PVT.  LTD. `, `${base} pvt ltd`]) {
        expect({ name, r: await resolver.resolve({ name, city: ' chennai ' }) }).toMatchObject({ r: { status: 'MATCHED', companyId: a.id, matchedBy: 'NAME_AND_LOCATION' } });
      }
      expect(await resolver.resolve({ legalName: `${base} Private Limited`, pincode: '600 001' })).toMatchObject({ status: 'MATCHED', companyId: a.id }); // pincode corroborates too
    });

    it('duplicate company names in the SAME city are AMBIGUOUS, with a deterministic candidate list', async () => {
      const name = uniq('Twin Traders');
      const a = await company({ name, locations: [{ city: 'Madurai' }] });
      const b = await company({ name: name.toUpperCase(), locations: [{ city: 'Madurai' }] }); // same name, different formatting
      const r1 = await resolver.resolve({ name, city: 'Madurai' });
      const r2 = await resolver.resolve({ name: name.toUpperCase(), city: 'MADURAI' });
      expect(r1).toMatchObject({ status: 'AMBIGUOUS', reasonCodes: expect.arrayContaining(['DUPLICATE_COMPANY_NAME_SAME_LOCATION']) });
      expect(r1.companyId).toBeUndefined();
      expect(r1.candidates!.map((c) => c.companyId)).toEqual([a.id, b.id].sort());
      expect(r2).toEqual(r1);
    });

    it('the same name in different cities: the city decides; a city that matches none is NOT_FOUND; a stated state can veto', async () => {
      const name = uniq('Cityname Corp');
      const chennai = await company({ name, locations: [{ city: 'Chennai', state: 'Tamil Nadu', pincode: '600002' }] });
      const pune = await company({ name, locations: [{ city: 'Pune', state: 'Maharashtra', pincode: '411001' }] });
      expect(await resolver.resolve({ name, city: 'Pune' })).toMatchObject({ status: 'MATCHED', companyId: pune.id });
      expect(await resolver.resolve({ name, city: 'Chennai' })).toMatchObject({ status: 'MATCHED', companyId: chennai.id });
      const elsewhere = await resolver.resolve({ name, city: 'Delhi' });
      expect(elsewhere).toMatchObject({ status: 'NOT_FOUND', reasonCodes: expect.arrayContaining(['NAME_MATCH_DIFFERENT_LOCATION']) });
      expect(elsewhere.candidates).toBeUndefined();
      expect((await resolver.resolve({ name, city: 'Pune', state: 'Tamil Nadu' })).status).toBe('NOT_FOUND'); // city matches Pune but the state is Chennai's
    });

    it('a matching name without enough location is never a MATCH: a single name match is AMBIGUOUS (needs corroboration) and nothing is chosen', async () => {
      const name = uniq('Lonely Labs');
      const a = await company({ name, locations: [{ city: 'Salem' }] });
      for (const hint of [{ name }, { name, state: 'Tamil Nadu' }, { name, city: '  ' }]) {
        const r = await resolver.resolve(hint);
        expect(r).toMatchObject({ status: 'AMBIGUOUS', reasonCodes: expect.arrayContaining(['NAME_MATCH_NEEDS_CORROBORATION']) });
        expect(r.companyId).toBeUndefined();
        expect(r.candidates!.map((c) => c.companyId)).toEqual([a.id]);
      }
    });

    it('a same-name company with no location on file cannot be ruled out, so even a corroborated match is AMBIGUOUS', async () => {
      const name = uniq('Shadow Systems');
      const located = await company({ name, locations: [{ city: 'Erode' }] });
      const unlocated = await company({ name });
      const r = await resolver.resolve({ name, city: 'Erode' });
      expect(r.status).toBe('AMBIGUOUS');
      expect(r.candidates!.map((c) => c.companyId)).toEqual([located.id, unlocated.id].sort());
    });

    it('names that are too short, unusable or absent, and unknown names, are NOT_FOUND with a reason', async () => {
      expect(await resolver.resolve({ name: 'AB', city: 'Chennai' })).toMatchObject({ status: 'NOT_FOUND', reasonCodes: ['NAME_NOT_USABLE'] });
      expect(await resolver.resolve({ name: '!!! ???' })).toMatchObject({ status: 'NOT_FOUND', reasonCodes: ['NAME_NOT_USABLE'] });
      expect(await resolver.resolve({})).toMatchObject({ status: 'NOT_FOUND', reasonCodes: ['NO_COMPANY_SIGNAL'] });
      expect(await resolver.resolve({ name: uniq('Nonexistent Enterprises'), city: 'Chennai' })).toMatchObject({ status: 'NOT_FOUND', reasonCodes: ['NAME_NOT_FOUND'] });
    });

    it('there is no fuzzy matching: near-miss names never match', async () => {
      const base = uniq('Precise Precision');
      await company({ name: `${base} Industries`, locations: [{ city: 'Hosur' }] });
      for (const near of [`${base} Industry`, `${base} Industrie`, `${base} Industries Group`, `${base}s Industries`, `${base.slice(0, -1)} Industries`]) {
        expect({ near, status: (await resolver.resolve({ name: near, city: 'Hosur' })).status }).toEqual({ near, status: 'NOT_FOUND' });
      }
    });

    it('too many duplicate candidates are truncated deterministically and the truncation is reported', async () => {
      const name = uniq('Crowded Crowd');
      for (let i = 0; i < MAX_CANDIDATES + 3; i++) await company({ name, locations: [{ city: 'Tiruppur' }] });
      const r = await resolver.resolve({ name, city: 'Tiruppur' });
      expect(r.status).toBe('AMBIGUOUS');
      expect(r.candidates).toHaveLength(MAX_CANDIDATES);
      expect(r.reasonCodes).toContain('CANDIDATES_TRUNCATED');
      const ids = r.candidates!.map((c) => c.companyId);
      expect(ids).toEqual([...ids].sort());
    });
  });

  // ================================================================ safety
  describe('safety: read-only, deterministic, no guessing', () => {
    it('resolving never creates or changes a company, identifier, presence, location, person or role', async () => {
      const a = await company({ name: uniq('Stable Co'), identifiers: [['CIN', 'U44444TN2013PTC000001']], domains: [{ domain: `${uniq('stable')}.com` }], locations: [{ city: 'Karur' }] });
      const snapshot = async () => JSON.stringify([await dbCounts(), (await db.select().from(schema.businesses).where(eq(schema.businesses.id, a.id)))[0]]);
      const before = await snapshot();
      for (const c of [
        { id: a.id }, { identifiers: [{ type: 'CIN', value: 'nope' }] }, { website: 'unknown.example.org' }, { name: 'Completely Unknown Company', city: 'Nowhere' },
        { name: a.name, city: 'Karur' }, { slug: 'missing-slug' }, {},
      ]) await resolver.resolve(c);
      expect(await snapshot()).toBe(before);
    });

    it('the resolver source can only read: no writes, no transactions, no network, no People services', () => {
      const src = fs.readFileSync(path.join(SRC_DIR, 'modules/business/company-resolution/company-resolver.service.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(src).not.toMatch(/\.(insert|update|delete|transaction|execute)\(/);
      expect(src).not.toMatch(/\bfetch\(|axios|https?\.request|node-fetch|got\(/);
      expect(src).not.toMatch(/PeopleWriteService|PeoplePublishingService|people-write|people-publishing/);
      const matching = fs.readFileSync(path.join(SRC_DIR, 'modules/business/company-resolution/company-matching.ts'), 'utf8');
      expect(matching).not.toMatch(/levenshtein|similarity|soundex|metaphone|bigram|jaro/i);
    });

    it('the same input always gives the same answer', async () => {
      const name = uniq('Repeat Repeat');
      await company({ name, locations: [{ city: 'Namakkal' }] });
      await company({ name, locations: [{ city: 'Namakkal' }] });
      const first = await resolver.resolve({ name, city: 'Namakkal' });
      for (let i = 0; i < 3; i++) expect(await resolver.resolve({ name, city: 'Namakkal' })).toEqual(first);
    });

    it('company resolution is reachable only from internal code: no controller and no customer service uses it; the import detector is untouched', () => {
      const walk = (dir: string): string[] =>
        fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === '__tests__' ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]));
      const users = walk(path.join(SRC_DIR, 'modules')).filter((f) => f.endsWith('.ts') && /CompanyResolver|company-resolution/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(SRC_DIR, f).replace(/\\/g, '/')).sort();
      expect(users).toEqual([
        'modules/business/company-resolution/company-resolution.module.ts',
        'modules/business/company-resolution/company-resolver.service.ts',
        'modules/people/ingestion/people-ingestion.service.ts',
        'modules/people/people.module.ts',
      ]);
      expect(fs.readFileSync(path.join(SRC_DIR, 'modules/import/services/duplicate-detection.service.ts'), 'utf8')).not.toMatch(/company-resolution|CompanyResolver/);
    });
  });

  // ================================================================ People ingestion
  describe('People ingestion uses the shared resolver', () => {
    const person = (over: Partial<IRawPersonRecord> = {}, source: Record<string, unknown> = {}): IRawPersonRecord =>
      ({ personName: `Person ${uniq('p')}`, jobTitle: 'Director', source: { type: 'MANUAL_IMPORT', reference: 'sheet-1', recordId: uniq('rec'), ...source }, ...over }) as IRawPersonRecord;
    const obsFor = (recordId: string) => db.select().from(schema.peopleObservations).where(eq(schema.peopleObservations.sourceRecordId, recordId));

    it('MATCHED: a record identified only by the company website/name ingests normally, and is observed', async () => {
      const d = `${uniq('matched')}.com`;
      const co = await company({ name: uniq('Match Me'), domains: [{ domain: d }] });
      const rec = person({ company: { website: `https://www.${d}/contact` } });
      const r = await ingest.ingest([rec], { sourceKey: 'people-json', batchRef: 'm1' });
      expect(r.results[0]).toMatchObject({ outcome: 'CREATED', observation: { status: 'RECORDED' } });
      const role = (await db.select().from(schema.companyPeople).where(eq(schema.companyPeople.id, r.results[0].companyPersonId!)))[0];
      expect(role).toMatchObject({ businessId: co.id, reviewStatus: 'PENDING', isPublished: false });
      expect((await obsFor(rec.source!.recordId!))[0]).toMatchObject({ outcome: 'INGESTED', businessId: co.id });
    });

    it('AMBIGUOUS: several plausible companies => quarantined whole, with the candidates for the reviewer; nobody is attached', async () => {
      const name = uniq('Clash Clan');
      const a = await company({ name, locations: [{ city: 'Vellore' }] });
      const b = await company({ name, locations: [{ city: 'Vellore' }] });
      const before = await dbCounts();
      const rec = person({ company: { name, city: 'Vellore' } });
      const r = await ingest.ingest([rec], { sourceKey: 'people-json', batchRef: 'amb-1' });
      expect(r.results[0]).toMatchObject({ outcome: 'QUARANTINED', observation: { status: 'RECORDED' } });
      const reason = r.results[0].reasons![0];
      expect(reason.code).toBe('AMBIGUOUS_COMPANY_MATCH');
      const match = (reason.details as any).companyMatch;
      expect(match.status).toBe('AMBIGUOUS');
      expect(match.candidates.map((c: any) => c.companyId)).toEqual([a.id, b.id].sort());
      expect(match.reasonCodes).toContain('DUPLICATE_COMPANY_NAME_SAME_LOCATION');
      const q = (await db.select().from(schema.peopleIngestionQuarantine)).find((x) => (x.raw as any)?.source?.recordId === rec.source!.recordId)!;
      expect((q.reasons as any[])[0].code).toBe('AMBIGUOUS_COMPANY_MATCH');
      expect(JSON.stringify((q.reasons as any[])[0].details)).not.toMatch(/@|https?:/); // ids and codes only
      expect({ ...(await dbCounts()), people: 0, roles: 0 }).toEqual({ ...before, people: 0, roles: 0 });
      expect((await dbCounts()).people).toBe(before.people);
      expect((await dbCounts()).roles).toBe(before.roles);
      const [o] = await obsFor(rec.source!.recordId!);
      expect(o).toMatchObject({ outcome: 'QUARANTINED', reasonCodes: ['AMBIGUOUS_COMPANY_MATCH'], personId: null });
    });

    it('NOT_FOUND: an unknown company is quarantined (BUSINESS_NOT_FOUND) and NO company is ever created', async () => {
      const before = await dbCounts();
      const rec = person({ company: { name: uniq('Phantom Enterprises'), city: 'Chennai' } });
      const r = await ingest.ingest([rec], { sourceKey: 'people-json', batchRef: 'nf-1' });
      expect(r.results[0]).toMatchObject({ outcome: 'QUARANTINED' });
      expect(r.results[0].reasons![0].code).toBe('BUSINESS_NOT_FOUND');
      expect(await dbCounts()).toEqual(before);
      expect((await obsFor(rec.source!.recordId!))[0]).toMatchObject({ outcome: 'QUARANTINED', reasonCodes: ['BUSINESS_NOT_FOUND'], personId: null });
    });

    it('an e-mail domain can never identify a company: a record with only a personal/work e-mail is quarantined', async () => {
      const d = `${uniq('mailco')}.com`;
      await company({ name: uniq('Mail Co'), domains: [{ domain: d }] });
      const before = await dbCounts();
      const rec = person({ email: `someone@${d}` });
      const r = await ingest.ingest([rec], { sourceKey: 'people-json', batchRef: 'email-1' });
      expect(r.results[0]).toMatchObject({ outcome: 'QUARANTINED' });
      expect(r.results[0].reasons![0].code).toBe('MISSING_BUSINESS');
      expect(await dbCounts()).toEqual(before);
      // and an e-mail passed off as the company website is refused by the resolver too
      const sneaky = person({ company: { website: `someone@${d}` } });
      const r2 = await ingest.ingest([sneaky], { sourceKey: 'people-json', batchRef: 'email-2' });
      expect(r2.results[0].outcome).toBe('QUARANTINED');
      expect(await dbCounts()).toEqual(before);
    });

    it('history is never rewritten: after an ambiguous refusal a later run that resolves the company adds a NEW observation and leaves the old one untouched', async () => {
      const name = uniq('Later Labs');
      await company({ name, locations: [{ city: 'Trichy' }, { city: 'Theni' }] });
      await company({ name, locations: [{ city: 'Trichy' }] });
      const recordId = uniq('later');
      const first = await ingest.ingest([person({ company: { name, city: 'Trichy' } }, { recordId })], { sourceKey: 'people-json', batchRef: 'try-1', acquiredAt: new Date(Date.now() - 86_400_000) });
      expect(first.results[0].outcome).toBe('QUARANTINED');
      const [refusal] = await obsFor(recordId);
      const refusalSnapshot = JSON.stringify(refusal);

      // the source now supplies a disambiguating signal (a city only one of the companies has)
      const second = await ingest.ingest([person({ company: { name, city: 'Theni' } }, { recordId })], { sourceKey: 'people-json', batchRef: 'try-2' });
      expect(second.results[0].outcome).toBe('CREATED');
      const history = (await obsFor(recordId)).sort((a, b) => a.acquiredAt.getTime() - b.acquiredAt.getTime());
      expect(history.map((h) => [h.batchRef, h.outcome])).toEqual([['try-1', 'QUARANTINED'], ['try-2', 'INGESTED']]);
      expect(JSON.stringify(history[0])).toBe(refusalSnapshot); // the earlier observation is byte-for-byte unchanged
    });

    it('re-ingesting a resolved record creates no duplicate people, roles or evidence', async () => {
      const name = uniq('Steady Stores');
      const co = await company({ name, locations: [{ city: 'Dindigul' }] });
      const rec = person({ personName: 'Steady Sundar', linkedinUrl: 'https://www.linkedin.com/in/steady-sundar-1', company: { name, city: 'Dindigul' } });
      await ingest.ingest([rec], { sourceKey: 'people-json', batchRef: 's1' });
      const snap = async () => ({ people: (await db.select().from(schema.people)).length, roles: (await db.select().from(schema.companyPeople)).length, evidence: (await db.select().from(schema.peopleEvidence)).length });
      const before = await snap();
      await ingest.ingest([rec], { sourceKey: 'people-json', batchRef: 's2' }); // new acquisition
      await ingest.ingest([rec], { sourceKey: 'people-json', batchRef: 's2' }); // same acquisition
      expect(await snap()).toEqual(before);
      expect((await db.select().from(schema.companyPeople).where(eq(schema.companyPeople.businessId, co.id))).length).toBe(1);
    });

    it('explicit references keep working exactly as before (id, slug, identifier); disagreeing ones are ambiguous', async () => {
      const a = await company({ name: uniq('Legacy A'), slug: uniq('legacy-a'), identifiers: [['CIN', 'U33333TN2012PTC000001']] });
      const b = await company({ name: uniq('Legacy B'), slug: uniq('legacy-b') });
      const ok = await ingest.ingest([person({ businessId: a.id }), person({ businessSlug: a.slug }), person({ businessIdentifier: { type: 'CIN', value: 'U33333TN2012PTC000001' } })]);
      expect(ok.results.map((r) => r.outcome)).toEqual(['CREATED', 'CREATED', 'CREATED']);
      const clash = await ingest.ingest([person({ businessId: a.id, businessSlug: b.slug })]);
      expect(clash.results[0].reasons![0].code).toBe('AMBIGUOUS_COMPANY_MATCH');
      const check = await ingest.checkCompany({ id: a.id, slug: b.slug });
      expect(check.status).toBe('AMBIGUOUS');
      expect(check.candidates!.map((c) => c.companyId).sort()).toEqual([a.id, b.id].sort());
      expect(check.candidates!.every((c) => typeof c.companyName === 'string')).toBe(true);
    });

    it('the company hints are validated and bounded; unknown shapes cannot smuggle state', async () => {
      const co = await company({ name: uniq('Bounded Co'), locations: [{ city: 'Ooty' }] });
      const long = 'x'.repeat(5000);
      const r = await ingest.ingest([person({ company: { name: long, city: 'Ooty', website: long, identifiers: [{ type: 'CIN', value: long }] } as any })]);
      expect(r.results[0].outcome).toBe('QUARANTINED'); // nothing matched; nothing crashed
      const weird = await ingest.ingest([person({ company: { name: { $ne: 1 } as any, identifiers: 'nope' as any, city: 5 as any } as any })]);
      expect(weird.results[0].outcome).toBe('QUARANTINED');
      expect(weird.results[0].reasons![0].code).toBe('MISSING_BUSINESS');
      void co;
    });
  });
});

import { eq } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { IPeopleSource, IRawPersonRecord } from '../ingestion/ingestion.types';
import { PeopleIngestionService } from '../ingestion/people-ingestion.service';
import { CsvPeopleSource, JsonPeopleSource } from '../ingestion/sources/people-sources';
import { PeopleWriteService } from '../people-write.service';
import { BUILT_IN_SOURCES, BUILT_IN_SOURCE_KEYS, LEGACY_INTERNAL_POLICY } from '../sources/built-in-sources';
import { applySourcePolicy, findForbiddenFields, findSecretLikeContent } from '../sources/source-policy';
import { ObservationService } from '../observations/observation.service';
import { SourceRegistryService, toDefinition } from '../sources/source-registry.service';
import { INewSource, IPeopleSourceAdapter, ISourcePolicy } from '../sources/source.types';
import { expectLedgerConsistent } from './ledger-invariants';
import { createTestDb, readMigration, seedBusiness } from './pglite-test-db';

const SRC_DIR = path.resolve(__dirname, '../../..');
const REG_SOURCE = { type: 'MANUAL_IMPORT', label: 'sheet', reference: 'sheet-1', evidenceType: 'UPLOAD_ROW' };

describe('People source registry + source contract (Phase 6.1)', () => {
  let db: DrizzleDb;
  let closeDb: () => Promise<void>;
  let registry: SourceRegistryService;
  let ingest: PeopleIngestionService;
  let client: { query: (...a: any[]) => Promise<any>; exec: (sql: string) => Promise<any> };
  let n = 0;

  const newCompany = () => seedBusiness(db, `src-co-${++n}-${Math.random().toString(36).slice(2, 6)}`);
  const person = (co: { id: string }, name: string, extra: Record<string, unknown> = {}): IRawPersonRecord =>
    ({ businessId: co.id, personName: name, jobTitle: 'Director', source: { ...REG_SOURCE }, ...extra }) as IRawPersonRecord;
  const roles = () => db.select().from(schema.companyPeople);
  const peopleRows = () => db.select().from(schema.people);
  const ledger = () => db.select().from(schema.peopleVerifications);
  const quarantine = () => db.select().from(schema.peopleIngestionQuarantine);

  /** A test adapter: only ever RETURNS records. It has no database and no People service. */
  class TestAdapter implements IPeopleSourceAdapter {
    constructor(
      readonly sourceKey: string,
      private readonly data: IRawPersonRecord[],
      readonly name = 'test adapter',
      readonly sourceVersion?: string,
    ) {}
    records() {
      return this.data;
    }
  }

  const externalSource = (over: Partial<INewSource> = {}): INewSource => ({
    key: `ext-${++n}`,
    displayName: 'Test partner feed',
    sourceType: 'PARTNER_FEED',
    termsAcknowledged: true,
    termsReference: 'contract #1',
    enabled: true,
    costClass: 'LOW',
    freshnessTtlDays: 90,
    policy: {
      permissions: { identity: true, title: true, email: true, evidence: true },
      allowedEvidenceTypes: ['ROLE_CLAIM', 'UPLOAD_ROW'],
      enforceSourceType: true,
      maxAttestation: 'NONE',
    },
    ...over,
  });

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    client = t.client as any;
    closeDb = () => t.client.close();
    registry = new SourceRegistryService(db);
    ingest = new PeopleIngestionService(db, new PeopleWriteService(db), registry, new ObservationService(db));
  }, 60_000);

  afterAll(async () => {
    await expectLedgerConsistent(db);
    await closeDb?.();
  });

  // ================================================================ registry
  describe('registration, lookup, versions', () => {
    it('1. registers a source: deny by default, disabled unless its terms are acknowledged', async () => {
      const def = await registry.register(externalSource({ key: 'partner-a' }));
      expect(def).toMatchObject({ key: 'partner-a', sourceType: 'PARTNER_FEED', version: '1', enabled: true, costClass: 'LOW', freshnessTtlDays: 90 });
      expect(def.termsAcknowledgedAt).toBeInstanceOf(Date);
      expect(def.policy).toEqual({
        permissions: { identity: true, title: true, email: true, phone: false, linkedin: false, evidence: true, attestation: false },
        enforceSourceType: true,
        allowedEvidenceTypes: ['ROLE_CLAIM', 'UPLOAD_ROW'],
        maxAttestation: 'NONE',
      });

      const quiet = await registry.register(externalSource({ key: 'partner-quiet', termsAcknowledged: false, enabled: false }));
      expect(quiet).toMatchObject({ enabled: false, termsAcknowledgedAt: null });
      await expect(registry.register(externalSource({ key: 'partner-bad', termsAcknowledged: false, enabled: true }))).rejects.toMatchObject({ errorCode: 'SOURCE_TERMS_NOT_ACKNOWLEDGED' });
    });

    it('2. a duplicate registration is refused (also for the built-in keys); keys are validated', async () => {
      await registry.register(externalSource({ key: 'dup-source' }));
      await expect(registry.register(externalSource({ key: 'dup-source' }))).rejects.toMatchObject({ errorCode: 'SOURCE_EXISTS' });
      await expect(registry.register(externalSource({ key: BUILT_IN_SOURCE_KEYS.CSV }))).rejects.toMatchObject({ errorCode: 'SOURCE_EXISTS' });
      for (const key of ['', 'A', 'UPPER', 'has space', '-lead', 'x'.repeat(61)]) {
        await expect(registry.register(externalSource({ key }))).rejects.toMatchObject({ errorCode: 'INVALID_SOURCE_KEY' });
      }
      expect((await db.select().from(schema.peopleSources).where(eq(schema.peopleSources.key, 'dup-source')))).toHaveLength(1);
    });

    it('5. lookup: get, list, unknown key', async () => {
      expect(await registry.get('people-csv')).toMatchObject({ key: 'people-csv', displayName: 'People CSV import' });
      expect(await registry.get('no-such-source')).toBeNull();
      const keys = (await registry.list()).map((s) => s.key);
      expect(keys).toEqual([...keys].sort());
      expect(keys).toEqual(expect.arrayContaining(['company-upload', 'people-csv', 'people-json']));
      await expect(registry.assertUsable('no-such-source')).rejects.toMatchObject({ errorCode: 'SOURCE_NOT_REGISTERED' });
    });

    it('6. version: seeded at 1, settable at registration, and the ingestion report records the registry version', async () => {
      expect((await registry.get('people-json'))!.version).toBe('1');
      await registry.register(externalSource({ key: 'versioned', version: '2.1' }));
      const co = await newCompany();
      const report = await ingest.ingestFromSource(new TestAdapter('versioned', [person(co, 'Vera Versioned')], 'v', '9.9'));
      expect(report.source).toEqual({ key: 'versioned', version: '2.1' }); // the registry is authoritative, not the adapter
      expect(report.created).toBe(1);
    });

    it('registry rows hold no credentials: nothing secret-like is accepted and there is no credential column', async () => {
      await expect(registry.register(externalSource({ key: 'leaky-1', policy: { permissions: { identity: true }, allowedEvidenceTypes: ['ROLE_CLAIM'], ...({ apiKey: 'abc' } as object) } }))).rejects.toMatchObject({ errorCode: 'SOURCE_SECRET_REJECTED' });
      await expect(registry.register(externalSource({ key: 'leaky-2', displayName: 'Bearer abcdef123456' }))).rejects.toMatchObject({ errorCode: 'SOURCE_SECRET_REJECTED' });
      await expect(registry.register(externalSource({ key: 'leaky-3', termsReference: 'sk-abcdefghijkl12345' }))).rejects.toMatchObject({ errorCode: 'SOURCE_SECRET_REJECTED' });
      await expect(registry.acknowledgeTerms('partner-a', 'token=eyJabcdefghijk.payload')).rejects.toMatchObject({ errorCode: 'SOURCE_SECRET_REJECTED' });
      expect(findSecretLikeContent({ policy: { nested: { clientSecret: 'x' } } })).toMatch(/clientSecret/);
      expect(findSecretLikeContent({ permissions: { identity: true } })).toBeNull();
      const cols = (await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'people_sources'`)).rows.map((r: any) => r.column_name);
      expect(cols.filter((c: string) => /key$|secret|token|password|credential/i.test(c))).toEqual(['key']); // only the source KEY (an identifier)
    });

    it('external source types must list their evidence types (service and database)', async () => {
      await expect(registry.register(externalSource({ key: 'ext-open', policy: { permissions: { identity: true }, allowedEvidenceTypes: null } }))).rejects.toMatchObject({ errorCode: 'INVALID_SOURCE_POLICY' });
      await expect(registry.register(externalSource({ key: 'ext-perm', policy: { permissions: { identity: true, bogus: true } as any, allowedEvidenceTypes: ['ROLE_CLAIM'] } }))).rejects.toMatchObject({ errorCode: 'INVALID_SOURCE_POLICY' });
      await expect(registry.register(externalSource({ key: 'ext-att', policy: { permissions: { identity: true }, allowedEvidenceTypes: ['ROLE_CLAIM'], maxAttestation: 'FULL' } }))).rejects.toMatchObject({ errorCode: 'INVALID_SOURCE_POLICY' }); // attestation not permitted
      // a human-supplied internal type may be unrestricted
      await expect(registry.register(externalSource({ key: 'internal-open', sourceType: 'USER_SUBMISSION', policy: { permissions: { identity: true, title: true }, allowedEvidenceTypes: null } }))).resolves.toBeDefined();
      // the database refuses the same things independently of the service
      await expect(client.query(`INSERT INTO people_sources (key, display_name, source_type) VALUES ('raw-ext', 'x', 'API_INTEGRATION')`)).rejects.toThrow();
      await expect(client.query(`INSERT INTO people_sources (key, display_name, source_type, enabled) VALUES ('raw-enabled', 'x', 'MANUAL_IMPORT', true)`)).rejects.toThrow();
      await expect(client.query(`INSERT INTO people_sources (key, display_name, source_type, policy) VALUES ('raw-policy', 'x', 'MANUAL_IMPORT', '[]'::jsonb)`)).rejects.toThrow();
      await expect(client.query(`INSERT INTO people_sources (key, display_name, source_type, max_attestation) VALUES ('raw-att', 'x', 'MANUAL_IMPORT', 'EVERYTHING')`)).rejects.toThrow();
      await expect(client.query(`INSERT INTO people_sources (key, display_name, source_type) VALUES ('BAD KEY', 'x', 'MANUAL_IMPORT')`)).rejects.toThrow();
    });
  });

  // ================================================================ built-in sources
  describe('existing sources are registered; the seed is deterministic', () => {
    it('7. migration 0009 seeds exactly the existing sources, identically on every run', async () => {
      const snapshot = async () => (await client.query(`SELECT id, key, display_name, source_type, version, enabled, terms_reference, terms_acknowledged_at, cost_class, freshness_ttl_days, max_attestation, allowed_evidence_types, policy, created_at, updated_at FROM people_sources WHERE key IN ('people-csv','people-json','company-upload') ORDER BY key`)).rows;
      const before = await snapshot();
      expect(before).toHaveLength(3);
      await client.exec(readMigration('0009_people_sources.sql'));
      await client.exec(readMigration('0009_people_sources.sql'));
      expect(await snapshot()).toEqual(before); // nothing duplicated, nothing rewritten
      expect(before.map((r: any) => r.id)).toEqual(['00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']);
      // the code-side list mirrors the seed
      expect(BUILT_IN_SOURCES.map((s) => ({ key: s.key, displayName: s.displayName, sourceType: s.sourceType, version: s.version })).sort((a, b) => a.key.localeCompare(b.key))).toEqual(
        before.map((r: any) => ({ key: r.key, displayName: r.display_name, sourceType: r.source_type, version: r.version })),
      );
      // no external provider is registered by the seed
      const seedSql = readMigration('0009_people_sources.sql');
      expect(seedSql).not.toMatch(/apollo|signalhire|contactout|linkedin\.com|mca|udyam|fssai/i);
    });

    it('built-in sources carry today\'s behaviour as policy (everything permitted, unrestricted, FULL attestation cap)', async () => {
      for (const key of Object.values(BUILT_IN_SOURCE_KEYS)) {
        const def = (await registry.assertUsable(key))!;
        expect(def.policy).toEqual(LEGACY_INTERNAL_POLICY);
        expect(def).toMatchObject({ enabled: true, sourceType: 'MANUAL_IMPORT', costClass: 'NONE', freshnessTtlDays: null });
        expect(def.termsAcknowledgedAt).toBeInstanceOf(Date);
      }
    });

    it('8. CSV: the built-in CSV source declares its registry key and ingests exactly as before', async () => {
      const co = await newCompany();
      const csv = `business_id,person_name,job_title,email,source_type,source_reference,evidence_type\n${co.id},Csv Chandra,Managing Director,csv.chandra@corp-src.co.in,MANUAL_IMPORT,sheet-1,UPLOAD_ROW\n`;
      const source = new CsvPeopleSource('csv test', csv);
      expect(source.sourceKey).toBe('people-csv');
      const report = await ingest.ingestFromSource(source);
      expect(report).toMatchObject({ total: 1, created: 1, quarantined: 0, source: { key: 'people-csv', version: '1' } });
      const [p] = await peopleRows().then((r) => r.filter((x) => x.fullName === 'Csv Chandra'));
      expect(p).toMatchObject({ dataStatus: 'DRAFT' });
    });

    it('9. JSON: the built-in JSON source declares its registry key and ingests exactly as before', async () => {
      const co = await newCompany();
      const source = new JsonPeopleSource('json test', [person(co, 'Json Jagan')]);
      expect(source.sourceKey).toBe('people-json');
      const report = await ingest.ingestFromSource(source);
      expect(report).toMatchObject({ total: 1, created: 1, source: { key: 'people-json', version: '1' } });
      expect((await roles()).find((r) => r.businessId === co.id)).toMatchObject({ reviewStatus: 'PENDING', isPublished: false });
    });

    it('10. upload: the bridge key is registered and matches the registry constant', async () => {
      const { UPLOAD_SOURCE_KEY } = await import('../../import/people/import-people.bridge');
      expect(UPLOAD_SOURCE_KEY).toBe(BUILT_IN_SOURCE_KEYS.COMPANY_UPLOAD);
      expect((await registry.assertUsable(UPLOAD_SOURCE_KEY)).displayName).toBe('Company upload (People bridge)');
      const co = await newCompany();
      const report = await ingest.ingest([person(co, 'Upload Uma')], { sourceKey: UPLOAD_SOURCE_KEY, batchRef: 'import-batch:x' });
      expect(report).toMatchObject({ created: 1, source: { key: 'company-upload' } });
    });

    it('14. regression: a keyed run gives the same outcomes as the same records through the unkeyed path', async () => {
      const a = await newCompany();
      const b = await newCompany();
      const make = (co: { id: string }, tag: string) => [
        person(co, 'Same Sarala', { email: `sarala.${tag}@corp-src.co.in`, linkedinUrl: `https://www.linkedin.com/in/same-sarala-${tag}` }),
        person(co, 'Same Sarala', { email: `sarala.${tag}@corp-src.co.in` }), // repeat: unchanged
        person(co, 'Sole', {}), // incomplete name -> quarantined
        { ...person(co, 'Verified Vimal'), verification: { status: 'VERIFIED', verifiedAt: new Date(Date.now() - 86_400_000), verifiedBy: 'desk' } },
      ];
      const keyed = await ingest.ingestFromSource(new JsonPeopleSource('keyed', make(a, 'aaa')));
      const unkeyed = await ingest.ingest(make(b, 'bbb'), { sourceLabel: 'unkeyed' });
      expect(unkeyed.source).toBeUndefined();
      const shape = (r: typeof keyed) => ({ c: r.created, u: r.updated, n: r.unchanged, q: r.quarantined, outcomes: r.results.map((x) => x.outcome), codes: r.results.map((x) => (x.reasons ?? []).map((y) => y.code)) });
      expect(shape(keyed)).toEqual(shape(unkeyed));
      // same stored result for the attested record either way
      const roleFor = async (co: { id: string }) => (await roles()).find((r) => r.businessId === co.id && r.jobTitleAtCompany === 'Director' && r.verificationStatus === 'VERIFIED');
      expect(await roleFor(a)).toBeDefined();
      expect(await roleFor(b)).toBeDefined();
    });
  });

  // ================================================================ disabled sources
  describe('disabled or unacknowledged sources', () => {
    it('3. a disabled source cannot ingest anything; re-enabling works; terms must be acknowledged first', async () => {
      await registry.register(externalSource({ key: 'switchable' }));
      const co = await newCompany();
      const adapter = new TestAdapter('switchable', [person(co, 'Switch Sanjana')]);
      await registry.setEnabled('switchable', false);
      const before = { people: (await peopleRows()).length, quarantine: (await quarantine()).length };
      await expect(ingest.ingestFromSource(adapter)).rejects.toMatchObject({ errorCode: 'SOURCE_DISABLED' });
      await expect(ingest.ingest([person(co, 'Switch Sanjana')], { sourceKey: 'switchable' })).rejects.toMatchObject({ errorCode: 'SOURCE_DISABLED' });
      expect({ people: (await peopleRows()).length, quarantine: (await quarantine()).length }).toEqual(before); // nothing written, nothing quarantined

      await registry.setEnabled('switchable', true);
      expect((await ingest.ingestFromSource(adapter)).created).toBe(1);

      await registry.register(externalSource({ key: 'no-terms', termsAcknowledged: false, enabled: false }));
      await expect(registry.setEnabled('no-terms', true)).rejects.toMatchObject({ errorCode: 'SOURCE_TERMS_NOT_ACKNOWLEDGED' });
      await expect(ingest.ingest([person(co, 'Terms Tara')], { sourceKey: 'no-terms' })).rejects.toMatchObject({ errorCode: 'SOURCE_TERMS_NOT_ACKNOWLEDGED' });
      await registry.acknowledgeTerms('no-terms', 'signed 2026-09-30');
      await registry.setEnabled('no-terms', true);
      expect((await ingest.ingest([person(co, 'Terms Tara')], { sourceKey: 'no-terms' })).created).toBe(1);
    });

    it('an unregistered key is refused; without a registry the keyed path is refused, never skipped', async () => {
      const co = await newCompany();
      await expect(ingest.ingest([person(co, 'Ghost Gayatri')], { sourceKey: 'never-registered' })).rejects.toMatchObject({ errorCode: 'SOURCE_NOT_REGISTERED' });
      const bare = new PeopleIngestionService(db, new PeopleWriteService(db));
      await expect(bare.ingest([person(co, 'Ghost Gayatri')], { sourceKey: 'people-json' })).rejects.toMatchObject({ errorCode: 'SOURCE_REGISTRY_UNAVAILABLE' });
      expect((await peopleRows()).find((p) => p.fullName === 'Ghost Gayatri')).toBeUndefined();
    });
  });

  // ================================================================ policy
  describe('4. source policy', () => {
    const policy = (over: { permissions?: Partial<ISourcePolicy['permissions']>; enforceSourceType?: boolean; allowedEvidenceTypes?: string[] | null; maxAttestation?: ISourcePolicy['maxAttestation'] } = {}): ISourcePolicy => ({
      permissions: { identity: true, title: true, email: true, phone: true, linkedin: true, evidence: true, attestation: true, ...(over.permissions ?? {}) },
      enforceSourceType: over.enforceSourceType ?? false,
      allowedEvidenceTypes: over.allowedEvidenceTypes === undefined ? null : over.allowedEvidenceTypes,
      maxAttestation: over.maxAttestation ?? 'FULL',
    });
    const rec = (over: Record<string, unknown> = {}) =>
      ({ businessId: 'b', personName: 'Pol Icy', jobTitle: 'CEO', email: 'pol@corp-src.co.in', phone: '0422 255 0100', mobile: '9876543210', linkedinUrl: 'https://www.linkedin.com/in/pol-icy-1', source: { type: 'GOVERNMENT_REGISTRY', url: 'https://x.example/a', reference: 'r', evidenceType: 'REGISTRY_FILING', observedAt: '2026-01-01' }, ...over }) as IRawPersonRecord;

    it('unpermitted contact fields are dropped with a warning; identity/title violations reject the record', () => {
      const r = applySourcePolicy(policy({ permissions: { email: false, phone: false, linkedin: false } }), 'PARTNER_FEED', rec());
      expect(r.violations).toEqual([]);
      expect(r.record).not.toHaveProperty('email');
      expect(r.record).not.toHaveProperty('phone');
      expect(r.record).not.toHaveProperty('mobile');
      expect(r.record).not.toHaveProperty('linkedinUrl');
      expect(r.warnings.map((w) => w.code).sort()).toEqual(['SOURCE_FIELD_NOT_PERMITTED:email', 'SOURCE_FIELD_NOT_PERMITTED:linkedin', 'SOURCE_FIELD_NOT_PERMITTED:mobile', 'SOURCE_FIELD_NOT_PERMITTED:phone']);
      expect(applySourcePolicy(policy({ permissions: { identity: false } }), 'PARTNER_FEED', rec()).violations[0].code).toBe('SOURCE_NOT_PERMITTED');
      expect(applySourcePolicy(policy({ permissions: { title: false } }), 'PARTNER_FEED', rec()).violations[0].code).toBe('SOURCE_NOT_PERMITTED');
    });

    it('evidence permission and allowed evidence types', () => {
      const noEv = applySourcePolicy(policy({ permissions: { evidence: false } }), 'PARTNER_FEED', rec());
      expect(noEv.record.source).toEqual({ type: 'GOVERNMENT_REGISTRY' });
      expect(noEv.warnings.map((w) => w.code)).toContain('SOURCE_FIELD_NOT_PERMITTED:evidence');
      const bad = applySourcePolicy(policy({ allowedEvidenceTypes: ['ROLE_CLAIM'] }), 'PARTNER_FEED', rec());
      expect(bad.violations[0].code).toBe('SOURCE_EVIDENCE_TYPE_NOT_ALLOWED');
      expect(applySourcePolicy(policy({ allowedEvidenceTypes: ['ROLE_CLAIM'] }), 'PARTNER_FEED', rec({ source: { type: 'PARTNER_FEED', reference: 'x' } })).violations).toEqual([]); // default ROLE_CLAIM is allowed
      expect(applySourcePolicy(policy({ allowedEvidenceTypes: ['UPLOAD_ROW'] }), 'PARTNER_FEED', rec({ source: { type: 'PARTNER_FEED', reference: 'x' } })).violations[0].code).toBe('SOURCE_EVIDENCE_TYPE_NOT_ALLOWED'); // even the default is checked
    });

    it('a source cannot pose as a registry: the registered type replaces the claimed one', () => {
      const r = applySourcePolicy(policy({ enforceSourceType: true }), 'PARTNER_FEED', rec());
      expect(r.record.source!.type).toBe('PARTNER_FEED');
      expect(r.warnings.map((w) => w.code)).toContain('SOURCE_TYPE_OVERRIDDEN');
      expect(applySourcePolicy(policy({ enforceSourceType: false }), 'PARTNER_FEED', rec()).record.source!.type).toBe('GOVERNMENT_REGISTRY');
    });

    it('attestation is capped by the configured maximum, never raised, and dropped when not permitted', () => {
      const v = (status: string) => rec({ verification: { status, verifiedAt: '2026-01-01', verifiedBy: 'x' } });
      expect(applySourcePolicy(policy({ maxAttestation: 'FULL' }), 'PARTNER_FEED', v('VERIFIED')).record.verification!.status).toBe('VERIFIED');
      const partial = applySourcePolicy(policy({ maxAttestation: 'PARTIAL' }), 'PARTNER_FEED', v('VERIFIED'));
      expect(partial.record.verification!.status).toBe('PARTIALLY_VERIFIED');
      expect(partial.warnings.map((w) => w.code)).toContain('SOURCE_ATTESTATION_CAPPED');
      expect(applySourcePolicy(policy({ maxAttestation: 'PARTIAL' }), 'PARTNER_FEED', v('PARTIALLY_VERIFIED')).record.verification!.status).toBe('PARTIALLY_VERIFIED'); // not raised
      expect(applySourcePolicy(policy({ maxAttestation: 'NONE' }), 'PARTNER_FEED', v('VERIFIED')).record.verification).toBeUndefined();
      expect(applySourcePolicy(policy({ permissions: { attestation: false }, maxAttestation: 'FULL' }), 'PARTNER_FEED', v('VERIFIED')).record.verification).toBeUndefined(); // permission wins over level
      expect(applySourcePolicy(policy({ permissions: { attestation: false } }), 'PARTNER_FEED', v('CONFLICTED')).record.verification).toBeUndefined();
    });

    it('the input record is never mutated', () => {
      const input = rec({ verification: { status: 'VERIFIED', verifiedAt: '2026-01-01', verifiedBy: 'x' } });
      const snapshot = JSON.parse(JSON.stringify(input));
      applySourcePolicy(policy({ permissions: { email: false, attestation: false }, enforceSourceType: true }), 'PARTNER_FEED', input);
      expect(JSON.parse(JSON.stringify(input))).toEqual(snapshot);
    });

    it('a stored policy that is malformed grants nothing', () => {
      const def = toDefinition({ id: 'i', key: 'k', displayName: 'd', sourceType: 'PARTNER_FEED', version: '1', enabled: true, termsReference: null, termsAcknowledgedAt: new Date(), costClass: 'LOW', freshnessTtlDays: null, maxAttestation: 'FULL', allowedEvidenceTypes: [], policy: { permissions: { identity: 'yes', title: 1 } } as any, createdAt: new Date(), updatedAt: new Date() });
      expect(Object.values(def.policy.permissions).every((v) => v === false)).toBe(true);
      expect(def.policy.maxAttestation).toBe('NONE'); // FULL is meaningless without the attestation permission
    });

    it('policy is enforced end to end: out-of-policy fields are dropped, out-of-policy records are quarantined, nothing slips through', async () => {
      await registry.register(externalSource({ key: 'strict-feed' }));
      const co = await newCompany();
      const records = [
        person(co, 'Policy Padma', { email: 'padma.policy@corp-src.co.in', phone: '0422 255 0199', linkedinUrl: 'https://www.linkedin.com/in/policy-padma-1', source: { type: 'GOVERNMENT_REGISTRY', label: 'claims to be a registry', reference: 'r-1', evidenceType: 'UPLOAD_ROW' } }),
        person(co, 'Policy Pranav', { source: { type: 'PARTNER_FEED', reference: 'r-2', evidenceType: 'REGISTRY_FILING' } }), // evidence type not allowed
      ];
      const report = await ingest.ingestFromSource(new TestAdapter('strict-feed', records));
      expect(report).toMatchObject({ created: 1, quarantined: 1 });
      expect(report.results[0].warnings!.map((w) => w.code)).toEqual(expect.arrayContaining(['SOURCE_FIELD_NOT_PERMITTED:phone', 'SOURCE_FIELD_NOT_PERMITTED:linkedin', 'SOURCE_TYPE_OVERRIDDEN']));
      expect(report.results[1].reasons![0].code).toBe('SOURCE_EVIDENCE_TYPE_NOT_ALLOWED');
      const padma = (await peopleRows()).find((p) => p.fullName === 'Policy Padma')!;
      expect(padma.linkedinUrl).toBeNull();
      const contacts = await db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, padma.id));
      expect(contacts.map((c) => c.contactType)).toEqual(['WORK_EMAIL']); // phone dropped
      const ev = await db.select().from(schema.peopleEvidence).where(eq(schema.peopleEvidence.personId, padma.id));
      expect(ev.every((e) => e.sourceType === 'PARTNER_FEED')).toBe(true); // the claimed GOVERNMENT_REGISTRY was overridden
      expect((await peopleRows()).find((p) => p.fullName === 'Policy Pranav')).toBeUndefined();
    });
  });

  // ================================================================ boundary
  describe('security boundary: an adapter cannot write review, verification or publication state', () => {
    const forbidden: Array<[string, Record<string, unknown>]> = [
      ['11. publication', { isPublished: true }],
      ['11. publication (snake case)', { is_published: true }],
      ['11. person publication', { dataStatus: 'PUBLISHED' }],
      ['12. review', { reviewStatus: 'APPROVED' }],
      ['12. review (snake case)', { review_status: 'APPROVED' }],
      ['12. reviewer', { reviewedBy: 'admin@example.com' }],
      ['13. verification', { verificationStatus: 'VERIFIED' }],
      ['13. verification (snake case)', { verification_status: 'VERIFIED' }],
      ['13. nested in source', { source: { type: 'PARTNER_FEED', reference: 'x', verificationStatus: 'VERIFIED' } }],
      ['13. nested in verification', { verification: { status: 'VERIFIED', verifiedAt: '2026-01-01', verifiedBy: 'x', reviewStatus: 'APPROVED' } }],
      ['classification ownership', { classificationSource: 'REVIEWER' }],
    ];

    it.each(forbidden)('%s: a record carrying it is quarantined whole, and nothing is created', async (_label, extra) => {
      const name = `Forbidden ${String.fromCharCode(97 + Math.floor(Math.random() * 26))}${String.fromCharCode(97 + Math.floor(Math.random() * 26))}rdvark`;
      const co = await newCompany();
      const before = { people: (await peopleRows()).length, roles: (await roles()).length, ledger: (await ledger()).length };
      const report = await ingest.ingestFromSource(new TestAdapter('people-json', [person(co, name, extra)]));
      expect(report).toMatchObject({ created: 0, quarantined: 1 });
      expect(report.results[0].reasons![0].code).toBe('SOURCE_FORBIDDEN_FIELD');
      expect({ people: (await peopleRows()).length, roles: (await roles()).length, ledger: (await ledger()).length }).toEqual(before);
    });

    it('findForbiddenFields sees the keys however they are spelled, and nothing for clean records', () => {
      expect(findForbiddenFields({ IsPublished: true, 'review-status': 'X', source: { 'Verification_Status': 'V' } }).sort()).toEqual(['IsPublished', 'review-status', 'source.Verification_Status']);
      expect(findForbiddenFields({ personName: 'A B', verification: { status: 'VERIFIED', verifiedAt: 'x', verifiedBy: 'y' }, source: { type: 'X' } })).toEqual([]);
    });

    it('even a fully permitted source only ever produces DRAFT / PENDING data; an attestation is a SYSTEM event, never a human verification', async () => {
      await registry.register(
        externalSource({ key: 'trusted-feed', policy: { permissions: { identity: true, title: true, evidence: true, attestation: true }, allowedEvidenceTypes: ['ROLE_CLAIM', 'REGISTRY_FILING'], maxAttestation: 'FULL' } }),
      );
      const co = await newCompany();
      const rec = person(co, 'Attested Anita', { source: { type: 'PARTNER_FEED', reference: 'feed-1', evidenceType: 'REGISTRY_FILING' }, verification: { status: 'VERIFIED', verifiedAt: new Date(Date.now() - 86_400_000), verifiedBy: 'partner desk' } });
      const report = await ingest.ingestFromSource(new TestAdapter('trusted-feed', [rec]));
      expect(report.created).toBe(1);
      const role = (await roles()).find((r) => r.businessId === co.id)!;
      const p = (await peopleRows()).find((x) => x.id === role.personId)!;
      expect(role).toMatchObject({ reviewStatus: 'PENDING', isPublished: false, verificationStatus: 'VERIFIED' });
      expect(p.dataStatus).toBe('DRAFT');
      const rows = (await ledger()).filter((l) => l.personId === p.id);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((l) => l.verifiedByKind === 'SYSTEM' && l.verifiedById === null && l.method === 'INGESTION_ATTESTED')).toBe(true);
    });

    it('a source capped at PARTIAL or without the attestation permission cannot produce a VERIFIED role', async () => {
      await registry.register(
        externalSource({ key: 'partial-feed', policy: { permissions: { identity: true, title: true, evidence: true, attestation: true }, allowedEvidenceTypes: ['ROLE_CLAIM'], maxAttestation: 'PARTIAL' } }),
      );
      await registry.register(externalSource({ key: 'mute-feed', policy: { permissions: { identity: true, title: true, evidence: true }, allowedEvidenceTypes: ['ROLE_CLAIM'] } }));
      const claim = { verification: { status: 'VERIFIED', verifiedAt: new Date(Date.now() - 86_400_000), verifiedBy: 'desk' }, source: { type: 'PARTNER_FEED', reference: 'f', evidenceType: 'ROLE_CLAIM' } };
      const a = await newCompany();
      const b = await newCompany();
      await ingest.ingestFromSource(new TestAdapter('partial-feed', [person(a, 'Partial Parvati', claim)]));
      await ingest.ingestFromSource(new TestAdapter('mute-feed', [person(b, 'Mute Mohan', claim)]));
      expect((await roles()).find((r) => r.businessId === a.id)!.verificationStatus).toBe('PARTIALLY_VERIFIED');
      expect((await roles()).find((r) => r.businessId === b.id)!.verificationStatus).toBe('UNVERIFIED');
      await expectLedgerConsistent(db);
    });

    it('by construction an adapter has no write capability (types)', () => {
      // @ts-expect-error a raw record has no publication field
      const a: IRawPersonRecord = { personName: 'X Y', isPublished: true };
      // @ts-expect-error a raw record has no review field
      const b: IRawPersonRecord = { personName: 'X Y', reviewStatus: 'APPROVED' };
      // @ts-expect-error a raw record has no verification-status field (only the capped `verification` claim block)
      const c: IRawPersonRecord = { personName: 'X Y', verificationStatus: 'VERIFIED' };
      const adapter: IPeopleSourceAdapter = new TestAdapter('x', []);
      // @ts-expect-error the adapter contract exposes no database or People service
      void adapter.db;
      void [a, b, c];
      const plain: IPeopleSource = { name: 'p', records: () => [] };
      expect(plain.sourceKey).toBeUndefined(); // an unkeyed source is still valid (legacy path)
    });

    it('structural: adapter-side code (sources and the contract) imports no database, People service or publishing code', () => {
      const files = [
        path.join(SRC_DIR, 'modules/people/ingestion/sources/people-sources.ts'),
        path.join(SRC_DIR, 'modules/people/sources/source.types.ts'),
        path.join(SRC_DIR, 'modules/people/sources/source-policy.ts'),
        path.join(SRC_DIR, 'modules/people/sources/built-in-sources.ts'),
      ];
      for (const f of files) {
        const text = fs.readFileSync(f, 'utf8');
        expect({ f: path.basename(f), hit: /drizzle-orm|database\/|DRIZZLE_DATABASE|people-write|people-publishing|Verification(Service|Controller)|PeopleReviewService|schema\./.exec(text)?.[0] ?? null }).toEqual({ f: path.basename(f), hit: null });
      }
    });

    it('structural: the registry and the contract grant no write path into People state', () => {
      const svc = fs.readFileSync(path.join(SRC_DIR, 'modules/people/sources/source-registry.service.ts'), 'utf8');
      expect(svc).not.toMatch(/schema\.(people\b|companyPeople|personContacts|peopleEvidence|peopleVerifications|peopleIngestionQuarantine)/);
      const ingestion = fs.readFileSync(path.join(SRC_DIR, 'modules/people/ingestion/people-ingestion.service.ts'), 'utf8');
      const code = ingestion.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code).not.toMatch(/verificationStatus|reviewStatus|isPublished|dataStatus/); // the ingestion service still never sets these
    });
  });
});

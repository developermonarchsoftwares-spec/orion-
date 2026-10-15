import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as fs from 'fs';
import * as path from 'path';
import { claimedValueFor } from '../policies/claim-verification.policy';
import { readMigration } from './pglite-test-db';

/**
 * Migration validation on a disposable in-process PostgreSQL (PGlite) using Drizzle's REAL
 * migrator and the real migration folder (same call as src/database/migrate.ts). Nothing here can
 * reach a remote database.
 */
const MIGRATIONS_DIR = path.resolve(__dirname, '../../../database/migrations');
const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8')) as {
  entries: Array<{ idx: number; tag: string }>;
};

const applied = async (c: PGlite) => {
  const r = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM drizzle."__drizzle_migrations"');
  return r.rows[0].n;
};

describe('People migrations 0004-0016 on a clean database', () => {
  let client: PGlite;
  let firstRunCount: number;

  beforeAll(async () => {
    client = new PGlite();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    firstRunCount = await applied(client);
  }, 60_000);

  afterAll(async () => {
    await client.close();
  });

  it('applies every journaled migration in order, including 0004, 0005, 0006 and 0007', async () => {
    const tags = journal.entries.map((e) => e.tag);
    for (const t of ['0004_decision_maker_people', '0005_people_ingestion', '0006_import_people_report', '0007_people_review', '0008_people_verification', '0009_people_sources', '0010_people_observations', '0011_people_suppression', '0012_people_classification_versioning', '0013_people_contact_provenance', '0014_people_freshness', '0015_people_conflicts', '0016_people_acquisition_runs']) {
      expect(tags).toContain(t);
    }
    expect(tags).toEqual([...tags].sort());
    expect(firstRunCount).toBe(journal.entries.length);
  });

  it('a second run applies 0 new migrations', async () => {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR });
    expect(await applied(client)).toBe(firstRunCount);
  });

  it('every People migration is idempotent when its SQL is executed again', async () => {
    for (const f of ['0004_decision_maker_people.sql', '0005_people_ingestion.sql', '0006_import_people_report.sql', '0007_people_review.sql', '0008_people_verification.sql', '0009_people_sources.sql', '0010_people_observations.sql', '0011_people_suppression.sql', '0012_people_classification_versioning.sql', '0013_people_contact_provenance.sql', '0014_people_freshness.sql', '0015_people_conflicts.sql', '0016_people_acquisition_runs.sql']) {
      await expect(client.exec(readMigration(f))).resolves.toBeDefined();
    }
  });

  it('creates the expected People schema', async () => {
    const cols = async (t: string) =>
      (await client.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [t])).rows.map((r) => r.column_name);
    expect(await cols('company_people')).toEqual(
      expect.arrayContaining(['review_status', 'reviewed_at', 'reviewed_by_id', 'review_note', 'classification_source', 'title_aliases', 'is_published', 'normalized_job_title']),
    );
    expect(await cols('people')).toEqual(expect.arrayContaining(['name_aliases', 'data_status', 'normalized_name']));
    expect(await cols('people_ingestion_quarantine')).toEqual(expect.arrayContaining(['resolution', 'fingerprint']));
    for (const t of ['people', 'company_people', 'person_contacts', 'people_evidence', 'person_unlocks', 'people_ingestion_quarantine']) {
      expect((await cols(t)).length).toBeGreaterThan(0);
    }
  });

  it('has the constraints and indexes the workflow relies on', async () => {
    const constraints = (await client.query<{ conname: string }>(`SELECT conname FROM pg_constraint`)).rows.map((r) => r.conname);
    expect(constraints).toEqual(
      expect.arrayContaining(['company_people_review_status_chk', 'company_people_classification_source_chk', 'company_people_published_approved_chk', 'company_people_reviewed_by_id_users_id_fk', 'people_verifications_claim_chk', 'people_verifications_status_chk', 'people_verifications_evidence_id_people_evidence_id_fk', 'people_sources_key_chk', 'people_sources_enabled_terms_chk', 'people_sources_evidence_types_chk', 'people_sources_policy_chk', 'people_sources_attestation_chk', 'people_observations_outcome_chk', 'people_observations_ingested_chk', 'people_observations_bytes_chk', 'people_observations_source_key_people_sources_key_fk', 'people_suppressions_kind_chk', 'people_suppressions_digest_chk', 'people_suppressions_person_id_people_id_fk']),
    );
    const indexes = (await client.query<{ indexname: string }>(`SELECT indexname FROM pg_indexes`)).rows.map((r) => r.indexname);
    expect(indexes).toEqual(
      expect.arrayContaining(['company_people_review_idx', 'company_people_role_uq', 'people_evidence_fingerprint_uq', 'people_quarantine_fingerprint_uq', 'person_contacts_uq', 'people_verifications_target_value_uq', 'people_verifications_person_idx', 'people_verifications_role_idx', 'people_sources_key_uq', 'people_observations_identity_uq', 'people_observations_record_idx', 'people_suppressions_identity_uq', 'people_suppressions_person_idx']),
    );
  });

  it('constraints are enforced by the database', async () => {
    const b = (await client.query<{ id: string }>(`INSERT INTO businesses (name, slug, status) VALUES ('Mig Co', 'mig-co', 'PUBLISHED') RETURNING id`)).rows[0].id;
    const p = (await client.query<{ id: string }>(`INSERT INTO people (full_name, normalized_name) VALUES ('Mig Person', 'mig person') RETURNING id`)).rows[0].id;
    const insert = (extra: string, vals: string, title: string) =>
      client.query(`INSERT INTO company_people (business_id, person_id, job_title_at_company, normalized_job_title${extra}) VALUES ('${b}', '${p}', '${title}', '${title.toLowerCase()}'${vals})`);

    await insert('', '', 'CEO'); // defaults: PENDING, unpublished, AUTO, no aliases
    const row = (await client.query<any>(`SELECT review_status, is_published, classification_source, title_aliases FROM company_people`)).rows[0];
    expect(row).toMatchObject({ review_status: 'PENDING', is_published: false, classification_source: 'AUTO', title_aliases: [] });

    await expect(insert(', review_status', `, 'BOGUS'`, 'CFO')).rejects.toThrow();
    await expect(insert(', is_published', ', true', 'COO')).rejects.toThrow(); // published while PENDING
    await expect(insert(', classification_source', `, 'ROBOT'`, 'CTO')).rejects.toThrow();
    await expect(insert('', '', 'CEO')).rejects.toThrow(); // role uniqueness
    await insert(', is_published, review_status', `, true, 'APPROVED'`, 'CMO'); // valid published role
  });
});

describe('People migrations preserve existing data', () => {
  it('a database at 0006 with published people upgrades to 0007 without changing visibility', async () => {
    const client = new PGlite();
    try {
      const pre = journal.entries.filter((e) => e.tag < '0007').map((e) => e.tag);
      for (const tag of pre) await client.exec(readMigration(`${tag}.sql`));
      const b = (await client.query<{ id: string }>(`INSERT INTO businesses (name, slug, status) VALUES ('Old Co', 'old-co', 'PUBLISHED') RETURNING id`)).rows[0].id;
      const p = (await client.query<{ id: string }>(`INSERT INTO people (full_name, normalized_name, data_status) VALUES ('Old Person', 'old person', 'PUBLISHED') RETURNING id`)).rows[0].id;
      await client.query(`INSERT INTO company_people (business_id, person_id, job_title_at_company, normalized_job_title, is_published) VALUES ($1, $2, 'CEO', 'ceo', true)`, [b, p]);
      await client.query(`INSERT INTO company_people (business_id, person_id, job_title_at_company, normalized_job_title, is_published) VALUES ($1, $2, 'Director', 'director', false)`, [b, p]);

      await client.exec(readMigration('0007_people_review.sql'));
      await client.exec(readMigration('0007_people_review.sql')); // and again
      const rows = (await client.query<any>(`SELECT normalized_job_title AS t, is_published, review_status FROM company_people ORDER BY t`)).rows;
      expect(rows).toEqual([
        { t: 'ceo', is_published: true, review_status: 'APPROVED' },
        { t: 'director', is_published: false, review_status: 'PENDING' },
      ]);
    } finally {
      await client.close();
    }
  }, 60_000);
});

describe('Migration 0008 (people_verifications)', () => {
  it('upgrades a database at 0007 that already holds people, without touching existing rows, and is idempotent', async () => {
    const client = new PGlite();
    try {
      const pre = journal.entries.filter((e) => e.tag < '0008').map((e) => e.tag);
      for (const tag of pre) await client.exec(readMigration(`${tag}.sql`));
      const b = (await client.query<{ id: string }>(`INSERT INTO businesses (name, slug, status) VALUES ('Up Co', 'up-co', 'PUBLISHED') RETURNING id`)).rows[0].id;
      const p = (await client.query<{ id: string }>(`INSERT INTO people (full_name, normalized_name, data_status, verification_status) VALUES ('Up Person', 'up person', 'PUBLISHED', 'VERIFIED') RETURNING id`)).rows[0].id;
      await client.query(`INSERT INTO company_people (business_id, person_id, job_title_at_company, normalized_job_title, is_published, review_status, verification_status) VALUES ($1, $2, 'CEO', 'ceo', true, 'APPROVED', 'VERIFIED')`, [b, p]);
      const snapshot = async () => (await client.query<any>(`SELECT p.verification_status AS pv, cp.verification_status AS cv, cp.is_published, cp.review_status FROM people p JOIN company_people cp ON cp.person_id = p.id`)).rows;
      const before = await snapshot();

      await client.exec(readMigration('0008_people_verification.sql'));
      await client.exec(readMigration('0008_people_verification.sql')); // and again
      expect(await snapshot()).toEqual(before);
      expect((await client.query<any>(`SELECT count(*)::int AS n FROM people_verifications`)).rows[0].n).toBe(0);
      // the one column added to an existing table defaults to empty for existing roles
      expect((await client.query<any>(`SELECT title_aliases FROM company_people`)).rows).toEqual([{ title_aliases: [] }]);
    } finally {
      await client.close();
    }
  }, 60_000);

  it('is additive: creates the ledger table and adds exactly one defaulted column to company_people', () => {
    const text = readMigration('0008_people_verification.sql');
    const alters = [...text.matchAll(/ALTER TABLE\s+"(\w+)"\s+ADD COLUMN IF NOT EXISTS\s+"(\w+)"/g)].map((m) => `${m[1]}.${m[2]}`);
    expect(alters).toEqual(['company_people.title_aliases']);
    const others = [...text.matchAll(/ALTER TABLE\s+"(\w+)"\s+ADD CONSTRAINT/g)].map((m) => m[1]);
    expect(new Set(others)).toEqual(new Set(['people_verifications']));
    expect(text).not.toMatch(/DROP|TRUNCATE|(?<!ON )UPDATE|(?<!ON )DELETE/i);
  });

  it('historical migrations 0004-0007 do not know about Phase 5', () => {
    for (const f of ['0004_decision_maker_people.sql', '0005_people_ingestion.sql', '0006_import_people_report.sql', '0007_people_review.sql']) {
      expect(readMigration(f)).not.toMatch(/title_aliases|people_verifications|people_sources|people_observations|people_suppressions/);
    }
  });
});

describe('Migration 0008 backfill: existing verifications become SYSTEM ledger events (no invented reviewer)', () => {
  it('records verified roles/contacts that have verified evidence, skips unbacked ones, never names a human, is idempotent', async () => {
    const client = new PGlite();
    try {
      for (const tag of journal.entries.filter((e) => e.tag < '0008').map((e) => e.tag)) await client.exec(readMigration(`${tag}.sql`));
      const b = (await client.query<{ id: string }>(`INSERT INTO businesses (name, slug, status) VALUES ('Legacy Co', 'legacy-co', 'PUBLISHED') RETURNING id`)).rows[0].id;
      const person = async (n: string) => (await client.query<{ id: string }>(`INSERT INTO people (full_name, normalized_name) VALUES ($1, $2) RETURNING id`, [n, n.toLowerCase()])).rows[0].id;
      const role = async (p: string, title: string, status: string, verifiedAt: string | null) =>
        (await client.query<{ id: string }>(`INSERT INTO company_people (business_id, person_id, job_title_at_company, normalized_job_title, verification_status, last_verified_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [b, p, title, title.toLowerCase(), status, verifiedAt])).rows[0].id;
      const evidence = async (p: string, roleId: string | null, contactId: string | null, verifiedAt: string | null) =>
        (await client.query<{ id: string }>(`INSERT INTO people_evidence (person_id, company_person_id, contact_id, source_type, evidence_type, source_reference, verified_at) VALUES ($1, $2, $3, 'GOVERNMENT_REGISTRY', 'REGISTRY_FILING', 'ref', $4) RETURNING id`, [p, roleId, contactId, verifiedAt])).rows[0].id;

      const p1 = await person('Full Verified');
      const r1 = await role(p1, 'CEO', 'VERIFIED', '2026-01-01T00:00:00Z');
      await evidence(p1, r1, null, '2026-01-01T00:00:00Z');
      const p2 = await person('Partly Verified');
      const r2 = await role(p2, 'CFO', 'PARTIALLY_VERIFIED', '2026-01-02T00:00:00Z');
      await evidence(p2, r2, null, '2026-01-02T00:00:00Z');
      const p3 = await person('Unbacked Person');
      await role(p3, 'COO', 'VERIFIED', '2026-01-03T00:00:00Z'); // verified status but NO verified evidence
      const c1 = (await client.query<{ id: string }>(`INSERT INTO person_contacts (person_id, contact_type, contact_value, normalized_value, verification_status, last_verified_at) VALUES ($1, 'WORK_EMAIL', 'A@Legacy.Example', 'a@legacy.example', 'VERIFIED', '2026-01-04T00:00:00Z') RETURNING id`, [p1])).rows[0].id;
      await evidence(p1, null, c1, '2026-01-04T00:00:00Z');
      await client.query(`INSERT INTO person_contacts (person_id, contact_type, contact_value, normalized_value, verification_status, last_verified_at) VALUES ($1, 'PHONE', '+919999999999', '+919999999999', 'VERIFIED', '2026-01-05T00:00:00Z')`, [p1]); // no evidence

      await client.exec(readMigration('0008_people_verification.sql'));
      await client.exec(readMigration('0008_people_verification.sql')); // idempotent
      const rows = (await client.query<any>(`SELECT claim_type, claimed_value, status, verified_by_kind, method, verified_by_id, verified_by_label, attested_by, evidence_id IS NOT NULL AS has_evidence, person_id FROM people_verifications ORDER BY claim_type, person_id`)).rows;
      const summary = rows.map((r) => `${r.claim_type}:${r.person_id === p1 ? 'p1' : r.person_id === p2 ? 'p2' : 'other'}`).sort();
      expect(summary).toEqual(['EMAIL:p1', 'RELATIONSHIP:p1', 'RELATIONSHIP:p2', 'TITLE:p1']);
      for (const r of rows) {
        expect(r).toMatchObject({ status: 'VERIFIED', verified_by_kind: 'SYSTEM', method: 'LEGACY_BACKFILL', verified_by_id: null, verified_by_label: 'system:legacy-backfill', attested_by: 'GOVERNMENT_REGISTRY', has_evidence: true });
      }
      // the contact is stored as a digest that matches the application's claimedValueFor()
      const email = rows.find((r) => r.claim_type === 'EMAIL')!;
      expect(email.claimed_value).toBe(claimedValueFor('EMAIL', 'a@legacy.example'));
      expect(rows.find((r) => r.claim_type === 'TITLE')!.claimed_value).toBe('ceo');
      // nothing else changed: existing status columns are as they were
      expect((await client.query<any>(`SELECT verification_status FROM company_people ORDER BY normalized_job_title`)).rows.map((r) => r.verification_status)).toEqual(['VERIFIED', 'PARTIALLY_VERIFIED', 'VERIFIED']);
    } finally {
      await client.close();
    }
  }, 60_000);

  it('the backfill inserts only into people_verifications and never invents a reviewer', () => {
    const text = readMigration('0008_people_verification.sql');
    expect([...text.matchAll(/INSERT INTO\s+"(\w+)"/g)].map((m) => m[1])).toEqual(['people_verifications', 'people_verifications']);
    expect(text).not.toMatch(/'REVIEWER'\s*,\s*'LEGACY/);
    expect((text.match(/'SYSTEM', 'LEGACY_BACKFILL'/g) ?? []).length).toBe(2);
  });
});

describe('Step-by-step upgrade 0004 -> 0005 -> 0006 -> 0007 -> 0008 -> 0009 -> 0010 -> 0011 -> 0012 -> 0013 -> 0014 -> 0015 -> 0016 on a populated database', () => {
  const fingerprint = async (c: PGlite) => {
    const cols = (await c.query<any>(`SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1, 2`)).rows;
    const idx = (await c.query<any>(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1`)).rows;
    const con = (await c.query<any>(`SELECT conrelid::regclass::text AS t, conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`)).rows;
    return JSON.stringify({ cols, idx, con });
  };

  it('each step applies on top of the previous one, keeps earlier data, and re-running that step changes nothing', async () => {
    const client = new PGlite();
    try {
      for (const f of ['0000_bent_johnny_storm.sql', '0001_blushing_loa.sql', '0002_typical_clint_barton.sql']) await client.exec(readMigration(f));
      const steps = ['0004_decision_maker_people.sql', '0005_people_ingestion.sql', '0006_import_people_report.sql', '0007_people_review.sql', '0008_people_verification.sql', '0009_people_sources.sql', '0010_people_observations.sql', '0011_people_suppression.sql', '0012_people_classification_versioning.sql', '0013_people_contact_provenance.sql', '0014_people_freshness.sql', '0015_people_conflicts.sql', '0016_people_acquisition_runs.sql'];
      const b = (await client.query<{ id: string }>(`INSERT INTO businesses (name, slug, status) VALUES ('Step Co', 'step-co', 'PUBLISHED') RETURNING id`)).rows[0].id;
      let personId: string | null = null;
      for (const step of steps) {
        await client.exec(readMigration(step));
        const after = await fingerprint(client);
        await client.exec(readMigration(step)); // the same step again: nothing may change
        expect(await fingerprint(client)).toBe(after);
        if (step.startsWith('0004')) {
          personId = (await client.query<{ id: string }>(`INSERT INTO people (full_name, normalized_name) VALUES ('Step Person', 'step person') RETURNING id`)).rows[0].id;
          await client.query(`INSERT INTO company_people (business_id, person_id, job_title_at_company, normalized_job_title) VALUES ($1, $2, 'CEO', 'ceo')`, [b, personId]);
        }
        // data created at 0004 survives every later step
        expect((await client.query<any>(`SELECT count(*)::int AS n FROM company_people`)).rows[0].n).toBe(1);
      }
      const roleCols = (await client.query<any>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'company_people'`)).rows.map((r) => r.column_name);
      expect(roleCols).toEqual(expect.arrayContaining(['review_status', 'classification_source', 'title_aliases']));
      expect((await client.query<any>(`SELECT count(*)::int AS n FROM people_verifications`)).rows[0].n).toBe(0);
      // nothing was dropped along the way: every table from 0004 still exists
      const tables = (await client.query<any>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).rows.map((r) => r.table_name);
      expect(tables).toEqual(expect.arrayContaining(['people', 'company_people', 'person_contacts', 'people_evidence', 'person_unlocks', 'people_ingestion_quarantine', 'people_verifications', 'people_sources', 'people_observations', 'people_suppressions']));
      expect((await client.query<any>(`SELECT count(*)::int AS n FROM people_sources`)).rows[0].n).toBe(3);
    } finally {
      await client.close();
    }
  }, 90_000);
});

describe('Migration 0009 (people_sources)', () => {
  it('upgrades a database at 0008 that already holds people, leaving them untouched, and seeds exactly the three existing sources once', async () => {
    const client = new PGlite();
    try {
      for (const tag of journal.entries.filter((e) => e.tag < '0009').map((e) => e.tag)) await client.exec(readMigration(`${tag}.sql`));
      const b = (await client.query<{ id: string }>(`INSERT INTO businesses (name, slug, status) VALUES ('Src Co', 'src-co', 'PUBLISHED') RETURNING id`)).rows[0].id;
      const p = (await client.query<{ id: string }>(`INSERT INTO people (full_name, normalized_name, data_status, verification_status) VALUES ('Src Person', 'src person', 'PUBLISHED', 'VERIFIED') RETURNING id`)).rows[0].id;
      await client.query(`INSERT INTO company_people (business_id, person_id, job_title_at_company, normalized_job_title, is_published, review_status) VALUES ($1, $2, 'CEO', 'ceo', true, 'APPROVED')`, [b, p]);
      const state = async () => JSON.stringify([
        (await client.query<any>(`SELECT * FROM people ORDER BY id`)).rows,
        (await client.query<any>(`SELECT * FROM company_people ORDER BY id`)).rows,
        (await client.query<any>(`SELECT count(*)::int AS n FROM people_verifications`)).rows,
      ]);
      const before = await state();
      await client.exec(readMigration('0009_people_sources.sql'));
      const once = (await client.query<any>(`SELECT * FROM people_sources ORDER BY key`)).rows;
      await client.exec(readMigration('0009_people_sources.sql'));
      expect((await client.query<any>(`SELECT * FROM people_sources ORDER BY key`)).rows).toEqual(once); // second run: nothing changes
      expect(once.map((r) => r.key)).toEqual(['company-upload', 'people-csv', 'people-json']);
      expect(await state()).toBe(before);
    } finally {
      await client.close();
    }
  }, 60_000);

  it('is additive: creates only people_sources, changes no existing table, and contains no credential columns', () => {
    const text = readMigration('0009_people_sources.sql');
    expect([...text.matchAll(/(?:CREATE TABLE IF NOT EXISTS|CREATE UNIQUE INDEX IF NOT EXISTS "\w+" ON|INSERT INTO)\s+"(\w+)"/g)].map((m) => m[1])).toEqual(['people_sources', 'people_sources', 'people_sources']);
    expect(text).not.toMatch(/ALTER TABLE|DROP|TRUNCATE|(?<!ON )\bUPDATE\b|(?<!ON )\bDELETE\b/i);
    expect(text.replace(/^--.*$/gm, '')).not.toMatch(/api_?key|secret|password|credential|"token"/i); // comments excluded
  });
});

describe('Migration 0010 (people_observations)', () => {
  it('upgrades a database at 0009 that already holds people, leaving everything untouched, and a second run changes nothing', async () => {
    const client = new PGlite();
    try {
      for (const tag of journal.entries.filter((e) => e.tag < '0010').map((e) => e.tag)) await client.exec(readMigration(`${tag}.sql`));
      const b = (await client.query<{ id: string }>(`INSERT INTO businesses (name, slug, status) VALUES ('Obs Co', 'obs-co', 'PUBLISHED') RETURNING id`)).rows[0].id;
      const p = (await client.query<{ id: string }>(`INSERT INTO people (full_name, normalized_name) VALUES ('Obs Person', 'obs person') RETURNING id`)).rows[0].id;
      await client.query(`INSERT INTO company_people (business_id, person_id, job_title_at_company, normalized_job_title) VALUES ($1, $2, 'CEO', 'ceo')`, [b, p]);
      const state = async () => JSON.stringify([
        (await client.query<any>(`SELECT * FROM people ORDER BY id`)).rows,
        (await client.query<any>(`SELECT * FROM company_people ORDER BY id`)).rows,
        (await client.query<any>(`SELECT * FROM people_sources ORDER BY key`)).rows,
        (await client.query<any>(`SELECT count(*)::int AS n FROM people_evidence`)).rows,
      ]);
      const before = await state();
      await client.exec(readMigration('0010_people_observations.sql'));
      const schemaOnce = JSON.stringify([
        (await client.query<any>(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'people_observations' ORDER BY ordinal_position`)).rows,
        (await client.query<any>(`SELECT indexname FROM pg_indexes WHERE tablename = 'people_observations' ORDER BY 1`)).rows,
        (await client.query<any>(`SELECT tgname FROM pg_trigger WHERE tgrelid = 'people_observations'::regclass AND NOT tgisinternal`)).rows,
      ]);
      await client.exec(readMigration('0010_people_observations.sql')); // again
      expect(JSON.stringify([
        (await client.query<any>(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'people_observations' ORDER BY ordinal_position`)).rows,
        (await client.query<any>(`SELECT indexname FROM pg_indexes WHERE tablename = 'people_observations' ORDER BY 1`)).rows,
        (await client.query<any>(`SELECT tgname FROM pg_trigger WHERE tgrelid = 'people_observations'::regclass AND NOT tgisinternal`)).rows,
      ])).toBe(schemaOnce);
      expect(await state()).toBe(before);
      expect((await client.query<any>(`SELECT count(*)::int AS n FROM people_observations`)).rows[0].n).toBe(0);
      expect(schemaOnce).toContain('people_observations_append_only_trg');
    } finally {
      await client.close();
    }
  }, 60_000);

  it('is additive: creates only people_observations (table, indexes, one trigger function); touches no existing table; holds no contact or payload columns', () => {
    const text = readMigration('0010_people_observations.sql');
    const code = text.replace(/^--.*$/gm, '');
    expect([...code.matchAll(/CREATE TABLE IF NOT EXISTS\s+"(\w+)"/g)].map((m) => m[1])).toEqual(['people_observations']);
    expect([...code.matchAll(/ALTER TABLE\s+"(\w+)"\s+ADD CONSTRAINT/g)].map((m) => m[1])).toEqual(Array(5).fill('people_observations'));
    expect(code).not.toMatch(/\bDROP TABLE|\bDROP COLUMN|TRUNCATE|\bINSERT\b|ALTER TABLE\s+"(?!people_observations)/i);
    expect(code).not.toMatch(/email|phone|mobile|linkedin|raw_payload|\bpayload\b|secret|password|credential|token/i);
  });
});

describe('Migration 0011 (people_suppressions)', () => {
  const digest = async (c: PGlite, v: string) => (await c.query<any>(`SELECT 'h:' || encode(sha256(convert_to($1, 'UTF8')), 'hex') AS d`, [v])).rows[0].d as string;

  it('upgrades a 0010 database; registers only the identifiers ALREADY-suppressed people hold (nothing guessed); people without any stay unregistered; idempotent', async () => {
    const client = new PGlite();
    try {
      for (const tag of journal.entries.filter((e) => e.tag < '0011').map((e) => e.tag)) await client.exec(readMigration(`${tag}.sql`));
      const person = async (name: string, status: string, linkedin: string | null) =>
        (await client.query<{ id: string }>(`INSERT INTO people (full_name, normalized_name, data_status, normalized_linkedin_url) VALUES ($1, $2, $3, $4) RETURNING id`, [name, name.toLowerCase(), status, linkedin])).rows[0].id;
      const contact = (p: string, type: string, norm: string) =>
        client.query(`INSERT INTO person_contacts (person_id, contact_type, contact_value, normalized_value) VALUES ($1, $2, $3, $3)`, [p, type, norm]);

      const sup = await person('Legacy Suppressed', 'SUPPRESSED', 'linkedin.com/in/legacy-suppressed');
      await contact(sup, 'WORK_EMAIL', 'legacy@corp.example');
      await contact(sup, 'PHONE', '+914222550100');
      await contact(sup, 'MOBILE', '+919876543210');
      const bare = await person('Legacy Bare', 'SUPPRESSED', null); // suppressed, holds no deterministic identifier
      const active = await person('Active Person', 'PUBLISHED', 'linkedin.com/in/active-person'); // must be untouched
      await contact(active, 'WORK_EMAIL', 'active@corp.example');
      await client.query(`INSERT INTO audit_logs (action, entity_type, entity_id, created_at) VALUES ('PEOPLE_PERSON_SUPPRESSED', 'PEOPLE_PERSON', $1, '2026-03-01T10:00:00Z')`, [sup]);
      const snapshot = async () => JSON.stringify((await client.query<any>(`SELECT * FROM people ORDER BY id`)).rows) + JSON.stringify((await client.query<any>(`SELECT * FROM person_contacts ORDER BY id`)).rows);
      const before = await snapshot();

      await client.exec(readMigration('0011_people_suppression.sql'));
      const once = (await client.query<any>(`SELECT * FROM people_suppressions ORDER BY identity_kind, identity_digest`)).rows;
      await client.exec(readMigration('0011_people_suppression.sql')); // second run
      expect((await client.query<any>(`SELECT * FROM people_suppressions ORDER BY identity_kind, identity_digest`)).rows).toEqual(once);
      expect(await snapshot()).toBe(before); // people and contacts untouched

      expect(once.map((r) => r.identity_kind).sort()).toEqual(['LINKEDIN', 'PHONE', 'PHONE', 'WORK_EMAIL']);
      expect(once.every((r) => r.person_id === sup && r.origin === 'LEGACY_BACKFILL' && r.suppressed_by_kind === 'SYSTEM' && r.suppressed_by_id === null)).toBe(true);
      const byKind = (k: string) => once.filter((r) => r.identity_kind === k).map((r) => r.identity_digest).sort();
      expect(byKind('LINKEDIN')).toEqual([await digest(client, 'linkedin.com/in/legacy-suppressed')]);
      expect(byKind('WORK_EMAIL')).toEqual([await digest(client, 'legacy@corp.example')]);
      expect(byKind('PHONE')).toEqual([await digest(client, '+914222550100'), await digest(client, '+919876543210')].sort());
      // the original suppression time is taken from the audit trail, not invented
      expect(new Date(once[0].suppressed_at).toISOString()).toBe('2026-03-01T10:00:00.000Z');
      expect(once.some((r) => r.person_id === bare || r.person_id === active)).toBe(false);
      // no readable data in the registry
      expect(JSON.stringify(once)).not.toMatch(/legacy@corp|linkedin\.com|4222550100|9876543210/);
    } finally {
      await client.close();
    }
  }, 60_000);

  it('is additive and never touches an existing table; the registry is immutable', async () => {
    const text = readMigration('0011_people_suppression.sql');
    const code = text.replace(/^--.*$/gm, '');
    expect([...code.matchAll(/CREATE TABLE IF NOT EXISTS\s+"(\w+)"/g)].map((m) => m[1])).toEqual(['people_suppressions']);
    expect([...code.matchAll(/INSERT INTO\s+"(\w+)"/g)].map((m) => m[1])).toEqual(['people_suppressions', 'people_suppressions']);
    expect(code).not.toMatch(/ALTER TABLE\s+"(?!people_suppressions)|\bDROP TABLE|\bDROP COLUMN|TRUNCATE|\bUPDATE\s+"/i);
    expect(code).not.toMatch(/raw_payload|secret|password|credential/i);
    const client = new PGlite();
    try {
      for (const tag of journal.entries.map((e) => e.tag)) await client.exec(readMigration(`${tag}.sql`));
      await client.query(`INSERT INTO people_suppressions (identity_kind, identity_digest, origin) VALUES ('LINKEDIN', $1, 'REVIEWER_ACTION')`, [await digest(client, 'x')]);
      await expect(client.query(`UPDATE people_suppressions SET reason = 'edited'`)).rejects.toThrow(/immutable/);
      await expect(client.query(`DELETE FROM people_suppressions`)).rejects.toThrow(/never deleted/);
    } finally {
      await client.close();
    }
  }, 60_000);
});

describe('Migration 0012 (classification versioning)', () => {
  it('upgrades a populated 0011 database without changing any existing role or reviewer override; runs twice safely', async () => {
    const client = new PGlite();
    try {
      for (const tag of journal.entries.filter((e) => e.tag < '0012').map((e) => e.tag)) await client.exec(readMigration(`${tag}.sql`));
      const biz = (await client.query<{ id: string }>(`INSERT INTO businesses (name, slug) VALUES ('Legacy Co', 'legacy-co-cls') RETURNING id`)).rows[0].id;
      const pid = (await client.query<{ id: string }>(`INSERT INTO people (full_name, normalized_name, data_status) VALUES ('Lee Gacy', 'lee gacy', 'PUBLISHED') RETURNING id`)).rows[0].id;
      const role = async (title: string, source: string, dm: string | null, published: boolean) =>
        (await client.query<{ id: string }>(
          `INSERT INTO company_people (business_id, person_id, job_title_at_company, normalized_job_title, department, seniority_level, decision_maker_type, classification_source, is_published, review_status)
           VALUES ($1, $2, $3, $3, 'SALES', 'HEAD', $4, $5, $6, $7) RETURNING id`,
          [biz, pid, title, dm, source, published, published ? 'APPROVED' : 'PENDING'],
        )).rows[0].id;
      await role('head of sales', 'REVIEWER', 'SALES_DECISION_MAKER', true); // an approved reviewer override
      await role('director', 'AUTO', 'DIRECTOR_PARTNER', false);
      const snapshot = async () => JSON.stringify((await client.query<any>(`SELECT * FROM company_people ORDER BY normalized_job_title`)).rows);
      const before = await snapshot();

      await client.exec(readMigration('0012_people_classification_versioning.sql'));
      await client.exec(readMigration('0012_people_classification_versioning.sql')); // second run
      const rows = (await client.query<any>(`SELECT * FROM company_people ORDER BY normalized_job_title`)).rows;
      // every pre-existing column is unchanged; the new ones are NULL (= unversioned) and nothing was back-filled
      const stripNew = (r: any) => Object.fromEntries(Object.entries(r).filter(([k]) => !['classification_version', 'classification_strength', 'classified_at'].includes(k)));
      expect(JSON.stringify(rows.map(stripNew))).toBe(JSON.stringify(JSON.parse(before).map(stripNew)));
      expect(rows.every((r: any) => r.classification_version === null && r.classification_strength === null && r.classified_at === null)).toBe(true);
      expect(rows.find((r: any) => r.normalized_job_title === 'head of sales')).toMatchObject({ classification_source: 'REVIEWER', decision_maker_type: 'SALES_DECISION_MAKER', is_published: true });
      expect((await client.query<any>(`SELECT count(*)::int AS n FROM company_people_classifications`)).rows[0].n).toBe(0);
      expect((await client.query<any>(`SELECT count(*)::int AS n FROM people_observations`)).rows[0].n).toBe(0);
    } finally {
      await client.close();
    }
  }, 60_000);

  it('is additive: touches no earlier migration, drops and deletes nothing, and rewrites no existing data', () => {
    const code = readMigration('0012_people_classification_versioning.sql').replace(/^--.*$/gm, '');
    expect(code).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE|UPDATE\s+"/i);
    expect([...code.matchAll(/CREATE TABLE IF NOT EXISTS\s+"(\w+)"/g)].map((m) => m[1])).toEqual(['company_people_classifications']);
    expect([...code.matchAll(/ALTER TABLE\s+"(\w+)"\s+ADD COLUMN IF NOT EXISTS/g)].map((m) => m[1]).sort()).toEqual(['company_people', 'company_people', 'company_people', 'people_observations', 'people_observations']);
    expect(code).not.toMatch(/INSERT INTO/i); // nothing is back-filled
  });
});

describe('Migration 0013 (contact provenance)', () => {
  it('upgrades a populated 0012 database without changing contacts, evidence or verification; runs twice safely; back-fills nothing', async () => {
    const client = new PGlite();
    try {
      for (const tag of journal.entries.filter((e) => e.tag < '0013').map((e) => e.tag)) await client.exec(readMigration(`${tag}.sql`));
      const pid = (await client.query<{ id: string }>(`INSERT INTO people (full_name, normalized_name, data_status) VALUES ('Pro Vena', 'pro vena', 'PUBLISHED') RETURNING id`)).rows[0].id;
      await client.query(`INSERT INTO person_contacts (person_id, contact_type, contact_value, normalized_value, verification_status) VALUES ($1, 'WORK_EMAIL', 'pv@corp.example', 'pv@corp.example', 'VERIFIED')`, [pid]);
      await client.query(`INSERT INTO people_evidence (person_id, source_type, evidence_type) VALUES ($1, 'MANUAL_IMPORT', 'CONTACT_CLAIM')`, [pid]);
      const snap = async () =>
        JSON.stringify((await client.query<any>(`SELECT * FROM person_contacts`)).rows) + JSON.stringify((await client.query<any>(`SELECT * FROM people_evidence`)).rows) + JSON.stringify((await client.query<any>(`SELECT * FROM people_verifications`)).rows);
      const before = await snap();
      await client.exec(readMigration('0013_people_contact_provenance.sql'));
      await client.exec(readMigration('0013_people_contact_provenance.sql'));
      expect(await snap()).toBe(before);
      expect((await client.query<any>(`SELECT count(*)::int AS n FROM people_observation_claims`)).rows[0].n).toBe(0);
    } finally {
      await client.close();
    }
  }, 60_000);

  it('is additive: one new table, no ALTER of existing tables, no data statements', () => {
    const code = readMigration('0013_people_contact_provenance.sql').replace(/^--.*$/gm, '');
    expect([...code.matchAll(/CREATE TABLE IF NOT EXISTS\s+"(\w+)"/g)].map((m) => m[1])).toEqual(['people_observation_claims']);
    expect(code).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE|UPDATE\s+"|INSERT INTO/i);
    expect([...code.matchAll(/ALTER TABLE\s+"(\w+)"/g)].every((m) => m[1] === 'people_observation_claims')).toBe(true);
  });
});

describe('Migration 0014 (freshness)', () => {
  it('upgrades a populated 0013 database: existing timestamps and verification untouched, new columns NULL (not back-filled); second run safe', async () => {
    const client = new PGlite();
    try {
      for (const tag of journal.entries.filter((e) => e.tag < '0014').map((e) => e.tag)) await client.exec(readMigration(`${tag}.sql`));
      const biz = (await client.query<{ id: string }>(`INSERT INTO businesses (name, slug) VALUES ('Fresh Co', 'fresh-co-m') RETURNING id`)).rows[0].id;
      const pid = (await client.query<{ id: string }>(`INSERT INTO people (full_name, normalized_name, data_status) VALUES ('Fre Sher', 'fre sher', 'PUBLISHED') RETURNING id`)).rows[0].id;
      await client.query(`INSERT INTO company_people (business_id, person_id, job_title_at_company, normalized_job_title, last_seen_at, last_verified_at, verification_status) VALUES ($1, $2, 'Director', 'director', '2026-01-02T00:00:00Z', '2026-01-03T00:00:00Z', 'VERIFIED')`, [biz, pid]);
      await client.query(`INSERT INTO person_contacts (person_id, contact_type, contact_value, normalized_value, last_verified_at, verification_status) VALUES ($1, 'WORK_EMAIL', 'f@corp.example', 'f@corp.example', '2026-01-04T00:00:00Z', 'VERIFIED')`, [pid]);
      const snap = async () => JSON.stringify((await client.query<any>(`SELECT * FROM company_people`)).rows) + JSON.stringify((await client.query<any>(`SELECT * FROM person_contacts`)).rows);
      const strip = (t: string) => t.replace(/,"last_confirmed_at":null|,"last_seen_at":null/g, '');
      const before = await snap();
      await client.exec(readMigration('0014_people_freshness.sql'));
      await client.exec(readMigration('0014_people_freshness.sql'));
      const after = await snap();
      expect(strip(after)).toBe(before);
      expect((await client.query<any>(`SELECT last_seen_at, last_confirmed_at FROM person_contacts`)).rows[0]).toEqual({ last_seen_at: null, last_confirmed_at: null });
      expect((await client.query<any>(`SELECT last_confirmed_at FROM company_people`)).rows[0].last_confirmed_at).toBeNull();
    } finally {
      await client.close();
    }
  }, 60_000);

  it('is additive: only nullable ADD COLUMN IF NOT EXISTS statements', () => {
    const code = readMigration('0014_people_freshness.sql').replace(/^--.*$/gm, '');
    const stmts = code.split('--> statement-breakpoint').map((x) => x.trim()).filter(Boolean);
    expect(stmts).toHaveLength(3);
    for (const st of stmts) expect(st).toMatch(/^ALTER TABLE "\w+" ADD COLUMN IF NOT EXISTS "\w+" timestamp with time zone;?$/);
  });
});

describe('Migration 0015 (conflicts)', () => {
  it('upgrades a populated 0014 database without touching any existing row; runs twice; back-fills nothing', async () => {
    const client = new PGlite();
    try {
      for (const tag of journal.entries.filter((e) => e.tag < '0015').map((e) => e.tag)) await client.exec(readMigration(`${tag}.sql`));
      const pid = (await client.query<{ id: string }>(`INSERT INTO people (full_name, normalized_name, data_status) VALUES ('Con Flict', 'con flict', 'PUBLISHED') RETURNING id`)).rows[0].id;
      await client.query(`INSERT INTO person_contacts (person_id, contact_type, contact_value, normalized_value, verification_status) VALUES ($1, 'WORK_EMAIL', 'c@corp.example', 'c@corp.example', 'VERIFIED')`, [pid]);
      const snap = async () => JSON.stringify((await client.query<any>(`SELECT * FROM people`)).rows) + JSON.stringify((await client.query<any>(`SELECT * FROM person_contacts`)).rows);
      const before = await snap();
      await client.exec(readMigration('0015_people_conflicts.sql'));
      await client.exec(readMigration('0015_people_conflicts.sql'));
      expect(await snap()).toBe(before);
      expect((await client.query<any>(`SELECT count(*)::int AS n FROM people_conflicts`)).rows[0].n).toBe(0);
      await client.query(`INSERT INTO people_conflicts (conflict_type, subject_key) VALUES ('ROLE_TITLE', 'k')`);
      await expect(client.query(`INSERT INTO people_conflicts (conflict_type, subject_key) VALUES ('ROLE_TITLE', 'k')`)).rejects.toThrow(); // unique per (type, subject)
    } finally {
      await client.close();
    }
  }, 60_000);

  it('is additive: two new tables, no data statements, no change to existing tables', () => {
    const code = readMigration('0015_people_conflicts.sql').replace(/^--.*$/gm, '');
    expect([...code.matchAll(/CREATE TABLE IF NOT EXISTS\s+"(\w+)"/g)].map((m) => m[1]).sort()).toEqual(['people_conflict_links', 'people_conflicts']);
    expect(code).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE|UPDATE\s+"|INSERT INTO/i);
    expect([...code.matchAll(/ALTER TABLE\s+"(\w+)"/g)].every((m) => ['people_conflicts', 'people_conflict_links'].includes(m[1]))).toBe(true);
  });
});

describe('Migration 0016 (acquisition runs)', () => {
  it('upgrades a populated 0015 database without touching existing rows; runs twice; creates no runs', async () => {
    const client = new PGlite();
    try {
      for (const tag of journal.entries.filter((e) => e.tag < '0016').map((e) => e.tag)) await client.exec(readMigration(`${tag}.sql`));
      await client.query(`INSERT INTO people (full_name, normalized_name, data_status) VALUES ('Run Ner', 'run ner', 'PUBLISHED')`);
      await client.query(`INSERT INTO people_sources (key, display_name, source_type, version, enabled) VALUES ('s1', 'S1', 'MANUAL_IMPORT', '1', false)`);
      const snap = async () => JSON.stringify((await client.query<any>(`SELECT * FROM people`)).rows) + JSON.stringify((await client.query<any>(`SELECT * FROM people_sources`)).rows);
      const before = await snap();
      await client.exec(readMigration('0016_people_acquisition_runs.sql'));
      await client.exec(readMigration('0016_people_acquisition_runs.sql'));
      expect(await snap()).toBe(before);
      expect((await client.query<any>(`SELECT count(*)::int AS n FROM people_acquisition_runs`)).rows[0].n).toBe(0);
      const ins = (extra: string) => client.query(`INSERT INTO people_acquisition_runs (source_key, source_version, batch_ref, max_records, batch_size${extra})`);
      await ins(`) VALUES ('s1', '1', 'acq-1', 100, 10`);
      await expect(ins(`) VALUES ('s1', '1', 'acq-1', 100, 10`)).rejects.toThrow(); // batch_ref unique
      await expect(ins(`) VALUES ('s1', '1', 'acq-2', 100, 500`)).rejects.toThrow(); // batch_size above max_records
      await expect(ins(`, status) VALUES ('s1', '1', 'acq-3', 100, 10, 'PAUSED'`)).rejects.toThrow();
      await expect(ins(`) VALUES ('nope', '1', 'acq-4', 100, 10`)).rejects.toThrow(); // unregistered source
    } finally {
      await client.close();
    }
  }, 60_000);

  it('is additive: one new table, no data statements, no change to existing tables', () => {
    const code = readMigration('0016_people_acquisition_runs.sql').replace(/^--.*$/gm, '');
    expect([...code.matchAll(/CREATE TABLE IF NOT EXISTS\s+"(\w+)"/g)].map((m) => m[1])).toEqual(['people_acquisition_runs']);
    expect(code).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE|UPDATE\s+"|INSERT INTO/i);
    expect([...code.matchAll(/ALTER TABLE\s+"(\w+)"/g)].every((m) => m[1] === 'people_acquisition_runs')).toBe(true);
  });
});

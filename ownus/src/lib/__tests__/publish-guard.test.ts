import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { isPublishStatus, refusedLookupSql, statusUpdateSql } from '../publish-guard.ts';

/**
 * R-005: the gateway status screen must not publish a business whose recorded source is not APPROVED.
 * The SQL below is the exact text the route sends; it runs here against in-memory PostgreSQL (PGlite, resolved from the repository root
 * install). If PGlite is not installed the database tests are skipped, never passed.
 */
let db: any = null;
let skipReason = '';

const SRC = { approved: '00000000-0000-4000-8000-0000000000a1', unreviewed: '00000000-0000-4000-8000-0000000000a2', restricted: '00000000-0000-4000-8000-0000000000a3', revoked: '00000000-0000-4000-8000-0000000000a4' };
const BIZ = (n: number) => `00000000-0000-4000-8000-0000000000b${n}`;

describe('publish guard SQL (R-005)', () => {
  before(async () => {
    try {
      const mod: any = await import('@electric-sql/pglite');
      db = new mod.PGlite();
      await db.exec(`
        CREATE TABLE data_sources (id uuid PRIMARY KEY, trust_status varchar(12) NOT NULL);
        CREATE TABLE businesses (id uuid PRIMARY KEY, slug text UNIQUE NOT NULL, status text NOT NULL DEFAULT 'DRAFT', source_id uuid, updated_at timestamptz);
        INSERT INTO data_sources VALUES ('${SRC.approved}','APPROVED'),('${SRC.unreviewed}','UNREVIEWED'),('${SRC.restricted}','RESTRICTED'),('${SRC.revoked}','REVOKED');
        INSERT INTO businesses (id, slug, source_id) VALUES
          ('${BIZ(1)}','approved-co','${SRC.approved}'),
          ('${BIZ(2)}','unreviewed-co','${SRC.unreviewed}'),
          ('${BIZ(3)}','restricted-co','${SRC.restricted}'),
          ('${BIZ(4)}','nosource-co', NULL),
          ('${BIZ(5)}','revoked-co','${SRC.revoked}');
      `);
    } catch (e: any) {
      skipReason = `PGlite not available: ${e?.code ?? e?.message ?? 'import failed'}`;
    }
  });
  after(async () => {
    await db?.close?.();
  });

  const publish = async (key: 'id' | 'slug', ref: string) => (await db.query(statusUpdateSql(key), ['PUBLISHED', ref, true])).rows;
  const statusOf = async (slug: string) => (await db.query('SELECT status FROM businesses WHERE slug = $1', [slug])).rows[0].status;

  it('publishes a business from an APPROVED source, and one with no recorded source', { skip: false }, async (t) => {
    if (!db) return t.skip(skipReason);
    assert.equal((await publish('id', BIZ(1))).length, 1);
    assert.equal(await statusOf('approved-co'), 'PUBLISHED');
    assert.equal((await publish('slug', 'nosource-co')).length, 1);
    assert.equal(await statusOf('nosource-co'), 'PUBLISHED');
  });

  it('refuses to publish from an UNREVIEWED or RESTRICTED source, by id and by slug, and leaves the row untouched', async (t) => {
    if (!db) return t.skip(skipReason);
    assert.equal((await publish('id', BIZ(2))).length, 0);
    assert.equal((await publish('slug', 'unreviewed-co')).length, 0);
    assert.equal((await publish('slug', 'restricted-co')).length, 0);
    assert.equal(await statusOf('unreviewed-co'), 'DRAFT');
    assert.equal(await statusOf('restricted-co'), 'DRAFT');
  });

  it('explains a refusal only for a business whose source is not approved (not for a missing business or an approved one)', async (t) => {
    if (!db) return t.skip(skipReason);
    assert.equal((await db.query(refusedLookupSql('id'), [BIZ(2)])).rows.length, 1);
    assert.equal((await db.query(refusedLookupSql('slug'), ['restricted-co'])).rows.length, 1);
    assert.equal((await db.query(refusedLookupSql('id'), [BIZ(1)])).rows.length, 0);
    assert.equal((await db.query(refusedLookupSql('id'), ['00000000-0000-4000-8000-00000000ffff'])).rows.length, 0);
  });

  it('does not restrict any other status change: an unreviewed source can still be moved to ARCHIVED or REJECTED', async (t) => {
    if (!db) return t.skip(skipReason);
    for (const status of ['ARCHIVED', 'REJECTED', 'DRAFT']) {
      assert.equal(isPublishStatus(status), false);
      const rows = (await db.query(statusUpdateSql('id'), [status, BIZ(2), false])).rows;
      assert.equal(rows.length, 1);
      assert.equal(await statusOf('unreviewed-co'), status);
    }
  });

  it('a missing business changes nothing and is not reported as refused', async (t) => {
    if (!db) return t.skip(skipReason);
    const rows = await publish('slug', 'does-not-exist');
    assert.equal(rows.length, 0);
    assert.equal((await db.query(refusedLookupSql('slug'), ['does-not-exist'])).rows.length, 0);
  });

  it('only PUBLISHED counts as publishing', () => {
    assert.equal(isPublishStatus('PUBLISHED'), true);
    for (const s of ['VERIFIED', 'DRAFT', 'ARCHIVED', 'published', '']) assert.equal(isPublishStatus(s), false);
  });
});

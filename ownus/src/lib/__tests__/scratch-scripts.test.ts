import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(import.meta.url);
const { isLocalDatabaseUrl, isDisposableOrionDatabase, requireLocalDatabaseUrl } = require(`${root}scratch_target.js`);
const scripts = readdirSync(root).filter((f) => /^scratch_.*\.js$/.test(f) && f !== 'scratch_target.js');

describe('scratch scripts (they write test data) cannot reach a shared or production database', () => {
  it('there are scratch scripts to check', () => assert.ok(scripts.length > 0));

  it('no scratch script carries a connection-string literal, a certificate-verification bypass or a DATABASE_URL fallback', () => {
    const offenders: string[] = [];
    for (const f of scripts) {
      const src = readFileSync(`${root}${f}`, 'utf8');
      if (/postgres(ql)?:\/\//i.test(src) || /rejectUnauthorized/.test(src) || /process\.env\.DATABASE_URL/.test(src)) offenders.push(f);
    }
    assert.deepEqual(offenders, []);
  });

  it('every scratch script selects its database through the local-only helper', () => {
    const missing = scripts.filter((f) => !readFileSync(`${root}${f}`, 'utf8').includes('requireLocalDatabaseUrl('));
    assert.deepEqual(missing, []);
  });

  it('the helper accepts only a local SCRATCH_DATABASE_URL', () => {
    assert.equal(isLocalDatabaseUrl('postgresql://u:p@localhost:5432/d'), true);
    assert.equal(isLocalDatabaseUrl('postgresql://u:p@127.0.0.1:5433/d'), true);
    for (const u of ['postgresql://u:p@ep-x-pooler.c-2.us-east-2.aws.neon.tech/d', 'postgresql://u:p@localhost.evil.com/d', 'nope', '', undefined]) {
      assert.equal(isLocalDatabaseUrl(u), false);
    }
    assert.equal(requireLocalDatabaseUrl({ SCRATCH_DATABASE_URL: 'postgresql://u:p@localhost:5432/orion_scratch' }), 'postgresql://u:p@localhost:5432/orion_scratch');
  });

  it('the helper exits (does not return) when the variable is missing or remote, and never prints the value', () => {
    const realExit = process.exit;
    const realError = console.error;
    const logged: string[] = [];
    console.error = (...a: unknown[]) => void logged.push(a.join(' '));
    try {
      for (const env of [{}, { DATABASE_URL: 'postgresql://u:p@localhost/d' }, { SCRATCH_DATABASE_URL: 'postgresql://u:secretpw@db.example.com/d' }, { SCRATCH_DATABASE_URL: 'postgresql://u:secretpw@localhost/orion_db' }, { SCRATCH_DATABASE_URL: 'postgresql://u:secretpw@localhost/hrm_db' }, { SCRATCH_DATABASE_URL: 'postgresql://u:secretpw@localhost/d' }]) {
        let code: number | undefined;
        process.exit = ((c?: number) => {
          code = c;
          throw new Error('exit');
        }) as never;
        assert.throws(() => requireLocalDatabaseUrl(env), /exit/);
        assert.equal(code, 1);
      }
    } finally {
      process.exit = realExit;
      console.error = realError;
    }
    assert.ok(!logged.join('\n').includes('secretpw'));
  });

  it('only a disposable Orion database is accepted: the real orion_db and databases of other applications are refused', () => {
    for (const ok of ['orion_scratch', 'orion_test_1', 'orion_verify', 'orion_db_restore_verify_20261009t064531']) assert.equal(isDisposableOrionDatabase(ok), true, ok);
    for (const bad of ['orion_db', 'auth_db', 'candify_db', 'hrm_db', 'water_utility', 'postgres', 'orion', 'd', '']) assert.equal(isDisposableOrionDatabase(bad), false, bad);
  });

  it('the older scratch writers call the guard first and no longer read a database URL of their own', () => {
    const legacy = ['scratch/backfill_locations.js', 'scratch/sync_user_unlocks.js', 'scratch/test_e2e_customer_filters.js', 'scratch/test_unlocked_export_query.js', 'ownus/scratch/test_account_settings_persistence.js', 'ownus/scratch/test_google_auth_email_matching.js', 'ownus/scratch/test_insert_location.js', 'ownus/scratch/test_production_login.js'];
    for (const f of legacy) {
      const src = readFileSync(`${root}../${f}`, 'utf8');
      assert.ok(/guardLegacyScratchWriter\(\)/.test(src), `${f} must call guardLegacyScratchWriter()`);
      assert.ok(src.indexOf('guardLegacyScratchWriter()') < src.indexOf('new Pool('), `${f} must call the guard before connecting`);
      assert.ok(!/postgres(ql)?:\/\//i.test(src), `${f} must not carry a connection string`);
    }
  });
});

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  assertDestructiveAllowed,
  assertLocalDatabaseAllowed,
  findLatestVerifiedBackup,
  isAllowedLocalDatabase,
  isDisposableOrionDatabase,
  parseDbTarget,
} from '../db-guard';

const local = (db: string) => `postgresql://svc:pw@localhost:5432/${db}`;
const NOW = new Date('2026-10-09T12:00:00.000Z');

function makeBackup(root: string, name: string, over: Record<string, unknown> = {}, withDump = true) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  if (withDump) fs.writeFileSync(path.join(dir, 'orion_db.dump'), 'x');
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ created_at: '2026-10-09T10:00:00.000Z', source: { database: 'orion_db' }, dump_file: 'orion_db.dump', verified: true, ...over }),
  );
}

// The standalone scratch-script helper (plain JavaScript, no build step) must apply the same rule as the TypeScript guard.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const scratchHelper = require('../../../../../ownus/scratch_target.js') as { isDisposableOrionDatabase: (n: string) => boolean };

describe('database guard (protects the other databases on the local server)', () => {
  it('the scratch helper and the TypeScript guard agree on which names are disposable', () => {
    for (const n of ['orion_scratch', 'orion_test_1', 'orion_verify', 'orion_db_restore_verify_20261009t064531', 'orion_x_scratch', 'orion_db', 'auth_db', 'hrm_db', 'postgres', 'orion', 'orion_dbx', '', 'xorion_scratch']) {
      expect(scratchHelper.isDisposableOrionDatabase(n)).toBe(isDisposableOrionDatabase(n));
    }
  });
  describe('which local databases are allowed', () => {
    it('allows orion_db and disposable Orion databases only', () => {
      for (const ok of ['orion_db', 'orion_scratch', 'orion_test_1', 'orion_verify', 'orion_db_restore_verify_20261009t064531', 'orion_x_scratch']) {
        expect(isAllowedLocalDatabase(ok, {})).toBe(true);
      }
      for (const bad of ['auth_db', 'candify_db', 'data_db', 'hrm_db', 'talorix_db', 'water_utility', 'postgres', 'postgersql', 'orion', 'orion_prod', 'orion_dbx', 'template1', '']) {
        expect(isAllowedLocalDatabase(bad, {})).toBe(false);
      }
    });
    it('extra names must be allowed explicitly', () => {
      expect(isAllowedLocalDatabase('orion_sandbox', {})).toBe(false);
      expect(isAllowedLocalDatabase('orion_sandbox', { ORION_ALLOWED_LOCAL_DATABASES: 'orion_sandbox, other' })).toBe(true);
    });
    it('disposable pattern is strict', () => {
      expect(isDisposableOrionDatabase('orion_scratch')).toBe(true);
      expect(isDisposableOrionDatabase('orion_db')).toBe(false);
      expect(isDisposableOrionDatabase('xorion_scratch')).toBe(false);
    });
  });

  describe('assertLocalDatabaseAllowed', () => {
    it('refuses a local database that belongs to something else, without echoing credentials', () => {
      for (const host of ['localhost', '127.0.0.1', '[::1]']) {
        let msg = '';
        try {
          assertLocalDatabaseAllowed(`postgresql://postgres:supersecret@${host}:5432/hrm_db`, {});
        } catch (e) {
          msg = (e as Error).message;
        }
        expect(msg).toMatch(/not an Orion database/);
        expect(msg).not.toMatch(/supersecret|postgresql:\/\//);
      }
    });
    it('accepts orion_db and does not judge a remote host', () => {
      expect(assertLocalDatabaseAllowed(local('orion_db'), {}).database).toBe('orion_db');
      expect(assertLocalDatabaseAllowed('postgresql://u:p@db.example.org:5432/some_name', {}).local).toBe(false);
    });
    it('rejects a missing or invalid URL', () => {
      expect(() => assertLocalDatabaseAllowed(undefined, {})).toThrow(/not set/);
      expect(() => assertLocalDatabaseAllowed('not a url', {})).toThrow(/not a valid/);
    });
    it('parses host, port and database', () => {
      expect(parseDbTarget('postgresql://u:p@LOCALHOST/orion_db')).toEqual({ host: 'localhost', port: '5432', database: 'orion_db', local: true });
    });
  });

  describe('findLatestVerifiedBackup / assertDestructiveAllowed', () => {
    let root: string;
    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-guard-'));
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
    const check = (over: Record<string, unknown> = {}) => ({
      label: 'clear-temporary-data',
      url: local('orion_db'),
      argv: ['--apply'],
      env: { CONFIRM_DESTRUCTIVE_DATABASE: 'orion_db' } as NodeJS.ProcessEnv,
      now: NOW,
      backupDir: root,
      ...over,
    });

    it('a dry run needs nothing but an allowed local database and changes nothing', () => {
      const d = assertDestructiveAllowed(check({ argv: [], env: {} }));
      expect(d.apply).toBe(false);
    });
    it('refuses another local database even for a dry run', () => {
      expect(() => assertDestructiveAllowed(check({ url: local('auth_db'), argv: [] }))).toThrow(/not an Orion database/);
    });
    it('refuses a remote database', () => {
      expect(() => assertDestructiveAllowed(check({ url: 'postgresql://u:p@db.example.org/orion_db', argv: [] }))).toThrow(/only runs against a local database/);
    });
    it('applying needs the exact confirmation', () => {
      makeBackup(root, 'orion_db_a');
      expect(() => assertDestructiveAllowed(check({ env: {} }))).toThrow(/CONFIRM_DESTRUCTIVE_DATABASE=orion_db/);
      expect(() => assertDestructiveAllowed(check({ env: { CONFIRM_DESTRUCTIVE_DATABASE: 'orion_db_x' } }))).toThrow(/CONFIRM_DESTRUCTIVE_DATABASE/);
    });
    it('applying needs a verified, recent backup of that database', () => {
      expect(() => assertDestructiveAllowed(check())).toThrow(/No verified backup/);
      makeBackup(root, 'orion_db_unverified', { verified: false });
      expect(() => assertDestructiveAllowed(check())).toThrow(/No verified backup/);
      makeBackup(root, 'orion_db_other', { source: { database: 'hrm_db' } });
      expect(() => assertDestructiveAllowed(check())).toThrow(/No verified backup/);
      makeBackup(root, 'orion_db_nodump', {}, false);
      expect(() => assertDestructiveAllowed(check())).toThrow(/No verified backup/);
      makeBackup(root, 'orion_db_old', { created_at: '2026-10-07T10:00:00.000Z' });
      expect(() => assertDestructiveAllowed(check())).toThrow(/hours old/);
    });
    it('applying passes with a fresh verified backup and the confirmation, and reports the backup used', () => {
      makeBackup(root, 'orion_db_old', { created_at: '2026-10-07T10:00:00.000Z' });
      makeBackup(root, 'orion_db_fresh');
      const d = assertDestructiveAllowed(check());
      expect(d.apply).toBe(true);
      expect(d.backup?.dir).toContain('orion_db_fresh');
      expect(d.backup?.ageHours).toBeCloseTo(2, 5);
    });
    it('the age limit can be set', () => {
      makeBackup(root, 'orion_db_old', { created_at: '2026-10-08T10:00:00.000Z' });
      expect(() => assertDestructiveAllowed(check())).toThrow(/hours old/);
      expect(assertDestructiveAllowed(check({ env: { CONFIRM_DESTRUCTIVE_DATABASE: 'orion_db', ORION_BACKUP_MAX_AGE_HOURS: '48' } })).apply).toBe(true);
    });
    it('tools without a dry run (schema push) still need confirmation and a backup', () => {
      expect(() => assertDestructiveAllowed(check({ argv: [], needsApplyFlag: false }))).toThrow(/No verified backup/);
      makeBackup(root, 'orion_db_a');
      expect(assertDestructiveAllowed(check({ argv: [], needsApplyFlag: false })).apply).toBe(true);
    });
    it('a missing backup folder is not an error in itself', () => {
      expect(findLatestVerifiedBackup('orion_db', { dir: path.join(root, 'nope'), now: NOW })).toBeNull();
    });
  });
});

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { IAppliedBaselineEntry, nextMigrationWhen, readJournalFile, validateJournal, verifyAppliedBaseline } from '../migration-journal';

const MIGRATIONS = path.resolve(__dirname, '../migrations');
const baseline = (JSON.parse(fs.readFileSync(path.join(__dirname, 'migration-applied-baseline.json'), 'utf8')) as { entries: IAppliedBaselineEntry[] }).entries;

/**
 * The REAL migration folder. These are the guards against the failure that is easy to miss: Drizzle applies a migration only when its
 * journal `when` is greater than the newest one recorded in the database, and skips it silently otherwise. The existing journal has
 * timestamps ahead of the calendar (migrations 0008 onward), so a migration generated today would never run on a database that already
 * applied them.
 */
describe('migration journal (real folder)', () => {
  it('journal, SQL files and snapshots are consistent', () => {
    expect(validateJournal(MIGRATIONS)).toEqual([]);
  });

  it('timestamps are unique and strictly increasing', () => {
    const whens = readJournalFile(MIGRATIONS).entries.map((e) => e.when);
    expect(new Set(whens).size).toBe(whens.length);
    for (let i = 1; i < whens.length; i++) expect(whens[i]).toBeGreaterThan(whens[i - 1]);
  });

  it('migrations already applied (0000-0023) keep their tag, timestamp and SQL', () => {
    expect(baseline).toHaveLength(24);
    expect(verifyAppliedBaseline(MIGRATIONS, baseline)).toEqual([]);
  });

  it('every migration added after the applied baseline is dated above the newest applied one', () => {
    const entries = readJournalFile(MIGRATIONS).entries;
    const newestApplied = Math.max(...baseline.map((b) => b.when));
    for (const e of entries.slice(baseline.length)) expect(e.when).toBeGreaterThan(newestApplied);
  });

  it('the next migration date is above every existing entry, even though some are in the future', () => {
    const entries = readJournalFile(MIGRATIONS).entries;
    const max = Math.max(...entries.map((e) => e.when));
    expect(nextMigrationWhen(entries, 1)).toBe(max + 1);
    expect(nextMigrationWhen(entries, Date.now())).toBeGreaterThan(max);
  });
});

describe('nextMigrationWhen', () => {
  it('uses the clock when the journal is behind it, and max + 1 when the journal is ahead', () => {
    expect(nextMigrationWhen([{ when: 100 }, { when: 200 }], 1000)).toBe(1000);
    expect(nextMigrationWhen([{ when: 100 }, { when: 5000 }], 1000)).toBe(5001);
    expect(nextMigrationWhen([], 42)).toBe(42);
  });
});

describe('validateJournal / verifyAppliedBaseline detect drift (synthetic folders)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-journal-'));
    fs.mkdirSync(path.join(dir, 'meta'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function build(entries: Array<{ tag: string; when: number }>, opts: { sql?: boolean; snapshots?: boolean } = {}) {
    fs.writeFileSync(
      path.join(dir, 'meta', '_journal.json'),
      JSON.stringify({ version: '7', dialect: 'postgresql', entries: entries.map((e, idx) => ({ idx, version: '7', when: e.when, tag: e.tag, breakpoints: true })) }),
    );
    for (const e of entries) {
      if (opts.sql !== false) fs.writeFileSync(path.join(dir, `${e.tag}.sql`), `-- ${e.tag}\r\nSELECT 1;\r\n`);
      if (opts.snapshots !== false) fs.writeFileSync(path.join(dir, 'meta', `${e.tag.slice(0, 4)}_snapshot.json`), '{}');
    }
  }
  const good = [
    { tag: '0000_a', when: 100 },
    { tag: '0001_b', when: 200 },
  ];

  it('accepts a consistent folder', () => {
    build(good);
    expect(validateJournal(dir, [])).toEqual([]);
  });
  it('flags a "when" that is not above the previous entry (the silent-skip trap)', () => {
    build([good[0], { tag: '0001_b', when: 100 }]);
    const f = validateJournal(dir, []);
    expect(f.join('\n')).toMatch(/not greater than the previous/);
    expect(f.join('\n')).toMatch(/used by another entry/);
  });
  it('flags a decreasing "when"', () => {
    build([good[0], { tag: '0001_b', when: 50 }]);
    expect(validateJournal(dir, []).join('\n')).toMatch(/not greater than the previous/);
  });
  it('flags a missing SQL file, a missing snapshot, an orphan SQL file and an orphan snapshot', () => {
    build(good);
    fs.rmSync(path.join(dir, '0001_b.sql'));
    fs.rmSync(path.join(dir, 'meta', '0001_snapshot.json'));
    fs.writeFileSync(path.join(dir, '0002_c.sql'), 'SELECT 1;');
    fs.writeFileSync(path.join(dir, 'meta', '0009_snapshot.json'), '{}');
    const f = validateJournal(dir, []).join('\n');
    expect(f).toMatch(/0001_b\.sql is missing/);
    expect(f).toMatch(/0001_snapshot\.json is missing/);
    expect(f).toMatch(/0002_c\.sql has no journal entry/);
    expect(f).toMatch(/0009_snapshot\.json has no journal entry/);
  });
  it('allows a snapshot to be missing only for a named hand-written migration', () => {
    build(good);
    fs.rmSync(path.join(dir, 'meta', '0001_snapshot.json'));
    expect(validateJournal(dir, ['0001_b'])).toEqual([]);
    expect(validateJournal(dir, []).join('\n')).toMatch(/snapshot\.json is missing/);
  });
  it('flags a wrong position, a wrong tag prefix and a malformed tag', () => {
    build([{ tag: '0000_a', when: 1 }, { tag: '0005_b', when: 2 }, { tag: 'bad', when: 3 }], { snapshots: false });
    const f = validateJournal(dir, ['0000_a', '0005_b', 'bad']).join('\n');
    expect(f).toMatch(/numeric prefix does not match/);
    expect(f).toMatch(/must look like/);
  });

  it('the applied baseline detects an edited timestamp, edited SQL and a changed tag; CRLF versus LF does not matter', () => {
    build(good);
    const base: IAppliedBaselineEntry[] = [
      { idx: 0, tag: '0000_a', when: 100, sha256: require('crypto').createHash('sha256').update('-- 0000_a\nSELECT 1;\n').digest('hex') },
    ];
    expect(verifyAppliedBaseline(dir, base)).toEqual([]); // the file on disk has CRLF, the baseline was computed from LF text
    fs.writeFileSync(path.join(dir, '0000_a.sql'), '-- 0000_a\nSELECT 2;\n');
    expect(verifyAppliedBaseline(dir, base).join('\n')).toMatch(/SQL of an applied migration was edited/);
    build([{ tag: '0000_a', when: 999 }, good[1]]);
    expect(verifyAppliedBaseline(dir, base).join('\n')).toMatch(/"when" changed/);
    build([{ tag: '0000_z', when: 100 }, good[1]]);
    expect(verifyAppliedBaseline(dir, base).join('\n')).toMatch(/tag changed/);
  });
});

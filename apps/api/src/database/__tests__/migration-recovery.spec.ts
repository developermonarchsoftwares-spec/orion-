import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as schema from '../schema';

/**
 * Phase 30: an interrupted or failing migration. Drizzle's migrator runs all pending migrations in ONE transaction, so a failure must
 * leave no trace: no half-created object, no journal entry, no change to data. Then the corrected migration must apply, and a rerun
 * must be a no-op. (Statements that cannot run inside a transaction, such as CREATE INDEX CONCURRENTLY, are outside this guarantee.)
 */
const MIGRATIONS = path.resolve(__dirname, '../migrations');

function withExtraMigration(sql: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-p30-'));
  fs.cpSync(MIGRATIONS, dir, { recursive: true });
  const journalPath = path.join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  const last = journal.entries[journal.entries.length - 1];
  journal.entries.push({ ...last, idx: last.idx + 1, tag: '9999_p30_extra', when: last.when + 1000 });
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  fs.writeFileSync(path.join(dir, '9999_p30_extra.sql'), sql);
  return dir;
}
const rows = async (client: PGlite, q: string) => (await client.query<any>(q)).rows;
const migrationsApplied = async (client: PGlite) => Number((await rows(client, 'SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations'))[0].n);

describe('a failing migration leaves the database exactly as it was (Phase 30)', () => {
  it('rolls back every statement, keeps the data, does not advance the journal, and the corrected migration then applies once', async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    await client.exec(`INSERT INTO users (email, first_name, last_name) VALUES ('p30@example.test', 'P', 'Thirty')`);
    const applied = await migrationsApplied(client);

    const bad = withExtraMigration(
      'CREATE TABLE p30_marker (id int);\n--> statement-breakpoint\nALTER TABLE users ADD COLUMN p30_col int;\n--> statement-breakpoint\nINSERT INTO no_such_table VALUES (1);\n',
    );
    await expect(migrate(db, { migrationsFolder: bad })).rejects.toBeDefined();
    expect((await rows(client, "SELECT to_regclass('public.p30_marker') IS NOT NULL AS t"))[0].t).toBe(false);
    expect(Number((await rows(client, "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'p30_col'"))[0].n)).toBe(0);
    expect(await migrationsApplied(client)).toBe(applied);
    expect(Number((await rows(client, 'SELECT count(*)::int AS n FROM users'))[0].n)).toBe(1);

    const good = withExtraMigration('CREATE TABLE p30_marker (id int);\n--> statement-breakpoint\nALTER TABLE users ADD COLUMN p30_col int;\n');
    await migrate(db, { migrationsFolder: good });
    expect(await migrationsApplied(client)).toBe(applied + 1);
    await migrate(db, { migrationsFolder: good });
    expect(await migrationsApplied(client)).toBe(applied + 1);
    await client.close();
  }, 120_000);
});

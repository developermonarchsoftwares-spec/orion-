/**
 * Safe way to create the next Drizzle migration. Never connects to a database and never runs a migration.
 *
 *   npm run db:migration:new -- <name>      validate the journal, run `drizzle-kit generate --name <name>`, then set the new entry's
 *                                           "when" above every existing entry and validate again
 *   npm run db:migration:new -- --dry-run <name>   validate and print what would happen; writes nothing
 *   npm run db:migration:new -- --print-next-when  print the "when" the next migration must have
 *   npm run db:migration:new -- --check     validate the journal, SQL files and snapshots only (exit 1 on any finding)
 *
 * Why: Drizzle applies a migration only if its "when" is greater than the newest one recorded in the database. This journal already has
 * entries ahead of the calendar, so a plainly generated migration would be skipped without any error on a database that applied them.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { nextMigrationWhen, readJournalFile, validateJournal } from '../src/database/migration-journal';

const FOLDER = path.resolve(__dirname, '../src/database/migrations');
const JOURNAL = path.join(FOLDER, 'meta', '_journal.json');

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function assertConsistent(stage: string) {
  const findings = validateJournal(FOLDER);
  if (findings.length) fail(`The migration journal is inconsistent ${stage}:\n  - ${findings.join('\n  - ')}`);
}

function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const name = args.find((a) => !a.startsWith('--'));
  const entries = readJournalFile(FOLDER).entries;
  const when = nextMigrationWhen(entries);

  if (flags.has('--check')) {
    assertConsistent('(--check)');
    console.log(`Journal consistent: ${entries.length} entries, newest "when" ${Math.max(...entries.map((e) => e.when))}.`);
    return;
  }
  if (flags.has('--print-next-when')) {
    console.log(when);
    return;
  }
  if (!name || !/^[a-z0-9_]{3,60}$/.test(name)) fail('Give a migration name of 3-60 lowercase letters, digits or underscores, for example: add_export_limits');
  assertConsistent('before generating');

  const nextIdx = String(entries.length).padStart(4, '0');
  if (flags.has('--dry-run')) {
    console.log(`DRY RUN: would run "drizzle-kit generate --name ${name}", producing ${nextIdx}_${name}.sql, and set its "when" to ${when}.`);
    return;
  }

  const gen = spawnSync('npx', ['drizzle-kit', 'generate', '--name', name], { cwd: path.resolve(__dirname, '..'), stdio: 'inherit', shell: true });
  if (gen.status !== 0) fail('drizzle-kit generate failed; the journal was not changed by this tool.');

  const journal = readJournalFile(FOLDER);
  if (journal.entries.length === entries.length) {
    console.log('drizzle-kit reported no schema changes: nothing was generated and nothing was changed.');
    return;
  }
  if (journal.entries.length !== entries.length + 1) fail(`Expected exactly one new journal entry but found ${journal.entries.length - entries.length}; review the migrations folder by hand.`);
  const created = journal.entries[journal.entries.length - 1];
  const wanted = nextMigrationWhen(entries); // computed from the entries that existed BEFORE generation
  if (created.when <= Math.max(...entries.map((e) => e.when))) {
    created.when = wanted;
    fs.writeFileSync(JOURNAL, JSON.stringify(journal, null, 2));
    console.log(`Set "when" of ${created.tag} to ${wanted} (above every existing entry).`);
  }
  assertConsistent('after generating');
  console.log(`Created ${created.tag}. Review the SQL, then apply it with "npm run drizzle:migrate" (after "npm run db:backup").`);
}

main();

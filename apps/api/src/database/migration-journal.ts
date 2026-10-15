import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Pure helpers for the Drizzle migration journal (`migrations/meta/_journal.json`). Nothing here touches a database.
 *
 * Why this exists: Drizzle's migrator applies a migration only if its journal `when` is GREATER than the newest `created_at` recorded in
 * the target database. A migration with a smaller `when` is skipped without any error. In this project the existing journal already
 * contains timestamps ahead of the calendar, so a migration generated "now" would be silently skipped on a database that has applied
 * them. `nextMigrationWhen` always returns a value above every existing entry, and `validateJournal` / `verifyAppliedBaseline` fail loudly
 * when the journal, the SQL files and the snapshots drift apart or when an already-applied migration is edited.
 */
export interface IJournalFileEntry {
  idx: number;
  version?: string;
  when: number;
  tag: string;
  breakpoints?: boolean;
}

export interface IAppliedBaselineEntry {
  idx: number;
  tag: string;
  when: number;
  /** sha256 of the migration SQL with line endings normalised to LF (so a CRLF checkout does not change it). */
  sha256: string;
}

/** Hand-written migrations that have no drizzle-kit snapshot (drizzle-kit never produced one for them). */
export const HAND_WRITTEN_WITHOUT_SNAPSHOT: readonly string[] = ['0003_seed_packages'];

export function readJournalFile(folder: string): { version: string; dialect: string; entries: IJournalFileEntry[] } {
  return JSON.parse(fs.readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8'));
}

export function normalizedSqlHash(file: string): string {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(text).digest('hex');
}

/** The `when` for a new migration: never below "now", always strictly above every existing entry. */
export function nextMigrationWhen(entries: Array<{ when: number }>, now: number = Date.now()): number {
  const max = entries.reduce((m, e) => Math.max(m, e.when), 0);
  return Math.max(now, max + 1);
}

/** Findings about the journal, the SQL files and the snapshots. An empty list means consistent. */
export function validateJournal(folder: string, handWritten: readonly string[] = HAND_WRITTEN_WITHOUT_SNAPSHOT): string[] {
  const findings: string[] = [];
  let entries: IJournalFileEntry[];
  try {
    entries = readJournalFile(folder).entries;
  } catch {
    return ['the journal (meta/_journal.json) cannot be read'];
  }
  if (entries.length === 0) findings.push('the journal has no entries');

  const seenWhen = new Set<number>();
  const seenTag = new Set<string>();
  entries.forEach((e, i) => {
    if (e.idx !== i) findings.push(`entry ${e.tag}: idx ${e.idx} is not its position ${i}`);
    if (!/^\d{4}_[a-z0-9_]+$/.test(e.tag)) findings.push(`entry ${e.tag}: the tag must look like 0007_name`);
    else if (Number(e.tag.slice(0, 4)) !== i) findings.push(`entry ${e.tag}: the numeric prefix does not match its position ${i}`);
    if (!Number.isFinite(e.when)) findings.push(`entry ${e.tag}: "when" is not a number`);
    if (seenWhen.has(e.when)) findings.push(`entry ${e.tag}: "when" ${e.when} is used by another entry`);
    seenWhen.add(e.when);
    if (seenTag.has(e.tag)) findings.push(`entry ${e.tag}: duplicated tag`);
    seenTag.add(e.tag);
    if (i > 0 && e.when <= entries[i - 1].when) {
      findings.push(`entry ${e.tag}: "when" ${e.when} is not greater than the previous entry's ${entries[i - 1].when}; Drizzle would skip it on a database that already applied the previous one`);
    }
    if (!fs.existsSync(path.join(folder, `${e.tag}.sql`))) findings.push(`entry ${e.tag}: ${e.tag}.sql is missing`);
    if (!handWritten.includes(e.tag) && !fs.existsSync(path.join(folder, 'meta', `${e.tag.slice(0, 4)}_snapshot.json`))) {
      findings.push(`entry ${e.tag}: meta/${e.tag.slice(0, 4)}_snapshot.json is missing`);
    }
  });

  const tags = new Set(entries.map((e) => e.tag));
  for (const f of fs.readdirSync(folder)) {
    if (f.endsWith('.sql') && !tags.has(f.replace(/\.sql$/, ''))) findings.push(`${f} has no journal entry (it would never run)`);
  }
  const prefixes = new Set(entries.map((e) => e.tag.slice(0, 4)));
  for (const f of fs.readdirSync(path.join(folder, 'meta'))) {
    const m = /^(\d{4})_snapshot\.json$/.exec(f);
    if (m && !prefixes.has(m[1])) findings.push(`meta/${f} has no journal entry`);
  }
  return findings;
}

/** Findings when an already-applied migration was renumbered, re-dated or its SQL edited. */
export function verifyAppliedBaseline(folder: string, baseline: IAppliedBaselineEntry[]): string[] {
  const findings: string[] = [];
  const entries = readJournalFile(folder).entries;
  if (entries.length < baseline.length) findings.push(`the journal has ${entries.length} entries; ${baseline.length} are recorded as applied`);
  for (const b of baseline) {
    const e = entries[b.idx];
    if (!e) continue;
    if (e.tag !== b.tag) findings.push(`entry ${b.idx}: tag changed from ${b.tag} to ${e.tag}`);
    if (e.when !== b.when) findings.push(`entry ${b.tag}: "when" changed from ${b.when} to ${e.when} (an applied migration's timestamp must never change)`);
    const sqlFile = path.join(folder, `${b.tag}.sql`);
    if (!fs.existsSync(sqlFile)) findings.push(`entry ${b.tag}: SQL file missing`);
    else if (normalizedSqlHash(sqlFile) !== b.sha256) findings.push(`entry ${b.tag}: the SQL of an applied migration was edited`);
  }
  return findings;
}

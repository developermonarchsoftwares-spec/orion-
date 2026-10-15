import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Read-only audit of a database against the migration journal and the latest schema snapshot.
 *
 * It only ever issues SELECTs against pg_catalog / information_schema and the Drizzle migrations table. It reads no application rows
 * and its report contains only structure: migration timestamps and tags, table / column / index names, types and counts.
 * Never a connection string, credential or row value.
 */
export type Query = (text: string, params?: unknown[]) => Promise<Array<Record<string, any>>>;

export type Verdict = 'SAFE_TO_MIGRATE' | 'REVIEW_REQUIRED' | 'BLOCKED';

export interface IJournalEntry {
  idx: number;
  tag: string;
  when: number;
  hash: string;
}

export interface IMigrationAudit {
  verdict: Verdict;
  findings: string[]; // BLOCKED / REVIEW reasons, each actionable
  notes: string[]; // informational
  journal: { entries: number; latestWhen: number };
  history: {
    tablePresent: boolean;
    rows: number;
    lastAppliedWhen: number | null;
    willApply: string[]; // entries Drizzle will execute (their `when` is newer than the newest applied one)
    skippedNeverApplied: string[]; // entries Drizzle will skip although no row records them
    unknownRows: number; // recorded timestamps that match no journal entry
    hashMismatches: string[]; // applied entries whose file content differs from what was applied (Drizzle does not compare hashes)
  };
  schema: {
    publicTables: number;
    missingTables: string[];
    drift: Record<string, string[]>; // table -> differences (columns, types, nullability, primary key, indexes)
  };
  hardenedTables: Record<string, 'ABSENT' | 'COMPATIBLE' | 'REPAIRABLE_BY_0017' | 'NEEDS_MANUAL_REPAIR'>;
}

/** Tables created by the idempotent migration 0017; the only ones with a dedicated verdict. */
const GUARDED_TABLES = ['queue_jobs', 'admin_otps'];

export function readJournal(folder: string): IJournalEntry[] {
  const journal = JSON.parse(fs.readFileSync(path.join(folder, 'meta/_journal.json'), 'utf8')) as { entries: Array<{ idx: number; tag: string; when: number }> };
  return journal.entries.map((e) => ({
    idx: e.idx,
    tag: e.tag,
    when: e.when,
    hash: crypto.createHash('sha256').update(fs.readFileSync(path.join(folder, `${e.tag}.sql`)).toString()).digest('hex'), // same as drizzle's reader
  }));
}

const normalizeType = (t: string): string => {
  const x = t.trim().toLowerCase().replace(/\s*,\s*/g, ',');
  if (x.startsWith('varchar')) return x.replace('varchar', 'character varying');
  if (x === 'serial') return 'integer';
  if (x === 'bigserial') return 'bigint';
  if (x === 'timestamp') return 'timestamp without time zone';
  if (x === 'timestamp with time zone') return 'timestamp with time zone';
  if (x === 'boolean' || x === 'integer' || x === 'text' || x === 'uuid' || x === 'jsonb' || x === 'bigint') return x;
  return x;
};

const sameType = (snapshot: string, actual: string) => {
  const a = normalizeType(snapshot);
  const b = actual.trim().toLowerCase().replace(/\s*,\s*/g, ',').replace(/^public\./, '');
  return a === b || a.replace(/^"?public"?\./, '') === b || b.replace(/"/g, '') === a.replace(/"/g, '');
};

const parseIndexColumns = (indexdef: string): { columns: string[]; unique: boolean } => {
  const unique = /^CREATE UNIQUE INDEX/i.test(indexdef);
  const open = indexdef.indexOf('(', indexdef.toUpperCase().indexOf(' USING '));
  let depth = 0;
  let close = -1;
  for (let i = open; open !== -1 && i < indexdef.length; i++) {
    if (indexdef[i] === '(') depth++;
    else if (indexdef[i] === ')' && --depth === 0) {
      close = i; // the matching parenthesis: a trailing WHERE (...) of a partial index is not part of the column list
      break;
    }
  }
  const body = open === -1 || close === -1 ? '' : indexdef.slice(open + 1, close);
  const columns = body.split(',').map((c) => c.trim().replace(/^"|"$/g, '').replace(/"/g, '').split(/\s+/)[0]).filter(Boolean);
  return { columns, unique };
};

export async function auditDatabase(query: Query, migrationsFolder: string, snapshotFile?: string): Promise<IMigrationAudit> {
  const entries = readJournal(migrationsFolder);
  const latest = entries[entries.length - 1];
  const snapshotPath = snapshotFile ?? path.join(migrationsFolder, `meta/${latest.tag.slice(0, 4)}_snapshot.json`);
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) as { tables: Record<string, any> };

  const findings: string[] = [];
  const notes: string[] = [];

  // ----------------------------------------------------------------------------------------------- migration history
  const tablePresent = ((await query(`SELECT to_regclass('drizzle.__drizzle_migrations') AS t`))[0]?.t ?? null) !== null;
  const applied = tablePresent ? await query(`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at ASC`) : [];
  const appliedWhens = applied.map((r) => Number(r.created_at));
  const lastAppliedWhen = appliedWhens.length ? Math.max(...appliedWhens) : null;
  const byWhen = new Map(entries.map((e) => [e.when, e]));

  const willApply = entries.filter((e) => lastAppliedWhen === null || lastAppliedWhen < e.when).map((e) => e.tag);
  const skippedNeverApplied = entries.filter((e) => lastAppliedWhen !== null && e.when <= lastAppliedWhen && !appliedWhens.includes(e.when)).map((e) => e.tag);
  const unknownRows = appliedWhens.filter((w) => !byWhen.has(w)).length;
  const hashMismatches = applied.filter((r) => byWhen.get(Number(r.created_at)) && byWhen.get(Number(r.created_at))!.hash !== r.hash).map((r) => byWhen.get(Number(r.created_at))!.tag);

  if (unknownRows > 0) {
    findings.push(`BLOCKED: ${unknownRows} recorded migration timestamp(s) match no journal entry. This database was migrated from a different journal; Drizzle's skip decision cannot be trusted. Establish the real history before migrating.`);
  }
  if (lastAppliedWhen !== null && lastAppliedWhen > latest.when) {
    findings.push('BLOCKED: the database records a migration newer than the newest journal entry (a newer or different journal was applied).');
  }
  const skippedUnexpected = skippedNeverApplied.filter((t) => !t.startsWith('0003'));
  if (skippedUnexpected.length) {
    findings.push(`REVIEW: journal entries skipped without ever being applied: ${skippedUnexpected.join(', ')}. Their schema changes are NOT installed and Drizzle will never run them.`);
  }
  if (skippedNeverApplied.some((t) => t.startsWith('0003'))) {
    notes.push('0003_seed_packages will be skipped here (a newer migration is already recorded). Packages come from the application seed; verify the credit_packages rows are the intended ones.');
  }
  if (hashMismatches.length) {
    notes.push(`Applied migration file(s) differ from what was applied (line endings or edits): ${hashMismatches.join(', ')}. Drizzle does not compare hashes, so this does not block, but it means history was edited.`);
  }

  // ----------------------------------------------------------------------------------------------- schema catalogue
  const tables = (await query(`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'`)).map((r) => String(r.name));
  const cols = await query(
    `SELECT c.relname AS tbl, a.attname AS col, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS notnull, a.atthasdef AS hasdef
       FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped`,
  );
  const indexes = await query(`SELECT tablename AS tbl, indexname AS name, indexdef AS def FROM pg_indexes WHERE schemaname = 'public'`);
  const pks = await query(
    `SELECT c.relname AS tbl, a.attname AS col FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (i.indkey) WHERE n.nspname = 'public' AND i.indisprimary`,
  );

  const drift: Record<string, string[]> = {};
  const undefinedColumns: Record<string, string[]> = {}; // columns present in the database that the schema does not define (informational: invisible to the ORM)
  const missingTables: string[] = [];
  const hardened: IMigrationAudit['hardenedTables'] = {};
  const manual = new Set<string>();
  const repairable = new Set<string>();

  for (const [key, def] of Object.entries<any>(snapshot.tables)) {
    const name = key.split('.').pop() as string;
    if (!tables.includes(name)) {
      missingTables.push(name);
      if (GUARDED_TABLES.includes(name)) hardened[name] = 'ABSENT';
      continue;
    }
    const diffs: string[] = [];
    const actualCols = cols.filter((c) => c.tbl === name);
    for (const col of Object.values<any>(def.columns)) {
      const a = actualCols.find((c) => c.col === col.name);
      if (!a) {
        diffs.push(`column ${col.name} missing`);
        continue;
      }
      if (!sameType(col.type, String(a.type))) diffs.push(`column ${col.name} type ${a.type} (expected ${normalizeType(col.type)})`);
      if (col.notNull && !a.notnull) diffs.push(`column ${col.name} is nullable (expected NOT NULL)`);
      if (!col.notNull && a.notnull && !a.hasdef) diffs.push(`column ${col.name} is NOT NULL without default (expected nullable): inserts that omit it fail`);
      if (col.notNull && col.default !== undefined && !a.hasdef) diffs.push(`column ${col.name} has no default (expected one)`);
    }
    const known = new Set(Object.values<any>(def.columns).map((c) => c.name));
    for (const a of actualCols) if (!known.has(a.col) && a.notnull && !a.hasdef) diffs.push(`extra column ${a.col} is NOT NULL without default: inserts fail`);
    const unknownCols = actualCols.filter((x) => !known.has(x.col) && !(x.notnull && !x.hasdef)).map((x) => String(x.col)).sort();
    if (unknownCols.length) undefinedColumns[name] = unknownCols;

    const expectedPk = Object.values<any>(def.columns).filter((c) => c.primaryKey).map((c) => c.name).sort();
    const actualPk = pks.filter((p) => p.tbl === name).map((p) => String(p.col)).sort();
    if (expectedPk.length && JSON.stringify(expectedPk) !== JSON.stringify(actualPk)) diffs.push(`primary key is [${actualPk.join(', ')}] (expected [${expectedPk.join(', ')}])`);

    const missingIdx: string[] = [];
    for (const idx of Object.values<any>(def.indexes ?? {})) {
      const found = indexes.find((i) => i.tbl === name && i.name === idx.name);
      if (!found) {
        missingIdx.push(idx.name);
        continue;
      }
      if (idx.columns.some((c: any) => c.isExpression)) continue;
      const parsed = parseIndexColumns(String(found.def));
      const expectedCols = idx.columns.map((c: any) => c.expression);
      if (JSON.stringify(parsed.columns) !== JSON.stringify(expectedCols) || parsed.unique !== !!idx.isUnique) {
        diffs.push(`index ${idx.name} is ${parsed.unique ? 'unique ' : ''}(${parsed.columns.join(', ')}) (expected ${idx.isUnique ? 'unique ' : ''}(${expectedCols.join(', ')}))`);
      }
    }
    for (const m of missingIdx) diffs.push(`index ${m} missing`);

    if (diffs.length) drift[name] = diffs;
    if (GUARDED_TABLES.includes(name)) {
      const structural = diffs.filter((d) => !/^index .* missing$/.test(d));
      if (structural.length) {
        hardened[name] = 'NEEDS_MANUAL_REPAIR';
        manual.add(name);
      } else if (diffs.length) {
        hardened[name] = 'REPAIRABLE_BY_0017'; // only absent indexes: 0017 creates them
        repairable.add(name);
      } else {
        hardened[name] = 'COMPATIBLE';
      }
    }
  }

  const willRun0017 = willApply.some((t) => t.startsWith('0017'));
  for (const name of manual) {
    findings.push(`BLOCKED: ${name} exists but differs from the schema (${drift[name].filter((d) => !/^index .* missing$/.test(d)).join('; ')}). 0017 uses IF NOT EXISTS and will NOT correct it; repair by hand first.`);
  }
  for (const name of repairable) notes.push(`${name} exists; 0017 will only add its missing index(es): ${drift[name].map((d) => d.replace(/^index | missing$/g, '')).join(', ')}.`);
  if (!willRun0017 && GUARDED_TABLES.some((t) => hardened[t] === 'ABSENT')) {
    findings.push('REVIEW: queue_jobs / admin_otps are absent but 0017 is already recorded as applied or will be skipped. Create them by hand.');
  }

  // A schema without migration history (e.g. created with `drizzle-kit push`): the first migration would try to create what exists.
  const nonSystem = tables.filter((t) => t !== '__drizzle_migrations');
  if (applied.length === 0 && nonSystem.length > 0) {
    findings.push(`BLOCKED: ${nonSystem.length} application table(s) exist but the database has no migration history. Running the migrations would try to create existing tables and fail (nothing is changed, the run is one transaction). Baselining the history is a manual decision.`);
  }

  // Everything outside the guarded tables that is missing or different is drift the pending migrations may or may not address.
  const otherDrift = Object.keys(drift).filter((t) => !GUARDED_TABLES.includes(t));
  const otherMissing = missingTables.filter((t) => !GUARDED_TABLES.includes(t));
  const pendingBeyond0017 = willApply.filter((t) => !t.startsWith('0017'));
  if ((otherDrift.length || otherMissing.length) && applied.length > 0) {
    const where = `${[...otherMissing.map((t) => `missing table ${t}`), ...otherDrift.map((t) => `${t}: ${drift[t].slice(0, 3).join('; ')}${drift[t].length > 3 ? '; ...' : ''}`)].join(' | ')}`;
    if (pendingBeyond0017.length === 0) findings.push(`REVIEW: schema drift outside the migrations being applied: ${where}`);
    else notes.push(`Schema differences that pending migrations (${pendingBeyond0017.length}) may resolve: ${where}`);
  }

  for (const [t, c] of Object.entries(undefinedColumns)) {
    notes.push(`${t} has ${c.length} column(s) the schema does not define (nullable or defaulted, so inserts still work, but something outside this repository may write them): ${c.join(', ')}.`);
  }

  const verdict: Verdict = findings.some((f) => f.startsWith('BLOCKED')) ? 'BLOCKED' : findings.length ? 'REVIEW_REQUIRED' : 'SAFE_TO_MIGRATE';
  return {
    verdict,
    findings,
    notes,
    journal: { entries: entries.length, latestWhen: latest.when },
    history: { tablePresent, rows: applied.length, lastAppliedWhen, willApply, skippedNeverApplied, unknownRows, hashMismatches },
    schema: { publicTables: tables.length, missingTables, drift },
    hardenedTables: hardened,
  };
}

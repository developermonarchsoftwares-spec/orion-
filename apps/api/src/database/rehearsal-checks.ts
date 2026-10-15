import { Query } from './migration-audit';

/**
 * Before / after evidence for a migration rehearsal. A snapshot holds only structure and counts plus the five package rows
 * (catalogue data, no personal data): table row counts, migration history, package state, pricing-setting keys and the number of
 * import_batches rows with a NULL file_key. SELECT only. Never a connection string or any user/row content.
 */
export interface ISnapshot {
  migrations: Array<{ created_at: string; hash8: string }>;
  tables: Record<string, number>;
  packages: Array<{ id: string; slug: string; name: string; price_inr: number | null; credits: number; is_active: boolean; sort_order: number }>;
  pricingSettingKeys: string[];
  importBatchesNullFileKey: number | null;
}

const quote = (id: string) => `"${id.replace(/"/g, '""')}"`;

export async function takeSnapshot(query: Query): Promise<ISnapshot> {
  const has = async (rel: string) => ((await query(`SELECT to_regclass($1) AS t`, [rel]))[0]?.t ?? null) !== null;
  const migrations = (await has('drizzle.__drizzle_migrations'))
    ? (await query(`SELECT created_at::text AS created_at, left(hash, 8) AS hash8 FROM drizzle.__drizzle_migrations ORDER BY created_at`)).map((r) => ({ created_at: String(r.created_at), hash8: String(r.hash8) }))
    : [];
  const names = (await query(`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1`)).map((r) => String(r.name));
  const tables: Record<string, number> = {};
  for (const t of names) tables[t] = Number((await query(`SELECT count(*)::int AS n FROM public.${quote(t)}`))[0].n);

  const packages = names.includes('credit_packages')
    ? ((await query(`SELECT id::text AS id, slug, name, price_inr, credits, is_active, sort_order FROM credit_packages ORDER BY sort_order, slug`)) as ISnapshot['packages'])
    : [];
  const pricingSettingKeys = names.includes('pricing_settings') ? (await query(`SELECT key FROM pricing_settings ORDER BY key`)).map((r) => String(r.key)) : [];
  const importBatchesNullFileKey = names.includes('import_batches')
    ? Number((await query(`SELECT count(*) FILTER (WHERE file_key IS NULL)::int AS n FROM import_batches`))[0].n)
    : null;
  return { migrations, tables, packages, pricingSettingKeys, importBatchesNullFileKey };
}

export interface IComparison {
  ok: boolean;
  problems: string[];
  notes: string[];
}

/**
 * What a correct run of the pending migrations must and must not change. Existing tables keep their exact row counts (these
 * migrations create tables and columns and, at most, insert into NEW tables); the earlier history rows are untouched; package rows,
 * pricing-setting keys and the NULL file_key count are identical. Everything else about the outcome is checked by `db:audit`.
 */
export function compareSnapshots(before: ISnapshot, after: ISnapshot): IComparison {
  const problems: string[] = [];
  const notes: string[] = [];

  before.migrations.forEach((m, i) => {
    const a = after.migrations[i];
    if (!a || a.created_at !== m.created_at || a.hash8 !== m.hash8) problems.push(`migration history row ${i} changed or disappeared`);
  });
  if (after.migrations.length <= before.migrations.length) notes.push('no migration was recorded by the run');
  else notes.push(`${after.migrations.length - before.migrations.length} migration(s) recorded`);

  for (const [t, n] of Object.entries(before.tables)) {
    if (!(t in after.tables)) problems.push(`table ${t} disappeared`);
    else if (after.tables[t] !== n) problems.push(`table ${t} row count changed ${n} -> ${after.tables[t]}`);
  }
  const added = Object.keys(after.tables).filter((t) => !(t in before.tables));
  notes.push(`${added.length} table(s) added`);
  const populated = added.filter((t) => after.tables[t] > 0);
  if (populated.length) notes.push(`new tables with rows: ${populated.map((t) => `${t}=${after.tables[t]}`).join(', ')}`);

  if (JSON.stringify(before.packages) !== JSON.stringify(after.packages)) problems.push('credit_packages rows changed (price, name, credits, active flag or set of plans)');
  if (JSON.stringify(before.pricingSettingKeys) !== JSON.stringify(after.pricingSettingKeys)) problems.push('pricing_settings keys changed');
  if (before.importBatchesNullFileKey !== after.importBatchesNullFileKey) problems.push(`import_batches NULL file_key count changed ${before.importBatchesNullFileKey} -> ${after.importBatchesNullFileKey}`);
  return { ok: problems.length === 0, problems, notes };
}

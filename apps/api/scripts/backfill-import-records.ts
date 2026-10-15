/**
 * Backfills import_records for batches whose rows were never stored (see backfill-import-records.sql for the rules).
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-import-records.ts           # dry run (default): reports, writes nothing
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-import-records.ts --apply   # writes, in one transaction
 * Idempotent: a second run finds nothing to repair.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { verifiedConnection } from '../src/database/tls';
import { assertLocalDatabaseAllowed } from '../src/database/db-guard';
dotenv.config();

async function main() {
  const apply = process.argv.includes('--apply');
  const sql = readFileSync(join(__dirname, 'backfill-import-records.sql'), 'utf8');
  assertLocalDatabaseAllowed(process.env.DATABASE_URL);
  const pool = new Pool(verifiedConnection(process.env.DATABASE_URL ?? ''));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(727001)'); // no two backfills at once
    const before = await client.query(`SELECT b.id, b.filename, b.total_records FROM import_batches b WHERE b.total_records > 0 AND NOT EXISTS (SELECT 1 FROM import_records r WHERE r.batch_id = b.id)`);
    const res = await client.query(sql);
    const inserted = res.rowCount ?? 0;
    const after = await client.query(`SELECT b.id, b.filename, b.total_records, (SELECT count(*)::int FROM import_records r WHERE r.batch_id = b.id) AS records FROM import_batches b WHERE b.id = ANY($1::uuid[])`, [before.rows.map((r) => r.id)]);
    for (const r of after.rows) console.log(`${r.filename} (${r.id}): total_records=${r.total_records} import_records=${r.records}${r.records === r.total_records ? '' : '  <-- NOT repaired (no exact match); review manually'}`);
    console.log(`${before.rowCount} batch(es) without records; ${inserted} import_record(s) ${apply ? 'inserted' : 'would be inserted'}.`);
    if (apply) { await client.query('COMMIT'); console.log('Committed.'); } else { await client.query('ROLLBACK'); console.log('Dry run: rolled back. Re-run with --apply to write.'); }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });

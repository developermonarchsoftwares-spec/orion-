import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { Pool } from 'pg';
import { assertDestructiveAllowed, describeTarget } from '../src/database/db-guard';
import { verifiedConnection } from '../src/database/tls';

/**
 * Empties `businesses`, `saved_leads` and `lead_unlocks` WITH CASCADE (every table that references them, directly or not, is emptied too).
 *
 * Safe by default: without `--apply` this is a DRY RUN that only reads and lists what would be emptied. Applying needs, in addition to
 * `--apply`: CONFIRM_DESTRUCTIVE_DATABASE=<database name> and a verified backup of the database no older than 24 hours
 * (`npm run db:backup`). It refuses any database that is not an Orion database on the local server, and any remote database.
 *
 *   npx ts-node -r tsconfig-paths/register scripts/clear-temporary-data.ts            dry run
 *   CONFIRM_DESTRUCTIVE_DATABASE=orion_db npx ts-node ... scripts/clear-temporary-data.ts --apply
 */
const ROOT_TABLES = ['businesses', 'saved_leads', 'lead_unlocks'];

/** Every table that TRUNCATE ... CASCADE would also empty: the roots plus all tables whose foreign keys lead to them. */
async function cascadeSet(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent FROM pg_constraint WHERE contype = 'f'`,
  );
  const strip = (s: string) => s.replace(/^public\./, '').replace(/^"|"$/g, '');
  const children = new Map<string, string[]>();
  for (const r of rows) {
    const p = strip(r.parent);
    children.set(p, [...(children.get(p) ?? []), strip(r.child)]);
  }
  const seen = new Set<string>(ROOT_TABLES);
  const queue = [...ROOT_TABLES];
  while (queue.length) {
    for (const c of children.get(queue.shift()!) ?? []) {
      if (!seen.has(c)) {
        seen.add(c);
        queue.push(c);
      }
    }
  }
  return [...seen].sort();
}

async function main() {
  const decision = assertDestructiveAllowed({
    label: 'clear-temporary-data',
    url: process.env.DATABASE_URL,
    argv: process.argv.slice(2),
  });
  console.log('====================================================');
  console.log('CLEAR TEMPORARY LEADS & SAMPLE BUSINESSES');
  console.log(`Target: ${describeTarget(decision.target)} (credentials hidden)`);
  console.log(decision.apply ? 'Mode: APPLY (data will be deleted)' : 'Mode: DRY RUN (nothing will be changed)');
  console.log('====================================================');

  const pool = new Pool(verifiedConnection(process.env.DATABASE_URL!.replace('-pooler.', '.')));
  try {
    const tables = await cascadeSet(pool);
    console.log('Tables that TRUNCATE ... CASCADE would empty:');
    let total = 0;
    for (const t of tables) {
      const n = Number((await pool.query(`SELECT count(*) AS n FROM "${t}"`)).rows[0].n);
      total += n;
      console.log(`   ${t.padEnd(36)} ${n} row(s)`);
    }
    console.log(`   ${'TOTAL'.padEnd(36)} ${total} row(s)`);

    if (!decision.apply) {
      console.log('DRY RUN: nothing was changed.');
      console.log('To apply: run "npm run db:backup", then set CONFIRM_DESTRUCTIVE_DATABASE to the database name and add --apply.');
      return;
    }

    console.log(`Verified backup in force: ${decision.backup!.dir} (${decision.backup!.ageHours.toFixed(1)} h old)`);
    console.log('1. Truncating businesses and dependent tables with CASCADE...');
    await pool.query('TRUNCATE TABLE "businesses" CASCADE');
    console.log('   Businesses table truncated successfully.');

    // Also clear any saved leads or unlocks
    await pool.query('TRUNCATE TABLE "saved_leads" CASCADE');
    await pool.query('TRUNCATE TABLE "lead_unlocks" CASCADE');
    console.log('   Saved leads and unlocks truncated successfully.');

    // Verify counts
    const bizCountRes = await pool.query('SELECT count(*) FROM "businesses"');
    console.log(`   Published businesses count in DB: ${bizCountRes.rows[0].count}`);

    const leadsCountRes = await pool.query('SELECT count(*) FROM "saved_leads"');
    console.log(`   Saved leads count in DB: ${leadsCountRes.rows[0].count}`);

    const unlocksCountRes = await pool.query('SELECT count(*) FROM "lead_unlocks"');
    console.log(`   Lead unlocks count in DB: ${unlocksCountRes.rows[0].count}`);

    console.log('====================================================');
    console.log('ALL TEMPORARY LEADS & BUSINESSES SUCCESSFULLY CLEARED');
    console.log('====================================================');
  } catch (err) {
    console.error('Error during cleanup:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? err.message : 'Refused'}`);
  process.exit(1);
});

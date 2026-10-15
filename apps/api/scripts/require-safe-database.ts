/**
 * Pre-flight check for tools that can change or drop data but have no dry run of their own (for example `drizzle-kit push`).
 * It exits non-zero, so a chained command (`... && drizzle-kit push`) never starts, unless the target is a local Orion database,
 * CONFIRM_DESTRUCTIVE_DATABASE names it exactly, and a verified backup no older than 24 hours exists (`npm run db:backup`).
 *
 *   ts-node scripts/require-safe-database.ts <label>
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { assertDestructiveAllowed, describeTarget } from '../src/database/db-guard';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

try {
  const label = process.argv[2] || 'schema push';
  const d = assertDestructiveAllowed({
    label,
    url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/orion_db', // same default as drizzle.config.ts
    needsApplyFlag: false,
  });
  console.log(`Safety check passed for "${label}": ${describeTarget(d.target)}; verified backup ${d.backup!.ageHours.toFixed(1)} h old.`);
} catch (err) {
  console.error(`✗ ${err instanceof Error ? err.message : 'Refused'}`);
  process.exit(1);
}

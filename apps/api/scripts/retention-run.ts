/**
 * Runs the data-retention schedule once, by hand.
 *
 *   npm run db:retention                 DRY RUN: counts what is past retention, changes nothing.
 *   CONFIRM_DESTRUCTIVE_DATABASE=orion_db npm run db:retention -- --apply
 *
 * Applying needs a local Orion database, the confirmation variable and a verified backup no older than 24 h. A remote database is refused
 * even for the dry run. Output is aggregate counts only.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { assertDestructiveAllowed, describeTarget } from '../src/database/db-guard';
import { verifiedConnection } from '../src/database/tls';
import * as schema from '../src/database/schema';
import { AuditLogService } from '../src/common/services/audit-log.service';
import { PrivacyService } from '../src/modules/privacy/privacy.service';

async function main() {
  const d = assertDestructiveAllowed({ label: 'retention-run', url: process.env.DATABASE_URL, argv: process.argv.slice(2) });
  console.log(`Target: ${describeTarget(d.target)}; mode: ${d.apply ? 'APPLY' : 'DRY RUN (nothing is changed)'}`);
  const pool = new Pool(verifiedConnection(process.env.DATABASE_URL!.replace('-pooler.', '.')));
  try {
    const db = drizzle(pool, { schema }) as any;
    const svc = new PrivacyService(db, {} as any, new AuditLogService(db));
    const report = await svc.runRetention({ dryRun: !d.apply, trigger: 'MANUAL' });
    console.log(JSON.stringify(report, null, 2));
    if (Object.keys(report.failed).length) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? err.message : 'Failed'}`);
  process.exit(1);
});

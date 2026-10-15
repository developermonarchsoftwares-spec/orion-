/**
 * Deletion ledger: export it with every backup, re-apply it after every restore (docs/BACKUP_AND_DISASTER_RECOVERY.md section 5).
 *
 *   export  --out <file>            READ-ONLY. Writes digests and opaque ids only (no names, e-mails, phones or companies).
 *   reapply --in <file>             DRY RUN: runs every statement in a transaction and rolls it back; prints what an apply would change.
 *   reapply --in <file> --apply     Applies it. Needs a local Orion database, CONFIRM_DESTRUCTIVE_DATABASE=<name> and a verified backup
 *                                   no older than 24 h (same safeguards as the other destructive scripts).
 *
 * Remote databases are refused by `reapply`. Reapplying to a restored PRODUCTION database is a production change and needs a written,
 * approved change request first; it is deliberately not possible from this script today.
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { assertDestructiveAllowed, describeTarget } from '../src/database/db-guard';
import { verifiedConnection } from '../src/database/tls';
import * as schema from '../src/database/schema';
import { buildDeletionLedger, reapplyDeletionLedger } from '../src/modules/privacy/deletion-ledger';

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};

async function main() {
  const cmd = process.argv[2];
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  if (cmd === 'export') {
    const out = arg('--out');
    if (!out) throw new Error('--out <file> is required');
    const pool = new Pool({ ...verifiedConnection(url.replace('-pooler.', '.')), options: '-c default_transaction_read_only=on' });
    try {
      const ledger = await buildDeletionLedger(drizzle(pool, { schema }) as any);
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      fs.writeFileSync(out, JSON.stringify(ledger), { mode: 0o600 });
      console.log(`Deletion ledger written: ${ledger.contactSuppressions.length} contact suppressions, ${ledger.peopleRegistry.length} people identities, ${ledger.suppressedPeople.length} suppressed people, ${ledger.erasedAccounts.length} erased accounts.`);
    } finally {
      await pool.end();
    }
    return;
  }

  if (cmd === 'reapply') {
    const input = arg('--in');
    if (!input) throw new Error('--in <file> is required');
    const decision = assertDestructiveAllowed({ label: 'deletion-ledger reapply', url, argv: process.argv.slice(3) });
    console.log(`Target: ${describeTarget(decision.target)}; mode: ${decision.apply ? 'APPLY' : 'DRY RUN (nothing is changed)'}`);
    const pool = new Pool(verifiedConnection(url.replace('-pooler.', '.')));
    try {
      const report = await reapplyDeletionLedger(drizzle(pool, { schema }) as any, JSON.parse(fs.readFileSync(input, 'utf8')), { dryRun: !decision.apply });
      console.log(JSON.stringify(report, null, 2));
    } finally {
      await pool.end();
    }
    return;
  }
  throw new Error('Usage: deletion-ledger.ts export --out <file> | reapply --in <file> [--apply]');
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? err.message : 'Failed'}`);
  process.exit(1);
});

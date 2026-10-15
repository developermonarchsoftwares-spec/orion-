import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { auditDatabase } from './migration-audit';
import { isLocalDatabaseUrl, verifiedConnection } from './tls';
import { assertLocalDatabaseAllowed } from './db-guard';

dotenv.config();

/**
 * Read-only migration audit: `npm run db:audit`.
 *  - one connection, one READ ONLY transaction, SELECTs on catalogues and the Drizzle migrations table only
 *  - nothing is created, altered or deleted; no application row is read
 *  - the connection string is never printed (only the host class is reported)
 * Exit codes: 0 safe to migrate, 2 review required, 3 blocked, 1 could not audit.
 */
async function main() {
  let url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Refusing to guess a database.');
    process.exit(1);
  }
  if (url.includes('-pooler.')) url = url.replace('-pooler.', '.'); // same rule as the migration runner (direct endpoint)

  const local = isLocalDatabaseUrl(url);
  assertLocalDatabaseAllowed(url);
  const client = new Client(verifiedConnection(url));
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const report = await auditDatabase(async (text, params) => (await client.query(text, params as any[])).rows, path.resolve(__dirname, './migrations'));
    await client.query('ROLLBACK');
    console.log(`Target: ${local ? 'local database' : 'remote database'} (connection details hidden)`);
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.verdict === 'SAFE_TO_MIGRATE' ? 0 : report.verdict === 'REVIEW_REQUIRED' ? 2 : 3);
  } catch (err: any) {
    // message only: pg errors can echo connection details in some drivers, so keep it to the code / first line
    console.error(`Audit failed: ${String(err?.code ?? '')} ${String(err?.message ?? err).split('\n')[0].replace(/postgres(ql)?:\/\/\S+/gi, '[hidden]')}`);
    process.exit(1);
  } finally {
    await client.end().catch(() => undefined);
  }
}

main();

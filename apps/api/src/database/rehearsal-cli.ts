import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { compareSnapshots, takeSnapshot } from './rehearsal-checks';
import { verifiedConnection } from './tls';
import { assertLocalDatabaseAllowed } from './db-guard';

dotenv.config(); // never overrides a DATABASE_URL already exported in the shell

/**
 *   npm run db:rehearsal -- snapshot > before.json     (read-only: one READ ONLY transaction, counts and structure only)
 *   npm run db:rehearsal -- compare before.json after.json   (offline: no database connection)
 * The connection string is never printed. Exit codes: 0 ok, 3 compare found problems, 1 error.
 */
async function main() {
  const [mode, a, b] = process.argv.slice(2);
  if (mode === 'compare') {
    if (!a || !b) throw new Error('usage: compare <before.json> <after.json>');
    const result = compareSnapshots(JSON.parse(fs.readFileSync(a, 'utf8')), JSON.parse(fs.readFileSync(b, 'utf8')));
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 3);
  }
  if (mode !== 'snapshot') throw new Error('usage: snapshot | compare <before.json> <after.json>');

  let url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. Refusing to guess a database.');
  if (url.includes('-pooler.')) url = url.replace('-pooler.', '.');
  assertLocalDatabaseAllowed(url);
  const client = new Client(verifiedConnection(url));
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const snapshot = await takeSnapshot(async (text, params) => (await client.query(text, params as any[])).rows);
    await client.query('ROLLBACK');
    console.log(JSON.stringify(snapshot, null, 2));
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((err: any) => {
  console.error(`Rehearsal check failed: ${String(err?.code ?? '')} ${String(err?.message ?? err).split('\n')[0].replace(/postgres(ql)?:\/\/\S+/gi, '[hidden]')}`);
  process.exit(1);
});

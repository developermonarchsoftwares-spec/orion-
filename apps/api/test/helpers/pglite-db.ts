import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as path from 'path';
import * as schema from '../../src/database/schema';

const MIGRATIONS = path.resolve(__dirname, '../../src/database/migrations');

/**
 * A hermetic database for the E2E specs: an in-memory PGlite with every journaled migration applied, exposed both as the drizzle
 * database and as a minimal pg-Pool look-alike (the queue engine uses pool.query / pool.connect directly). No network, no real
 * database. One connection: statements are serialised by PGlite itself.
 */
export async function createHermeticDatabase() {
  const client = new PGlite();
  // The real journal, applied by Drizzle's own migrator: nothing here creates an application table or seed row by hand, so a gap
  // in the migrations shows up as a failing test instead of being masked.
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });

  const db = drizzle(client, { schema });
  const run = async (text: string, values?: unknown[]) => {
    const res = await client.query<any>(text, values as any[]);
    return { rows: res.rows, rowCount: res.rows.length, fields: [] };
  };
  const pool: any = {
    query: run,
    connect: async () => ({ query: run, release: () => undefined }),
    on: () => pool,
    end: async () => undefined,
  };
  return { client, db, pool, close: () => client.close() };
}

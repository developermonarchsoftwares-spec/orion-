import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { assertMigrationTarget, IMigrationTarget } from './migration-target';
import { assertLocalDatabaseAllowed } from './db-guard';
import { verifiedConnection } from './tls';

dotenv.config();

async function runMigrations() {
  let databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/orion_db';
  // For Neon PostgreSQL: pooler endpoints (-pooler.) cannot run Drizzle migrations due to advisory locks.
  // Automatically switch to the direct endpoint for running migrations.
  if (databaseUrl.includes('-pooler.')) {
    databaseUrl = databaseUrl.replace('-pooler.', '.');
  }
  let target: IMigrationTarget;
  try {
    target = assertMigrationTarget(databaseUrl);
    assertLocalDatabaseAllowed(databaseUrl); // a local server may host other applications' databases
  } catch (err: any) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }
  console.log(`Connecting to database for migrations: host ${target.host}, database ${target.database} (credentials hidden)`);

  const pool = new Pool({
    ...verifiedConnection(databaseUrl),
    max: 1,
  });

  const db = drizzle(pool);

  console.log('Running Drizzle migrations...');
  // From source (ts-node) the folder sits beside this file. From the compiled build (dist/database) it does not: the Dockerfile copies the
  // SQL to apps/api/src/database/migrations, two levels up. MIGRATIONS_FOLDER overrides both.
  const candidates = [process.env.MIGRATIONS_FOLDER, path.resolve(__dirname, './migrations'), path.resolve(__dirname, '../../src/database/migrations')].filter((c): c is string => !!c);
  const migrationsFolder = candidates.find((c) => fs.existsSync(path.join(c, 'meta', '_journal.json')));
  if (!migrationsFolder) {
    console.error(`✗ No migrations folder found (looked for meta/_journal.json in ${candidates.length} place(s)). Set MIGRATIONS_FOLDER.`);
    process.exit(1);
  }

  try {
    await migrate(db, { migrationsFolder });
    console.log('✓ All database migrations applied successfully.');
  } catch (error) {
    console.error('✗ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrations();

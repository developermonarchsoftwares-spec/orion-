import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

async function runMigrations() {
  let databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/orion_db';
  // For Neon PostgreSQL: pooler endpoints (-pooler.) cannot run Drizzle migrations due to advisory locks.
  // Automatically switch to the direct endpoint for running migrations.
  if (databaseUrl.includes('-pooler.')) {
    databaseUrl = databaseUrl.replace('-pooler.', '.');
  }
  console.log('Connecting to database for migrations:', databaseUrl.replace(/:[^:@]+@/, ':****@'));

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    ssl: { rejectUnauthorized: false },
  });

  const db = drizzle(pool);

  console.log('Running Drizzle migrations...');
  const migrationsFolder = path.resolve(__dirname, './migrations');

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

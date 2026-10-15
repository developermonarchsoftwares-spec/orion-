import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as fs from 'fs';
import * as path from 'path';
import * as schema from '../../../database/schema';
import type { DrizzleDb } from '../../../database/database.provider';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../database/migrations');

/** Migrations that Drizzle's journal applies, in order (0003 is a manual seed file, not journaled). */
export const JOURNALED_MIGRATIONS = [
  '0000_bent_johnny_storm.sql',
  '0001_blushing_loa.sql',
  '0002_typical_clint_barton.sql',
  '0004_decision_maker_people.sql',
  '0005_people_ingestion.sql',
  '0006_import_people_report.sql',
  '0007_people_review.sql',
  '0008_people_verification.sql',
  '0009_people_sources.sql',
  '0010_people_observations.sql',
  '0011_people_suppression.sql',
  '0012_people_classification_versioning.sql',
  '0013_people_contact_provenance.sql',
  '0014_people_freshness.sql',
  '0015_people_conflicts.sql',
  '0016_people_acquisition_runs.sql',
];

export const readMigration = (file: string) => fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

/**
 * In-process PostgreSQL (PGlite) built from the REAL migration files, so tests exercise the
 * actual DDL - constraints, partial unique indexes, foreign keys - without touching any
 * shared/remote database.
 */
export async function createTestDb(migrations: string[] = JOURNALED_MIGRATIONS) {
  const client = new PGlite();
  for (const file of migrations) {
    await client.exec(readMigration(file));
  }
  // The Drizzle schema selects users.deleted_at (added by 0023); these tests replay only a subset of migrations, so add the column here.
  await client.exec('ALTER TABLE IF EXISTS "users" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone');
  // Phase 15: the source-trust columns and the publication guard (0025). These suites replay a subset of the journal, so apply it here when it is not in the list.
  if (!migrations.includes('0025_source_trust.sql')) await client.exec(readMigration('0025_source_trust.sql'));
  // Phase 23: suppressing a person expires stored scheduled-export files, so these suites need the export tables (0020), which they would otherwise skip.
  if (!migrations.includes('0020_exports.sql')) await client.exec(readMigration('0020_exports.sql'));
  // The pglite drizzle driver exposes the same query API the services use.
  const db = drizzle(client, { schema }) as unknown as DrizzleDb;
  return { client, db };
}

export async function seedUser(db: DrizzleDb, email: string, credits?: { daily: number; purchased: number }, role: 'USER' | 'ADMIN' | 'SUPER_ADMIN' | 'DATA_MANAGER' = 'USER') {
  const [user] = await db
    .insert(schema.users)
    .values({ email, firstName: 'Test', lastName: 'User', role, status: 'ACTIVE' })
    .returning();
  if (credits) {
    await db.insert(schema.userWallets).values({
      userId: user.id,
      dailyCredits: credits.daily,
      purchasedCredits: credits.purchased,
      balance: credits.daily + credits.purchased,
      lastDailyCreditDate: new Date().toISOString().slice(0, 10),
    });
  }
  return user;
}

export async function seedBusiness(
  db: DrizzleDb,
  slug: string,
  opts: { status?: 'PUBLISHED' | 'DRAFT'; city?: string; state?: string } = {},
) {
  const [biz] = await db
    .insert(schema.businesses)
    .values({ slug, name: `${slug} Pvt Ltd`, status: opts.status ?? 'PUBLISHED', publishedAt: new Date() })
    .returning();
  await db.insert(schema.businessLocations).values({
    businessId: biz.id,
    addressLine1: '1 Test Street',
    city: opts.city ?? 'Coimbatore',
    district: opts.city ?? 'Coimbatore',
    state: opts.state ?? 'Tamil Nadu',
    pincode: '641001',
    isPrimary: true,
  });
  return biz;
}

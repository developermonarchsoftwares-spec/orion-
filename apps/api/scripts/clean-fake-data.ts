import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { assertDestructiveAllowed, describeTarget } from '../src/database/db-guard';
import { verifiedConnection } from '../src/database/tls';
dotenv.config();

/**
 * Deletes every user except two protected accounts, with their unlocks, saved items, wallets, credit ledger and audit rows.
 *
 * Safe by default: without `--apply` this is a DRY RUN that only counts what would be deleted. Applying needs `--apply`,
 * CONFIRM_DESTRUCTIVE_DATABASE=<database name> and a verified backup no older than 24 hours (`npm run db:backup`). It refuses any
 * database that is not an Orion database on the local server, and any remote database.
 */
const PROTECTED_EMAILS = ['subash@monarchsoftwares.com', 'kathirrajput@gmail.com'];

async function cleanDatabase() {
  let databaseUrl = process.env.DATABASE_URL || '';
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set in environment.');
  }
  if (databaseUrl.includes('-pooler.')) {
    databaseUrl = databaseUrl.replace('-pooler.', '.');
  }

  const decision = assertDestructiveAllowed({ label: 'clean-fake-data', url: databaseUrl, argv: process.argv.slice(2) });
  console.log(`Target: ${describeTarget(decision.target)} (credentials hidden)`);
  console.log(decision.apply ? 'Mode: APPLY (data will be deleted)' : 'Mode: DRY RUN (nothing will be changed)');
  console.log('Connecting to PostgreSQL for safe fake/demo data cleanup...');
  const pool = new Pool({
    ...verifiedConnection(databaseUrl),
    max: 1,
  });

  const client = await pool.connect();

  try {
    if (!decision.apply) {
      // Read-only plan: the same selection as below, counted instead of deleted.
      const keep = await client.query('SELECT id, email FROM users WHERE email = ANY($1::text[])', [PROTECTED_EMAILS]);
      const keepIds = keep.rows.map((r) => r.id);
      console.log(`Protected accounts found: ${keep.rowCount} of ${PROTECTED_EMAILS.length}`);
      if (keepIds.length === 0) console.log('WARNING: no protected account exists; an apply run would abort.');
      const plan: Array<[string, string]> = [
        ['lead_unlocks', 'user_id'],
        ['saved_searches', 'user_id'],
        ['saved_leads', 'user_id'],
        ['credit_transactions', 'user_id'],
        ['user_wallets', 'user_id'],
        ['audit_logs', 'user_id'],
        ['users', 'id'],
      ];
      for (const [table, col] of plan) {
        const n = (await client.query(`SELECT count(*)::int AS n FROM "${table}" WHERE "${col}" <> ALL($1::uuid[])`, [keepIds])).rows[0].n;
        console.log(`   would delete from ${table.padEnd(22)} ${n} row(s)`);
      }
      console.log('DRY RUN: nothing was changed.');
      console.log('To apply: run "npm run db:backup", then set CONFIRM_DESTRUCTIVE_DATABASE to the database name and add --apply.');
      return;
    }
    console.log(`Verified backup in force: ${decision.backup!.dir} (${decision.backup!.ageHours.toFixed(1)} h old)`);

    await client.query('BEGIN');

    // 1. Identify legitimate accounts to strictly PRESERVE
    const realUserQuery = await client.query(
      'SELECT id, email, role FROM users WHERE email = ANY($1::text[])',
      [PROTECTED_EMAILS],
    );
    const realUserIds = realUserQuery.rows.map((r) => r.id);
    console.log(`Protected Real Accounts: ${realUserQuery.rows.map((r) => `${r.email} (${r.role})`).join(', ')}`);

    if (realUserIds.length === 0) {
      throw new Error('Safety check failed: Real admin/user accounts were not found! Aborting.');
    }

    // 2. Identify test users to delete
    const testUsersQuery = await client.query(
      `SELECT id, email FROM users WHERE id NOT IN (${realUserIds.map((_, i) => `$${i + 1}`).join(', ')})`,
      realUserIds
    );
    const testUserIds = testUsersQuery.rows.map((r) => r.id);
    console.log(`Identified ${testUserIds.length} test/demo users to purge.`);

    if (testUserIds.length > 0) {
      const userParamPlaceholders = testUserIds.map((_, i) => `$${i + 1}`).join(', ');

      // 3. Delete dependent test lead unlocks
      const deletedUnlocks = await client.query(
        `DELETE FROM lead_unlocks WHERE user_id IN (${userParamPlaceholders}) RETURNING id`,
        testUserIds
      );
      console.log(`Deleted ${deletedUnlocks.rowCount} test lead unlocks.`);

      // 4. Delete dependent test saved searches
      const deletedSearches = await client.query(
        `DELETE FROM saved_searches WHERE user_id IN (${userParamPlaceholders}) RETURNING id`,
        testUserIds
      );
      console.log(`Deleted ${deletedSearches.rowCount} test saved searches.`);

      // 5. Delete dependent test saved leads
      const deletedSavedLeads = await client.query(
        `DELETE FROM saved_leads WHERE user_id IN (${userParamPlaceholders}) RETURNING id`,
        testUserIds
      );
      console.log(`Deleted ${deletedSavedLeads.rowCount} test saved leads.`);

      // 6. Delete credit transactions associated with test users or test wallets
      const deletedTx = await client.query(
        `DELETE FROM credit_transactions WHERE user_id IN (${userParamPlaceholders}) RETURNING id`,
        testUserIds
      );
      console.log(`Deleted ${deletedTx.rowCount} test credit transactions.`);

      // 7. Delete test user wallets
      const deletedWallets = await client.query(
        `DELETE FROM user_wallets WHERE user_id IN (${userParamPlaceholders}) RETURNING id`,
        testUserIds
      );
      console.log(`Deleted ${deletedWallets.rowCount} test user wallets.`);

      // 8. Delete test audit logs (auth and activity events for test users)
      const deletedAudit = await client.query(
        `DELETE FROM audit_logs WHERE user_id IN (${userParamPlaceholders}) RETURNING id`,
        testUserIds
      );
      console.log(`Deleted ${deletedAudit.rowCount} test audit logs.`);

      // 9. Delete test users
      const deletedUsers = await client.query(
        `DELETE FROM users WHERE id IN (${userParamPlaceholders}) RETURNING id`,
        testUserIds
      );
      console.log(`Deleted ${deletedUsers.rowCount} test users from database.`);
    }

    // 10. Audit businesses: ensure real business is intact
    const realBizQuery = await client.query('SELECT id, name, slug, status FROM businesses');
    console.log(`Preserved Businesses in Master DB: ${realBizQuery.rows.map((b) => `${b.name} (${b.status})`).join(', ')}`);

    // 11. Audit import batches: ensure real batches are intact
    const realBatchQuery = await client.query('SELECT id, filename, status, total_records FROM import_batches');
    console.log(`Preserved Ingestion Batches: ${realBatchQuery.rows.map((b) => `${b.filename} (${b.status})`).join(', ')}`);

    // 12. Audit real wallets & transactions
    const realWalletQuery = await client.query(
      `SELECT u.email, uw.balance, uw.daily_credits, uw.purchased_credits 
       FROM user_wallets uw JOIN users u ON uw.user_id = u.id 
       WHERE u.id IN (${realUserIds.map((_, i) => `$${i + 1}`).join(', ')})`,
      realUserIds
    );
    console.log('Preserved Real Wallets:', realWalletQuery.rows);

    const realTxQuery = await client.query(
      `SELECT count(*)::int as c FROM credit_transactions WHERE user_id IN (${realUserIds.map((_, i) => `$${i + 1}`).join(', ')})`,
      realUserIds
    );
    console.log(`Preserved Real Transactions: ${realTxQuery.rows[0].c}`);

    await client.query('COMMIT');
    console.log('✓ Database cleanup successfully committed!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Failed to clean database, transaction rolled back:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

cleanDatabase().catch((err) => {
  console.error('Fatal error during database cleanup:', err);
  process.exit(1);
});

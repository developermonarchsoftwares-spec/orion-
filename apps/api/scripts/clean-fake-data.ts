import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

async function cleanDatabase() {
  let databaseUrl = process.env.DATABASE_URL || '';
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set in environment.');
  }
  if (databaseUrl.includes('-pooler.')) {
    databaseUrl = databaseUrl.replace('-pooler.', '.');
  }

  console.log('Connecting to PostgreSQL for safe fake/demo data cleanup...');
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    max: 1,
  });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Identify legitimate accounts to strictly PRESERVE
    const realUserQuery = await client.query(
      "SELECT id, email, role FROM users WHERE email IN ('subash@monarchsoftwares.com', 'kathirrajput@gmail.com')"
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

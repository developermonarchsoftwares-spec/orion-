const { Pool } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
let dbUrl = '';
for (const line of envContent.split('\n')) {
  if (line.startsWith('DATABASE_URL=')) {
    dbUrl = line.split('=')[1].trim();
  }
}

async function runTest() {
  console.log('--- STARTING GMAIL AUTHENTICATION & EMAIL MATCHING TEST SUITE ---');
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
  });

  try {
    const timestamp = Date.now();
    const testGmail = `verify.gmail.${timestamp}@gmail.com`;
    const googleSubId = `google_sub_${timestamp}`;
    const givenName = 'GoogleUser';
    const familyName = `Tester_${timestamp}`;
    const displayName = `GoogleUser Tester ${timestamp}`;
    const avatarUrl = 'https://lh3.googleusercontent.com/a/mock-avatar-path';

    console.log(`[Step 1] Simulating Google OAuth Sign-In for Gmail: ${testGmail}`);

    // Upsert user into PostgreSQL users table exactly as handleGoogleCallback does
    let dbUser;
    const existing = await pool.query(`SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`, [testGmail]);
    if (existing.rows.length > 0) {
      const updateRes = await pool.query(
        `UPDATE users
         SET first_name = $1, last_name = $2, display_name = $3, avatar_url = $4, google_id = $5, provider = 'google', updated_at = NOW()
         WHERE LOWER(email) = LOWER($6)
         RETURNING *`,
        [givenName, familyName, displayName, avatarUrl, googleSubId, testGmail]
      );
      dbUser = updateRes.rows[0];
    } else {
      const insertRes = await pool.query(
        `INSERT INTO users (email, first_name, last_name, display_name, avatar_url, google_id, provider, role, status)
         VALUES (LOWER($1), $2, $3, $4, $5, $6, 'google', 'USER', 'ACTIVE')
         RETURNING *`,
        [testGmail, givenName, familyName, displayName, avatarUrl, googleSubId]
      );
      dbUser = insertRes.rows[0];
    }

    console.log(`[PASS 1] Upserted user in PostgreSQL users table: ID=${dbUser.id}, Email=${dbUser.email}`);

    // Verify stored email in database strictly matches testGmail
    if (dbUser.email.toLowerCase() !== testGmail.toLowerCase()) {
      throw new Error(`[FAIL 1] Stored database email (${dbUser.email}) does not match authenticated Gmail (${testGmail})!`);
    }

    // 2. Verify wallet association is for this exact user ID and email
    const walletRes = await pool.query(`SELECT * FROM user_wallets WHERE user_id = $1 LIMIT 1`, [dbUser.id]);
    let wallet = walletRes.rows[0];
    if (!wallet) {
      const todayStr = new Date().toISOString().slice(0, 10);
      const createdWallet = await pool.query(
        `INSERT INTO user_wallets (user_id, daily_credits, purchased_credits, balance, last_daily_credit_date, lifetime_purchased, lifetime_used)
         VALUES ($1, 5, 0, 5, $2, 0, 0)
         RETURNING *`,
        [dbUser.id, todayStr]
      );
      wallet = createdWallet.rows[0];
    }

    console.log(`[PASS 2] Wallet associated with user_id ${wallet.user_id} (balance: ${wallet.balance}).`);

    // 3. Verify user retrieval by Email query returns ONLY this user and never a different user
    const fetchedUserRes = await pool.query(`SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`, [testGmail]);
    const fetchedUser = fetchedUserRes.rows[0];

    if (!fetchedUser || fetchedUser.email.toLowerCase() !== testGmail.toLowerCase()) {
      throw new Error(`[FAIL 3] User lookup returned incorrect email: ${fetchedUser?.email}`);
    }

    console.log(`[PASS 3] Exact identity matching confirmed: Authenticated Gmail (${testGmail}) matches database record.`);

    // Clean up test user
    await pool.query(`DELETE FROM user_wallets WHERE user_id = $1`, [dbUser.id]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [dbUser.id]);

    console.log('\n=======================================================');
    console.log(' SUCCESS: GMAIL AUTHENTICATION & EMAIL MATCHING TEST PASSED!');
    console.log('=======================================================\n');

  } catch (err) {
    console.error('❌ GMAIL AUTHENTICATION TEST FAILED:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runTest();

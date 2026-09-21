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

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHashStr) {
  if (!storedHashStr || !storedHashStr.includes(':')) return false;
  const [salt, hash] = storedHashStr.split(':');
  const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(verifyHash, 'hex'));
  } catch {
    return false;
  }
}

async function runTest() {
  console.log('--- STARTING ACCOUNT SETTINGS DATABASE PERSISTENCE SUITE ---');
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
  });

  try {
    // 1. Identify or Create Test User in PostgreSQL
    const testEmail = 'subash@monarchsoftwares.com';
    let userRes = await pool.query(`SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`, [testEmail]);
    
    if (userRes.rows.length === 0) {
      console.log('Creating test user in Neon PostgreSQL...');
      userRes = await pool.query(
        `INSERT INTO users (email, first_name, last_name, display_name, role, status)
         VALUES (LOWER($1), 'Subash', 'Administrator', 'Subash Administrator', 'USER', 'ACTIVE')
         RETURNING *`,
        [testEmail]
      );
    }

    const testUser = userRes.rows[0];
    console.log(`[PASS 1] Loaded active user from PostgreSQL: ID=${testUser.id}, Email=${testUser.email}`);

    // 2. Test Profile & Company Update (CRUD)
    const timestamp = Date.now();
    const updatedFirstName = 'Subash';
    const updatedLastName = `Tech_${timestamp}`;
    const updatedDisplayName = `Subash Tech ${timestamp}`;
    const updatedOrg = `Monarch Software Enterprise ${timestamp}`;
    const updatedPhone = `+91 98450 ${timestamp.toString().slice(-5)}`;
    const updatedJobTitle = 'Chief Product Officer';

    const currentMeta = testUser.metadata || {};
    const newMeta = { ...currentMeta, jobTitle: updatedJobTitle };

    const updateProfileRes = await pool.query(
      `UPDATE users
       SET first_name = $1, last_name = $2, display_name = $3, organization_name = $4, phone_number = $5, metadata = $6::jsonb, updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [updatedFirstName, updatedLastName, updatedDisplayName, updatedOrg, updatedPhone, JSON.stringify(newMeta), testUser.id]
    );

    const verifiedUser = updateProfileRes.rows[0];
    if (
      verifiedUser.first_name === updatedFirstName &&
      verifiedUser.last_name === updatedLastName &&
      verifiedUser.display_name === updatedDisplayName &&
      verifiedUser.organization_name === updatedOrg &&
      verifiedUser.phone_number === updatedPhone &&
      verifiedUser.metadata?.jobTitle === updatedJobTitle
    ) {
      console.log('[PASS 2] Profile & Company updates successfully written and verified in Neon PostgreSQL users table.');
    } else {
      throw new Error('[FAIL 2] Profile update mismatch in database!');
    }

    // 3. Test Notification Preferences Persistence
    const notificationsSetting = {
      emailNewBusinesses: true,
      savedSearchAlerts: false,
      creditLowWarning: true,
      weeklyDigest: true,
      productUpdates: true,
      marketingEmails: false,
    };

    const notifMeta = { ...verifiedUser.metadata, notifications: notificationsSetting };

    const updateNotifRes = await pool.query(
      `UPDATE users SET metadata = $1::jsonb, updated_at = NOW() WHERE id = $2 RETURNING metadata`,
      [JSON.stringify(notifMeta), testUser.id]
    );

    const readNotif = updateNotifRes.rows[0].metadata?.notifications;
    if (
      readNotif?.emailNewBusinesses === true &&
      readNotif?.savedSearchAlerts === false &&
      readNotif?.weeklyDigest === true
    ) {
      console.log('[PASS 3] Notification preferences successfully persisted into JSONB metadata column in Neon PostgreSQL.');
    } else {
      throw new Error('[FAIL 3] Notification preferences update mismatch in database!');
    }

    // 4. Test App Preferences Persistence
    const appPreferencesSetting = {
      resultsPerPage: '50 results',
      defaultView: 'Grid View',
      timezone: 'India Standard Time (IST) - New Delhi, Kolkata',
      dateFormat: 'YYYY-MM-DD',
    };

    const prefMeta = { ...updateNotifRes.rows[0].metadata, preferences: appPreferencesSetting };

    const updatePrefRes = await pool.query(
      `UPDATE users SET metadata = $1::jsonb, updated_at = NOW() WHERE id = $2 RETURNING metadata`,
      [JSON.stringify(prefMeta), testUser.id]
    );

    const readPref = updatePrefRes.rows[0].metadata?.preferences;
    if (
      readPref?.resultsPerPage === '50 results' &&
      readPref?.defaultView === 'Grid View' &&
      readPref?.dateFormat === 'YYYY-MM-DD'
    ) {
      console.log('[PASS 4] App preferences successfully persisted into JSONB metadata column in Neon PostgreSQL.');
    } else {
      throw new Error('[FAIL 4] App preferences update mismatch in database!');
    }

    // 5. Test Password Hash Security & Persistence
    const testPassword = `SecurePass@${timestamp}`;
    const passwordHash = hashPassword(testPassword);

    const updatePasswordRes = await pool.query(
      `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2 RETURNING password_hash`,
      [passwordHash, testUser.id]
    );

    const storedHash = updatePasswordRes.rows[0].password_hash;
    const isPasswordValid = verifyPassword(testPassword, storedHash);
    const isWrongPasswordInvalid = !verifyPassword('WrongPassword123!', storedHash);

    if (storedHash && isPasswordValid && isWrongPasswordInvalid) {
      console.log('[PASS 5] Password security & hashing successfully updated and verified in Neon PostgreSQL users table.');
    } else {
      throw new Error('[FAIL 5] Password hashing verification failed!');
    }

    console.log('\n=======================================================');
    console.log(' SUCCESS: ALL ACCOUNT SETTINGS DATABASE PERSISTENCE TESTS PASSED CLEANLY! ');
    console.log('=======================================================\n');

  } catch (err) {
    console.error('\n❌ ACCOUNT SETTINGS VERIFICATION FAILED:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runTest();

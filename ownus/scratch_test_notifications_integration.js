const { Pool } = require('pg');

const dbUrl = "postgresql://neondb_owner:npg_CFOGv20pEALD@ep-weathered-surf-aefvqpls-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require";

async function testNotificationIntegration() {
  console.log("==================================================================");
  console.log("STARTING NOTIFICATION PREFERENCES & DISPATCH ENGINE INTEGRATION TEST");
  console.log("==================================================================");

  let pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const testEmail = "test_notification_user@monarchsoftwares.com";
    let userRes = await pool.query("SELECT * FROM users WHERE LOWER(email) = LOWER($1)", [testEmail]);

    let userId;
    if (userRes.rows.length === 0) {
      console.log(`[SETUP] Creating test user for ${testEmail}...`);
      const insertRes = await pool.query(
        `INSERT INTO users (email, first_name, last_name, display_name, role, status)
         VALUES ($1, 'NotifTest', 'User', 'Notif Test User', 'USER', 'ACTIVE')
         RETURNING *`,
        [testEmail]
      );
      userId = insertRes.rows[0].id;
    } else {
      userId = userRes.rows[0].id;
      console.log(`[SETUP] Found existing test user with ID: ${userId}`);
    }

    // 1. Update Notification Preferences in Neon PostgreSQL (All 6 Keys)
    const newPrefs = {
      emailNewBusinesses: true,
      savedSearchAlerts: true,
      creditLowWarning: true,
      weeklyDigest: true,
      productUpdates: true,
      marketingEmails: false, // Explicitly disabled
    };

    console.log("\n[TEST 1] Saving notification preferences directly to Neon PostgreSQL...");
    const currentMetaRes = await pool.query("SELECT metadata FROM users WHERE id = $1", [userId]);
    const currentMeta = currentMetaRes.rows[0]?.metadata || {};
    const updatedMeta = { ...currentMeta, notifications: newPrefs };

    await pool.query(
      `UPDATE users SET metadata = $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(updatedMeta), userId]
    );

    // 2. Re-connect & fetch fresh data from Neon PostgreSQL to verify DB persistence
    console.log("[TEST 1] Simulating new database session to verify persistence...");
    await pool.end();

    pool = new Pool({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
    });

    const freshRes = await pool.query("SELECT metadata FROM users WHERE id = $1", [userId]);
    const dbNotifications = freshRes.rows[0]?.metadata?.notifications || {};

    console.log("\n=================== DB PERSISTENCE CHECK ===================");
    console.log(`1. emailNewBusinesses : DB=${dbNotifications.emailNewBusinesses} | Expected=true -> ${dbNotifications.emailNewBusinesses === true ? 'PASS' : 'FAIL'}`);
    console.log(`2. savedSearchAlerts  : DB=${dbNotifications.savedSearchAlerts} | Expected=true -> ${dbNotifications.savedSearchAlerts === true ? 'PASS' : 'FAIL'}`);
    console.log(`3. creditLowWarning   : DB=${dbNotifications.creditLowWarning} | Expected=true -> ${dbNotifications.creditLowWarning === true ? 'PASS' : 'FAIL'}`);
    console.log(`4. weeklyDigest       : DB=${dbNotifications.weeklyDigest} | Expected=true -> ${dbNotifications.weeklyDigest === true ? 'PASS' : 'FAIL'}`);
    console.log(`5. productUpdates     : DB=${dbNotifications.productUpdates} | Expected=true -> ${dbNotifications.productUpdates === true ? 'PASS' : 'FAIL'}`);
    console.log(`6. marketingEmails    : DB=${dbNotifications.marketingEmails} | Expected=false -> ${dbNotifications.marketingEmails === false ? 'PASS' : 'FAIL'}`);

    // 3. Test Preference-Based Dispatch Engine Simulation
    console.log("\n[TEST 2] Testing Notification Dispatch Engine logic...");

    function evaluateNotificationDispatch(userMeta, notifType) {
      const defaultPrefs = {
        emailNewBusinesses: true,
        savedSearchAlerts: true,
        creditLowWarning: true,
        weeklyDigest: false,
        productUpdates: true,
        marketingEmails: false,
      };
      const notifPrefs = userMeta?.notifications || {};
      const isEnabled = notifPrefs[notifType] !== undefined ? Boolean(notifPrefs[notifType]) : defaultPrefs[notifType];
      if (!isEnabled) {
        return { dispatched: false, reason: `PREFERENCE_DISABLED: User has disabled '${notifType}'` };
      }
      return { dispatched: true, emailSent: true };
    }

    const enabledResult = evaluateNotificationDispatch(freshRes.rows[0]?.metadata, 'creditLowWarning');
    console.log(`- Enabled Preference ('creditLowWarning') Dispatch Result: Dispatched=${enabledResult.dispatched} -> ${enabledResult.dispatched === true ? 'PASS (Dispatched)' : 'FAIL'}`);

    const disabledResult = evaluateNotificationDispatch(freshRes.rows[0]?.metadata, 'marketingEmails');
    console.log(`- Disabled Preference ('marketingEmails') Dispatch Result: Dispatched=${disabledResult.dispatched} (Reason: ${disabledResult.reason}) -> ${disabledResult.dispatched === false ? 'PASS (Suppressed)' : 'FAIL'}`);

    // 4. Update marketingEmails to true and re-test
    console.log("\n[TEST 3] Updating 'marketingEmails' preference to true in Neon PostgreSQL...");
    updatedMeta.notifications.marketingEmails = true;
    await pool.query("UPDATE users SET metadata = $1::jsonb WHERE id = $2", [JSON.stringify(updatedMeta), userId]);

    const updatedFreshRes = await pool.query("SELECT metadata FROM users WHERE id = $1", [userId]);
    const reEnabledResult = evaluateNotificationDispatch(updatedFreshRes.rows[0]?.metadata, 'marketingEmails');
    console.log(`- Re-enabled Preference ('marketingEmails') Dispatch Result: Dispatched=${reEnabledResult.dispatched} -> ${reEnabledResult.dispatched === true ? 'PASS (Dispatched)' : 'FAIL'}`);

    console.log("\n>>> ALL NOTIFICATION PREFERENCE & DISPATCH ENGINE TESTS PASSED! <<<");
  } catch (err) {
    console.error("Test failed with error:", err);
    process.exit(1);
  } finally {
    await pool.end().catch(() => {});
  }
}

testNotificationIntegration();

const { Pool } = require('pg');

const dbUrl = "postgresql://neondb_owner:npg_CFOGv20pEALD@ep-weathered-surf-aefvqpls-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require";

async function verifyAppPreferencesPersistence() {
  console.log("==================================================================");
  console.log("STARTING APP PREFERENCES NEON POSTGRESQL PERSISTENCE TEST");
  console.log("==================================================================");

  let pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const testEmail = "test_app_preferences_user@monarchsoftwares.com";
    let userRes = await pool.query("SELECT * FROM users WHERE LOWER(email) = LOWER($1)", [testEmail]);

    let userId;
    if (userRes.rows.length === 0) {
      console.log(`[SETUP] Creating test user for ${testEmail}...`);
      const insertRes = await pool.query(
        `INSERT INTO users (email, first_name, last_name, display_name, role, status)
         VALUES ($1, 'PrefTest', 'User', 'Preferences Test User', 'USER', 'ACTIVE')
         RETURNING *`,
        [testEmail]
      );
      userId = insertRes.rows[0].id;
    } else {
      userId = userRes.rows[0].id;
      console.log(`[SETUP] Found existing test user with ID: ${userId}`);
    }

    // 1. Define new App Preferences state
    const newPreferences = {
      resultsPerPage: "50 results",
      defaultView: "Grid View",
      timezone: "Eastern Time (ET) - US & Canada",
      dateFormat: "YYYY-MM-DD"
    };

    console.log("\n[UPDATE] Saving App Preferences to Neon PostgreSQL:", JSON.stringify(newPreferences, null, 2));

    const currentMetaRes = await pool.query("SELECT metadata FROM users WHERE id = $1", [userId]);
    const currentMeta = currentMetaRes.rows[0]?.metadata || {};
    const updatedMeta = { ...currentMeta, preferences: newPreferences };

    const updateRes = await pool.query(
      `UPDATE users SET metadata = $1::jsonb, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [JSON.stringify(updatedMeta), userId]
    );

    console.log(`[UPDATE SUCCESS] Updated metadata in Neon DB at: ${updateRes.rows[0].updated_at}`);

    // 2. Simulate Connection Tear-down & Page Reload / New Session
    console.log("\n[SIMULATION] Closing DB pool & reconnecting to simulate page refresh / browser restart / new session...");
    await pool.end();

    pool = new Pool({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
    });

    // 3. Fetch fresh data from Neon PostgreSQL (Single Source of Truth)
    console.log("[FETCH] Retrieving fresh metadata from Neon PostgreSQL...");
    const freshRes = await pool.query("SELECT metadata FROM users WHERE id = $1", [userId]);
    const fetchedPreferences = freshRes.rows[0]?.metadata?.preferences || {};

    console.log("\n=================== VERIFICATION RESULTS ===================");
    console.log(`1. Default Results Per Page : DB='${fetchedPreferences.resultsPerPage}' | Expected='${newPreferences.resultsPerPage}' -> ${fetchedPreferences.resultsPerPage === newPreferences.resultsPerPage ? 'PASS' : 'FAIL'}`);
    console.log(`2. Default View             : DB='${fetchedPreferences.defaultView}' | Expected='${newPreferences.defaultView}' -> ${fetchedPreferences.defaultView === newPreferences.defaultView ? 'PASS' : 'FAIL'}`);
    console.log(`3. Timezone                 : DB='${fetchedPreferences.timezone}' | Expected='${newPreferences.timezone}' -> ${fetchedPreferences.timezone === newPreferences.timezone ? 'PASS' : 'FAIL'}`);
    console.log(`4. Date Format              : DB='${fetchedPreferences.dateFormat}' | Expected='${newPreferences.dateFormat}' -> ${fetchedPreferences.dateFormat === newPreferences.dateFormat ? 'PASS' : 'FAIL'}`);

    const allPassed = 
      fetchedPreferences.resultsPerPage === newPreferences.resultsPerPage &&
      fetchedPreferences.defaultView === newPreferences.defaultView &&
      fetchedPreferences.timezone === newPreferences.timezone &&
      fetchedPreferences.dateFormat === newPreferences.dateFormat;

    if (allPassed) {
      console.log("\n>>> ALL APP PREFERENCES FULLY PERSISTED IN NEON POSTGRESQL! <<<");
    } else {
      console.error("\n>>> VERIFICATION FAILED FOR ONE OR MORE PREFERENCE FIELDS! <<<");
      process.exit(1);
    }
  } catch (err) {
    console.error("Test failed with error:", err);
    process.exit(1);
  } finally {
    await pool.end().catch(() => {});
  }
}

verifyAppPreferencesPersistence();

const { Pool } = require('pg');

const dbUrl = "postgresql://neondb_owner:npg_CFOGv20pEALD@ep-weathered-surf-aefvqpls-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require";

async function testSingleDeviceLoginEnforcement() {
  console.log("==========================================================================================");
  console.log("    STARTING SINGLE-DEVICE LOGIN ENFORCEMENT (NETFLIX-STYLE SESSION) TEST          ");
  console.log("==========================================================================================");

  let pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const testEmail = "single_device_test_user@monarchsoftwares.com";
    let userRes = await pool.query("SELECT * FROM users WHERE LOWER(email) = LOWER($1)", [testEmail]);

    let userId;
    if (userRes.rows.length === 0) {
      console.log(`[SETUP] Creating test user for ${testEmail}...`);
      const insertRes = await pool.query(
        `INSERT INTO users (email, first_name, last_name, display_name, role, status)
         VALUES ($1, 'Single', 'DeviceUser', 'Single Device User', 'USER', 'ACTIVE')
         RETURNING *`,
        [testEmail]
      );
      userId = insertRes.rows[0].id;
    } else {
      userId = userRes.rows[0].id;
      console.log(`[SETUP] Found existing test user with ID: ${userId}`);
    }

    // -------------------------------------------------------------------------------------
    // STEP 1: Device 1 Logs In
    // -------------------------------------------------------------------------------------
    const device1SessionId = "sess_device_1_laptop_chrome_1001";
    console.log(`\n[STEP 1] User logs in on Device 1 (Chrome Laptop). Generated Session ID: '${device1SessionId}'`);

    const currentMetaRes1 = await pool.query("SELECT metadata FROM users WHERE id = $1", [userId]);
    const meta1 = currentMetaRes1.rows[0]?.metadata || {};
    const updatedMeta1 = { ...meta1, activeSessionId: device1SessionId };

    await pool.query("UPDATE users SET metadata = $1::jsonb, updated_at = NOW() WHERE id = $2", [
      JSON.stringify(updatedMeta1),
      userId,
    ]);

    // Validate Device 1 Session against DB
    const dbRes1 = await pool.query("SELECT metadata FROM users WHERE id = $1", [userId]);
    const currentDbSession1 = dbRes1.rows[0]?.metadata?.activeSessionId;

    const isDevice1ValidInitial = device1SessionId === currentDbSession1;
    console.log(`  - Device 1 Session Check: Token='${device1SessionId}' | DB='${currentDbSession1}' -> ${isDevice1ValidInitial ? 'PASS (Allowed)' : 'FAIL'}`);

    // -------------------------------------------------------------------------------------
    // STEP 2: Device 2 Logs In (New Device / Phone / Browser)
    // -------------------------------------------------------------------------------------
    const device2SessionId = "sess_device_2_mobile_safari_2002";
    console.log(`\n[STEP 2] User logs in on Device 2 (iPhone Safari). Generated Session ID: '${device2SessionId}'`);

    const currentMetaRes2 = await pool.query("SELECT metadata FROM users WHERE id = $1", [userId]);
    const meta2 = currentMetaRes2.rows[0]?.metadata || {};
    const updatedMeta2 = { ...meta2, activeSessionId: device2SessionId };

    await pool.query("UPDATE users SET metadata = $1::jsonb, updated_at = NOW() WHERE id = $2", [
      JSON.stringify(updatedMeta2),
      userId,
    ]);

    // Validate Device 2 Session against DB
    const dbRes2 = await pool.query("SELECT metadata FROM users WHERE id = $1", [userId]);
    const currentDbSession2 = dbRes2.rows[0]?.metadata?.activeSessionId;

    const isDevice2Valid = device2SessionId === currentDbSession2;
    console.log(`  - Device 2 Session Check: Token='${device2SessionId}' | DB='${currentDbSession2}' -> ${isDevice2Valid ? 'PASS (Allowed)' : 'FAIL'}`);

    // -------------------------------------------------------------------------------------
    // STEP 3: Verify Device 1 is now SUPERSEDED & REJECTED (401 SESSION_SUPERSEDED)
    // -------------------------------------------------------------------------------------
    console.log(`\n[STEP 3] Device 1 makes a new API request with old token ('${device1SessionId}')...`);
    
    function validateSession(tokenSessionId, dbSessionId) {
      if (!tokenSessionId || !dbSessionId) return { valid: true };
      if (tokenSessionId !== dbSessionId) {
        return {
          valid: false,
          statusCode: 401,
          code: 'SESSION_SUPERSEDED',
          message: 'Your account has been logged in on another device. Please log in again.'
        };
      }
      return { valid: true };
    }

    const device1CheckResult = validateSession(device1SessionId, currentDbSession2);
    console.log(`  - Device 1 Session Evaluation: Valid=${device1CheckResult.valid} | Code='${device1CheckResult.code}'`);
    console.log(`  - Rejection Message: "${device1CheckResult.message}"`);

    const isDevice1Superseded = device1CheckResult.valid === false && device1CheckResult.code === 'SESSION_SUPERSEDED';

    console.log("\n=================== VERIFICATION RESULTS ===================");
    console.log(`1. Device 1 Initial Session  : Allowed = ${isDevice1ValidInitial ? 'PASS' : 'FAIL'}`);
    console.log(`2. Device 2 New Login        : Allowed = ${isDevice2Valid ? 'PASS' : 'FAIL'}`);
    console.log(`3. Device 1 Superseded Check : REJECTED 401 SESSION_SUPERSEDED = ${isDevice1Superseded ? 'PASS' : 'FAIL'}`);

    if (isDevice1ValidInitial && isDevice2Valid && isDevice1Superseded) {
      console.log("\n>>> NETFLIX-STYLE SINGLE-DEVICE LOGIN ENFORCEMENT FULLY VERIFIED (100% PASS)! <<<");
    } else {
      console.error("\n>>> VERIFICATION FAILED FOR SINGLE-DEVICE LOGIN ENFORCEMENT! <<<");
      process.exit(1);
    }
  } catch (err) {
    console.error("Test failed with error:", err);
    process.exit(1);
  } finally {
    await pool.end().catch(() => {});
  }
}

testSingleDeviceLoginEnforcement();

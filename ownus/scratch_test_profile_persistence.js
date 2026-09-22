const { Pool } = require('pg');

const dbUrl = "postgresql://neondb_owner:npg_CFOGv20pEALD@ep-weathered-surf-aefvqpls-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require";

async function verifyProfilePersistence() {
  console.log("==================================================================");
  console.log("STARTING PROFILE INFORMATION NEON POSTGRESQL PERSISTENCE TEST");
  console.log("==================================================================");

  let pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    // 1. Fetch or create a test user
    const testEmail = "test_persistence_user@monarchsoftwares.com";
    let userRes = await pool.query("SELECT * FROM users WHERE LOWER(email) = LOWER($1)", [testEmail]);
    
    let userId;
    if (userRes.rows.length === 0) {
      console.log(`[SETUP] Creating test user for ${testEmail}...`);
      const insertRes = await pool.query(
        `INSERT INTO users (email, first_name, last_name, display_name, role, status)
         VALUES ($1, 'Kathir', 'Rajput', 'Kathir Rajput Initial', 'USER', 'ACTIVE')
         RETURNING *`,
        [testEmail]
      );
      userId = insertRes.rows[0].id;
    } else {
      userId = userRes.rows[0].id;
      console.log(`[SETUP] Found existing test user with ID: ${userId}`);
    }

    // 2. Perform updates across all 5 profile fields
    const testData = {
      fullName: "Kathir Rajput Updated",
      companyName: "Monarch Product Labs Pvt Ltd",
      jobTitle: "Senior Director of Engineering",
      phoneNumber: "+91 98450 12345",
      avatarUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop"
    };

    console.log(`\n[UPDATE] Updating user ${userId} in Neon PostgreSQL with:`, JSON.stringify(testData, null, 2));

    const currentMetaRes = await pool.query("SELECT metadata FROM users WHERE id = $1", [userId]);
    const currentMeta = currentMetaRes.rows[0]?.metadata || {};
    const updatedMeta = { ...currentMeta, jobTitle: testData.jobTitle };

    const updateRes = await pool.query(
      `UPDATE users
       SET display_name = $1,
           organization_name = $2,
           phone_number = $3,
           avatar_url = $4,
           profile_picture = $4,
           metadata = $5::jsonb,
           updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [
        testData.fullName,
        testData.companyName,
        testData.phoneNumber,
        testData.avatarUrl,
        JSON.stringify(updatedMeta),
        userId
      ]
    );

    console.log(`[UPDATE SUCCESS] Row updated in Neon PostgreSQL at: ${updateRes.rows[0].updated_at}`);

    // 3. Simulate Server Restart / New DB Session
    console.log("\n[SIMULATION] Closing connection pool & reconnecting to Neon PostgreSQL to simulate server restart / new session...");
    await pool.end();

    pool = new Pool({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
    });

    // 4. Retrieve fresh data from Neon PostgreSQL (Single Source of Truth)
    console.log("[FETCH] Fetching fresh profile data from Neon PostgreSQL...");
    const freshRes = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
    const row = freshRes.rows[0];

    const fetchedName = row.display_name;
    const fetchedCompany = row.organization_name;
    const fetchedPhone = row.phone_number;
    const fetchedAvatar = row.avatar_url;
    const fetchedJobTitle = row.metadata?.jobTitle;

    console.log("\n=================== VERIFICATION RESULTS ===================");
    console.log(`1. Full Name       : DB='${fetchedName}' | Expected='${testData.fullName}' -> ${fetchedName === testData.fullName ? 'PASS' : 'FAIL'}`);
    console.log(`2. Company Name    : DB='${fetchedCompany}' | Expected='${testData.companyName}' -> ${fetchedCompany === testData.companyName ? 'PASS' : 'FAIL'}`);
    console.log(`3. Job Title       : DB='${fetchedJobTitle}' | Expected='${testData.jobTitle}' -> ${fetchedJobTitle === testData.jobTitle ? 'PASS' : 'FAIL'}`);
    console.log(`4. Phone Number    : DB='${fetchedPhone}' | Expected='${testData.phoneNumber}' -> ${fetchedPhone === testData.phoneNumber ? 'PASS' : 'FAIL'}`);
    console.log(`5. Profile Photo   : DB='${fetchedAvatar}' | Expected='${testData.avatarUrl}' -> ${fetchedAvatar === testData.avatarUrl ? 'PASS' : 'FAIL'}`);

    const allPassed = 
      fetchedName === testData.fullName &&
      fetchedCompany === testData.companyName &&
      fetchedJobTitle === testData.jobTitle &&
      fetchedPhone === testData.phoneNumber &&
      fetchedAvatar === testData.avatarUrl;

    if (allPassed) {
      console.log("\n>>> ALL PROFILE UPDATES FULLY PERSISTED IN NEON POSTGRESQL! <<<");
    } else {
      console.error("\n>>> VERIFICATION FAILED FOR ONE OR MORE FIELDS! <<<");
      process.exit(1);
    }
  } catch (err) {
    console.error("Test failed with error:", err);
    process.exit(1);
  } finally {
    await pool.end().catch(() => {});
  }
}

verifyProfilePersistence();

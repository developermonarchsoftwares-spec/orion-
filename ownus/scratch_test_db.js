const { Pool } = require('pg');
const { requireLocalDatabaseUrl } = require('./scratch_target');

const dbUrls = [requireLocalDatabaseUrl()];

async function testAll() {
  for (const url of dbUrls) {
    console.log("\nTesting URL:", url.replace(/:[^:@]+@/, ':****@'));
    const pool = new Pool({
      connectionString: url,
      ssl: false,
      connectionTimeoutMillis: 3000,
    });
    try {
      const res = await pool.query("SELECT current_database(), current_user");
      console.log("SUCCESS!", res.rows[0]);
      
      const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
      console.log("Tables:", tables.rows.map(r => r.table_name));
    } catch (err) {
      console.error("FAILED:", err.message);
    } finally {
      await pool.end().catch(() => {});
    }
  }
}

testAll();

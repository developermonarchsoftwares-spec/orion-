const { Pool } = require('pg');

const dbUrls = [
  "postgresql://neondb_owner:npg_CFOGv20pEALD@ep-weathered-surf-aefvqpls-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require",
  "postgresql://neondb_owner:npg_CFOGv20pEALD@ep-weathered-surf-aefvqpls.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require",
  "postgresql://postgres:postgres@localhost:5432/orion_db",
  "postgresql://postgres:postgres@127.0.0.1:5432/orion_db",
  "postgresql://postgres:postgres@127.0.0.1:5432/postgres"
];

async function testAll() {
  for (const url of dbUrls) {
    console.log("\nTesting URL:", url.replace(/:[^:@]+@/, ':****@'));
    const pool = new Pool({
      connectionString: url,
      ssl: url.includes('neon.tech') ? { rejectUnauthorized: false } : false,
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

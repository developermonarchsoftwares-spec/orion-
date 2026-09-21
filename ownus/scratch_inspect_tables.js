const { Pool } = require('pg');

const dbUrl = "postgresql://neondb_owner:npg_CFOGv20pEALD@ep-weathered-surf-aefvqpls-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require";

const pool = new Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
});

async function inspectSchema() {
  const targetTables = [
    'businesses',
    'import_batches',
    'import_records',
    'business_locations',
    'business_contacts',
    'duplicate_candidates',
    'publish_queue',
    'lead_unlocks',
    'users',
    'user_wallets'
  ];

  for (const table of targetTables) {
    try {
      const cols = await pool.query(
        `SELECT column_name, data_type, is_nullable, column_default 
         FROM information_schema.columns 
         WHERE table_name = $1 
         ORDER BY ordinal_position`,
        [table]
      );
      console.log(`\n=================== TABLE: ${table} ===================`);
      cols.rows.forEach(c => {
        console.log(`  ${c.column_name.padEnd(25)} | ${c.data_type.padEnd(25)} | null:${c.is_nullable} | default:${c.column_default}`);
      });

      const rowCount = await pool.query(`SELECT count(*)::int as count FROM "${table}"`);
      console.log(`Current Row Count: ${rowCount.rows[0].count}`);

      if (rowCount.rows[0].count > 0) {
        const sample = await pool.query(`SELECT * FROM "${table}" LIMIT 2`);
        console.log(`Sample Rows:`, JSON.stringify(sample.rows, null, 2));
      }
    } catch (err) {
      console.error(`Error inspecting table [${table}]:`, err.message);
    }
  }

  await pool.end();
}

inspectSchema();

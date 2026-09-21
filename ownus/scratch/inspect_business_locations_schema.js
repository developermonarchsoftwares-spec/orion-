const { Pool } = require('pg');
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

async function main() {
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
  });

  try {
    const columnsRes = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'business_locations'
      ORDER BY ordinal_position;
    `);
    console.log('--- BUSINESS_LOCATIONS TABLE COLUMNS ---');
    console.table(columnsRes.rows);

    const constRes = await pool.query(`
      SELECT conname, contype, pg_get_constraintdef(oid)
      FROM pg_constraint
      WHERE conrelid = 'business_locations'::regclass;
    `);
    console.log('--- CONSTRAINTS ---');
    console.table(constRes.rows);

  } catch (err) {
    console.error('Database Error:', err);
  } finally {
    await pool.end();
  }
}

main();

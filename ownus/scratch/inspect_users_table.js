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
      WHERE table_name = 'users'
      ORDER BY ordinal_position;
    `);
    console.log('--- USERS TABLE COLUMNS ---');
    console.table(columnsRes.rows);

    const sampleRes = await pool.query(`SELECT id, email, first_name, last_name, display_name, phone_number, organization_name, metadata FROM users LIMIT 3;`);
    console.log('--- SAMPLE USERS ---');
    console.log(JSON.stringify(sampleRes.rows, null, 2));

  } catch (err) {
    console.error('Database Error:', err);
  } finally {
    await pool.end();
  }
}

main();

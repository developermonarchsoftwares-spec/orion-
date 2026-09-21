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
    const res = await pool.query(`
      SELECT b.id, b.name, b.status, bl.id as loc_id, bl.city, bl.district, bl.state, bl.pincode, bl.address_line1
      FROM businesses b
      LEFT JOIN business_locations bl ON b.id = bl.business_id
      ORDER BY b.created_at DESC;
    `);

    console.log(`TOTAL BUSINESSES IN DB: ${res.rows.length}`);
    console.table(res.rows.slice(0, 25));

  } catch (err) {
    console.error('Database Error:', err);
  } finally {
    await pool.end();
  }
}

main();

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
    const testBizId = '1b8f6010-4d19-45e1-ac25-e99ea81f6ede';
    await pool.query(
      `INSERT INTO business_locations (business_id, city, district, state, pincode, address_line1)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (business_id) DO NOTHING`,
      [testBizId, 'Coimbatore', 'Coimbatore', 'Tamil Nadu', '641001', '101 Industrial Estate']
    );
    console.log('Query succeeded!');
  } catch (err) {
    console.error('SQL EXECUTION ERROR:', err.message);
  } finally {
    await pool.end();
  }
}

main();

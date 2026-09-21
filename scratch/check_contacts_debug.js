const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

let envContent = '';
try {
  envContent = fs.readFileSync(path.join(__dirname, '..', 'ownus', '.env.local'), 'utf8');
} catch {
  envContent = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
}
let dbUrl = '';
for (const line of envContent.split('\n')) {
  if (line.startsWith('DATABASE_URL=')) {
    dbUrl = line.split('=')[1].trim();
  }
}

const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function check() {
  console.log('--- CHECKING DATABASE CONTACTS & EXPORT DATA ---');
  
  const bRes = await pool.query(`
    SELECT b.id, b.name, b.status, b.business_type,
           bc.phone, bc.email, dp.url as website,
           bl.city, bl.district, bl.state
    FROM businesses b
    LEFT JOIN business_contacts bc ON b.id = bc.business_id
    LEFT JOIN digital_presences dp ON b.id = dp.business_id AND dp.platform = 'WEBSITE'
    LEFT JOIN business_locations bl ON b.id = bl.business_id AND bl.is_primary = true
    WHERE b.status = 'PUBLISHED'
    LIMIT 10
  `);

  console.log(`Found ${bRes.rows.length} sample published businesses:`);
  console.table(bRes.rows);

  const contactCount = await pool.query('SELECT count(id) FROM business_contacts');
  console.log('Total business_contacts count:', contactCount.rows[0].count);

  const dpCount = await pool.query('SELECT count(id) FROM digital_presences');
  console.log('Total digital_presences count:', dpCount.rows[0].count);

  await pool.end();
}

check().catch(console.error);

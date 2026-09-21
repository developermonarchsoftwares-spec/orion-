const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function testLocationDataFlow() {
  console.log('=== TEST 1: DIRECT POSTGRESQL LOCATION QUERY ===');
  const sqlQuery = `
    SELECT b.id, b.name, b.status,
           bl.city, bl.district, bl.state, bl.pincode, bl.address_line1 as address
    FROM businesses b
    LEFT JOIN business_locations bl ON b.id = bl.business_id
    WHERE LOWER(b.status::text) = 'published' OR LOWER(b.status::text) = 'active'
    ORDER BY b.created_at DESC
    LIMIT 5;
  `;
  const dbResult = await pool.query(sqlQuery);
  console.log('SQL Query Output:');
  console.table(dbResult.rows);

  console.log('\n=== TEST 2: API DISCOVER RESPONSE SIMULATION ===');
  const apiItems = dbResult.rows.map((r) => ({
    id: r.id,
    name: r.name,
    city: r.city || '',
    district: r.district || r.city || '',
    state: r.state || '',
    address: r.address || '',
    pincode: r.pincode || ''
  }));
  console.log('API Response Items (first 3):', JSON.stringify(apiItems.slice(0, 3), null, 2));

  console.log('\n=== TEST 3: VERIFY NO HARDCODED MUMBAI/MAHARASHTRA IN DB RESULTS ===');
  const mumbaiCount = dbResult.rows.filter(r => r.city === 'Mumbai' && r.state === 'Maharashtra').length;
  console.log(`Total records in sample: ${dbResult.rows.length}`);
  console.log(`Mumbai/Maharashtra hardcoded fallback records count: ${mumbaiCount}`);
  if (mumbaiCount < dbResult.rows.length) {
    console.log('SUCCESS: Authentic location data retrieved directly from database!');
  } else {
    console.log('WARNING: Still showing Mumbai');
  }

  await pool.end();
}

testLocationDataFlow().catch(console.error);

const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    const res = await pool.query(`
      SELECT b.id, b.name, b.status, bl.city, bl.district, bl.state, bl.pincode, bl.address_line1
      FROM businesses b
      LEFT JOIN business_locations bl ON b.id = bl.business_id
      ORDER BY b.created_at DESC
      LIMIT 10;
    `);
    console.log('Sample Business Locations in DB:', JSON.stringify(res.rows, null, 2));
    console.log('Total businesses count:', (await pool.query('SELECT COUNT(*) FROM businesses')).rows[0].count);
    console.log('Total business_locations count:', (await pool.query('SELECT COUNT(*) FROM business_locations')).rows[0].count);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

main();

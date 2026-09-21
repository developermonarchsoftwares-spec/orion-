const { Pool } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', 'ownus', '.env.local') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    const allRows = await pool.query(`
      SELECT b.id, b.name, b.status, b.business_type, b.msme_category, b.is_verified,
             i.name as industry_name, c.name as category_name,
             bl.state, bl.city, bl.district, bl.pincode,
             bc.phone, bc.email, dp.url as website
      FROM businesses b
      LEFT JOIN industries i ON b.industry_id = i.id
      LEFT JOIN categories c ON b.category_id = c.id
      LEFT JOIN business_locations bl ON b.id = bl.business_id
      LEFT JOIN business_contacts bc ON b.id = bc.business_id
      LEFT JOIN digital_presences dp ON b.id = dp.business_id AND dp.platform = 'WEBSITE'
      ORDER BY b.created_at DESC
      LIMIT 20
    `);
    console.log('Total businesses in DB:', allRows.rows.length);
    console.log('All Records sample:', JSON.stringify(allRows.rows, null, 2));
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

main();

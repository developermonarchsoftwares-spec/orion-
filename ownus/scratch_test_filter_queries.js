const { Pool } = require('pg');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  console.log('--- TESTING DYNAMIC SQL FILTER QUERIES AGAINST NEON POSTGRESQL ---');
  try {
    // Test 1: Query with state filter
    const q1 = await pool.query(`
      SELECT b.id, b.name, b.status, bl.city, bl.state, bc.phone, bc.email
      FROM businesses b
      LEFT JOIN business_locations bl ON b.id = bl.business_id
      LEFT JOIN business_contacts bc ON b.id = bc.business_id
      WHERE (b.status = 'PUBLISHED' OR LOWER(b.status::text) = 'published' OR LOWER(b.status::text) = 'active')
        AND (bl.state ILIKE $1 OR bl.city ILIKE $1)
      ORDER BY b.created_at DESC
    `, ['%Maharashtra%']);
    console.log('Test 1 (State/City filter "Maharashtra") returned:', q1.rows.length, 'records');

    // Test 2: Query with search term
    const q2 = await pool.query(`
      SELECT b.id, b.name, b.status, bl.city, bl.state
      FROM businesses b
      LEFT JOIN business_locations bl ON b.id = bl.business_id
      WHERE (b.status = 'PUBLISHED' OR LOWER(b.status::text) = 'published' OR LOWER(b.status::text) = 'active')
        AND (LOWER(b.name) LIKE $1 OR LOWER(COALESCE(b.description, '')) LIKE $1)
      ORDER BY b.created_at DESC
    `, ['%partner%']);
    console.log('Test 2 (Search query "partner") returned:', q2.rows.length, 'records');

    // Test 3: Total count query for pagination
    const q3 = await pool.query(`
      SELECT COUNT(DISTINCT b.id) as total
      FROM businesses b
      LEFT JOIN business_locations bl ON b.id = bl.business_id
      WHERE (b.status = 'PUBLISHED' OR LOWER(b.status::text) = 'published' OR LOWER(b.status::text) = 'active')
    `);
    console.log('Test 3 (Total published count) returned:', q3.rows[0].total);

    console.log('--- DYNAMIC SQL FILTER QUERIES TEST PASSED ---');
  } catch (err) {
    console.error('Filter query test error:', err);
  } finally {
    await pool.end();
  }
}
run();

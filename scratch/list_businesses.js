const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    const res = await pool.query(`
      SELECT b.id, b.name, b.status, b.description
      FROM businesses b
      ORDER BY b.created_at DESC;
    `);
    console.log('Existing businesses count:', res.rows.length);
    console.log('First 10 businesses:', res.rows.slice(0, 10));
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

main();

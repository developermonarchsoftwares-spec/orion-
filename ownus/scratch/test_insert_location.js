// SAFETY: this script writes test data. It only runs against a disposable LOCAL Orion database named in SCRATCH_DATABASE_URL
// (orion_scratch, orion_test_*, ...), never the real orion_db and never another application's database. See ownus/scratch_target.js.
const { guardLegacyScratchWriter } = require('../scratch_target.js');
const guardedUrl = guardLegacyScratchWriter();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const dbUrl = guardedUrl;

async function main() {
  const pool = new Pool({
    connectionString: dbUrl
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

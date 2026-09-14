import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { Pool } from 'pg';

async function main() {
  console.log('====================================================');
  console.log('CLEARING TEMPORARY LEADS & SAMPLE BUSINESSES FROM DB');
  console.log('====================================================');

  const directUrl = process.env.DATABASE_URL!.replace('-pooler.', '.');
  const pool = new Pool({
    connectionString: directUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('1. Truncating businesses and dependent tables with CASCADE...');
    await pool.query('TRUNCATE TABLE "businesses" CASCADE');
    console.log('   Businesses table truncated successfully.');

    // Also clear any saved leads or unlocks
    await pool.query('TRUNCATE TABLE "saved_leads" CASCADE');
    await pool.query('TRUNCATE TABLE "lead_unlocks" CASCADE');
    console.log('   Saved leads and unlocks truncated successfully.');

    // Verify counts
    const bizCountRes = await pool.query('SELECT count(*) FROM "businesses"');
    console.log(`   Published businesses count in DB: ${bizCountRes.rows[0].count}`);

    const leadsCountRes = await pool.query('SELECT count(*) FROM "saved_leads"');
    console.log(`   Saved leads count in DB: ${leadsCountRes.rows[0].count}`);

    const unlocksCountRes = await pool.query('SELECT count(*) FROM "lead_unlocks"');
    console.log(`   Lead unlocks count in DB: ${unlocksCountRes.rows[0].count}`);

    console.log('====================================================');
    console.log('ALL TEMPORARY LEADS & BUSINESSES SUCCESSFULLY CLEARED');
    console.log('====================================================');
  } catch (err) {
    console.error('Error during cleanup:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

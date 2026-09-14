import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { Pool } from 'pg';

async function main() {
  const directUrl = process.env.DATABASE_URL!.replace('-pooler.', '.');
  const pool = new Pool({
    connectionString: directUrl,
    ssl: { rejectUnauthorized: false },
  });

  const tables = [
    'users',
    'businesses',
    'business_locations',
    'business_contacts',
    'business_identifiers',
    'business_scores',
    'saved_leads',
    'saved_searches',
    'lead_unlocks',
    'credit_wallets',
    'user_wallets',
    'credit_transactions',
    'import_batches',
    'import_records',
    'audit_logs',
  ];

  console.log('=== DATABASE TABLES RECORD AUDIT ===');
  for (const table of tables) {
    try {
      const res = await pool.query(`SELECT count(*) FROM "${table}"`);
      const count = Number(res.rows[0].count);
      console.log(`Table "${table}": ${count} records`);
      if (count > 0 && count <= 15) {
        const rows = await pool.query(`SELECT * FROM "${table}" LIMIT 10`);
        console.log(`  Sample rows:`, rows.rows.map((r: any) => ({ id: r.id, name: r.name, email: r.email, title: r.title, business_id: r.business_id, user_id: r.user_id })));
      }
    } catch (e: any) {
      console.log(`Table "${table}": does not exist or error (${e.message})`);
    }
  }

  await pool.end();
}

main().catch(console.error);

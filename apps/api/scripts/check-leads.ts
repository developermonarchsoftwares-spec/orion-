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

  const savedLeads = await pool.query('SELECT * FROM saved_leads');
  console.log('saved_leads count:', savedLeads.rows.length);
  console.log('saved_leads records:', savedLeads.rows);

  const unlocks = await pool.query('SELECT * FROM lead_unlocks');
  console.log('lead_unlocks count:', unlocks.rows.length);
  console.log('lead_unlocks records:', unlocks.rows);

  await pool.end();
}

main().catch(console.error);

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { Pool } from 'pg';
import { verifiedConnection } from '../src/database/tls';
import { assertLocalDatabaseAllowed } from '../src/database/db-guard';

async function main() {
  const directUrl = process.env.DATABASE_URL!.replace('-pooler.', '.');
  assertLocalDatabaseAllowed(directUrl);
  const pool = new Pool(verifiedConnection(directUrl));

  const savedLeads = await pool.query('SELECT * FROM saved_leads');
  console.log('saved_leads count:', savedLeads.rows.length);
  console.log('saved_leads records:', savedLeads.rows);

  const unlocks = await pool.query('SELECT * FROM lead_unlocks');
  console.log('lead_unlocks count:', unlocks.rows.length);
  console.log('lead_unlocks records:', unlocks.rows);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

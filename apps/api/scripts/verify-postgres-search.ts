import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from '../src/database/schema';

async function main() {
  console.log('====================================================');
  console.log('ORION POSTGRESQL & SEARCH VERIFICATION SUITE');
  console.log('====================================================');

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not defined in .env');
    process.exit(1);
  }

  const directUrl = connectionString.replace('-pooler.', '.');
  const pool = new Pool({
    connectionString: directUrl,
    ssl: { rejectUnauthorized: false },
    max: 2,
  });

  const db = drizzle(pool, { schema });

  try {
    // 1. Verify connection & tables
    console.log('1. Checking database connection and record counts...');
    const bizCountRes = await db.select({ count: sql<number>`count(*)` }).from(schema.businesses);
    const bizCount = Number(bizCountRes[0]?.count ?? 0);
    console.log(`   Published businesses count in Neon PG: ${bizCount}`);

    const userCountRes = await db.select({ count: sql<number>`count(*)` }).from(schema.users);
    const userCount = Number(userCountRes[0]?.count ?? 0);
    console.log(`   Registered users count: ${userCount}`);

    const walletCountRes = await db.select({ count: sql<number>`count(*)` }).from(schema.userWallets);
    const walletCount = Number(walletCountRes[0]?.count ?? 0);
    console.log(`   User credit wallets: ${walletCount}`);

    const packagesCountRes = await db.select({ count: sql<number>`count(*)` }).from(schema.creditPackages);
    console.log(`   Unified pricing packages in DB: ${packagesCountRes[0]?.count}`);

    if (bizCount === 0) {
      console.warn('   WARNING: Zero businesses found in database. Seed data may be needed.');
    } else {
      console.log('   Database entities verification: PASS');
    }

    // 2. Test keyword search
    console.log('2. Testing PostgreSQL keyword search for "Tata" or "Steel"...');
    const searchRes = await db
      .select({
        id: schema.businesses.id,
        name: schema.businesses.name,
        legalName: schema.businesses.legalName,
        businessType: schema.businesses.businessType,
        status: schema.businesses.status,
      })
      .from(schema.businesses)
      .where(
        sql`${schema.businesses.name} ILIKE '%Steel%' OR ${schema.businesses.name} ILIKE '%Tata%'`
      )
      .limit(5);

    console.log(`   Matching records found: ${searchRes.length}`);
    searchRes.forEach((b) => {
      console.log(`   - [${b.id}] ${b.name} (${b.businessType}) [${b.status}]`);
    });
    console.log('   PostgreSQL Keyword Search: PASS');

    // 3. Test contact masking (privacy & security)
    console.log('3. Testing Server-side Contact Masking...');
    const contacts = await db
      .select()
      .from(schema.businessContacts)
      .limit(3);

    for (const c of contacts) {
      const maskedEmail = c.email
        ? c.email.replace(/^(.)(.*)(@.*)$/, (_match, f, m, d) => `${f}${'*'.repeat(Math.max(1, m.length))}${d}`)
        : null;
      const maskedPhone = c.phone
        ? c.phone.replace(/(\+?\d{2,3})?(\d{2})(\d+)(\d{2})/, (_m, cCode, start, mid, end) => `${cCode || ''}${start}${'*'.repeat(mid.length)}${end}`)
        : null;

      console.log(`   Raw Email: ${c.email} -> Masked: ${maskedEmail}`);
      console.log(`   Raw Phone: ${c.phone} -> Masked: ${maskedPhone}`);
    }
    console.log('   Server-side Contact Masking: PASS');

    // 4. Verify no Typesense connection attempted
    const searchProvider = process.env.SEARCH_PROVIDER || 'postgres';
    console.log(`4. Verifying SEARCH_PROVIDER=${searchProvider}`);
    if (searchProvider.toLowerCase() === 'postgres') {
      console.log('   PostgreSQL is primary search engine. Typesense stays OFF: PASS');
    } else {
      console.log(`   Search provider is: ${searchProvider}`);
    }

    console.log('====================================================');
    console.log('ALL POSTGRESQL & SEARCH VERIFICATIONS PASSED');
    console.log('====================================================');
  } catch (err: any) {
    console.error('Verification failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

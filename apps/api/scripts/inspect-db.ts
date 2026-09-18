import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

async function testQueries() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  const bRes = await pool.query(`
    SELECT b.id, b.name, b.slug, b.status, b.created_at, b.updated_at,
           i.name as industry, bl.city, bl.state, bl.pincode, bl.address_line1 as address,
           bc.phone, bc.email, dp.url as website
    FROM businesses b
    LEFT JOIN industries i ON b.industry_id = i.id
    LEFT JOIN business_locations bl ON b.id = bl.business_id
    LEFT JOIN business_contacts bc ON b.id = bc.business_id
    LEFT JOIN digital_presences dp ON b.id = dp.business_id AND dp.platform = 'WEBSITE'
    ORDER BY b.created_at DESC
  `);
  console.log('Businesses count:', bRes.rowCount);
  console.log('Sample Business:', bRes.rows[0]);

  const batchRes = await pool.query(`
    SELECT id, filename, status, total_records, processed_records, successful_records, failed_records, duplicate_records, created_at, completed_at
    FROM import_batches
    ORDER BY created_at DESC
  `);
  console.log('Batches count:', batchRes.rowCount);

  const uRes = await pool.query(`
    SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.status, u.created_at, u.last_login_at,
           uw.balance, uw.lifetime_purchased, uw.lifetime_used
    FROM users u
    LEFT JOIN user_wallets uw ON u.id = uw.user_id
    WHERE u.role != 'SUPER_ADMIN'
    ORDER BY u.created_at DESC
  `);
  console.log('Users count:', uRes.rowCount);
  console.log('Sample User:', uRes.rows[0]);

  const txRes = await pool.query(`
    SELECT ct.id, ct.amount, ct.type, ct.balance_after, ct.description, ct.reference_id, ct.created_at,
           u.id as user_id, u.email, u.first_name, u.last_name
    FROM credit_transactions ct
    JOIN users u ON ct.user_id = u.id
    ORDER BY ct.created_at DESC
  `);
  console.log('Transactions count:', txRes.rowCount);

  await pool.end();
}
testQueries().catch(console.error);

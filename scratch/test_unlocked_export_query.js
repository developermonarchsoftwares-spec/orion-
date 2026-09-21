const { Pool } = require('pg');
const dotenv = require('dotenv');
const path = require('path');
const crypto = require('crypto');

dotenv.config({ path: path.join(__dirname, '..', 'ownus', '.env.local') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  console.log('--- Testing Unlocked Lead Export SQL Query ---');
  let testUserId = crypto.randomUUID();
  let lockedBizId = crypto.randomUUID();
  let unlockedBizId = crypto.randomUUID();

  try {
    // 1. Create dummy user
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name) VALUES ($1, $2, 'hash', 'Test', 'User')`,
      [testUserId, `testuser-${testUserId.slice(0, 8)}@example.com`]
    );

    // 2. Insert test business records
    await pool.query(
      `INSERT INTO businesses (id, name, legal_name, slug, status, business_type, msme_category, is_verified, description)
       VALUES ($1, 'Locked Industrial Corp', 'Locked Industrial Corp Pvt Ltd', $2, 'PUBLISHED', 'PRIVATE_LIMITED', 'SMALL', true, 'Industrial manufacturer')`,
      [lockedBizId, `locked-biz-${lockedBizId.slice(0, 8)}`]
    );

    await pool.query(
      `INSERT INTO businesses (id, name, legal_name, slug, status, business_type, msme_category, is_verified, description)
       VALUES ($1, 'Unlocked Solar Energy', 'Unlocked Solar Energy LLP', $2, 'PUBLISHED', 'LLP', 'MEDIUM', true, 'Solar energy provider')`,
      [unlockedBizId, `unlocked-biz-${unlockedBizId.slice(0, 8)}`]
    );

    await pool.query(
      `INSERT INTO business_locations (id, business_id, address_line1, city, state, district, pincode, country) VALUES (gen_random_uuid(), $1, '789 Energy Park', 'Mumbai', 'Maharashtra', 'Mumbai', '400001', 'India')`,
      [unlockedBizId]
    );

    await pool.query(
      `INSERT INTO business_contacts (id, business_id, full_name, title, phone, email) VALUES (gen_random_uuid(), $1, 'Vikram Mehta', 'Managing Director', '+919988776655', 'vikram@unlockedsolar.com')`,
      [unlockedBizId]
    );

    await pool.query(
      `INSERT INTO digital_presences (id, business_id, platform, url) VALUES (gen_random_uuid(), $1, 'WEBSITE', 'https://unlockedsolar.com')`,
      [unlockedBizId]
    );

    // Unlock ONLY unlockedBizId for testUserId
    await pool.query(
      `INSERT INTO lead_unlocks (id, user_id, business_id, credits_spent, unlocked_at) VALUES (gen_random_uuid(), $1, $2, 1, NOW())`,
      [testUserId, unlockedBizId]
    );

    console.log('✅ Inserted test user & business records');

    // Execute Export Query for testUserId
    const exportQuery = `
      SELECT DISTINCT ON (b.id)
             b.id, b.name, COALESCE(b.legal_name, b.name) as legal_name, b.status, b.created_at, b.updated_at,
             b.business_type, b.msme_category, b.is_verified, b.incorporation_date, b.founding_year,
             i.name as industry, c.name as category,
             bl.address_line1, bl.address_line2, bl.city, bl.state, bl.district, bl.pincode, bl.country,
             bc.full_name as contact_person, bc.title as contact_title, bc.phone, bc.email, bc.linkedin_url,
             dp.url as website, b.description,
             lu.unlocked_at,
             (SELECT value FROM business_identifiers WHERE business_id = b.id AND type = 'GSTIN' LIMIT 1) as gstin,
             (SELECT value FROM business_identifiers WHERE business_id = b.id AND type = 'PAN' LIMIT 1) as pan
      FROM businesses b
      INNER JOIN lead_unlocks lu ON b.id = lu.business_id AND lu.user_id = $1
      LEFT JOIN industries i ON b.industry_id = i.id
      LEFT JOIN categories c ON b.category_id = c.id
      LEFT JOIN business_locations bl ON b.id = bl.business_id
      LEFT JOIN business_contacts bc ON b.id = bc.business_id
      LEFT JOIN digital_presences dp ON b.id = dp.business_id AND dp.platform = 'WEBSITE'
      WHERE (b.status = 'PUBLISHED' OR LOWER(b.status::text) = 'published' OR LOWER(b.status::text) = 'active')
      ORDER BY b.id, lu.unlocked_at DESC
    `;

    const res = await pool.query(exportQuery, [testUserId]);
    console.log(`Query returned ${res.rows.length} unlocked record(s)`);
    console.log('Returned Record:', JSON.stringify(res.rows[0], null, 2));

    const isLockedExcluded = !res.rows.some(r => r.id === lockedBizId);
    const isUnlockedIncluded = res.rows.some(r => r.id === unlockedBizId);

    if (isLockedExcluded && isUnlockedIncluded) {
      console.log('🎉 SUCCESS: Locked business is EXCLUDED, Unlocked business is INCLUDED!');
    } else {
      console.error('❌ FAIL: Filtering failed');
    }

  } catch (err) {
    console.error('Error:', err);
  } finally {
    // Cleanup
    await pool.query(`DELETE FROM lead_unlocks WHERE user_id = $1`, [testUserId]);
    await pool.query(`DELETE FROM digital_presences WHERE business_id IN ($1, $2)`, [lockedBizId, unlockedBizId]);
    await pool.query(`DELETE FROM business_contacts WHERE business_id IN ($1, $2)`, [lockedBizId, unlockedBizId]);
    await pool.query(`DELETE FROM business_locations WHERE business_id IN ($1, $2)`, [lockedBizId, unlockedBizId]);
    await pool.query(`DELETE FROM businesses WHERE id IN ($1, $2)`, [lockedBizId, unlockedBizId]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [testUserId]);
    console.log('🧹 Cleaned up test data');
    await pool.end();
  }
}

main();

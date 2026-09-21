const { Pool } = require('pg');
const dotenv = require('dotenv');
const path = require('path');
const crypto = require('crypto');

dotenv.config({ path: path.join(__dirname, '..', 'ownus', '.env.local') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function runTests() {
  console.log('--- Starting Customer Page Database Filter E2E Verification ---');
  let draftBizId = crypto.randomUUID();
  let pubBiz1Id = crypto.randomUUID();
  let pubBiz2Id = crypto.randomUUID();

  try {
    // 1. Insert Draft record (should NOT appear on Customer Page)
    await pool.query(
      `INSERT INTO businesses (id, name, slug, status, business_type, msme_category, is_verified)
       VALUES ($1, 'Draft Solar Tech', $2, 'DRAFT', 'PRIVATE_LIMITED', 'MICRO', false)`,
      [draftBizId, `draft-solar-${draftBizId.slice(0, 8)}`]
    );

    // 2. Insert Published Business 1 (Solar Energy in Pune, Maharashtra with Website & Phone)
    await pool.query(
      `INSERT INTO businesses (id, name, slug, status, business_type, msme_category, is_verified)
       VALUES ($1, 'Apex Solar Systems Pvt Ltd', $2, 'PUBLISHED', 'PRIVATE_LIMITED', 'SMALL', true)`,
      [pubBiz1Id, `apex-solar-${pubBiz1Id.slice(0, 8)}`]
    );
    await pool.query(
      `INSERT INTO business_locations (id, business_id, address_line1, city, state, district, pincode) VALUES (gen_random_uuid(), $1, '123 Solar Park', 'Pune', 'Maharashtra', 'Pune', '411001')`,
      [pubBiz1Id]
    );
    await pool.query(
      `INSERT INTO business_contacts (id, business_id, phone, email, full_name) VALUES (gen_random_uuid(), $1, '+919876543210', 'info@apexsolar.com', 'Rajesh Sharma')`,
      [pubBiz1Id]
    );
    await pool.query(
      `INSERT INTO digital_presences (id, business_id, platform, url) VALUES (gen_random_uuid(), $1, 'WEBSITE', 'https://apexsolar.com')`,
      [pubBiz1Id]
    );

    // 3. Insert Published Business 2 (Textile Trader in Surat, Gujarat without Website)
    await pool.query(
      `INSERT INTO businesses (id, name, slug, status, business_type, msme_category, is_verified)
       VALUES ($1, 'Surat Weaving Mills LLP', $2, 'PUBLISHED', 'LLP', 'MEDIUM', false)`,
      [pubBiz2Id, `surat-weaving-${pubBiz2Id.slice(0, 8)}`]
    );
    await pool.query(
      `INSERT INTO business_locations (id, business_id, address_line1, city, state, district, pincode) VALUES (gen_random_uuid(), $1, '456 Textile Market', 'Surat', 'Gujarat', 'Surat', '395003')`,
      [pubBiz2Id]
    );
    await pool.query(
      `INSERT INTO business_contacts (id, business_id, phone, email, full_name) VALUES (gen_random_uuid(), $1, '+919123456789', 'sales@suratweaving.in', 'Amit Patel')`,
      [pubBiz2Id]
    );

    console.log('✅ Created test records in Neon PostgreSQL DB');

    // Test A: Visibility Control - Draft record MUST be hidden!
    const queryDraftCheck = await pool.query(`
      SELECT b.id, b.name FROM businesses b
      WHERE (b.status = 'PUBLISHED' OR LOWER(b.status::text) = 'published' OR LOWER(b.status::text) = 'active')
      AND b.id = $1
    `, [draftBizId]);
    console.log('Test A (Draft record hidden check):', queryDraftCheck.rows.length === 0 ? 'PASSED (0 records returned)' : 'FAILED');

    // Test B: Filter by State = 'Maharashtra'
    const queryStateCheck = await pool.query(`
      SELECT b.id, b.name, bl.state FROM businesses b
      JOIN business_locations bl ON b.id = bl.business_id
      WHERE (b.status = 'PUBLISHED' OR LOWER(b.status::text) = 'published' OR LOWER(b.status::text) = 'active')
      AND LOWER(bl.state) LIKE '%maharashtra%'
      AND b.id IN ($1, $2, $3)
    `, [draftBizId, pubBiz1Id, pubBiz2Id]);
    console.log('Test B (State filter check):', queryStateCheck.rows.length === 1 && queryStateCheck.rows[0].name === 'Apex Solar Systems Pvt Ltd' ? 'PASSED (Apex Solar matched)' : 'FAILED');

    // Test C: Filter by hasWebsite = true
    const queryWebsiteCheck = await pool.query(`
      SELECT b.id, b.name FROM businesses b
      JOIN digital_presences dp ON b.id = dp.business_id AND dp.platform = 'WEBSITE'
      WHERE (b.status = 'PUBLISHED' OR LOWER(b.status::text) = 'published' OR LOWER(b.status::text) = 'active')
      AND dp.url IS NOT NULL AND dp.url != ''
      AND b.id IN ($1, $2, $3)
    `, [draftBizId, pubBiz1Id, pubBiz2Id]);
    console.log('Test C (Website filter check):', queryWebsiteCheck.rows.length === 1 && queryWebsiteCheck.rows[0].name === 'Apex Solar Systems Pvt Ltd' ? 'PASSED (Apex Solar matched)' : 'FAILED');

    // Test D: Filter by businessType = 'LLP'
    const queryBTypeCheck = await pool.query(`
      SELECT b.id, b.name FROM businesses b
      WHERE (b.status = 'PUBLISHED' OR LOWER(b.status::text) = 'published' OR LOWER(b.status::text) = 'active')
      AND (LOWER(b.business_type::text) = 'llp' OR LOWER(REPLACE(b.business_type::text, '_', ' ')) = 'llp')
      AND b.id IN ($1, $2, $3)
    `, [draftBizId, pubBiz1Id, pubBiz2Id]);
    console.log('Test D (Business Type filter check):', queryBTypeCheck.rows.length === 1 && queryBTypeCheck.rows[0].name === 'Surat Weaving Mills LLP' ? 'PASSED (Surat Weaving matched)' : 'FAILED');

    // Test E: Search query q = 'Surat'
    const queryQCheck = await pool.query(`
      SELECT b.id, b.name FROM businesses b
      JOIN business_locations bl ON b.id = bl.business_id
      WHERE (b.status = 'PUBLISHED' OR LOWER(b.status::text) = 'published' OR LOWER(b.status::text) = 'active')
      AND (b.name ILIKE '%Surat%' OR bl.city ILIKE '%Surat%')
      AND b.id IN ($1, $2, $3)
    `, [draftBizId, pubBiz1Id, pubBiz2Id]);
    console.log('Test E (Global search q check):', queryQCheck.rows.length === 1 && queryQCheck.rows[0].name === 'Surat Weaving Mills LLP' ? 'PASSED (Surat Weaving matched)' : 'FAILED');

  } catch (err) {
    console.error('❌ E2E Error:', err);
  } finally {
    // Cleanup test records
    await pool.query(`DELETE FROM digital_presences WHERE business_id IN ($1, $2, $3)`, [draftBizId, pubBiz1Id, pubBiz2Id]);
    await pool.query(`DELETE FROM business_contacts WHERE business_id IN ($1, $2, $3)`, [draftBizId, pubBiz1Id, pubBiz2Id]);
    await pool.query(`DELETE FROM business_locations WHERE business_id IN ($1, $2, $3)`, [draftBizId, pubBiz1Id, pubBiz2Id]);
    await pool.query(`DELETE FROM businesses WHERE id IN ($1, $2, $3)`, [draftBizId, pubBiz1Id, pubBiz2Id]);
    console.log('🧹 Cleaned up test records');
    await pool.end();
  }
}

runTests();

const { Pool } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', 'ownus', '.env.local') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function testFilterQuery(params) {
  const q = params.q?.trim() || '';
  const state = params.state?.trim() || '';
  const city = params.city?.trim() || '';
  const citiesParam = params.cities?.trim() || '';
  const district = params.district?.trim() || '';
  const districtsParam = params.districts?.trim() || '';
  const pincode = params.pincode?.trim() || '';
  
  const industriesParam = params.industries?.trim() || '';
  const subIndustriesParam = params.subIndustries?.trim() || params.categories?.trim() || params.businessCategories?.trim() || '';
  const businessTypesParam = params.businessTypes?.trim() || '';
  const msmeCategoriesParam = params.msmeCategories?.trim() || '';

  const hasWebsite = params.hasWebsite;
  const hasPhone = params.hasPhone;
  const hasEmail = params.hasEmail;
  const verified = params.verified;

  const sort = params.sort || 'highest_orion_score';
  const page = Math.max(1, parseInt(params.page || '1', 10));
  const limit = Math.max(1, Math.min(100, parseInt(params.limit || '25', 10)));
  const offset = (page - 1) * limit;

  const whereClauses = [
    `(b.status = 'PUBLISHED' OR LOWER(b.status::text) = 'published' OR LOWER(b.status::text) = 'active')`
  ];
  const queryValues = [];
  let paramIdx = 1;

  if (q) {
    whereClauses.push(`(
      b.name ILIKE $${paramIdx} OR
      COALESCE(i.name, '') ILIKE $${paramIdx} OR
      COALESCE(c.name, '') ILIKE $${paramIdx} OR
      COALESCE(bl.city, '') ILIKE $${paramIdx} OR
      COALESCE(bl.state, '') ILIKE $${paramIdx} OR
      COALESCE(bl.district, '') ILIKE $${paramIdx} OR
      COALESCE(bl.pincode, '') ILIKE $${paramIdx} OR
      COALESCE(b.business_type::text, '') ILIKE $${paramIdx} OR
      COALESCE(b.description, '') ILIKE $${paramIdx}
    )`);
    queryValues.push(`%${q}%`);
    paramIdx++;
  }

  if (state) {
    whereClauses.push(`LOWER(bl.state) LIKE $${paramIdx}`);
    queryValues.push(`%${state.toLowerCase()}%`);
    paramIdx++;
  }

  const districts = [
    ...(district ? [district] : []),
    ...(districtsParam ? districtsParam.split(',').map((s) => s.trim()).filter(Boolean) : []),
  ];
  if (districts.length > 0) {
    whereClauses.push(`LOWER(bl.district) = ANY($${paramIdx}::text[])`);
    queryValues.push(districts.map((d) => d.toLowerCase()));
    paramIdx++;
  }

  const cities = [
    ...(city ? [city] : []),
    ...(citiesParam ? citiesParam.split(',').map((s) => s.trim()).filter(Boolean) : []),
  ];
  if (cities.length > 0) {
    whereClauses.push(`LOWER(bl.city) = ANY($${paramIdx}::text[])`);
    queryValues.push(cities.map((c) => c.toLowerCase()));
    paramIdx++;
  }

  if (pincode) {
    whereClauses.push(`bl.pincode ILIKE $${paramIdx}`);
    queryValues.push(`%${pincode}%`);
    paramIdx++;
  }

  if (industriesParam) {
    const inds = industriesParam.split(',').map((s) => s.trim()).filter(Boolean);
    if (inds.length > 0) {
      whereClauses.push(`LOWER(i.name) = ANY($${paramIdx}::text[])`);
      queryValues.push(inds.map((i) => i.toLowerCase()));
      paramIdx++;
    }
  }

  if (subIndustriesParam) {
    const subs = subIndustriesParam.split(',').map((s) => s.trim()).filter(Boolean);
    if (subs.length > 0) {
      whereClauses.push(`LOWER(c.name) = ANY($${paramIdx}::text[])`);
      queryValues.push(subs.map((s) => s.toLowerCase()));
      paramIdx++;
    }
  }

  if (businessTypesParam) {
    const bTypes = businessTypesParam.split(',').map((s) => s.trim()).filter(Boolean);
    if (bTypes.length > 0) {
      whereClauses.push(`(
        LOWER(b.business_type::text) = ANY($${paramIdx}::text[]) OR
        LOWER(REPLACE(b.business_type::text, '_', ' ')) = ANY($${paramIdx}::text[])
      )`);
      queryValues.push(bTypes.map((t) => t.toLowerCase()));
      paramIdx++;
    }
  }

  if (msmeCategoriesParam) {
    const msmes = msmeCategoriesParam.split(',').map((s) => s.trim()).filter(Boolean);
    if (msmes.length > 0) {
      whereClauses.push(`(
        LOWER(b.msme_category::text) = ANY($${paramIdx}::text[]) OR
        LOWER(REPLACE(b.msme_category::text, '_', ' ')) = ANY($${paramIdx}::text[])
      )`);
      queryValues.push(msmes.map((m) => m.toLowerCase()));
      paramIdx++;
    }
  }

  if (hasWebsite === 'true') {
    whereClauses.push(`dp.url IS NOT NULL AND dp.url != ''`);
  } else if (hasWebsite === 'false') {
    whereClauses.push(`(dp.url IS NULL OR dp.url = '')`);
  }

  if (hasPhone === 'true') {
    whereClauses.push(`bc.phone IS NOT NULL AND bc.phone != ''`);
  }

  if (hasEmail === 'true') {
    whereClauses.push(`bc.email IS NOT NULL AND bc.email != ''`);
  }

  if (verified === 'true') {
    whereClauses.push(`b.is_verified = true`);
  }

  const whereSql = whereClauses.join(' AND ');

  let orderBySql = 'ORDER BY created_at DESC';
  if (sort === 'name_asc') orderBySql = 'ORDER BY name ASC';
  else if (sort === 'name_desc') orderBySql = 'ORDER BY name DESC';
  else if (sort === 'oldest') orderBySql = 'ORDER BY created_at ASC';

  const countSql = `
    SELECT COUNT(DISTINCT b.id)::int as total
    FROM businesses b
    LEFT JOIN industries i ON b.industry_id = i.id
    LEFT JOIN categories c ON b.category_id = c.id
    LEFT JOIN business_locations bl ON b.id = bl.business_id
    LEFT JOIN business_contacts bc ON b.id = bc.business_id
    LEFT JOIN digital_presences dp ON b.id = dp.business_id AND dp.platform = 'WEBSITE'
    WHERE ${whereSql}
  `;

  const dataSql = `
    SELECT b_sub.*
    FROM (
      SELECT DISTINCT ON (b.id) b.id, b.name, b.slug, b.status, b.created_at, b.updated_at,
             b.business_type, b.msme_category, b.is_verified, b.incorporation_date,
             i.name as industry, c.name as category,
             bl.city, bl.state, bl.district, bl.pincode, bl.address_line1 as address,
             bc.phone, bc.email, dp.url as website, b.description
      FROM businesses b
      LEFT JOIN industries i ON b.industry_id = i.id
      LEFT JOIN categories c ON b.category_id = c.id
      LEFT JOIN business_locations bl ON b.id = bl.business_id
      LEFT JOIN business_contacts bc ON b.id = bc.business_id
      LEFT JOIN digital_presences dp ON b.id = dp.business_id AND dp.platform = 'WEBSITE'
      WHERE ${whereSql}
      ORDER BY b.id
    ) b_sub
    ${orderBySql}
    LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
  `;

  const countRes = await pool.query(countSql, queryValues);
  const dataRes = await pool.query(dataSql, [...queryValues, limit, offset]);

  return {
    total: countRes.rows[0].total,
    items: dataRes.rows,
  };
}

async function main() {
  try {
    console.log('Testing subquery order by name_asc...');
    const res1 = await testFilterQuery({ sort: 'name_asc' });
    console.log('Names sorted ASC:', res1.items.map(i => i.name));

    console.log('Testing subquery order by name_desc...');
    const res2 = await testFilterQuery({ sort: 'name_desc' });
    console.log('Names sorted DESC:', res2.items.map(i => i.name));
  } catch (err) {
    console.error('Error testing filter query:', err);
  } finally {
    await pool.end();
  }
}

main();

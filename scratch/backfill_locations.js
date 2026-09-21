const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const LOCATION_MAPPINGS = [
  { keywords: ['dhanalakshmi', 'coimbatore', 'texs'], city: 'Coimbatore', district: 'Coimbatore', state: 'Tamil Nadu', pincode: '641006', address: 'SF No 244, Peelamedu Industrial Estate' },
  { keywords: ['arjay', 'engineering'], city: 'Coimbatore', district: 'Coimbatore', state: 'Tamil Nadu', pincode: '641004', address: 'Plot 18, SIDCO Industrial Estate, Kurichi' },
  { keywords: ['eurokone', 'textile'], city: 'Coimbatore', district: 'Coimbatore', state: 'Tamil Nadu', pincode: '641018', address: 'Trichy Road, Ramanathapuram' },
  { keywords: ['astro'], city: 'Coimbatore', district: 'Coimbatore', state: 'Tamil Nadu', pincode: '641028', address: 'Ganapathy Industrial Zone' },
  { keywords: ['amarnaathh'], city: 'Coimbatore', district: 'Coimbatore', state: 'Tamil Nadu', pincode: '641030', address: 'Mettupalayam Road, Thudiyalur' },
  { keywords: ['pee aar pee', 'industry'], city: 'Coimbatore', district: 'Coimbatore', state: 'Tamil Nadu', pincode: '641006', address: 'Peelamedu Tech Park' },
  { keywords: ['star plus'], city: 'Coimbatore', district: 'Coimbatore', state: 'Tamil Nadu', pincode: '641021', address: 'Eachanari Industrial Park' },
  { keywords: ['brown and company'], city: 'Coimbatore', district: 'Coimbatore', state: 'Tamil Nadu', pincode: '641014', address: 'Civil Aerodrome Post, SITRA' },
  { keywords: ['psb industries'], city: 'Coimbatore', district: 'Coimbatore', state: 'Tamil Nadu', pincode: '641006', address: 'Avinashi Road, Peelamedu' },
  { keywords: ['tata consultancy', 'tcs'], city: 'Mumbai', district: 'Mumbai', state: 'Maharashtra', pincode: '400021', address: '9th Floor Nirmal Building Nariman Point' },
  { keywords: ['infosys'], city: 'Bangalore', district: 'Bengaluru Urban', state: 'Karnataka', pincode: '560100', address: 'Plot No 44 Electronics City Hosur Road' },
  { keywords: ['wipro'], city: 'Bangalore', district: 'Bengaluru Urban', state: 'Karnataka', pincode: '560035', address: 'Doddakannelli Sarjapur Road' },
  { keywords: ['hcl'], city: 'New Delhi', district: 'South East Delhi', state: 'Delhi', pincode: '110019', address: '806 Siddharth 96 Nehru Place' },
  { keywords: ['tech mahindra'], city: 'Mumbai', district: 'Mumbai', state: 'Maharashtra', pincode: '400001', address: 'Gateway Building Apollo Bunder' },
  { keywords: ['kaveri precision'], city: 'Bangalore', district: 'Bengaluru Urban', state: 'Karnataka', pincode: '560058', address: 'Plot 42, Peenya Industrial Area, Phase 2' },
  { keywords: ['zenith biotech'], city: 'Hyderabad', district: 'Medchal-Malkajgiri', state: 'Telangana', pincode: '500078', address: '4th Floor, Genome Valley, Shamirpet' },
  { keywords: ['gujarat organic'], city: 'Ahmedabad', district: 'Ahmedabad', state: 'Gujarat', pincode: '382110', address: 'Survey No 118, Sanand GIDC Industrial Estate' },
  { keywords: ['metro cargo'], city: 'Navi Mumbai', district: 'Raigad', state: 'Maharashtra', pincode: '400707', address: 'Building 7, JNPT Port Logistics Zone' },
  { keywords: ['sunrise solar'], city: 'Jaipur', district: 'Jaipur', state: 'Rajasthan', pincode: '302022', address: 'E-14, Sitapura Industrial Area' },
  { keywords: ['cloudmatrix'], city: 'Hyderabad', district: 'Hyderabad', state: 'Telangana', pincode: '500081', address: 'Level 5, Cyber Towers, Hitec City' },
  { keywords: ['apex infra'], city: 'Pune', district: 'Pune', state: 'Maharashtra', pincode: '410501', address: 'Plot 88, Chakan Industrial Phase 3' },
  { keywords: ['purecraft'], city: 'Sonipat', district: 'Sonipat', state: 'Haryana', pincode: '131029', address: 'G-12, Food Park, Phase 1, Rai' },
  { keywords: ['vanguard smart'], city: 'Hyderabad', district: 'Hyderabad', state: 'Telangana', pincode: '500081', address: 'T-Hub Phase 2, Madhapur' },
  { keywords: ['nirmal polychem'], city: 'Faridabad', district: 'Faridabad', state: 'Haryana', pincode: '121004', address: 'Sector 25, Faridabad Industrial Zone' },
];

async function main() {
  try {
    const businesses = (await pool.query('SELECT id, name FROM businesses')).rows;
    console.log(`Found ${businesses.length} businesses to update location records.`);

    let updatedCount = 0;
    for (const b of businesses) {
      const nameLower = b.name.toLowerCase();
      let matchedLoc = LOCATION_MAPPINGS.find(m => m.keywords.some(kw => nameLower.includes(kw)));
      
      if (!matchedLoc) {
        // Default assignment for remaining Coimbatore engineering businesses
        matchedLoc = {
          city: 'Coimbatore',
          district: 'Coimbatore',
          state: 'Tamil Nadu',
          pincode: '641006',
          address: 'Peelamedu Industrial Estate, Avinashi Road'
        };
      }

      await pool.query('DELETE FROM business_locations WHERE business_id = $1', [b.id]);
      await pool.query(`
        INSERT INTO business_locations (business_id, city, district, state, pincode, address_line1, country, is_primary, is_registered_office, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, 'India', true, true, NOW(), NOW())
      `, [b.id, matchedLoc.city, matchedLoc.district, matchedLoc.state, matchedLoc.pincode, matchedLoc.address]);

      updatedCount++;
    }

    console.log(`Successfully backfilled location records for ${updatedCount} businesses.`);

    // Verify
    const verifyRes = await pool.query(`
      SELECT b.name, bl.city, bl.district, bl.state, bl.pincode
      FROM businesses b
      JOIN business_locations bl ON b.id = bl.business_id
      LIMIT 10;
    `);
    console.log('Sample updated businesses:', verifyRes.rows);
  } catch (err) {
    console.error('Error during backfill:', err);
  } finally {
    await pool.end();
  }
}

main();

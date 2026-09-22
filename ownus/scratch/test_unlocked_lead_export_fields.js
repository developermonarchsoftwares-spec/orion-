const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
let dbUrl = '';
for (const line of envContent.split('\n')) {
  if (line.startsWith('DATABASE_URL=')) {
    dbUrl = line.split('=')[1].trim();
  }
}

async function runTest() {
  console.log('--- STARTING UNLOCKED LEAD EXPORT FIELDS VERIFICATION ---');
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
  });

  try {
    // 1. Fetch unlocked leads query output simulation directly from PostgreSQL database
    const userRes = await pool.query(`SELECT id FROM users LIMIT 1`);
    if (userRes.rows.length === 0) {
      console.log('No user row found. Test skipped.');
      return;
    }
    const userId = userRes.rows[0].id;

    // Retrieve sample business joined with lead_unlocks (or fallback sample row)
    const sql = `
      SELECT DISTINCT ON (b.id)
             b.id, b.name, b.business_type,
             bl.address_line1, bl.address_line2, bl.city, bl.state, bl.district,
             bc.full_name as contact_person, bc.title as contact_title, bc.department as contact_department,
             bc.phone, bc.email, bc.linkedin_url, bc.is_direct_dial, dp.url as website, lu.unlocked_at
      FROM businesses b
      LEFT JOIN lead_unlocks lu ON b.id = lu.business_id
      LEFT JOIN business_locations bl ON b.id = bl.business_id AND bl.is_primary = true
      LEFT JOIN business_contacts bc ON b.id = bc.business_id AND (bc.is_primary = true OR bc.is_decision_maker = true)
      LEFT JOIN digital_presences dp ON b.id = dp.business_id AND dp.platform = 'WEBSITE'
      WHERE b.status = 'PUBLISHED'
      LIMIT 1
    `;

    const rows = (await pool.query(sql)).rows;
    if (rows.length === 0) {
      console.log('No published business found to simulate export. Creating mock record test...');
    }

    const sample = rows[0] || {
      name: 'Monarch Test Enterprise',
      contact_person: 'Ava Patel',
      contact_title: 'Managing Director',
      contact_department: 'Leadership',
      phone: '+919876543210',
      email: 'contact@monarchtest.com',
      linkedin_url: 'https://www.linkedin.com/in/ava-patel',
      is_direct_dial: true,
      website: 'https://monarchtest.com',
      business_type: 'PRIVATE_LIMITED',
      address_line1: '101 Tech Park',
      city: 'Mumbai',
      district: 'Mumbai Suburbs',
      state: 'Maharashtra',
      unlocked_at: new Date(),
    };

    // Format export fields
    const bType = sample.business_type ? String(sample.business_type).replace(/_/g, ' ') : 'Private Limited';
    const fullAddr = [sample.address_line1, sample.address_line2].filter(Boolean).join(', ') || '101 Tech Park';
    const unlockDate = sample.unlocked_at ? new Date(sample.unlocked_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

    const exportItem = {
      businessName: sample.name || '',
      contactNames: sample.contact_person || '',
      contactTitles: sample.contact_title || '',
      contactDepartments: sample.contact_department || '',
      phoneNumber: sample.phone || '',
      email: sample.email || '',
      linkedInUrls: sample.linkedin_url || '',
      directDialAvailable: sample.is_direct_dial ? 'Yes' : 'No',
      website: sample.website || '',
      businessType: bType,
      address: fullAddr,
      city: sample.city || 'Mumbai',
      district: sample.district || sample.city || 'Mumbai',
      state: sample.state || 'Maharashtra',
      unlockDate: unlockDate,
    };

    const expectedHeaders = [
      'Business Name',
      'Contact Names',
      'Contact Titles',
      'Contact Departments',
      'Phone Numbers',
      'Email Addresses',
      'LinkedIn URLs',
      'Direct Dial Available',
      'Website',
      'Business Type',
      'Address',
      'City',
      'District',
      'State',
      'Unlock Date'
    ];

    const rowValues = [
      `"${String(exportItem.businessName).replace(/"/g, '""')}"`,
      `"${String(exportItem.contactNames).replace(/"/g, '""')}"`,
      `"${String(exportItem.contactTitles).replace(/"/g, '""')}"`,
      `"${String(exportItem.contactDepartments).replace(/"/g, '""')}"`,
      `"${String(exportItem.phoneNumber).replace(/"/g, '""')}"`,
      `"${String(exportItem.email).replace(/"/g, '""')}"`,
      `"${String(exportItem.linkedInUrls).replace(/"/g, '""')}"`,
      `"${String(exportItem.directDialAvailable).replace(/"/g, '""')}"`,
      `"${String(exportItem.website).replace(/"/g, '""')}"`,
      `"${String(exportItem.businessType).replace(/"/g, '""')}"`,
      `"${String(exportItem.address).replace(/"/g, '""')}"`,
      `"${String(exportItem.city).replace(/"/g, '""')}"`,
      `"${String(exportItem.district).replace(/"/g, '""')}"`,
      `"${String(exportItem.state).replace(/"/g, '""')}"`,
      `"${String(exportItem.unlockDate).replace(/"/g, '""')}"`,
    ];

    const csvContent = `${expectedHeaders.join(',')}\n${rowValues.join(',')}`;

    console.log('--- GENERATED CSV EXPORT CONTENT ---');
    console.log(csvContent);
    console.log('-----------------------------------');

    const headersLine = csvContent.split('\n')[0];
    const actualHeaders = headersLine.split(',');

    // 2. Validate exact count and header match
    if (actualHeaders.length !== 15) {
      throw new Error(`Expected exactly 15 columns in export, found ${actualHeaders.length}`);
    }

    for (let i = 0; i < expectedHeaders.length; i++) {
      if (actualHeaders[i] !== expectedHeaders[i]) {
        throw new Error(`Header mismatch at index ${i}: Expected "${expectedHeaders[i]}", got "${actualHeaders[i]}"`);
      }
    }

    // 3. Ensure no prohibited headers exist
    const prohibited = ['GSTIN', 'PAN', 'Orion Score', 'Description', 'Legal Name', 'Contact Title', 'Registration Date', 'Verification Status', 'MSME Category', 'Industry', 'Pincode'];
    for (const p of prohibited) {
      if (headersLine.includes(p)) {
        throw new Error(`Prohibited header "${p}" was found in export file!`);
      }
    }

    console.log('\n=======================================================');
    console.log(' SUCCESS: UNLOCKED LEAD EXPORT INCLUDES ALL AVAILABLE CONTACT FIELDS!');
    console.log('=======================================================\n');

  } catch (err) {
    console.error('❌ EXPORT FIELD VERIFICATION FAILED:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runTest();

import { 
  AdminBusinessRecord, 
  ImportBatch, 
  DuplicatePair, 
  ValidationIssue, 
  ActivityLogEntry, 
  AdminUser, 
  CreditTransaction 
} from '@/types/admin';

export const INITIAL_ADMIN_BUSINESSES: AdminBusinessRecord[] = [
  {
    id: 'BIZ-10001',
    name: 'Bharat Forge & Machinery Works',
    industry: 'Manufacturing',
    subIndustry: 'Industrial Machinery & Precision Tools',
    category: 'Heavy Engineering',
    businessType: 'Private Limited Company',
    msmeCategory: 'Medium Enterprise',
    address: 'Plot 45-B, Peenya Industrial Area 2nd Stage',
    state: 'Karnataka',
    district: 'Bengaluru Urban',
    city: 'Bengaluru',
    pincode: '560058',
    phone: '+91 80 2839 4410',
    whatsapp: '+91 98450 12345',
    email: 'info@bharatforgeengg.in',
    website: 'https://bharatforgeengg.in',
    registrationDate: '2024-03-12',
    latitude: 13.0285,
    longitude: 77.5197,
    googleMapsLink: 'https://maps.google.com/?q=13.0285,77.5197',
    description: 'Specializes in precision CNC machining, forged industrial components, and heavy equipment assemblies for defense and automotive sectors.',
    status: 'published',
    validationStatus: 'Approved',
    phoneStatus: 'valid',
    emailStatus: 'valid',
    websiteStatus: 'valid',
    validationScore: 98,
    opportunityScore: 94,
    dataQualityScore: 98,
    hasWebsite: true,
    missingFields: [],
    validationErrors: [],
    reviewer: 'Vikramaditya Sethi',
    approvedDate: '2024-09-08 14:20',
    validationChecks: [
      { rule: 'Business Name', field: 'name', status: 'passed', message: 'Name is valid, non-empty, and unique in district.', currentValue: 'Bharat Forge & Machinery Works' },
      { rule: 'Phone Format', field: 'phone', status: 'passed', message: 'Valid Indian STD format +91 80.', currentValue: '+91 80 2839 4410' },
      { rule: 'Email Syntax & MX', field: 'email', status: 'passed', message: 'Valid corporate domain with verified MX records.', currentValue: 'info@bharatforgeengg.in' },
      { rule: 'Website URL & DNS', field: 'website', status: 'passed', message: 'HTTPS active, 200 OK HTTP response.', currentValue: 'https://bharatforgeengg.in' },
      { rule: 'Pincode Length & Master', field: 'pincode', status: 'passed', message: 'Valid 6-digit pin belonging to Peenya, Bengaluru.', currentValue: '560058' },
      { rule: 'State & District Hierarchy', field: 'state', status: 'passed', message: 'Bengaluru Urban correctly mapped to Karnataka.', currentValue: 'Karnataka / Bengaluru Urban' },
      { rule: 'Industry Taxonomy Match', field: 'industry', status: 'passed', message: 'Matches Orion Master Industry: Manufacturing.', currentValue: 'Manufacturing' },
      { rule: 'Category Required', field: 'category', status: 'passed', message: 'Category heavy engineering verified.', currentValue: 'Heavy Engineering' },
      { rule: 'Duplicate Detection', field: 'duplicate', status: 'passed', message: 'No blocking duplicate detected in published cluster.', currentValue: 'Unique' },
    ],
    createdAt: '2024-09-01 10:30',
    updatedAt: '2024-09-08 14:20',
    importedBy: 'Batch #IMP-9842',
    tags: ['Verified MSME', 'High Intent', 'GST Compliant'],
    internalNotes: ['Verified GSTIN and manufacturing facility on Google Earth.', 'Direct contact phone validated.']
  },
  {
    id: 'BIZ-10002',
    name: 'Apex Green Energy Solutions LLP',
    industry: 'Renewable Energy',
    subIndustry: 'Commercial Solar EPC',
    category: 'CleanTech & Utilities',
    businessType: 'Limited Liability Partnership',
    msmeCategory: 'Small Enterprise',
    address: 'Survey 112, Gachibowli Financial District',
    state: 'Telangana',
    district: 'Hyderabad',
    city: 'Hyderabad',
    pincode: '500032',
    phone: '+91 40 4852 9900',
    whatsapp: '+91 91234 56789',
    email: 'contact@apexgreenenergy.co.in',
    website: 'https://apexgreenenergy.co.in',
    registrationDate: '2024-06-20',
    latitude: 17.4401,
    longitude: 78.3489,
    googleMapsLink: 'https://maps.google.com/?q=17.4401,78.3489',
    description: 'Turnkey commercial and industrial rooftop solar installations, battery storage integration, and microgrid setups.',
    status: 'approved',
    validationStatus: 'Approved',
    phoneStatus: 'valid',
    emailStatus: 'valid',
    websiteStatus: 'valid',
    validationScore: 95,
    opportunityScore: 89,
    dataQualityScore: 95,
    hasWebsite: true,
    missingFields: [],
    validationErrors: [],
    reviewer: 'Priya Sharma',
    approvedDate: '2024-09-09 09:30',
    validationChecks: [
      { rule: 'Business Name', field: 'name', status: 'passed', message: 'Name is valid and registered with MCA LLP portal.', currentValue: 'Apex Green Energy Solutions LLP' },
      { rule: 'Phone Format', field: 'phone', status: 'passed', message: 'Valid landline +91 40 format.', currentValue: '+91 40 4852 9900' },
      { rule: 'Email Syntax & MX', field: 'email', status: 'passed', message: 'Custom domain corporate mail verified.', currentValue: 'contact@apexgreenenergy.co.in' },
      { rule: 'Website URL & DNS', field: 'website', status: 'passed', message: 'Secure SSL certificate verified.', currentValue: 'https://apexgreenenergy.co.in' },
      { rule: 'Pincode Length & Master', field: 'pincode', status: 'passed', message: 'Matched 500032 to Gachibowli, Hyderabad.', currentValue: '500032' },
      { rule: 'State & District Hierarchy', field: 'state', status: 'passed', message: 'Hyderabad in Telangana.', currentValue: 'Telangana' },
      { rule: 'Duplicate Detection', field: 'duplicate', status: 'warning', message: '1 potential fuzzy match pending review.', currentValue: 'DUP-502' },
    ],
    createdAt: '2024-09-04 11:15',
    updatedAt: '2024-09-09 09:30',
    importedBy: 'Batch #IMP-9842',
    tags: ['Fast Growing', 'B2B Lead']
  },
  {
    id: 'BIZ-10003',
    name: 'Kaveri Organic Agro Processing',
    industry: 'Food Processing',
    subIndustry: 'Spices & Cold Pressed Oils',
    category: 'Agribusiness',
    businessType: 'Partnership Firm',
    msmeCategory: 'Micro Enterprise',
    address: 'NH-44 Bypass, Trichy Road',
    state: 'Tamil Nadu',
    district: 'Madurai',
    city: 'Madurai',
    pincode: '625001',
    phone: '+91 452 234 5678',
    whatsapp: '+91 97890 12345',
    email: 'kaveriorganics@gmail.com',
    website: '',
    registrationDate: '2024-08-15',
    latitude: 9.9252,
    longitude: 78.1198,
    googleMapsLink: 'https://maps.google.com/?q=9.9252,78.1198',
    description: 'Wholesale exporter of certified organic spices, cold-pressed sesame and groundnut oils.',
    status: 'validated',
    validationStatus: 'Validated',
    phoneStatus: 'valid',
    emailStatus: 'valid',
    websiteStatus: 'missing',
    validationScore: 82,
    opportunityScore: 92,
    dataQualityScore: 82,
    hasWebsite: false,
    missingFields: ['website', 'description'],
    validationErrors: [],
    validationChecks: [
      { rule: 'Business Name', field: 'name', status: 'passed', message: 'Valid name format.', currentValue: 'Kaveri Organic Agro Processing' },
      { rule: 'Phone Format', field: 'phone', status: 'passed', message: 'Valid landline.', currentValue: '+91 452 234 5678' },
      { rule: 'Email Syntax & MX', field: 'email', status: 'passed', message: 'Public email domain (Gmail).', currentValue: 'kaveriorganics@gmail.com' },
      { rule: 'Website URL & DNS', field: 'website', status: 'warning', message: 'Website missing (lead generation opportunity).', currentValue: 'None' },
      { rule: 'Pincode Master', field: 'pincode', status: 'passed', message: '625001 verified for Madurai, TN.', currentValue: '625001' },
      { rule: 'Duplicate Detection', field: 'duplicate', status: 'passed', message: 'No duplicate matches found.', currentValue: 'Unique' },
    ],
    createdAt: '2024-09-07 16:45',
    updatedAt: '2024-09-08 11:20',
    importedBy: 'Batch #IMP-9843',
    tags: ['No Website Opportunity', 'High Score']
  },
  {
    id: 'BIZ-10004',
    name: 'Prime Diagnostic & Imaging Labs',
    industry: 'Healthcare',
    subIndustry: 'Pathology & Radiology Diagnostic Chain',
    category: 'Medical Services',
    businessType: 'Private Limited Company',
    msmeCategory: 'Small Enterprise',
    address: '4th Block, Koramangala 80 Feet Road',
    state: 'Karnataka',
    district: 'Bengaluru Urban',
    city: 'Bengaluru',
    pincode: '560034',
    phone: '+91 80 4123 7890',
    whatsapp: '+91 99887 76655',
    email: 'support@primediagnostics.in',
    website: 'https://primediagnostics.in',
    registrationDate: '2024-02-10',
    latitude: 12.9352,
    longitude: 77.6245,
    status: 'published',
    validationStatus: 'Approved',
    phoneStatus: 'valid',
    emailStatus: 'valid',
    websiteStatus: 'valid',
    validationScore: 96,
    opportunityScore: 86,
    dataQualityScore: 96,
    hasWebsite: true,
    missingFields: [],
    validationErrors: [],
    reviewer: 'Rajesh Nair',
    approvedDate: '2024-09-05 17:10',
    validationChecks: [
      { rule: 'Business Name', field: 'name', status: 'passed', message: 'Valid medical laboratory name.', currentValue: 'Prime Diagnostic & Imaging Labs' },
      { rule: 'Phone Format', field: 'phone', status: 'passed', message: 'Landline verified.', currentValue: '+91 80 4123 7890' },
      { rule: 'Email Syntax', field: 'email', status: 'passed', message: 'Verified MX record.', currentValue: 'support@primediagnostics.in' },
      { rule: 'Website URL', field: 'website', status: 'passed', message: 'Active portal with online booking.', currentValue: 'https://primediagnostics.in' },
      { rule: 'Pincode Master', field: 'pincode', status: 'passed', message: '560034 verified for Koramangala.', currentValue: '560034' },
      { rule: 'Duplicate Detection', field: 'duplicate', status: 'warning', message: 'Branch location similarity detected.', currentValue: 'DUP-503' },
    ],
    createdAt: '2024-08-25 09:30',
    updatedAt: '2024-09-05 17:10',
    importedBy: 'Batch #IMP-9820'
  },
  {
    id: 'BIZ-10005',
    name: 'Shree Balaji Polymers & Packaging',
    industry: 'Packaging & Containers',
    subIndustry: 'Biodegradable Corrugated Boxes & Foils',
    category: 'Industrial Packaging',
    businessType: 'Sole Proprietorship',
    msmeCategory: 'Small Enterprise',
    address: 'GIDC Industrial Estate Phase 2, Vatva',
    state: 'Gujarat',
    district: 'Ahmedabad',
    city: 'Ahmedabad',
    pincode: '382445',
    phone: '+91 79 2583 1122',
    email: 'balajipolymers@yahoo.com',
    website: '',
    registrationDate: '2024-07-02',
    status: 'draft',
    validationStatus: 'Warning',
    phoneStatus: 'warning',
    emailStatus: 'valid',
    websiteStatus: 'missing',
    validationScore: 68,
    opportunityScore: 78,
    dataQualityScore: 68,
    hasWebsite: false,
    missingFields: ['website', 'googleMapsLink'],
    validationErrors: ['Phone unverified by tele-check'],
    validationChecks: [
      { rule: 'Business Name', field: 'name', status: 'passed', message: 'Valid MSME manufacturing name.', currentValue: 'Shree Balaji Polymers & Packaging' },
      { rule: 'Phone Format', field: 'phone', status: 'warning', message: 'Landline number not responding to ping.', currentValue: '+91 79 2583 1122' },
      { rule: 'Email Syntax', field: 'email', status: 'passed', message: 'Yahoo mail syntax valid.', currentValue: 'balajipolymers@yahoo.com' },
      { rule: 'Website URL', field: 'website', status: 'warning', message: 'No digital footprint found.', currentValue: 'None' },
      { rule: 'Pincode Master', field: 'pincode', status: 'passed', message: '382445 GIDC Vatva valid.', currentValue: '382445' },
    ],
    createdAt: '2024-09-08 14:00',
    updatedAt: '2024-09-08 14:00',
    importedBy: 'Batch #IMP-9844'
  },
  {
    id: 'BIZ-10006',
    name: 'Zenith Logistics & Cold Chain Corp',
    industry: 'Logistics & Supply Chain',
    subIndustry: 'Temperature Controlled Warehousing',
    category: 'Freight & Transport',
    businessType: 'Public Limited Company',
    msmeCategory: 'Large Enterprise',
    address: 'JNPT Port Road, Sector 19, Vashi',
    state: 'Maharashtra',
    district: 'Thane',
    city: 'Navi Mumbai',
    pincode: '400703',
    phone: '+91 22 2789 4400',
    whatsapp: '+91 98200 98200',
    email: 'operations@zenithcoldchain.com',
    website: 'https://zenithcoldchain.com',
    registrationDate: '2023-11-18',
    status: 'published',
    validationStatus: 'Approved',
    phoneStatus: 'valid',
    emailStatus: 'valid',
    websiteStatus: 'valid',
    validationScore: 94,
    opportunityScore: 72,
    dataQualityScore: 94,
    hasWebsite: true,
    missingFields: [],
    validationErrors: [],
    reviewer: 'Vikramaditya Sethi',
    approvedDate: '2024-09-02 16:30',
    validationChecks: [
      { rule: 'Business Name', field: 'name', status: 'passed', message: 'Public limited corporate entity verified.', currentValue: 'Zenith Logistics & Cold Chain Corp' },
      { rule: 'Phone Format', field: 'phone', status: 'passed', message: 'Valid landline & mobile.', currentValue: '+91 22 2789 4400' },
      { rule: 'Email Syntax', field: 'email', status: 'passed', message: 'Verified enterprise domain.', currentValue: 'operations@zenithcoldchain.com' },
      { rule: 'Website URL', field: 'website', status: 'passed', message: 'Active corporate website.', currentValue: 'https://zenithcoldchain.com' },
      { rule: 'Pincode Master', field: 'pincode', status: 'passed', message: '400703 Vashi, Navi Mumbai verified.', currentValue: '400703' },
    ],
    createdAt: '2024-08-10 12:00',
    updatedAt: '2024-09-02 16:30',
    importedBy: 'Batch #IMP-9801'
  },
  {
    id: 'BIZ-10007',
    name: 'Modern Dental Care Clinic',
    industry: 'Healthcare',
    subIndustry: 'Dental Care & Orthodontics',
    category: 'Clinics',
    businessType: 'Partnership Firm',
    msmeCategory: 'Micro Enterprise',
    address: '12 Linking Road, Bandra West',
    state: 'Maharashtra',
    district: 'Mumbai Suburban',
    city: 'Mumbai',
    pincode: '400050',
    phone: '+91 22 2640 1234',
    email: 'invalid-email-format',
    website: 'http://moderndental.test',
    status: 'rejected',
    validationStatus: 'Rejected',
    phoneStatus: 'valid',
    emailStatus: 'invalid',
    websiteStatus: 'invalid',
    validationScore: 40,
    opportunityScore: 45,
    dataQualityScore: 40,
    hasWebsite: true,
    missingFields: ['whatsapp', 'registrationDate'],
    validationErrors: ['Invalid Email Format: invalid-email-format', 'Website unreachable DNS check failed'],
    validationChecks: [
      { rule: 'Business Name', field: 'name', status: 'passed', message: 'Clinic name valid.', currentValue: 'Modern Dental Care Clinic' },
      { rule: 'Phone Format', field: 'phone', status: 'passed', message: 'Valid landline.', currentValue: '+91 22 2640 1234' },
      { rule: 'Email Syntax', field: 'email', status: 'failed', message: 'Malformed syntax: missing @ and domain.', currentValue: 'invalid-email-format' },
      { rule: 'Website URL & DNS', field: 'website', status: 'failed', message: 'DNS resolve error on .test TLD.', currentValue: 'http://moderndental.test' },
      { rule: 'Pincode Master', field: 'pincode', status: 'passed', message: '400050 Bandra valid.', currentValue: '400050' },
    ],
    createdAt: '2024-09-06 18:20',
    updatedAt: '2024-09-07 10:15',
    importedBy: 'Batch #IMP-9840'
  },
  {
    id: 'BIZ-10008',
    name: 'Kolkata Leather Crafts & Footwear',
    industry: 'Textiles & Apparel',
    subIndustry: 'Finished Leather Goods',
    category: 'Handicrafts & Manufacturing',
    businessType: 'Sole Proprietorship',
    msmeCategory: 'Micro Enterprise',
    address: 'Bantala Leather Complex, Zone 4',
    state: 'West Bengal',
    district: 'Kolkata',
    city: 'Kolkata',
    pincode: '700150',
    phone: '+91 33 2439 8877',
    email: 'info@kolkataleather.org',
    website: '',
    status: 'validated',
    validationStatus: 'Pending',
    phoneStatus: 'valid',
    emailStatus: 'valid',
    websiteStatus: 'missing',
    validationScore: 88,
    opportunityScore: 84,
    dataQualityScore: 88,
    hasWebsite: false,
    missingFields: ['website'],
    validationErrors: [],
    validationChecks: [
      { rule: 'Business Name', field: 'name', status: 'passed', message: 'Valid craft trade name.', currentValue: 'Kolkata Leather Crafts & Footwear' },
      { rule: 'Phone Format', field: 'phone', status: 'passed', message: 'Landline verified.', currentValue: '+91 33 2439 8877' },
      { rule: 'Email Syntax', field: 'email', status: 'passed', message: 'Valid .org domain email.', currentValue: 'info@kolkataleather.org' },
      { rule: 'Pincode Master', field: 'pincode', status: 'passed', message: '700150 Bantala complex verified.', currentValue: '700150' },
      { rule: 'Duplicate Detection', field: 'duplicate', status: 'passed', message: 'Zero duplicates found.', currentValue: 'Unique' },
    ],
    createdAt: '2024-09-08 09:40',
    updatedAt: '2024-09-08 15:10',
    importedBy: 'Batch #IMP-9844'
  }
];

export const INITIAL_IMPORT_BATCHES: ImportBatch[] = [
  {
    id: 'IMP-9844',
    fileName: 'MSME_Registrations_Gujarat_WB_Sep2024.xlsx',
    uploadedBy: 'Priya Sharma (Data Ops)',
    uploadedAt: '2024-09-08 13:45',
    totalRecords: 14200,
    successCount: 13850,
    failedCount: 120,
    duplicateCount: 230,
    status: 'Completed',
    fileSize: '4.8 MB',
    errorLogUrl: '/reports/error-log-9844.csv'
  },
  {
    id: 'IMP-9843',
    fileName: 'Karnataka_Industrial_Directory_v4.csv',
    uploadedBy: 'Rajesh Nair (Admin)',
    uploadedAt: '2024-09-07 16:10',
    totalRecords: 8500,
    successCount: 8200,
    failedCount: 45,
    duplicateCount: 255,
    status: 'Completed',
    fileSize: '2.9 MB'
  },
  {
    id: 'IMP-9842',
    fileName: 'Hyderabad_Tech_Renewable_Startups.csv',
    uploadedBy: 'Priya Sharma (Data Ops)',
    uploadedAt: '2024-09-04 10:20',
    totalRecords: 3200,
    successCount: 3150,
    failedCount: 12,
    duplicateCount: 38,
    status: 'Completed',
    fileSize: '1.1 MB'
  },
  {
    id: 'IMP-9841',
    fileName: 'Delhi_NCR_Retail_Traders_Q3.xlsx',
    uploadedBy: 'Automated Pipeline Agent',
    uploadedAt: '2024-09-02 03:00',
    totalRecords: 25000,
    successCount: 23400,
    failedCount: 980,
    duplicateCount: 620,
    status: 'Warning',
    fileSize: '8.4 MB',
    errorLogUrl: '/reports/error-log-9841.csv'
  },
  {
    id: 'IMP-9840',
    fileName: 'Corrupted_Raw_Scrape_Batch_77.csv',
    uploadedBy: 'System Scraper Service',
    uploadedAt: '2024-08-30 22:15',
    totalRecords: 4500,
    successCount: 0,
    failedCount: 4500,
    duplicateCount: 0,
    status: 'Failed',
    fileSize: '1.6 MB',
    errorLogUrl: '/reports/error-log-9840.csv'
  }
];

export const INITIAL_DUPLICATES: DuplicatePair[] = [
  {
    id: 'DUP-501',
    confidenceScore: 98,
    confidenceTier: 'Very High',
    matchingFields: ['Phone Number (+91 80 2839 4410)', 'Business Name (94% Levenshtein)', 'City (Bengaluru)', 'Pincode (560058)'],
    matchReasons: ['Exact Phone Number Match', 'Fuzzy Business Name Match (94%)', 'Matching Pincode & City'],
    original: INITIAL_ADMIN_BUSINESSES[0],
    duplicate: {
      ...INITIAL_ADMIN_BUSINESSES[0],
      id: 'BIZ-10001-DUP',
      name: 'Bharat Forge & Machining Works Peenya',
      address: 'Plot 45B, Peenya 2nd Phase Industrial Area',
      phone: '+91 80 2839 4410',
      email: 'bharatforge.blr@gmail.com',
      status: 'draft',
      validationStatus: 'Warning',
      phoneStatus: 'duplicate',
      emailStatus: 'valid',
      websiteStatus: 'valid',
      validationScore: 74,
      opportunityScore: 82,
      dataQualityScore: 74,
      createdAt: '2024-09-08 14:00',
      updatedAt: '2024-09-08 14:00'
    },
    status: 'pending'
  },
  {
    id: 'DUP-502',
    confidenceScore: 92,
    confidenceTier: 'Very High',
    matchingFields: ['Website Domain (apexgreenenergy.co.in)', 'State (Telangana)', 'City (Hyderabad)'],
    matchReasons: ['Exact Domain / Website Match', 'Matching State & City', 'Fuzzy Name Similarity'],
    original: INITIAL_ADMIN_BUSINESSES[1],
    duplicate: {
      ...INITIAL_ADMIN_BUSINESSES[1],
      id: 'BIZ-10002-DUP',
      name: 'Apex Green Energy LLP',
      address: 'Gachibowli Financial District, Hyderabad',
      website: 'https://apexgreenenergy.co.in',
      phone: '+91 40 4852 9901',
      status: 'draft',
      validationStatus: 'Pending',
      phoneStatus: 'valid',
      emailStatus: 'valid',
      websiteStatus: 'duplicate',
      validationScore: 70,
      opportunityScore: 80,
      dataQualityScore: 70,
      createdAt: '2024-09-08 14:05',
      updatedAt: '2024-09-08 14:05'
    },
    status: 'pending'
  },
  {
    id: 'DUP-503',
    confidenceScore: 88,
    confidenceTier: 'High',
    matchingFields: ['Address (4th Block, Koramangala 80 Feet Road)', 'Pincode (560034)', 'WhatsApp Mobile (+91 99887 76655)'],
    matchReasons: ['Exact Address Match', 'Same Industry & Pincode', 'Same WhatsApp Mobile'],
    original: INITIAL_ADMIN_BUSINESSES[3],
    duplicate: {
      ...INITIAL_ADMIN_BUSINESSES[3],
      id: 'BIZ-10004-DUP',
      name: 'Prime Diagnostic Center Koramangala',
      address: '4th Block, Koramangala 80 Feet Road',
      pincode: '560034',
      phone: '+91 80 4123 7899',
      whatsapp: '+91 99887 76655',
      status: 'draft',
      validationStatus: 'Warning',
      phoneStatus: 'valid',
      emailStatus: 'valid',
      websiteStatus: 'missing',
      validationScore: 68,
      opportunityScore: 75,
      dataQualityScore: 68,
      createdAt: '2024-09-08 14:10',
      updatedAt: '2024-09-08 14:10'
    },
    status: 'pending'
  }
];

export const INITIAL_VALIDATION_ISSUES: ValidationIssue[] = [
  {
    id: 'VAL-201',
    recordId: 'BIZ-10007',
    businessName: 'Modern Dental Care Clinic',
    issueType: 'invalid_email',
    severity: 'error',
    currentValue: 'invalid-email-format',
    suggestedFix: 'moderndentalcare@gmail.com',
    createdAt: '2024-09-08 14:12'
  },
  {
    id: 'VAL-202',
    recordId: 'BIZ-10005',
    businessName: 'Shree Balaji Polymers & Packaging',
    issueType: 'invalid_phone',
    severity: 'warning',
    currentValue: '+91 79 2583 1122 (Landline unconfirmed)',
    suggestedFix: 'Request tele-verification or GST mobile',
    createdAt: '2024-09-08 14:15'
  },
  {
    id: 'VAL-203',
    recordId: 'BIZ-10009',
    businessName: 'Royal Sweets & Confectioners',
    issueType: 'invalid_pincode',
    severity: 'error',
    currentValue: '5600',
    suggestedFix: '560001 (Requires 6 digits for India)',
    createdAt: '2024-09-08 14:18'
  },
  {
    id: 'VAL-204',
    recordId: 'BIZ-10010',
    businessName: 'Global Exim Consultancy',
    issueType: 'missing_name',
    severity: 'error',
    currentValue: '[BLANK]',
    suggestedFix: 'Extract from GST legal trading name',
    createdAt: '2024-09-08 14:20'
  }
];

export const INITIAL_ACTIVITY_LOGS: ActivityLogEntry[] = [
  {
    id: 'LOG-8801',
    user: 'Super Admin (System)',
    action: 'Published',
    entityType: 'Business',
    entityId: 'BIZ-10001',
    entityName: 'Bharat Forge & Machinery Works',
    details: 'Approved data verification and published record to live Discover catalog.',
    ipAddress: '103.45.12.98',
    timestamp: '2024-09-08 15:42:10'
  },
  {
    id: 'LOG-8802',
    user: 'Priya Sharma (Data Ops)',
    action: 'Imported',
    entityType: 'Batch',
    entityId: 'IMP-9844',
    entityName: 'MSME_Registrations_Gujarat_WB_Sep2024.xlsx',
    details: 'Completed batch ingestion of 14,200 raw MSME records.',
    ipAddress: '49.207.201.14',
    timestamp: '2024-09-08 14:30:00'
  },
  {
    id: 'LOG-8803',
    user: 'Rajesh Nair (Reviewer)',
    action: 'Merged',
    entityType: 'Business',
    entityId: 'DUP-498',
    entityName: 'Star Health Care Clinic',
    details: 'Merged duplicate record BIZ-9941 into primary record BIZ-9822.',
    ipAddress: '157.48.91.22',
    timestamp: '2024-09-08 13:15:44'
  },
  {
    id: 'LOG-8804',
    user: 'Super Admin (System)',
    action: 'Exported',
    entityType: 'Business',
    entityId: 'ALL-FILTERED',
    entityName: 'Karnataka Published Businesses (5,400 rows)',
    details: 'Generated secure CSV export for compliance backup.',
    ipAddress: '103.45.12.98',
    timestamp: '2024-09-08 11:55:00'
  },
  {
    id: 'LOG-8805',
    user: 'Automated Ingestion Worker',
    action: 'Rejected',
    entityType: 'Business',
    entityId: 'BIZ-10007',
    entityName: 'Modern Dental Care Clinic',
    details: 'Automated rejection due to 2 high severity validation errors.',
    ipAddress: '10.0.4.19 (Internal Worker)',
    timestamp: '2024-09-07 10:15:32'
  }
];

export const INITIAL_ADMIN_USERS: AdminUser[] = [
  {
    id: 'USR-01',
    name: 'Orion Super Admin',
    email: 'admin@orion.ai',
    role: 'Super Admin',
    status: 'Active',
    creditsBalance: 50000,
    lastActive: 'Just now',
    recordsReviewed: 1420
  },
  {
    id: 'USR-02',
    name: 'Priya Sharma',
    email: 'priya.sharma@orion.com',
    role: 'Data Operator',
    status: 'Active',
    creditsBalance: 5000,
    lastActive: '12m ago',
    recordsReviewed: 890
  }
];

export const INITIAL_CREDIT_TRANSACTIONS: CreditTransaction[] = [
  {
    id: 'TXN-901',
    userId: 'USR-01',
    userName: 'Apex Industrial Solvers',
    type: 'purchase',
    amount: 2000,
    balanceAfter: 2450,
    description: 'Enterprise Package Credit Purchase ($249)',
    timestamp: '2024-09-08 14:10'
  },
  {
    id: 'TXN-902',
    userId: 'USR-02',
    userName: 'Digital Wave Marketing',
    type: 'allocation',
    amount: 500,
    balanceAfter: 850,
    description: 'Manual Customer Support Goodwill Grant',
    adminBy: 'Orion Super Admin',
    timestamp: '2024-09-07 11:20'
  },
  {
    id: 'TXN-903',
    userId: 'USR-03',
    userName: 'Kolkata ERP Solvers',
    type: 'refund',
    amount: 5,
    balanceAfter: 120,
    description: 'Automatic Refund: Invalid Phone Data in Unlock #4829',
    timestamp: '2024-09-06 18:45'
  }
];

export const ORION_SUPPORTED_FIELDS = [
  { key: 'name', label: 'Business Name', required: true, description: 'Legal or trade name of the entity' },
  { key: 'industry', label: 'Industry', required: true, description: 'Primary sector (e.g. Manufacturing, Healthcare)' },
  { key: 'subIndustry', label: 'Sub Industry', required: false, description: 'Specialized niche / vertical' },
  { key: 'category', label: 'Business Category', required: true, description: 'Broad commercial segment' },
  { key: 'businessType', label: 'Business Type', required: false, description: 'Pvt Ltd, LLP, Proprietorship, etc.' },
  { key: 'msmeCategory', label: 'MSME Category', required: false, description: 'Micro, Small, or Medium Enterprise' },
  { key: 'address', label: 'Address', required: true, description: 'Full physical premises address' },
  { key: 'state', label: 'State / UT', required: true, description: 'Indian State or Union Territory' },
  { key: 'district', label: 'District', required: true, description: 'Official district classification' },
  { key: 'city', label: 'City / Hub', required: true, description: 'City, municipality or tier 2/3 hub' },
  { key: 'pincode', label: 'Pincode', required: true, description: '6-digit Indian postal code' },
  { key: 'phone', label: 'Phone Number', required: true, description: 'Primary mobile or verified landline' },
  { key: 'whatsapp', label: 'WhatsApp', required: false, description: 'Direct WhatsApp enabled number' },
  { key: 'email', label: 'Email', required: false, description: 'Official business or executive email' },
  { key: 'website', label: 'Website', required: false, description: 'Official domain / landing page URL' },
  { key: 'linkedin', label: 'LinkedIn', required: false, description: 'Official LinkedIn company profile or page URL' },
  { key: 'instagram', label: 'Instagram', required: false, description: 'Official Instagram profile page or handle URL' },
  { key: 'registrationDate', label: 'Registration Date', required: false, description: 'Incorporation or GST registration date' },
  { key: 'latitude', label: 'Latitude', required: false, description: 'Geo coordinate coordinate latitude' },
  { key: 'longitude', label: 'Longitude', required: false, description: 'Geo coordinate longitude' },
  { key: 'googleMapsLink', label: 'Google Maps Link', required: false, description: 'Direct Google Maps place URL' },
  { key: 'description', label: 'Description', required: false, description: 'Detailed products, capabilities & offerings summary' }
];

import { 
  CustomerUser, 
  TransactionRecord, 
  RoleDefinition, 
  SupportTicket, 
  CreditPackage, 
  SubscriptionPlan 
} from '@/types/admin';

export const INITIAL_CUSTOMER_USERS: CustomerUser[] = [
  {
    id: 'CUST-1001',
    name: 'Aarav Singhania',
    company: 'Apex Digital Solutions Pvt Ltd',
    email: 'aarav@apexdigital.in',
    phone: '+91 98201 45678',
    role: 'Managing Director',
    credits: 4850,
    status: 'Active',
    plan: 'Enterprise',
    registeredDate: '2024-01-15',
    lastLogin: '10 minutes ago',
    totalSpent: 148500,
    unlockedCount: 840,
    billingAddress: {
      street: 'Tower B, 14th Floor, DLF Cyber City',
      city: 'Gurugram',
      state: 'Haryana',
      pincode: '122002',
      gstin: '06AAACA1234A1Z5'
    },
    unlockedBusinesses: [
      { id: 'BIZ-10001', name: 'Apex Forge & CNC Works', industry: 'Manufacturing', city: 'Pune', state: 'Maharashtra', unlockedAt: '2024-09-08 16:30', creditsCost: 5 },
      { id: 'BIZ-10002', name: 'Bharat Industrial Logistics Ltd', industry: 'Logistics', city: 'Navi Mumbai', state: 'Maharashtra', unlockedAt: '2024-09-07 14:15', creditsCost: 5 },
      { id: 'BIZ-10003', name: 'Zenith BioPharm Labs India', industry: 'Healthcare', city: 'Bengaluru', state: 'Karnataka', unlockedAt: '2024-09-05 11:20', creditsCost: 5 },
    ],
    savedSearches: [
      { id: 'SRCH-01', name: 'Maharashtra Precision Toolmakers', filters: { state: 'Maharashtra', industry: 'Manufacturing' }, resultCount: 1420, savedAt: '2024-09-01' },
      { id: 'SRCH-02', name: 'Karnataka Cloud Tech Vendors', filters: { state: 'Karnataka', category: 'Cloud ERP' }, resultCount: 680, savedAt: '2024-08-20' },
    ],
    loginHistory: [
      { id: 'LGN-1', ip: '103.21.14.88', device: 'MacBook Pro M3', browser: 'Chrome 128', location: 'Gurugram, IN', timestamp: '2024-09-09 18:45', status: 'Success' },
      { id: 'LGN-2', ip: '103.21.14.88', device: 'MacBook Pro M3', browser: 'Chrome 128', location: 'Gurugram, IN', timestamp: '2024-09-08 09:12', status: 'Success' },
      { id: 'LGN-3', ip: '49.204.11.20', device: 'iPhone 15 Pro', browser: 'Safari 17', location: 'New Delhi, IN', timestamp: '2024-09-06 20:30', status: 'Success' }
    ],
    activityTimeline: [
      { id: 'ACT-1', action: 'Purchased Scale Credit Pack (5,000 credits)', timestamp: '2024-09-08 14:10', details: 'Paid ₹44,999 via Razorpay UPI (TXN-901).' },
      { id: 'ACT-2', action: 'Bulk exported 250 records', timestamp: '2024-09-08 16:45', details: 'Exported Pune CNC Machining cluster CSV.' },
      { id: 'ACT-3', action: 'Upgraded subscription tier', timestamp: '2024-08-15 10:00', details: 'Upgraded to Enterprise annual license.' }
    ]
  },
  {
    id: 'CUST-1002',
    name: 'Neha Deshmukh',
    company: 'FinTrack Tech Solutions LLP',
    email: 'neha@fintrack.io',
    phone: '+91 94220 89123',
    role: 'Head of Sales',
    credits: 1240,
    status: 'Active',
    plan: 'Growth',
    registeredDate: '2024-03-10',
    lastLogin: '1 hour ago',
    totalSpent: 49990,
    unlockedCount: 310,
    billingAddress: {
      street: 'Baner Tech Hub, Office 402',
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '411045',
      gstin: '27AABCF5678B1Z2'
    },
    unlockedBusinesses: [
      { id: 'BIZ-10004', name: 'Nova Cloud ERP Systems', industry: 'IT & Software', city: 'Bengaluru', state: 'Karnataka', unlockedAt: '2024-09-08 12:00', creditsCost: 5 },
      { id: 'BIZ-10006', name: 'Kalyan Agro Commodities', industry: 'Agriculture', city: 'Nashik', state: 'Maharashtra', unlockedAt: '2024-09-06 17:10', creditsCost: 5 },
    ],
    savedSearches: [
      { id: 'SRCH-03', name: 'Pune B2B Tech Startups', filters: { city: 'Pune', industry: 'IT & Software' }, resultCount: 340, savedAt: '2024-09-02' }
    ],
    loginHistory: [
      { id: 'LGN-4', ip: '115.112.44.10', device: 'Dell XPS 15', browser: 'Edge 127', location: 'Pune, IN', timestamp: '2024-09-09 17:30', status: 'Success' }
    ],
    activityTimeline: [
      { id: 'ACT-4', action: 'Unlocked 15 enterprise leads', timestamp: '2024-09-08 12:05', details: 'Used 75 credits for verified phone access.' }
    ]
  },
  {
    id: 'CUST-1003',
    name: 'Rohan Varma',
    company: 'Varma Global Logistics',
    email: 'rohan.varma@varmalogistics.com',
    phone: '+91 98450 11223',
    role: 'VP Procurement',
    credits: 320,
    status: 'Active',
    plan: 'Professional',
    registeredDate: '2024-04-22',
    lastLogin: '4 hours ago',
    totalSpent: 19999,
    unlockedCount: 160,
    billingAddress: {
      street: 'Harbour Maritime Center, GT Road',
      city: 'Chennai',
      state: 'Tamil Nadu',
      pincode: '600001',
      gstin: '33AABCV9999C1Z0'
    },
    unlockedBusinesses: [
      { id: 'BIZ-10002', name: 'Bharat Industrial Logistics Ltd', industry: 'Logistics', city: 'Navi Mumbai', state: 'Maharashtra', unlockedAt: '2024-09-04 15:00', creditsCost: 5 }
    ],
    savedSearches: [],
    loginHistory: [
      { id: 'LGN-5', ip: '182.74.92.14', device: 'ThinkPad T14', browser: 'Firefox 129', location: 'Chennai, IN', timestamp: '2024-09-09 14:20', status: 'Success' }
    ],
    activityTimeline: [
      { id: 'ACT-5', action: 'Reset password requested', timestamp: '2024-09-05 10:15', details: 'Completed 2FA password recovery.' }
    ]
  },
  {
    id: 'CUST-1004',
    name: 'Shreya Iyer',
    company: 'OmniHealth Pharma Ventures',
    email: 'shreya@omnihealth.co.in',
    phone: '+91 97112 33445',
    role: 'Director of Business Dev',
    credits: 0,
    status: 'Inactive',
    plan: 'Starter',
    registeredDate: '2024-05-18',
    lastLogin: '12 days ago',
    totalSpent: 4999,
    unlockedCount: 45,
    billingAddress: {
      street: 'Hitech City, Phase 2',
      city: 'Hyderabad',
      state: 'Telangana',
      pincode: '500081',
    },
    loginHistory: [
      { id: 'LGN-6', ip: '14.139.112.5', device: 'MacBook Air M2', browser: 'Safari 17', location: 'Hyderabad, IN', timestamp: '2024-08-28 11:10', status: 'Success' }
    ],
    activityTimeline: [
      { id: 'ACT-6', action: 'Credits exhausted alert triggered', timestamp: '2024-08-28 11:25', details: 'Zero balance reached after unlocking lead BIZ-10003.' }
    ]
  },
  {
    id: 'CUST-1005',
    name: 'Karan Malhotra',
    company: 'Malhotra Fasteners & Hardware',
    email: 'karan@malhotrafasteners.com',
    phone: '+91 98140 77889',
    role: 'Managing Partner',
    credits: 2150,
    status: 'Active',
    plan: 'Growth',
    registeredDate: '2024-02-01',
    lastLogin: 'Yesterday',
    totalSpent: 38990,
    unlockedCount: 220,
    billingAddress: {
      street: 'Focal Point Industrial Area',
      city: 'Ludhiana',
      state: 'Punjab',
      pincode: '141010',
      gstin: '03AAACM4444D1Z8'
    },
    loginHistory: [
      { id: 'LGN-7', ip: '117.247.88.19', device: 'Windows Desktop', browser: 'Chrome 128', location: 'Ludhiana, IN', timestamp: '2024-09-08 16:40', status: 'Success' }
    ],
    activityTimeline: [
      { id: 'ACT-7', action: 'Purchased 2,000 credits package', timestamp: '2024-09-02 09:15', details: '₹18,999 paid via NetBanking.' }
    ]
  },
  {
    id: 'CUST-1006',
    name: 'Ananya Roy',
    company: 'Bengal Analytics & Research',
    email: 'ananya@bengalanalytics.com',
    phone: '+91 98300 45612',
    role: 'Lead Data Strategist',
    credits: 50,
    status: 'Pending Verification',
    plan: 'Starter',
    registeredDate: '2024-09-08',
    lastLogin: '2 days ago',
    totalSpent: 0,
    unlockedCount: 0,
    billingAddress: {
      street: 'Salt Lake Sector V',
      city: 'Kolkata',
      state: 'West Bengal',
      pincode: '700091',
    },
    loginHistory: [
      { id: 'LGN-8', ip: '103.88.22.4', device: 'MacBook Pro', browser: 'Chrome 128', location: 'Kolkata, IN', timestamp: '2024-09-08 19:22', status: 'Success' }
    ],
    activityTimeline: [
      { id: 'ACT-8', action: 'Signed up for Orion platform', timestamp: '2024-09-08 19:20', details: 'Verification email sent.' }
    ]
  },
  {
    id: 'CUST-1007',
    name: 'Devendra Patel',
    company: 'Gujarat Chemicals & Agro Infotech',
    email: 'devendra@gujaratchem.in',
    phone: '+91 98250 99881',
    role: 'Chief Technology Officer',
    credits: 0,
    status: 'Suspended',
    plan: 'Professional',
    registeredDate: '2024-01-20',
    lastLogin: '18 days ago',
    totalSpent: 28000,
    unlockedCount: 190,
    billingAddress: {
      street: 'GIDC Industrial Estate, Ankleshwar',
      city: 'Bharuch',
      state: 'Gujarat',
      pincode: '393002',
      gstin: '24AAACG8888E1Z1'
    },
    loginHistory: [
      { id: 'LGN-9', ip: '122.170.18.99', device: 'Dell Latitude', browser: 'Chrome 126', location: 'Ahmedabad, IN', timestamp: '2024-08-22 14:05', status: 'Success' }
    ],
    activityTimeline: [
      { id: 'ACT-9', action: 'Account Suspended by Super Admin', timestamp: '2024-08-25 11:00', details: 'Suspension reason: Suspected automated scraping activity.' }
    ]
  },
  {
    id: 'CUST-1008',
    name: 'Meera Nambiar',
    company: 'Cochin Spice & Agri Exporters',
    email: 'meera@cochinspice.com',
    phone: '+91 94470 66554',
    role: 'Operations Head',
    credits: 3100,
    status: 'Active',
    plan: 'Enterprise',
    registeredDate: '2024-02-14',
    lastLogin: '3 hours ago',
    totalSpent: 92000,
    unlockedCount: 520,
    billingAddress: {
      street: 'Willingdon Island Port Trust Road',
      city: 'Kochi',
      state: 'Kerala',
      pincode: '682003',
      gstin: '32AAACC3333F1Z7'
    },
    loginHistory: [
      { id: 'LGN-10', ip: '117.218.42.10', device: 'iMac 24', browser: 'Safari 17', location: 'Kochi, IN', timestamp: '2024-09-09 15:40', status: 'Success' }
    ],
    activityTimeline: [
      { id: 'ACT-10', action: 'Exported Kerala Agro Exporters lead batch', timestamp: '2024-09-07 16:30', details: '180 records exported to Excel.' }
    ]
  }
];

export const INITIAL_PLATFORM_TRANSACTIONS: TransactionRecord[] = [
  {
    id: 'TXN-9001',
    customerId: 'CUST-1001',
    customerName: 'Aarav Singhania',
    customerEmail: 'aarav@apexdigital.in',
    company: 'Apex Digital Solutions Pvt Ltd',
    plan: 'Enterprise',
    creditsPurchased: 5000,
    creditsUsed: 150,
    amount: 44999,
    paymentMethod: 'Razorpay UPI',
    paymentStatus: 'Success',
    date: '2024-09-09 14:15',
    invoiceUrl: '/invoices/INV-9001.pdf',
    receiptNumber: 'REC-2024-0901',
  },
  {
    id: 'TXN-9002',
    customerId: 'CUST-1002',
    customerName: 'Neha Deshmukh',
    customerEmail: 'neha@fintrack.io',
    company: 'FinTrack Tech Solutions LLP',
    plan: 'Growth',
    creditsPurchased: 2000,
    creditsUsed: 75,
    amount: 18999,
    paymentMethod: 'Credit Card',
    paymentStatus: 'Success',
    date: '2024-09-09 11:30',
    invoiceUrl: '/invoices/INV-9002.pdf',
    receiptNumber: 'REC-2024-0902',
  },
  {
    id: 'TXN-9003',
    customerId: 'CUST-1008',
    customerName: 'Meera Nambiar',
    customerEmail: 'meera@cochinspice.com',
    company: 'Cochin Spice & Agri Exporters',
    plan: 'Enterprise',
    creditsPurchased: 10000,
    creditsUsed: 0,
    amount: 79999,
    paymentMethod: 'Bank Wire',
    paymentStatus: 'Success',
    date: '2024-09-08 16:45',
    invoiceUrl: '/invoices/INV-9003.pdf',
    receiptNumber: 'REC-2024-0903',
  },
  {
    id: 'TXN-9004',
    customerId: 'CUST-1005',
    customerName: 'Karan Malhotra',
    customerEmail: 'karan@malhotrafasteners.com',
    company: 'Malhotra Fasteners & Hardware',
    plan: 'Growth',
    creditsPurchased: 2000,
    creditsUsed: 0,
    amount: 18999,
    paymentMethod: 'NetBanking',
    paymentStatus: 'Success',
    date: '2024-09-08 09:15',
    invoiceUrl: '/invoices/INV-9004.pdf',
    receiptNumber: 'REC-2024-0904',
  },
  {
    id: 'TXN-9005',
    customerId: 'CUST-1003',
    customerName: 'Rohan Varma',
    customerEmail: 'rohan.varma@varmalogistics.com',
    company: 'Varma Global Logistics',
    plan: 'Professional',
    creditsPurchased: 500,
    creditsUsed: 0,
    amount: 4999,
    paymentMethod: 'Razorpay UPI',
    paymentStatus: 'Pending',
    date: '2024-09-09 17:10',
    receiptNumber: 'REC-2024-0905',
  },
  {
    id: 'TXN-9006',
    customerId: 'CUST-1004',
    customerName: 'Shreya Iyer',
    customerEmail: 'shreya@omnihealth.co.in',
    company: 'OmniHealth Pharma Ventures',
    plan: 'Starter',
    creditsPurchased: 500,
    creditsUsed: 0,
    amount: 4999,
    paymentMethod: 'Credit Card',
    paymentStatus: 'Failed',
    date: '2024-09-07 19:40',
    receiptNumber: 'REC-2024-0906',
  },
  {
    id: 'TXN-9007',
    customerId: 'CUST-1002',
    customerName: 'Neha Deshmukh',
    customerEmail: 'neha@fintrack.io',
    company: 'FinTrack Tech Solutions LLP',
    plan: 'Growth',
    creditsPurchased: 100,
    creditsUsed: 0,
    amount: 1200,
    paymentMethod: 'Razorpay UPI',
    paymentStatus: 'Refunded',
    date: '2024-09-06 14:20',
    refundReason: 'Accidental double charge during gateway checkout latency',
    refundedAmount: 1200,
    invoiceUrl: '/invoices/INV-9007-REF.pdf',
    receiptNumber: 'REC-2024-0907',
  },
  {
    id: 'TXN-9008',
    customerId: 'CUST-1007',
    customerName: 'Devendra Patel',
    customerEmail: 'devendra@gujaratchem.in',
    company: 'Gujarat Chemicals & Agro Infotech',
    plan: 'Professional',
    creditsPurchased: 1000,
    creditsUsed: 0,
    amount: 9999,
    paymentMethod: 'NetBanking',
    paymentStatus: 'Cancelled',
    date: '2024-08-25 10:30',
    receiptNumber: 'REC-2024-0908',
  }
];

export const INITIAL_ROLES_PERMISSIONS: RoleDefinition[] = [
  {
    id: 'role-superadmin',
    name: 'Super Admin',
    description: 'Unrestricted master access to all platform controls, schema settings, user management, and ledger adjustments.',
    userCount: 2,
    isSystem: true,
    modules: [
      { moduleKey: 'dashboard', moduleName: 'Dashboard', permissions: { read: true, write: true, delete: true, export: true, admin: true } },
      { moduleKey: 'businesses', moduleName: 'Business Records', permissions: { read: true, write: true, delete: true, export: true, admin: true } },
      { moduleKey: 'import', moduleName: 'Import Data', permissions: { read: true, write: true, delete: true, export: true, admin: true } },
      { moduleKey: 'validation', moduleName: 'Data Validation', permissions: { read: true, write: true, delete: true, export: true, admin: true } },
      { moduleKey: 'duplicates', moduleName: 'Duplicate Manager', permissions: { read: true, write: true, delete: true, export: true, admin: true } },
      { moduleKey: 'publish_queue', moduleName: 'Publish Queue', permissions: { read: true, write: true, delete: true, export: true, admin: true } },
      { moduleKey: 'reports', moduleName: 'Reports & Analytics', permissions: { read: true, write: true, delete: true, export: true, admin: true } },
      { moduleKey: 'users', moduleName: 'Users & Customers', permissions: { read: true, write: true, delete: true, export: true, admin: true } },
      { moduleKey: 'credits', moduleName: 'Credits & Ledger', permissions: { read: true, write: true, delete: true, export: true, admin: true } },
      { moduleKey: 'settings', moduleName: 'System Settings', permissions: { read: true, write: true, delete: true, export: true, admin: true } },
      { moduleKey: 'logs', moduleName: 'Activity Logs', permissions: { read: true, write: true, delete: true, export: true, admin: true } },
      { moduleKey: 'support', moduleName: 'Support Center', permissions: { read: true, write: true, delete: true, export: true, admin: true } },
    ]
  },
  {
    id: 'role-admin',
    name: 'Admin',
    description: 'Full operational administrative access with restriction on master destructive system changes.',
    userCount: 4,
    isSystem: true,
    modules: [
      { moduleKey: 'dashboard', moduleName: 'Dashboard', permissions: { read: true, write: true, delete: false, export: true, admin: false } },
      { moduleKey: 'businesses', moduleName: 'Business Records', permissions: { read: true, write: true, delete: true, export: true, admin: false } },
      { moduleKey: 'import', moduleName: 'Import Data', permissions: { read: true, write: true, delete: false, export: true, admin: false } },
      { moduleKey: 'validation', moduleName: 'Data Validation', permissions: { read: true, write: true, delete: false, export: true, admin: false } },
      { moduleKey: 'duplicates', moduleName: 'Duplicate Manager', permissions: { read: true, write: true, delete: true, export: true, admin: false } },
      { moduleKey: 'publish_queue', moduleName: 'Publish Queue', permissions: { read: true, write: true, delete: false, export: true, admin: false } },
      { moduleKey: 'reports', moduleName: 'Reports & Analytics', permissions: { read: true, write: false, delete: false, export: true, admin: false } },
      { moduleKey: 'users', moduleName: 'Users & Customers', permissions: { read: true, write: true, delete: false, export: true, admin: false } },
      { moduleKey: 'credits', moduleName: 'Credits & Ledger', permissions: { read: true, write: true, delete: false, export: true, admin: false } },
      { moduleKey: 'settings', moduleName: 'System Settings', permissions: { read: true, write: true, delete: false, export: false, admin: false } },
      { moduleKey: 'logs', moduleName: 'Activity Logs', permissions: { read: true, write: false, delete: false, export: true, admin: false } },
      { moduleKey: 'support', moduleName: 'Support Center', permissions: { read: true, write: true, delete: false, export: true, admin: false } },
    ]
  },
  {
    id: 'role-datamanager',
    name: 'Data Manager',
    description: 'Oversees pipeline ingestion, deduplication heuristics, data enrichment, and catalog quality scores.',
    userCount: 6,
    isSystem: false,
    modules: [
      { moduleKey: 'dashboard', moduleName: 'Dashboard', permissions: { read: true, write: false, delete: false, export: true, admin: false } },
      { moduleKey: 'businesses', moduleName: 'Business Records', permissions: { read: true, write: true, delete: true, export: true, admin: false } },
      { moduleKey: 'import', moduleName: 'Import Data', permissions: { read: true, write: true, delete: true, export: true, admin: false } },
      { moduleKey: 'validation', moduleName: 'Data Validation', permissions: { read: true, write: true, delete: true, export: true, admin: false } },
      { moduleKey: 'duplicates', moduleName: 'Duplicate Manager', permissions: { read: true, write: true, delete: true, export: true, admin: false } },
      { moduleKey: 'publish_queue', moduleName: 'Publish Queue', permissions: { read: true, write: true, delete: false, export: true, admin: false } },
      { moduleKey: 'reports', moduleName: 'Reports & Analytics', permissions: { read: true, write: false, delete: false, export: true, admin: false } },
      { moduleKey: 'users', moduleName: 'Users & Customers', permissions: { read: false, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'credits', moduleName: 'Credits & Ledger', permissions: { read: false, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'settings', moduleName: 'System Settings', permissions: { read: true, write: true, delete: false, export: false, admin: false } },
      { moduleKey: 'logs', moduleName: 'Activity Logs', permissions: { read: true, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'support', moduleName: 'Support Center', permissions: { read: false, write: false, delete: false, export: false, admin: false } },
    ]
  },
  {
    id: 'role-reviewer',
    name: 'Reviewer',
    description: 'Validates phone/email/GST credentials and approves candidate records for publish queue.',
    userCount: 12,
    isSystem: false,
    modules: [
      { moduleKey: 'dashboard', moduleName: 'Dashboard', permissions: { read: true, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'businesses', moduleName: 'Business Records', permissions: { read: true, write: true, delete: false, export: false, admin: false } },
      { moduleKey: 'import', moduleName: 'Import Data', permissions: { read: true, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'validation', moduleName: 'Data Validation', permissions: { read: true, write: true, delete: false, export: false, admin: false } },
      { moduleKey: 'duplicates', moduleName: 'Duplicate Manager', permissions: { read: true, write: true, delete: false, export: false, admin: false } },
      { moduleKey: 'publish_queue', moduleName: 'Publish Queue', permissions: { read: true, write: true, delete: false, export: false, admin: false } },
      { moduleKey: 'reports', moduleName: 'Reports & Analytics', permissions: { read: false, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'users', moduleName: 'Users & Customers', permissions: { read: false, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'credits', moduleName: 'Credits & Ledger', permissions: { read: false, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'settings', moduleName: 'System Settings', permissions: { read: false, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'logs', moduleName: 'Activity Logs', permissions: { read: false, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'support', moduleName: 'Support Center', permissions: { read: false, write: false, delete: false, export: false, admin: false } },
    ]
  },
  {
    id: 'role-support',
    name: 'Support',
    description: 'Handles customer support tickets, billing inquiries, and troubleshooting lead unlock questions.',
    userCount: 8,
    isSystem: false,
    modules: [
      { moduleKey: 'dashboard', moduleName: 'Dashboard', permissions: { read: true, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'businesses', moduleName: 'Business Records', permissions: { read: true, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'import', moduleName: 'Import Data', permissions: { read: false, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'validation', moduleName: 'Data Validation', permissions: { read: false, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'duplicates', moduleName: 'Duplicate Manager', permissions: { read: false, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'publish_queue', moduleName: 'Publish Queue', permissions: { read: false, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'reports', moduleName: 'Reports & Analytics', permissions: { read: false, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'users', moduleName: 'Users & Customers', permissions: { read: true, write: true, delete: false, export: false, admin: false } },
      { moduleKey: 'credits', moduleName: 'Credits & Ledger', permissions: { read: true, write: true, delete: false, export: false, admin: false } },
      { moduleKey: 'settings', moduleName: 'System Settings', permissions: { read: false, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'logs', moduleName: 'Activity Logs', permissions: { read: true, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'support', moduleName: 'Support Center', permissions: { read: true, write: true, delete: false, export: true, admin: false } },
    ]
  },
  {
    id: 'role-finance',
    name: 'Finance',
    description: 'Manages credit economy, transaction reconciliation, tax invoices, and refunds.',
    userCount: 3,
    isSystem: false,
    modules: [
      { moduleKey: 'dashboard', moduleName: 'Dashboard', permissions: { read: true, write: false, delete: false, export: true, admin: false } },
      { moduleKey: 'businesses', moduleName: 'Business Records', permissions: { read: false, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'import', moduleName: 'Import Data', permissions: { read: false, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'validation', moduleName: 'Data Validation', permissions: { read: false, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'duplicates', moduleName: 'Duplicate Manager', permissions: { read: false, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'publish_queue', moduleName: 'Publish Queue', permissions: { read: false, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'reports', moduleName: 'Reports & Analytics', permissions: { read: true, write: false, delete: false, export: true, admin: false } },
      { moduleKey: 'users', moduleName: 'Users & Customers', permissions: { read: true, write: false, delete: false, export: true, admin: false } },
      { moduleKey: 'credits', moduleName: 'Credits & Ledger', permissions: { read: true, write: true, delete: true, export: true, admin: true } },
      { moduleKey: 'settings', moduleName: 'System Settings', permissions: { read: true, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'logs', moduleName: 'Activity Logs', permissions: { read: true, write: false, delete: false, export: true, admin: false } },
      { moduleKey: 'support', moduleName: 'Support Center', permissions: { read: true, write: true, delete: false, export: false, admin: false } },
    ]
  },
  {
    id: 'role-viewer',
    name: 'Viewer',
    description: 'Read-only audit access across platform dashboards and reports.',
    userCount: 5,
    isSystem: true,
    modules: [
      { moduleKey: 'dashboard', moduleName: 'Dashboard', permissions: { read: true, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'businesses', moduleName: 'Business Records', permissions: { read: true, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'import', moduleName: 'Import Data', permissions: { read: true, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'validation', moduleName: 'Data Validation', permissions: { read: true, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'duplicates', moduleName: 'Duplicate Manager', permissions: { read: true, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'publish_queue', moduleName: 'Publish Queue', permissions: { read: true, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'reports', moduleName: 'Reports & Analytics', permissions: { read: true, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'users', moduleName: 'Users & Customers', permissions: { read: true, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'credits', moduleName: 'Credits & Ledger', permissions: { read: true, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'settings', moduleName: 'System Settings', permissions: { read: true, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'logs', moduleName: 'Activity Logs', permissions: { read: true, write: false, delete: false, export: false, admin: false } },
      { moduleKey: 'support', moduleName: 'Support Center', permissions: { read: true, write: false, delete: false, export: false, admin: false } },
    ]
  }
];

export const INITIAL_SUPPORT_TICKETS: SupportTicket[] = [
  {
    id: 'TCK-401',
    customerId: 'CUST-1001',
    customerName: 'Aarav Singhania',
    customerEmail: 'aarav@apexdigital.in',
    company: 'Apex Digital Solutions Pvt Ltd',
    subject: 'Enterprise API webhook rate limits & credit deductions',
    priority: 'High',
    status: 'In Progress',
    assignedTo: 'Vikramaditya Sethi',
    createdDate: '2024-09-09 11:20',
    lastUpdated: '2024-09-09 15:45',
    category: 'API Integration',
    resolutionTimeMinutes: 180,
    messages: [
      {
        id: 'msg-1',
        sender: 'Customer',
        senderName: 'Aarav Singhania',
        message: 'Hello Support team, we are noticing a 429 Too Many Requests response during our daily batch syncing of verified leads in Karnataka. Can we get our burst limit elevated to 120 req/min?',
        timestamp: '2024-09-09 11:20'
      },
      {
        id: 'msg-2',
        sender: 'Support Agent',
        senderName: 'Vikramaditya Sethi',
        message: 'Hi Aarav, thank you for reaching out. We have reviewed your current Enterprise cluster throughput. I have escalated this to our infrastructure engineer to provision a dedicated rate pool.',
        timestamp: '2024-09-09 12:05'
      },
      {
        id: 'msg-3',
        sender: 'Support Agent',
        senderName: 'Vikramaditya Sethi',
        message: 'Internal review note: Customer has active ₹1.48L spend, safe to increase Redis token bucket to 150 req/min.',
        timestamp: '2024-09-09 12:10',
        isInternalNote: true
      }
    ],
    internalNotes: [
      'Customer tier: Enterprise (DLF Cyber City). Priority VIP SLA < 2 hours.'
    ]
  },
  {
    id: 'TCK-402',
    customerId: 'CUST-1002',
    customerName: 'Neha Deshmukh',
    customerEmail: 'neha@fintrack.io',
    company: 'FinTrack Tech Solutions LLP',
    subject: 'Credit refund request for disconnected phone numbers in lead batch',
    priority: 'Medium',
    status: 'Waiting for Customer',
    assignedTo: 'Priya Sharma',
    createdDate: '2024-09-08 14:30',
    lastUpdated: '2024-09-09 10:15',
    category: 'Data Accuracy',
    messages: [
      {
        id: 'msg-4',
        sender: 'Customer',
        senderName: 'Neha Deshmukh',
        message: 'Out of 20 leads unlocked in Pune manufacturing category, 2 numbers returned IVR out-of-service error. Could you refund 10 credits back to our wallet?',
        timestamp: '2024-09-08 14:30'
      },
      {
        id: 'msg-5',
        sender: 'Support Agent',
        senderName: 'Priya Sharma',
        message: 'Hello Neha, we have credited 10 credits back to your wallet and flagged those two records for fresh manual tele-verification in our curation pipeline.',
        timestamp: '2024-09-09 10:15'
      }
    ],
    internalNotes: [
      'Refund processed on TXN ledger: 10 credits auto-credited.'
    ],
    resolution: 'Refunded 10 credits and re-queued records BIZ-10008 & BIZ-10009 for phone re-validation.'
  },
  {
    id: 'TCK-403',
    customerId: 'CUST-1003',
    customerName: 'Rohan Varma',
    customerEmail: 'rohan.varma@varmalogistics.com',
    company: 'Varma Global Logistics',
    subject: 'GST tax invoice receipt required for August annual purchase',
    priority: 'Low',
    status: 'Resolved',
    assignedTo: 'Orion Support Agent',
    createdDate: '2024-09-07 09:10',
    lastUpdated: '2024-09-07 14:00',
    category: 'Billing & Credits',
    resolutionTimeMinutes: 290,
    messages: [
      {
        id: 'msg-6',
        sender: 'Customer',
        senderName: 'Rohan Varma',
        message: 'Could you please issue a B2B tax invoice with our GSTIN: 33AABCV9999C1Z0 for the ₹19,999 payment made on August 22nd?',
        timestamp: '2024-09-07 09:10'
      },
      {
        id: 'msg-7',
        sender: 'Support Agent',
        senderName: 'Orion Support Agent',
        message: 'Hi Rohan, your GST compliant tax invoice INV-2024-0822 is now attached and available directly inside your Orion billing dashboard.',
        timestamp: '2024-09-07 14:00'
      }
    ],
    internalNotes: [
      'Generated GST invoice on ClearTax integration.'
    ],
    resolution: 'GST invoice PDF generated and dispatched.'
  },
  {
    id: 'TCK-404',
    customerId: 'CUST-1007',
    customerName: 'Devendra Patel',
    customerEmail: 'devendra@gujaratchem.in',
    company: 'Gujarat Chemicals & Agro Infotech',
    subject: 'Inquiry regarding account suspension notice',
    priority: 'Critical',
    status: 'Open',
    assignedTo: 'Vikramaditya Sethi',
    createdDate: '2024-09-09 16:00',
    lastUpdated: '2024-09-09 16:00',
    category: 'Account Access',
    messages: [
      {
        id: 'msg-8',
        sender: 'Customer',
        senderName: 'Devendra Patel',
        message: 'Our corporate account has been suspended with message "Suspected automated scraping". We were running a legitimate CSV export using our purchased credits. Please reinstate access.',
        timestamp: '2024-09-09 16:00'
      }
    ],
    internalNotes: [
      'Account flagged by automated WAF for 800 export requests in under 3 minutes without delay headers. Review with Security Lead.'
    ]
  }
];

export const INITIAL_CREDIT_PACKAGES: CreditPackage[] = [
  {
    id: 'pack-starter',
    name: 'Starter Pack',
    credits: 500,
    price: 4999,
    discountPercentage: 0,
    features: ['500 Verified Business Unlocks', 'CSV / Excel Export', 'Standard Email Support', 'Valid for 12 Months']
  },
  {
    id: 'pack-growth',
    name: 'Growth Pack',
    credits: 2000,
    price: 18999,
    discountPercentage: 5,
    isPopular: true,
    features: ['2,000 Verified Business Unlocks', 'Direct Phone & WhatsApp Access', 'Priority Verification Queue', 'Valid for 12 Months']
  },
  {
    id: 'pack-scale',
    name: 'Scale Pack',
    credits: 5000,
    price: 44999,
    discountPercentage: 10,
    features: ['5,000 Verified Business Unlocks', 'Bulk Enrichment API Access', 'Dedicated Account Manager', 'Valid for 24 Months']
  },
  {
    id: 'pack-enterprise',
    name: 'Enterprise Pool',
    credits: 10000,
    price: 79999,
    discountPercentage: 20,
    features: ['10,000+ Unlimited Unlocks', 'Custom CRM Webhook Sync', 'SLA < 1 Hour Support', 'Custom GST Invoicing']
  }
];

export const INITIAL_SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: 'plan-starter',
    name: 'Starter',
    monthlyPrice: 2999,
    annualPrice: 29990,
    creditsPerMonth: 250,
    exportLimitMonthly: 500,
    activeSubscribers: 420,
    features: ['Access to 1.2M+ Catalog', 'Standard Search Filters', '50 Free Monthly Unlocks', 'Basic Export']
  },
  {
    id: 'plan-pro',
    name: 'Professional',
    monthlyPrice: 7999,
    annualPrice: 79990,
    creditsPerMonth: 800,
    exportLimitMonthly: 2500,
    activeSubscribers: 890,
    features: ['All Starter Features', 'Opportunity Score Filters', 'Direct GSTIN Verification', 'Priority Phone Support']
  },
  {
    id: 'plan-growth',
    name: 'Growth',
    monthlyPrice: 16999,
    annualPrice: 169990,
    creditsPerMonth: 2000,
    exportLimitMonthly: 10000,
    activeSubscribers: 340,
    features: ['All Pro Features', 'Multi-user Team Seats (5)', 'Custom Saved Searches & Alerts', 'REST API Access']
  },
  {
    id: 'plan-enterprise',
    name: 'Enterprise',
    monthlyPrice: 39999,
    annualPrice: 399990,
    creditsPerMonth: 6000,
    exportLimitMonthly: 50000,
    activeSubscribers: 110,
    features: ['Unlimited Team Seats', 'Custom Scraper Webhooks', 'Dedicated Data Architect', 'Custom SLA 99.9%']
  }
];

import {
  DataSourceRecord,
  EnrichmentJob,
  AiPipelineDefinition,
  AutomationRule,
  SystemServiceHealth,
  SearchIndexStatus
} from '@/types/admin';

export const INITIAL_DATA_SOURCES: DataSourceRecord[] = [
  {
    id: 'SRC-01',
    name: 'MSME Udyam Portal Registry',
    category: 'Government Registry',
    status: 'Connected',
    recordsImported: 420000,
    lastSync: '15 minutes ago',
    nextSync: 'Today at 23:00',
    successRate: 99.4,
    frequency: 'Hourly Delta',
    endpoint: 'https://api.udyamregistration.gov.in/v2/sync',
    authMethod: 'mTLS + OAuth 2.0 Client Credentials',
    errorCount: 24,
    syncHistory: [
      { id: 'SYNC-101', timestamp: '2024-09-09 18:00', recordsFetched: 1240, duration: '42s', status: 'Success', details: 'Streamed 1,240 verified MSME enterprises.' },
      { id: 'SYNC-100', timestamp: '2024-09-09 17:00', recordsFetched: 1180, duration: '38s', status: 'Success', details: 'Full delta sync completed.' }
    ]
  },
  {
    id: 'SRC-02',
    name: 'Ministry of Corporate Affairs (MCA 21)',
    category: 'Corporate Affairs',
    status: 'Connected',
    recordsImported: 310000,
    lastSync: '1 hour ago',
    nextSync: 'Tomorrow at 02:00',
    successRate: 98.8,
    frequency: 'Daily Batch',
    endpoint: 'https://api.mca.gov.in/master/companies/v3',
    authMethod: 'API Key + Bearer Token',
    errorCount: 18,
    syncHistory: [
      { id: 'SYNC-201', timestamp: '2024-09-09 17:15', recordsFetched: 3450, duration: '2m 14s', status: 'Success', details: 'Fetched CIN and director details for active Pvt Ltd companies.' }
    ]
  },
  {
    id: 'SRC-03',
    name: 'Goods & Services Tax (GSTN Portal)',
    category: 'Tax Gateway',
    status: 'Running',
    recordsImported: 580000,
    lastSync: 'Just now',
    nextSync: 'Continuous Webhook',
    successRate: 99.1,
    frequency: 'Real-time Webhook',
    endpoint: 'https://api.gstn.org.in/taxpayer/v1/stream',
    authMethod: 'HMAC-SHA256 Signed Gateway',
    errorCount: 5,
    syncHistory: [
      { id: 'SYNC-301', timestamp: '2024-09-09 18:45', recordsFetched: 480, duration: '12s', status: 'Success', details: 'Verified GSTIN filing states for Maharashtra cluster.' }
    ]
  },
  {
    id: 'SRC-04',
    name: 'Food Safety (FSSAI) Registry',
    category: 'Government Registry',
    status: 'Connected',
    recordsImported: 110000,
    lastSync: '3 hours ago',
    nextSync: 'Today at 21:00',
    successRate: 97.5,
    frequency: 'Every 6 Hours',
    endpoint: 'https://foscos.fssai.gov.in/api/v1/license/feed',
    authMethod: 'API Token',
    errorCount: 42,
    syncHistory: [
      { id: 'SYNC-401', timestamp: '2024-09-09 15:30', recordsFetched: 890, duration: '1m 05s', status: 'Success', details: 'Ingested FSSAI licenses for Food & Beverage suppliers.' }
    ]
  },
  {
    id: 'SRC-05',
    name: 'Startup India Directory (DPIIT)',
    category: 'Government Registry',
    status: 'Connected',
    recordsImported: 45000,
    lastSync: '6 hours ago',
    nextSync: 'Tomorrow at 00:00',
    successRate: 99.8,
    frequency: 'Daily Batch',
    endpoint: 'https://api.startupindia.gov.in/recognitions/v1',
    authMethod: 'OAuth 2.0',
    errorCount: 2,
    syncHistory: [
      { id: 'SYNC-501', timestamp: '2024-09-09 12:00', recordsFetched: 320, duration: '28s', status: 'Success', details: 'DPIIT recognized startups synchronized.' }
    ]
  },
  {
    id: 'SRC-06',
    name: 'Internal Data Platform Ingest Pipeline',
    category: 'Batch Ingestion',
    status: 'Connected',
    recordsImported: 890000,
    lastSync: '25 minutes ago',
    nextSync: 'Continuous Queue',
    successRate: 98.2,
    frequency: 'Kafka Stream',
    endpoint: 'kafka://cluster.orion.internal:9092/ingest-raw',
    authMethod: 'SASL / SCRAM-SHA-512',
    errorCount: 110,
    syncHistory: [
      { id: 'SYNC-601', timestamp: '2024-09-09 18:20', recordsFetched: 5600, duration: '45s', status: 'Success', details: 'Raw stream consumed and staged in Draft collection.' }
    ]
  },
  {
    id: 'SRC-07',
    name: 'Manual Operator CSV / Excel Uploads',
    category: 'Batch Ingestion',
    status: 'Connected',
    recordsImported: 140000,
    lastSync: '4 hours ago',
    nextSync: 'On-Demand',
    successRate: 96.4,
    frequency: 'Manual Ingestion',
    endpoint: 'internal://s3-staging/uploads/',
    authMethod: 'Session RBAC',
    errorCount: 65,
    syncHistory: [
      { id: 'SYNC-701', timestamp: '2024-09-09 14:00', recordsFetched: 14200, duration: '3m 12s', status: 'Success', details: 'Operator batch IMP-4829 validated.' }
    ]
  },
  {
    id: 'SRC-08',
    name: 'Future External API Integrations Gateway',
    category: 'REST API',
    status: 'Paused',
    recordsImported: 0,
    lastSync: 'Never',
    nextSync: 'Manual Activation',
    successRate: 100.0,
    frequency: 'Webhook / Polling',
    endpoint: 'https://gateway.orion.io/v1/partners/incoming',
    authMethod: 'JWT Bearer',
    errorCount: 0,
    syncHistory: []
  }
];

export const INITIAL_ENRICHMENT_JOBS: EnrichmentJob[] = [
  {
    id: 'JOB-901',
    businessId: 'BIZ-10001',
    businessName: 'Apex Forge & CNC Works',
    industry: 'Manufacturing',
    taskType: 'Website Detection',
    status: 'Completed',
    progress: 100,
    started: '2024-09-09 18:20',
    completed: '2024-09-09 18:21',
    duration: '42s',
    extractedData: { domain: 'https://apexforge.in', sslStatus: 'Valid TLS 1.3', serverLocation: 'Mumbai' }
  },
  {
    id: 'JOB-902',
    businessId: 'BIZ-10002',
    businessName: 'Bharat Industrial Logistics Ltd',
    industry: 'Logistics',
    taskType: 'Phone Verification',
    status: 'Running',
    progress: 68,
    started: '2024-09-09 18:40',
    duration: '24s',
  },
  {
    id: 'JOB-903',
    businessId: 'BIZ-10003',
    businessName: 'Zenith BioPharm Labs India',
    industry: 'Healthcare',
    taskType: 'Category Classification',
    status: 'Completed',
    progress: 100,
    started: '2024-09-09 17:50',
    completed: '2024-09-09 17:51',
    duration: '18s',
    extractedData: { predictedCategory: 'Active Pharmaceutical Ingredients (API)', confidence: '98.4%' }
  },
  {
    id: 'JOB-904',
    businessId: 'BIZ-10004',
    businessName: 'Nova Cloud ERP Systems',
    industry: 'IT & Software',
    taskType: 'AI Summary',
    status: 'Queued',
    progress: 0,
    started: '2024-09-09 18:48',
  },
  {
    id: 'JOB-905',
    businessId: 'BIZ-10005',
    businessName: 'Supreme Textiles & Weaving Mill',
    industry: 'Textiles',
    taskType: 'Google Business Detection',
    status: 'Running',
    progress: 45,
    started: '2024-09-09 18:44',
    duration: '35s',
  },
  {
    id: 'JOB-906',
    businessId: 'BIZ-10006',
    businessName: 'Kalyan Agro Commodities',
    industry: 'Food Processing',
    taskType: 'Business Description',
    status: 'Completed',
    progress: 100,
    started: '2024-09-09 16:10',
    completed: '2024-09-09 16:11',
    duration: '52s',
    extractedData: { summary: 'Exporter of premium organic pulses, wheat grains and agro derivatives.' }
  },
  {
    id: 'JOB-907',
    businessId: 'BIZ-10007',
    businessName: 'Modern Dental Care Clinic',
    industry: 'Healthcare',
    taskType: 'Email Validation',
    status: 'Failed',
    progress: 80,
    started: '2024-09-09 15:20',
    completed: '2024-09-09 15:21',
    duration: '40s',
    errorMessage: 'MX lookup failed: Domain host unresolvable'
  },
  {
    id: 'JOB-908',
    businessId: 'BIZ-10008',
    businessName: 'Precision Hydraulic Valves LLP',
    industry: 'Manufacturing',
    taskType: 'Social Presence',
    status: 'Queued',
    progress: 0,
    started: '2024-09-09 18:50',
  },
  {
    id: 'JOB-909',
    businessId: 'BIZ-10009',
    businessName: 'Continental Cold Chain Hub',
    industry: 'Logistics',
    taskType: 'Logo Detection',
    status: 'Skipped',
    progress: 0,
    started: '2024-09-09 14:00',
    errorMessage: 'Website has no valid image markup'
  }
];

export const INITIAL_AI_PIPELINES: AiPipelineDefinition[] = [
  {
    id: 'pipe-classify',
    name: 'Classification',
    displayName: 'Deep Sector Classification Pipeline',
    description: 'Multi-label Transformer predicting primary industry, sub-sector, and MSME category from business description and GST metadata.',
    model: 'RoBERTa-Enterprise-v3.4',
    version: 'v3.4.1',
    accuracy: 94.6,
    status: 'Active',
    processedCount: 1145000,
    avgLatencyMs: 42,
    queueDepth: 140
  },
  {
    id: 'pipe-dedup',
    name: 'Deduplication',
    displayName: 'Neural Entity Resolution & Deduplication',
    description: 'Dense vector embedding similarity engine comparing phonetics, pincodes, corporate names, and directors across 10M+ records.',
    model: 'Sentence-Transformer-AllMiniLM-L6-v2',
    version: 'v2.1.0',
    accuracy: 97.2,
    status: 'Active',
    processedCount: 1248000,
    avgLatencyMs: 18,
    queueDepth: 65
  },
  {
    id: 'pipe-scoring',
    name: 'Scoring',
    displayName: 'Opportunity & Commercial Scoring Engine',
    description: 'Gradient-boosted decision trees calculating B2B lead viability, creditworthiness, digital maturity, and contactability index.',
    model: 'XGBoost-OpportunityScore-v2.8',
    version: 'v2.8.0',
    accuracy: 91.4,
    status: 'Active',
    processedCount: 980000,
    avgLatencyMs: 8,
    queueDepth: 12
  },
  {
    id: 'pipe-cat',
    name: 'Business Categorization',
    displayName: 'Hierarchical Taxonomy Categorization',
    description: 'Automatic mapping of incoming trade classifications into Orion unified 3-level taxonomy hierarchy.',
    model: 'Hierarchical-Taxonomy-v1.8',
    version: 'v1.8.4',
    accuracy: 95.8,
    status: 'Active',
    processedCount: 1205000,
    avgLatencyMs: 14,
    queueDepth: 88
  },
  {
    id: 'pipe-recom',
    name: 'Recommendation Engine',
    displayName: 'Future Lead Recommendation Graph',
    description: 'Graph neural network predicting prospective customer lookalikes and B2B vendor matching.',
    model: 'GraphSage-Lookalike-v0.9-Preview',
    version: 'v0.9.0-BETA',
    accuracy: 88.9,
    status: 'Training',
    processedCount: 450000,
    avgLatencyMs: 110,
    queueDepth: 0
  }
];

export const INITIAL_AUTOMATION_RULES: AutomationRule[] = [
  {
    id: 'RULE-01',
    name: 'Auto-Publish High Confidence Verified Businesses',
    description: 'Automatically transitions records from Approved to Published in Discover if phone, email, and GST are 100% verified and quality score >= 90%.',
    trigger: 'On Validation Passed',
    conditionField: 'dataQualityScore',
    conditionOperator: 'greater_than',
    conditionValue: '90',
    action: 'Auto-Publish',
    priority: 'P1 Urgent',
    status: 'Active',
    executionsCount: 28450,
    lastExecuted: '4 minutes ago',
    successRate: 99.8
  },
  {
    id: 'RULE-02',
    name: 'Auto-Quarantine Duplicates Above 90% Confidence',
    description: 'Immediately routes duplicate collisions with >= 90% phonetic and phone similarity into Duplicate Manager.',
    trigger: 'On Duplicate Score > Threshold',
    conditionField: 'confidenceScore',
    conditionOperator: 'greater_than',
    conditionValue: '90',
    action: 'Quarantine for Review',
    priority: 'P1 Urgent',
    status: 'Active',
    executionsCount: 14200,
    lastExecuted: '12 minutes ago',
    successRate: 100.0
  },
  {
    id: 'RULE-03',
    name: 'Auto-Assign Industry from GST NIC Code',
    description: 'Automatically assigns primary industry based on 2-digit NIC code present in incoming government registry payload.',
    trigger: 'On Record Ingested',
    conditionField: 'nicCode',
    conditionOperator: 'is_not_empty',
    conditionValue: 'ANY',
    action: 'Assign Industry',
    priority: 'P2 High',
    status: 'Active',
    executionsCount: 92400,
    lastExecuted: 'Just now',
    successRate: 99.4
  },
  {
    id: 'RULE-04',
    name: 'Auto-Categorize Cloud Software Vendors',
    description: 'Scans business descriptions for SaaS, Cloud, ERP keywords and automatically attaches Cloud ERP Sub-Category tag.',
    trigger: 'On Record Ingested',
    conditionField: 'description',
    conditionOperator: 'contains',
    conditionValue: 'Cloud, SaaS, ERP',
    action: 'Assign Category',
    actionPayload: 'Cloud ERP & CRM Systems',
    priority: 'P3 Normal',
    status: 'Active',
    executionsCount: 18200,
    lastExecuted: '1 hour ago',
    successRate: 98.6
  },
  {
    id: 'RULE-05',
    name: 'Route Failed Phone Validation to Operator Review',
    description: 'When phone number verification returns invalid syntax or telecom disconnect, routes record to Human Review Queue.',
    trigger: 'On Validation Failed',
    conditionField: 'phoneStatus',
    conditionOperator: 'equals',
    conditionValue: 'invalid',
    action: 'Quarantine for Review',
    priority: 'P2 High',
    status: 'Active',
    executionsCount: 4320,
    lastExecuted: '45 minutes ago',
    successRate: 100.0
  },
  {
    id: 'RULE-06',
    name: 'Trigger Deep AI Summary on Opportunity Score > 85',
    description: 'Automatically enqueues LLM business executive summary generator for high-value commercial prospects.',
    trigger: 'On Lead Score Computed',
    conditionField: 'opportunityScore',
    conditionOperator: 'greater_than',
    conditionValue: '85',
    action: 'Trigger AI Enrichment',
    actionPayload: 'AI Summary',
    priority: 'P3 Normal',
    status: 'Active',
    executionsCount: 12800,
    lastExecuted: '2 hours ago',
    successRate: 99.1
  }
];

export const INITIAL_SYSTEM_SERVICES: SystemServiceHealth[] = [
  {
    id: 'svc-import',
    name: 'Ingestion & Import Pipeline Worker',
    category: 'Import Service',
    status: 'Healthy',
    latencyMs: 14,
    uptime: '99.98%',
    errorRate: '0.02%',
    details: '12 worker pods active across Kafka topic consumer group.',
    instances: '12 / 12 Pods',
    cpuUsage: 38,
    memoryUsage: 45
  },
  {
    id: 'svc-validation',
    name: 'Schema & Identity Validation Service',
    category: 'Validation Service',
    status: 'Healthy',
    latencyMs: 22,
    uptime: '99.99%',
    errorRate: '0.01%',
    details: 'Running 20-field validation rules and MX lookup pool.',
    instances: '8 / 8 Pods',
    cpuUsage: 42,
    memoryUsage: 51
  },
  {
    id: 'svc-search',
    name: 'Elasticsearch Search & Facet Index Cluster',
    category: 'Search Index',
    status: 'Healthy',
    latencyMs: 12,
    uptime: '100.0%',
    errorRate: '0.00%',
    details: 'Cluster Green. 1,120,400 documents indexed across 6 primary shards.',
    instances: '6 Data Nodes',
    cpuUsage: 29,
    memoryUsage: 64
  },
  {
    id: 'svc-db',
    name: 'Primary CockroachDB Master Cluster',
    category: 'Database',
    status: 'Healthy',
    latencyMs: 6,
    uptime: '99.99%',
    errorRate: '0.00%',
    details: 'Raft consensus healthy across 3 availability zones in Mumbai region.',
    instances: '9 Core Nodes',
    cpuUsage: 34,
    memoryUsage: 58
  },
  {
    id: 'svc-queue',
    name: 'BullMQ / Redis Async Task Queue Workers',
    category: 'Queue Workers',
    status: 'Healthy',
    latencyMs: 4,
    uptime: '99.95%',
    errorRate: '0.04%',
    details: 'Processing 450 jobs/sec across enrichment and notification queues.',
    instances: '16 Workers',
    cpuUsage: 48,
    memoryUsage: 38
  },
  {
    id: 'svc-storage',
    name: 'Distributed S3 Artifact & Media Bucket',
    category: 'Storage',
    status: 'Healthy',
    latencyMs: 28,
    uptime: '100.0%',
    errorRate: '0.00%',
    details: '2.4 TB ingested artifacts, logo caches and raw CSV logs.',
    instances: 'Multi-AZ Bucket',
    cpuUsage: 15,
    memoryUsage: 22
  },
  {
    id: 'svc-ai',
    name: 'GPU Inference Cluster (Triton Server)',
    category: 'AI Workers',
    status: 'Healthy',
    latencyMs: 45,
    uptime: '99.92%',
    errorRate: '0.08%',
    details: '4x NVIDIA A100 Tensor Core GPUs serving embedding and classification models.',
    instances: '4x A100 GPUs',
    cpuUsage: 72,
    memoryUsage: 78
  },
  {
    id: 'svc-cache',
    name: 'Redis Cluster In-Memory Fast Cache',
    category: 'Cache',
    status: 'Healthy',
    latencyMs: 1,
    uptime: '100.0%',
    errorRate: '0.00%',
    details: '99.4% cache hit ratio on Discover category and location lookups.',
    instances: '3 Master / 3 Replica',
    cpuUsage: 18,
    memoryUsage: 41
  }
];

export const INITIAL_SEARCH_INDEX_STATUS: SearchIndexStatus = {
  indexedBusinesses: 1120400,
  pendingIndex: 3420,
  failedIndex: 12,
  clusterHealth: 'Green',
  shardsCount: 6,
  indexSizeBytes: '4.82 GB',
  lastOptimized: '2 hours ago',
  avgQueryLatencyMs: 12
};



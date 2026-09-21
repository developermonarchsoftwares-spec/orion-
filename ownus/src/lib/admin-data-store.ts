'use client';

import { 
  AdminBusinessRecord, 
  ImportBatch, 
  DuplicatePair, 
  ValidationIssue 
} from '@/types/admin';
import { savePublishedBusinessesToStorage, mapAdminRecordToCustomerBusiness } from '@/lib/published-businesses-store';

export const ORION_ADMIN_DATA_EVENT = 'orion_admin_data_updated';

const STORAGE_KEYS = {
  RECORDS: 'orion_admin_records_v3',
  BATCHES: 'orion_admin_batches_v3',
  DUPLICATES: 'orion_admin_duplicates_v3',
  VALIDATIONS: 'orion_admin_validations_v3',
};

// Initial Seed Data Structured Across Workflow Stages
export const INITIAL_DEFAULT_RECORDS: AdminBusinessRecord[] = [
  // Published Stage (Visible on Published Businesses and Customer Discover Page)
  {
    id: 'BIZ-10001',
    name: 'Tata Consultancy Services',
    industry: 'Information Technology',
    subIndustry: 'IT Services & Consulting',
    category: 'IT Services & Consulting',
    businessType: 'Public Limited Company',
    msmeCategory: 'Medium Enterprise',
    address: '9th Floor Nirmal Building Nariman Point',
    state: 'Maharashtra',
    district: 'Mumbai',
    city: 'Mumbai',
    pincode: '400021',
    phone: '+912267789999',
    email: 'corporate.office@tcs.com',
    website: 'https://www.tcs.com',
    registrationDate: '1968-04-01',
    description: 'Global leader in IT services, digital and business solutions.',
    status: 'published',
    validationStatus: 'Approved',
    phoneStatus: 'valid',
    emailStatus: 'valid',
    websiteStatus: 'valid',
    validationScore: 98,
    opportunityScore: 98,
    dataQualityScore: 98,
    hasWebsite: true,
    missingFields: [],
    validationErrors: [],
    reviewer: 'Monarch Administrator',
    approvedDate: new Date().toISOString().split('T')[0],
    validationChecks: [],
    createdAt: '2024-01-15',
    updatedAt: new Date().toISOString().split('T')[0],
    importedBy: 'System Pipeline',
    tags: ['Information Technology', 'IT Services', 'Verified'],
  },
  {
    id: 'BIZ-10002',
    name: 'Infosys Limited',
    industry: 'Information Technology',
    subIndustry: 'Enterprise Software & AI',
    category: 'Enterprise Software & AI',
    businessType: 'Public Limited Company',
    msmeCategory: 'Medium Enterprise',
    address: 'Plot No 44 Electronics City Hosur Road',
    state: 'Karnataka',
    district: 'Bengaluru Urban',
    city: 'Bangalore',
    pincode: '560100',
    phone: '+918028520261',
    email: 'investors@infosys.com',
    website: 'https://www.infosys.com',
    registrationDate: '1981-07-02',
    description: 'Next-generation digital services and consulting.',
    status: 'published',
    validationStatus: 'Approved',
    phoneStatus: 'valid',
    emailStatus: 'valid',
    websiteStatus: 'valid',
    validationScore: 96,
    opportunityScore: 96,
    dataQualityScore: 96,
    hasWebsite: true,
    missingFields: [],
    validationErrors: [],
    reviewer: 'Monarch Administrator',
    approvedDate: new Date().toISOString().split('T')[0],
    validationChecks: [],
    createdAt: '2024-01-16',
    updatedAt: new Date().toISOString().split('T')[0],
    importedBy: 'System Pipeline',
    tags: ['Information Technology', 'Enterprise Software', 'Verified'],
  },
  {
    id: 'BIZ-10003',
    name: 'Wipro Limited',
    industry: 'Information Technology',
    subIndustry: 'Cloud & Business Transformation',
    category: 'Cloud & Business Transformation',
    businessType: 'Public Limited Company',
    msmeCategory: 'Medium Enterprise',
    address: 'Doddakannelli Sarjapur Road',
    state: 'Karnataka',
    district: 'Bengaluru Urban',
    city: 'Bangalore',
    pincode: '560035',
    phone: '+918028440011',
    email: 'info@wipro.com',
    website: 'https://www.wipro.com',
    registrationDate: '1945-12-29',
    description: 'Leading global information technology, consulting and business process services company.',
    status: 'published',
    validationStatus: 'Approved',
    phoneStatus: 'valid',
    emailStatus: 'valid',
    websiteStatus: 'valid',
    validationScore: 94,
    opportunityScore: 94,
    dataQualityScore: 94,
    hasWebsite: true,
    missingFields: [],
    validationErrors: [],
    reviewer: 'Monarch Administrator',
    approvedDate: new Date().toISOString().split('T')[0],
    validationChecks: [],
    createdAt: '2024-01-17',
    updatedAt: new Date().toISOString().split('T')[0],
    importedBy: 'System Pipeline',
    tags: ['Information Technology', 'Cloud Services', 'Verified'],
  },
  {
    id: 'BIZ-10004',
    name: 'HCL Technologies',
    industry: 'Information Technology',
    subIndustry: 'Digital Foundation & Engineering',
    category: 'Digital Foundation & Engineering',
    businessType: 'Public Limited Company',
    msmeCategory: 'Medium Enterprise',
    address: '806 Siddharth 96 Nehru Place',
    state: 'Delhi',
    district: 'South East Delhi',
    city: 'New Delhi',
    pincode: '110019',
    phone: '+911204013000',
    email: 'investors@hcl.com',
    website: 'https://www.hcltech.com',
    registrationDate: '1991-11-12',
    description: 'Global technology company helping enterprises reimagine their businesses.',
    status: 'published',
    validationStatus: 'Approved',
    phoneStatus: 'valid',
    emailStatus: 'valid',
    websiteStatus: 'valid',
    validationScore: 92,
    opportunityScore: 92,
    dataQualityScore: 92,
    hasWebsite: true,
    missingFields: [],
    validationErrors: [],
    reviewer: 'Monarch Administrator',
    approvedDate: new Date().toISOString().split('T')[0],
    validationChecks: [],
    createdAt: '2024-01-18',
    updatedAt: new Date().toISOString().split('T')[0],
    importedBy: 'System Pipeline',
    tags: ['Information Technology', 'Engineering', 'Verified'],
  },
  {
    id: 'BIZ-10005',
    name: 'Tech Mahindra',
    industry: 'Information Technology',
    subIndustry: 'Telecommunications & Enterprise IT',
    category: 'Telecommunications & Enterprise IT',
    businessType: 'Public Limited Company',
    msmeCategory: 'Medium Enterprise',
    address: 'Gateway Building Apollo Bunder',
    state: 'Maharashtra',
    district: 'Mumbai',
    city: 'Mumbai',
    pincode: '400001',
    phone: '+912066018100',
    email: 'investor.relations@techmahindra.com',
    website: 'https://www.techmahindra.com',
    registrationDate: '1986-10-24',
    description: 'Offering innovative and customer-centric digital experiences.',
    status: 'published',
    validationStatus: 'Approved',
    phoneStatus: 'valid',
    emailStatus: 'valid',
    websiteStatus: 'valid',
    validationScore: 90,
    opportunityScore: 90,
    dataQualityScore: 90,
    hasWebsite: true,
    missingFields: [],
    validationErrors: [],
    reviewer: 'Monarch Administrator',
    approvedDate: new Date().toISOString().split('T')[0],
    validationChecks: [],
    createdAt: '2024-01-19',
    updatedAt: new Date().toISOString().split('T')[0],
    importedBy: 'System Pipeline',
    tags: ['Information Technology', 'Telecommunications', 'Verified'],
  },

  // Publish Queue Stage (Approved & Validated, NOT YET PUBLISHED)
  {
    id: 'BIZ-QUE-001',
    name: 'Bharat Biotech International',
    industry: 'Healthcare & Lifesciences',
    subIndustry: 'Vaccine & Biopharmaceuticals',
    category: 'Biotechnology',
    businessType: 'Private Limited Company',
    msmeCategory: 'Medium Enterprise',
    address: 'Genome Valley Turkapally',
    state: 'Telangana',
    district: 'Hyderabad',
    city: 'Hyderabad',
    pincode: '500078',
    phone: '+914023480567',
    email: 'info@bharatbiotech.com',
    website: 'https://www.bharatbiotech.com',
    registrationDate: '1996-02-15',
    description: 'Pioneering biotechnology and vaccine innovation company.',
    status: 'approved',
    validationStatus: 'Approved',
    phoneStatus: 'valid',
    emailStatus: 'valid',
    websiteStatus: 'valid',
    validationScore: 95,
    opportunityScore: 94,
    dataQualityScore: 95,
    hasWebsite: true,
    missingFields: [],
    validationErrors: [],
    reviewer: 'Monarch Validator',
    approvedDate: new Date().toISOString().split('T')[0],
    validationChecks: [],
    createdAt: '2024-02-01',
    updatedAt: new Date().toISOString().split('T')[0],
    importedBy: 'Batch Ingestion',
    tags: ['Biotech', 'Healthcare', 'Queued'],
  },
  {
    id: 'BIZ-QUE-002',
    name: 'Adani Renewable Energy Systems',
    industry: 'Energy & Utilities',
    subIndustry: 'Solar & Clean Energy',
    category: 'Renewables',
    businessType: 'Public Limited Company',
    msmeCategory: 'Large Enterprise',
    address: 'Adani Corporate House Shantigram',
    state: 'Gujarat',
    district: 'Ahmedabad',
    city: 'Ahmedabad',
    pincode: '382421',
    phone: '+917926565555',
    email: 'contact@adanirenewables.com',
    website: 'https://www.adanigreenenergy.com',
    registrationDate: '2015-01-23',
    description: 'Leading clean energy infrastructure developer in India.',
    status: 'approved',
    validationStatus: 'Approved',
    phoneStatus: 'valid',
    emailStatus: 'valid',
    websiteStatus: 'valid',
    validationScore: 92,
    opportunityScore: 91,
    dataQualityScore: 92,
    hasWebsite: true,
    missingFields: [],
    validationErrors: [],
    reviewer: 'Monarch Validator',
    approvedDate: new Date().toISOString().split('T')[0],
    validationChecks: [],
    createdAt: '2024-02-02',
    updatedAt: new Date().toISOString().split('T')[0],
    importedBy: 'Batch Ingestion',
    tags: ['Renewable Energy', 'Solar', 'Queued'],
  },

  // Data Validation Stage (Pending Validation)
  {
    id: 'BIZ-VAL-001',
    name: 'GreenTech Manufacturing Systems',
    industry: 'Manufacturing & Industrial',
    subIndustry: 'Industrial Automation',
    category: 'Industrial Machinery',
    businessType: 'Private Limited Company',
    msmeCategory: 'Small Enterprise',
    address: 'Plot 45 Hadapsar Industrial Estate',
    state: 'Maharashtra',
    district: 'Pune',
    city: 'Pune',
    pincode: '411013',
    phone: '+912026871234',
    email: 'contact@greentechmfg.co.in',
    website: 'https://www.greentechmfg.co.in',
    registrationDate: '2018-06-11',
    description: 'Precision industrial machinery and green automation components.',
    status: 'draft',
    validationStatus: 'Pending',
    phoneStatus: 'valid',
    emailStatus: 'valid',
    websiteStatus: 'valid',
    validationScore: 78,
    opportunityScore: 75,
    dataQualityScore: 78,
    hasWebsite: true,
    missingFields: [],
    validationErrors: [],
    reviewer: 'Unassigned',
    validationChecks: [],
    createdAt: new Date().toISOString().split('T')[0],
    updatedAt: new Date().toISOString().split('T')[0],
    importedBy: 'CSV Import Pipeline',
    tags: ['Manufacturing', 'Validation Pending'],
  },
  {
    id: 'BIZ-VAL-002',
    name: 'Apex Logistics & Supply Chain',
    industry: 'Transportation & Logistics',
    subIndustry: 'Freight Forwarding',
    category: 'Logistics',
    businessType: 'Private Limited Company',
    msmeCategory: 'Micro Enterprise',
    address: '12 Gachibowli Main Road',
    state: 'Telangana',
    district: 'Hyderabad',
    city: 'Hyderabad',
    pincode: '500032',
    phone: '+914067890123',
    email: '',
    website: 'http://apexlogistics.in',
    registrationDate: '2021-03-19',
    description: 'End-to-end B2B freight transportation and warehousing solutions.',
    status: 'draft',
    validationStatus: 'Warning',
    phoneStatus: 'valid',
    emailStatus: 'missing',
    websiteStatus: 'warning',
    validationScore: 62,
    opportunityScore: 60,
    dataQualityScore: 62,
    hasWebsite: true,
    missingFields: ['Email Address'],
    validationErrors: ['Email field is empty'],
    reviewer: 'Unassigned',
    validationChecks: [],
    createdAt: new Date().toISOString().split('T')[0],
    updatedAt: new Date().toISOString().split('T')[0],
    importedBy: 'CSV Import Pipeline',
    tags: ['Logistics', 'Validation Warning'],
  }
];

export const INITIAL_DEFAULT_BATCHES: ImportBatch[] = [
  {
    id: 'IMP-9001',
    fileName: 'Q3_Enterprise_Ingestion_Batch.csv',
    fileSize: '4.2 MB',
    uploadedBy: 'Monarch Administrator',
    uploadedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
    status: 'Completed',
    totalRecords: 120,
    successCount: 110,
    failedCount: 2,
    duplicateCount: 8,
  },
];

export const INITIAL_DEFAULT_DUPLICATES: DuplicatePair[] = [
  {
    id: 'DUP-1001',
    original: INITIAL_DEFAULT_RECORDS[0], // TCS
    duplicate: {
      id: 'BIZ-DUP-991',
      name: 'TCS Software Services India',
      industry: 'Information Technology',
      subIndustry: 'IT Services & Consulting',
      category: 'IT Services & Consulting',
      businessType: 'Private Limited Company',
      address: 'Nariman Point 9th Floor',
      state: 'Maharashtra',
      district: 'Mumbai',
      city: 'Mumbai',
      pincode: '400021',
      phone: '+912267789999',
      email: 'corporate.office@tcs.com',
      website: 'https://www.tcs.com',
      status: 'draft',
      validationStatus: 'Pending',
      phoneStatus: 'valid',
      emailStatus: 'valid',
      websiteStatus: 'valid',
      validationScore: 88,
      opportunityScore: 88,
      dataQualityScore: 88,
      hasWebsite: true,
      missingFields: [],
      validationErrors: [],
      createdAt: new Date().toISOString().split('T')[0],
      updatedAt: new Date().toISOString().split('T')[0],
      importedBy: 'CSV Import Pipeline',
    },
    confidenceScore: 94,
    confidenceTier: 'Very High',
    matchReasons: ['Exact Phone (+912267789999), Exact Email & High Name Similarity (Levenshtein 94%)'],
    matchingFields: ['phone', 'email', 'pincode', 'city'],
    status: 'pending',
  },
  {
    id: 'DUP-1002',
    original: INITIAL_DEFAULT_RECORDS[1], // Infosys
    duplicate: {
      id: 'BIZ-DUP-992',
      name: 'Infosys Technologies BPO Services',
      industry: 'Information Technology',
      subIndustry: 'Enterprise Software & AI',
      category: 'Enterprise Software & AI',
      businessType: 'Private Limited Company',
      address: 'Electronics City Hosur Road',
      state: 'Karnataka',
      district: 'Bengaluru Urban',
      city: 'Bangalore',
      pincode: '560100',
      phone: '+918028520261',
      email: 'investors@infosys.com',
      website: 'https://www.infosys.com',
      status: 'draft',
      validationStatus: 'Pending',
      phoneStatus: 'valid',
      emailStatus: 'valid',
      websiteStatus: 'valid',
      validationScore: 90,
      opportunityScore: 90,
      dataQualityScore: 90,
      hasWebsite: true,
      missingFields: [],
      validationErrors: [],
      createdAt: new Date().toISOString().split('T')[0],
      updatedAt: new Date().toISOString().split('T')[0],
      importedBy: 'CSV Import Pipeline',
    },
    confidenceScore: 91,
    confidenceTier: 'Very High',
    matchReasons: ['Exact GSTIN, Domain Match & High Address Proximity'],
    matchingFields: ['gstin', 'website', 'pincode', 'city'],
    status: 'pending',
  }
];

// Persistence Helper Functions
export function loadAdminRecordsFromStorage(): AdminBusinessRecord[] {
  if (typeof window === 'undefined') return INITIAL_DEFAULT_RECORDS;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.RECORDS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Failed to load admin records from localStorage:', e);
  }
  return INITIAL_DEFAULT_RECORDS;
}

export function saveAdminRecordsToStorage(records: AdminBusinessRecord[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEYS.RECORDS, JSON.stringify(records));
    
    // Sync strictly PUBLISHED records to the Customer Discovery Page Store
    const publishedRecords = records
      .filter((r) => r.status === 'published')
      .map(mapAdminRecordToCustomerBusiness);

    savePublishedBusinessesToStorage(publishedRecords);

    // Sync to backend API asynchronously if available
    fetch('/api/v1/admin/businesses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businesses: records }),
    }).catch(() => {});
  } catch (e) {
    console.warn('Failed to save admin records to localStorage:', e);
  }
}

export function loadImportBatchesFromStorage(): ImportBatch[] {
  if (typeof window === 'undefined') return INITIAL_DEFAULT_BATCHES;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.BATCHES);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {}
  return INITIAL_DEFAULT_BATCHES;
}

export function saveImportBatchesToStorage(batches: ImportBatch[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEYS.BATCHES, JSON.stringify(batches));
  } catch (e) {}
}

export function loadDuplicatePairsFromStorage(): DuplicatePair[] {
  if (typeof window === 'undefined') return INITIAL_DEFAULT_DUPLICATES;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DUPLICATES);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {}
  return INITIAL_DEFAULT_DUPLICATES;
}

export function saveDuplicatePairsToStorage(duplicates: DuplicatePair[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEYS.DUPLICATES, JSON.stringify(duplicates));
  } catch (e) {}
}

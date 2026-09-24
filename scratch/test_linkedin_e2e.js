const { mapAdminRecordToCustomerBusiness } = require('../ownus/src/lib/published-businesses-store');
const { filterAdminBusinessRecord } = require('../ownus/src/lib/admin-filter-utils');

function runLinkedInE2ETest() {
  console.log("==========================================================================================");
  console.log("             LINKEDIN PLATFORM INTEGRATION E2E VERIFICATION SUITE                         ");
  console.log("==========================================================================================");

  let totalTests = 0;
  let passedTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`  [PASS] ${message}`);
    } else {
      console.error(`  [FAIL] ${message}`);
    }
  }

  // 1. Data Mapping Verification
  console.log("\n------------------------------------------------------------------------------------------");
  console.log("TEST 1: ADMIN RECORD TO CUSTOMER BUSINESS LINKEDIN MAPPING");
  console.log("------------------------------------------------------------------------------------------");

  const adminRecordWithLinkedIn = {
    id: 'test-biz-1',
    name: 'Tata Consultancy Services',
    industry: 'Information Technology',
    category: 'IT Services',
    city: 'Mumbai',
    state: 'Maharashtra',
    linkedin_url: 'https://www.linkedin.com/company/tata-consultancy-services',
    phone: '+912267789999',
    email: 'info@tcs.com',
    status: 'published'
  };

  const customerBiz = mapAdminRecordToCustomerBusiness(adminRecordWithLinkedIn);
  assert(customerBiz.linkedin === 'https://www.linkedin.com/company/tata-consultancy-services', "Mapped 'linkedin' correctly from 'linkedin_url'");
  assert(customerBiz.linkedInUrl === 'https://www.linkedin.com/company/tata-consultancy-services', "Mapped 'linkedInUrl' correctly from 'linkedin_url'");
  assert(customerBiz.hasLinkedIn === true, "Mapped 'hasLinkedIn' boolean flag as TRUE");
  assert(customerBiz.linkedinStatus === 'available', "Mapped 'linkedinStatus' as 'available'");

  const adminRecordNoLinkedIn = {
    id: 'test-biz-2',
    name: 'Local Store',
    industry: 'Retail',
    category: 'General',
    city: 'Chennai',
    state: 'Tamil Nadu',
    status: 'published'
  };
  const customerBiz2 = mapAdminRecordToCustomerBusiness(adminRecordNoLinkedIn);
  assert(customerBiz2.hasLinkedIn === false, "Mapped 'hasLinkedIn' boolean flag as FALSE when LinkedIn missing");
  assert(customerBiz2.linkedinStatus === 'not_available', "Mapped 'linkedinStatus' as 'not_available' when LinkedIn missing");

  // 2. Filter Evaluator Verification
  console.log("\n------------------------------------------------------------------------------------------");
  console.log("TEST 2: ADMIN FILTER EVALUATOR WITH HAS LINKEDIN FILTER");
  console.log("------------------------------------------------------------------------------------------");

  const initialFilterState = {
    state: '',
    districts: [],
    cities: [],
    pincode: '',
    businessNameQuery: '',
    industries: [],
    subIndustries: [],
    businessCategories: [],
    businessTypes: [],
    msmeCategories: [],
    agePreset: 'all',
    ageMaxMonths: 36,
    customDateStart: '',
    customDateEnd: '',
    contactAvailability: {
      hasWebsite: false,
      noWebsite: false,
      hasPhone: false,
      hasEmail: false,
      hasWhatsApp: false,
      hasLinkedIn: true
    },
    digitalPresence: {
      googleBusinessProfile: 'all',
      websiteAvailable: false,
      websiteMissing: false,
      socialMediaAvailable: false
    },
    businessStatus: {
      active: false,
      draft: false,
      validated: false,
      rejected: false,
      archived: false
    }
  };

  const passesWithLinkedIn = filterAdminBusinessRecord(adminRecordWithLinkedIn, initialFilterState);
  assert(passesWithLinkedIn === true, "Filter evaluator ACCEPTED record with valid LinkedIn URL when 'hasLinkedIn' filter enabled");

  const passesWithoutLinkedIn = filterAdminBusinessRecord(adminRecordNoLinkedIn, initialFilterState);
  assert(passesWithoutLinkedIn === false, "Filter evaluator REJECTED record without LinkedIn URL when 'hasLinkedIn' filter enabled");

  console.log("\n==========================================================================================");
  console.log(`               LINKEDIN INTEGRATION TEST COMPLETE: ${passedTests}/${totalTests} PASSED                     `);
  console.log("==========================================================================================");

  if (passedTests === totalTests) {
    console.log("\n>>> ALL LINKEDIN INTEGRATION MODULES VERIFIED (100% PASS) <<<");
  } else {
    process.exit(1);
  }
}

runLinkedInE2ETest();

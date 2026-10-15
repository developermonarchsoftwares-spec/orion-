// Demo data layer for the Orion showreel. The real Orion UI runs unmodified;
// only the network responses are replaced with clearly fictional demo records.
const day = 86400000;
const iso = (d) => new Date(Date.now() - d * day).toISOString().slice(0, 10);

const cos = [
  ['Nilgiri Precision Components Pvt Ltd', 'Coimbatore', 'Coimbatore', '641014', 'Private Limited', 9, 92, 'Arvind Menon', 'Managing Director'],
  ['Vaigai Industrial Automation LLP', 'Madurai', 'Madurai', '625002', 'LLP', 14, 88, 'Lakshmi Venkat', 'Designated Partner'],
  ['Kaveri Packaging Solutions Pvt Ltd', 'Tiruchirappalli', 'Tiruchirappalli', '620017', 'Private Limited', 18, 85, 'Rohit Chandran', 'Director'],
  ['Palar Engineering Works', 'Vellore', 'Vellore', '632001', 'Partnership', 21, 81, 'Sundar Rajan', 'Partner'],
  ['Marina Auto Components Pvt Ltd', 'Chennai', 'Chennai', '600032', 'Private Limited', 23, 79, 'Nisha Balakrishnan', 'Director'],
  ['Siruvani Cast Metals LLP', 'Coimbatore', 'Coimbatore', '641035', 'LLP', 26, 76, 'Kiran Paul', 'Designated Partner'],
  ['Hosur Fabrication Systems Pvt Ltd', 'Hosur', 'Krishnagiri', '635109', 'Private Limited', 27, 74, 'Deepa Iyer', 'Managing Director'],
  ['Tamirabarani Agro Machinery Pvt Ltd', 'Tirunelveli', 'Tirunelveli', '627001', 'Private Limited', 29, 72, 'Manoj Selvam', 'Director'],
];

const slug = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const unlocked = new Set();

export const businesses = cos.map(([name, city, district, pincode, type, age, score, dm, role], i) => ({
  id: `demo-${i + 1}`,
  slug: slug(name),
  name,
  legalName: name,
  industry: 'Manufacturing',
  city,
  district,
  state: 'Tamil Nadu',
  pincode,
  businessType: type,
  entityType: type,
  msmeCategory: i % 3 === 0 ? 'Small Enterprise' : 'Micro Enterprise',
  registrationDate: iso(age),
  businessAge: `${age} days`,
  foundingYear: new Date().getFullYear(),
  orionScore: score,
  opportunityScore: score,
  verified: true,
  isVerified: true,
  isUnlocked: false,
  contactAvailability: { hasPhone: true, hasEmail: true, hasWebsite: i % 2 === 0, hasLinkedIn: true },
  website: i % 2 === 0 ? `https://${slug(name).split('-').slice(0, 2).join('')}.example.in` : null,
  linkedin: null,
  hasLinkedIn: true,
  _dm: dm,
  _role: role,
}));

const decoy = [
  ['Bengaluru Cloud Systems Pvt Ltd', 'Bengaluru', 'Karnataka', 'Information Technology', 'Private Limited', 6, 90],
  ['Pune Logistics Hub LLP', 'Pune', 'Maharashtra', 'Logistics & Warehousing', 'LLP', 11, 84],
  ['Surat Textile Traders', 'Surat', 'Gujarat', 'Wholesale & Distribution', 'Partnership', 15, 78],
  ['Kochi Marine Services Pvt Ltd', 'Kochi', 'Kerala', 'Service Provider', 'Private Limited', 17, 77],
  ['Hyderabad Pharma Labs Pvt Ltd', 'Hyderabad', 'Telangana', 'Healthcare', 'Private Limited', 20, 83],
  ['Jaipur Handicraft Exports LLP', 'Jaipur', 'Rajasthan', 'Export Merchant', 'LLP', 25, 70],
].map(([name, city, state, industry, type, age, score], i) => ({ ...businesses[0], id: `demo-x${i}`, slug: slug(name), name, legalName: name, city, district: city, state, industry, businessType: type, entityType: type, registrationDate: iso(age), businessAge: `${age} days`, orionScore: score, opportunityScore: score, website: null }));

const searchResponse = (url) => {
  const u = new URL(url);
  const state = u.searchParams.get('state');
  const city = u.searchParams.get('city');
  const q = (u.searchParams.get('q') || '').toLowerCase();
  const industries = (u.searchParams.get('industries') || '').toLowerCase();
  const pool = [...businesses, ...decoy].sort((a, b) => b.orionScore - a.orionScore);
  let items = pool.filter((b) => (!state || b.state === state) && (!industries || industries.includes(b.industry.toLowerCase().split(' ')[0])) && (!city || b.city === city) && (!q || b.name.toLowerCase().includes(q)));
  items = items.map((b) => (unlocked.has(b.id) ? { ...b, isUnlocked: true, phone: '+91 90000 00000', email: `${(b._dm || 'contact').split(' ')[0].toLowerCase()}@example.in`, linkedin: 'https://linkedin.com/company/example' } : b));
  return { items, total: items.length, page: 1, limit: 20, totalPages: 1 };
};

const detail = (b) => ({
  ...b,
  industry: { id: 'ind-mfg', name: b.industry },
  isVerified: true,
  isUnlocked: unlocked.has(b.id),
  description: `${b.name} is a newly registered manufacturing company based in ${b.city}, ${b.state}. (Demo record.)`,
  employeeCountRange: null,
  annualRevenueRange: null,
  identifiers: [],
  locations: [{ id: 'l1', city: b.city, district: b.district, state: b.state, pincode: b.pincode, country: 'India', isPrimary: true, addressLine1: `Industrial Estate, ${b.city}` }],
  contacts: [{
    id: 'c1', fullName: b._dm, name: b._dm, designation: b._role, title: b._role, isPrimary: true, isDecisionMaker: true,
    phone: unlocked.has(b.id) ? '+91 90000 00000' : null, email: unlocked.has(b.id) ? `${b._dm.split(' ')[0].toLowerCase()}@example.in` : null,
    isPhoneVerified: true, isEmailVerified: true,
  }],
  digitalPresence: [...(b.website ? [{ platform: 'WEBSITE', url: b.website, domain: b.website.replace('https://', ''), isVerified: true }] : []), { platform: 'LINKEDIN', url: 'https://linkedin.com/company/example', isVerified: true }],
  metrics: { orionScore: b.orionScore, opportunityScore: b.orionScore, completenessScore: 92, verificationScore: 90, freshnessScore: 97 },
});

const person = (b, unl) => ({
  id: `p-${b.id}`, companyPersonId: `cp-${b.id}`, businessId: b.id, fullName: b._dm, jobTitle: b._role, additionalRoles: [],
  department: { key: 'executive', label: 'Executive' }, seniority: { key: 'c_level', label: 'C-level' },
  decisionMaker: { type: 'primary', label: 'Primary decision maker', assertion: 'KNOWN', claim: 'Named officer on registration' },
  isCurrent: true, startDate: iso(b.businessAge ? parseInt(b.businessAge) : 10), endDate: null,
  location: { city: b.city, state: b.state, country: 'India' },
  verification: { status: 'VERIFIED', assertion: 'KNOWN', lastVerifiedAt: new Date().toISOString(), confidence: { score: 90, level: 'HIGH' } },
  evidence: { count: 2, verifiedCount: 2, sourceTypes: ['registry'] },
  relevance: 'Registered officer',
  contacts: {
    isUnlocked: unl,
    email: { available: true, verificationStatus: 'VERIFIED', value: unl ? `${b._dm.split(' ')[0].toLowerCase()}@example.in` : null },
    phone: { available: true, verificationStatus: 'VERIFIED', value: unl ? '+91 90000 00000' : null },
    mobile: { available: false, verificationStatus: null, value: null },
    linkedin: { available: true, verificationStatus: 'PARTIALLY_VERIFIED', value: unl ? 'https://linkedin.com/in/example' : null },
  },
  isSaved: false, unlockCostCredits: 1,
});

const ok = (data) => ({ success: true, statusCode: 200, message: 'OK', data, timestamp: new Date().toISOString() });
const profile = {
  id: 'demo-user', email: 'demo@orion.example', firstName: 'Demo', lastName: 'User', name: 'Demo User', displayName: 'Demo User',
  role: 'USER', status: 'ACTIVE', organizationName: 'Demo Workspace', isEmailVerified: true, provider: 'EMAIL', hasPassword: true,
  wallet: { dailyCredits: 5, purchasedCredits: 20, balance: 25, lifetimePurchased: 20, lifetimeUsed: 0 },
};

export async function installDemoApi(page) {
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const url = req.url();
    const path = new URL(url).pathname.replace('/api/v1', '');
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(ok(data)) });

    if (path === '/user/profile' || path === '/auth/me') return json(profile);
    if (path === '/credit/wallet') return json(profile.wallet);
    if (path === '/discover/search') return json(searchResponse(url));
    let m = path.match(/^\/discover\/businesses\/([^/]+)\/related$/);
    if (m) return json(businesses.slice(0, 4));
    m = path.match(/^\/discover\/businesses\/([^/]+)$/);
    if (m) { const b = businesses.find((x) => x.slug === m[1] || x.id === m[1]); return b ? json(detail(b)) : json(null, 404); }
    if (path === '/unlock/business') {
      const { businessId } = JSON.parse(req.postData() || '{}');
      unlocked.add(businessId);
      profile.wallet.balance -= 1;
      return json({ success: true, message: 'Business unlocked successfully! Full contacts are now available.', balance: profile.wallet.balance, dailyCredits: 5, purchasedCredits: profile.wallet.balance - 5 });
    }
    m = path.match(/^\/companies\/([^/]+)\/people/) || path.match(/^\/people\/companies\/([^/]+)/) || path.match(/^\/businesses\/([^/]+)\/people/);
    if (m) {
      const b = businesses.find((x) => x.id === m[1] || x.slug === m[1]) || businesses[0];
      return json({ business: { id: b.id, slug: b.slug, name: b.name }, summary: { total: 1, decisionMakers: 1, verified: 1, withContact: 1 }, facets: { decisionMakerTypes: [], departments: [], seniority: [] }, people: [person(b, unlocked.has(b.id))], pagination: { page: 1, limit: 12, totalItems: 1, totalPages: 1 } });
    }
    if (path === '/people/taxonomy') return json({ departments: [], seniorityLevels: [], decisionMakerTypes: [], verificationStatuses: [], unlockCostCredits: 1 });
    if (path.startsWith('/discover/suggestions')) return json([]);
    console.log('[demo-api] unmocked', req.method(), path);
    return json(Array.isArray([]) ? {} : {});
  });
}

export const demoInit = () => {
  localStorage.setItem('orion_access_token', 'demo-access-token');
  localStorage.setItem('orion_refresh_token', 'demo-refresh-token');
  localStorage.setItem('orion_wallet', JSON.stringify({ dailyCredits: 5, purchasedCredits: 20, balance: 25, lifetimePurchased: 20, lifetimeUsed: 0 }));
};

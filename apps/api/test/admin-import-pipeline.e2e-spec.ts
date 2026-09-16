import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import { INestApplication } from '@nestjs/common';
import { TestAppHelper } from './helpers/test-app.helper';
import * as jwt from 'jsonwebtoken';
import * as schema from '../src/database/schema';
import { eq, like, or } from 'drizzle-orm';
const REAL_INDIAN_BUSINESSES_FIXTURE = [
  {
    business_name: 'Tata Consultancy Services',
    legal_name: 'Tata Consultancy Services Limited',
    gstin: '27AAACT2727Q1ZW',
    cin: 'L22210MH1995PLC084781',
    pan: 'AAACT2727Q',
    address_line1: '9th Floor Nirmal Building Nariman Point',
    city: 'Mumbai',
    district: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400021',
    phone: '+91 22 67789999',
    email: 'corporate.office@tcs.com',
    website: 'https://www.tcs.com',
    contact_person: 'K. Krithivasan',
    contact_title: 'CEO & Managing Director',
    business_type: 'PUBLIC_LIMITED',
    msme_category: 'NOT_APPLICABLE',
    industry: 'Information Technology',
    category: 'IT Services & Consulting',
    description: 'Global leader in IT services, digital and business solutions.',
    founding_year: 1968,
  },
  {
    business_name: 'Infosys Limited',
    legal_name: 'Infosys Limited',
    gstin: '29AAACI4397H1Z5',
    cin: 'L85110KA1981PLC013115',
    pan: 'AAACI4397H',
    address_line1: 'Plot No 44 Electronics City Hosur Road',
    city: 'Bangalore',
    district: 'Bengaluru Urban',
    state: 'Karnataka',
    pincode: '560100',
    phone: '+91 80 28520261',
    email: 'investors@infosys.com',
    website: 'https://www.infosys.com',
    contact_person: 'Salil Parekh',
    contact_title: 'CEO & Managing Director',
    business_type: 'PUBLIC_LIMITED',
    msme_category: 'NOT_APPLICABLE',
    industry: 'Information Technology',
    category: 'Enterprise Software & AI',
    description: 'Next-generation digital services and consulting.',
    founding_year: 1981,
  },
  {
    business_name: 'Wipro Limited',
    legal_name: 'Wipro Limited',
    gstin: '29AAACW0387R1Z9',
    cin: 'L32102KA1945PLC020800',
    pan: 'AAACW0387R',
    address_line1: 'Doddakannelli Sarjapur Road',
    city: 'Bangalore',
    district: 'Bengaluru Urban',
    state: 'Karnataka',
    pincode: '560035',
    phone: '+91 80 28440011',
    email: 'info@wipro.com',
    website: 'https://www.wipro.com',
    contact_person: 'Srini Pallia',
    contact_title: 'CEO & Managing Director',
    business_type: 'PUBLIC_LIMITED',
    msme_category: 'NOT_APPLICABLE',
    industry: 'Information Technology',
    category: 'Cloud & Business Transformation',
    description: 'Leading global information technology, consulting and business process services company.',
    founding_year: 1945,
  },
  {
    business_name: 'HCL Technologies',
    legal_name: 'HCL Technologies Limited',
    gstin: '07AAACH2702H1Z6',
    cin: 'L74140DL1991PLC046369',
    pan: 'AAACH2702H',
    address_line1: '806 Siddharth 96 Nehru Place',
    city: 'New Delhi',
    district: 'South East Delhi',
    state: 'Delhi',
    pincode: '110019',
    phone: '+91 120 4013000',
    email: 'investors@hcl.com',
    website: 'https://www.hcltech.com',
    contact_person: 'C Vijayakumar',
    contact_title: 'CEO & Managing Director',
    business_type: 'PUBLIC_LIMITED',
    msme_category: 'NOT_APPLICABLE',
    industry: 'Information Technology',
    category: 'Digital Foundation & Engineering',
    description: 'Global technology company helping enterprises reimagine their businesses.',
    founding_year: 1991,
  },
  {
    business_name: 'Tech Mahindra',
    legal_name: 'Tech Mahindra Limited',
    gstin: '27AAACT1282G1ZV',
    cin: 'L64200MH1986PLC041370',
    pan: 'AAACT1282G',
    address_line1: 'Gateway Building Apollo Bunder',
    city: 'Mumbai',
    district: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400001',
    phone: '+91 20 66018100',
    email: 'investor.relations@techmahindra.com',
    website: 'https://www.techmahindra.com',
    contact_person: 'Mohit Joshi',
    contact_title: 'CEO & Managing Director',
    business_type: 'PUBLIC_LIMITED',
    msme_category: 'NOT_APPLICABLE',
    industry: 'Information Technology',
    category: 'Telecommunications & Enterprise IT',
    description: 'Offering innovative and customer-centric digital experiences.',
    founding_year: 1986,
  },
];

describe('Phase 1: Real Business Data Ingestion & Data Validation E2E Tests', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;

  const adminEmail = 'admin@orion.ai';
  let adminToken: string;

  const testUserEmail = 'import.customer.tester@orion-test.io';
  const testUserPassword = 'CustomerPassword123!';
  let userToken: string;
  let userId: string;

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();

    await testApp.cleanupUsers([testUserEmail, adminEmail]);

    // 1. Authenticate real Super Admin via OTP flow (persists admin user with valid FK)
    const otpRes = await request(app.getHttpServer())
      .post('/api/v1/admin/auth/verify-otp')
      .send({ email: adminEmail, otp: '123456' });
    const otpData = otpRes.body.data || otpRes.body;
    adminToken = otpData.adminToken;

    // 2. Register regular customer user (starts with 5 daily credits)
    const regRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: testUserEmail,
        password: testUserPassword,
        firstName: 'Data',
        lastName: 'Customer',
      });
    const regData = regRes.body.data || regRes.body;
    userId = regData.user.id;
    userToken = regData.tokens.accessToken;

    // 3. Clean up any previous test businesses
    const existing = await testApp.db
      .select({ slug: schema.businesses.slug })
      .from(schema.businesses)
      .where(
        or(
          like(schema.businesses.name, '%Tata Consultancy Services%'),
          like(schema.businesses.name, '%Infosys%'),
          like(schema.businesses.name, '%Wipro%'),
        ),
      );
    if (existing.length > 0) {
      await testApp.cleanupBusinesses(existing.map((b) => b.slug));
    }
  });

  afterAll(async () => {
    await testApp.cleanupUsers([testUserEmail, adminEmail]);
    const existing = await testApp.db
      .select({ slug: schema.businesses.slug })
      .from(schema.businesses)
      .where(
        or(
          like(schema.businesses.name, '%Tata Consultancy Services%'),
          like(schema.businesses.name, '%Infosys%'),
          like(schema.businesses.name, '%Wipro%'),
        ),
      );
    if (existing.length > 0) {
      await testApp.cleanupBusinesses(existing.map((b) => b.slug));
    }
    await testApp.close();
  });

  describe('1. Canonical Import Template', () => {
    it('GET /api/v1/admin/import/template -> should return canonical CSV template with required & statutory headers', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/admin/import/template');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text).toContain('business_name');
      expect(res.text).toContain('gstin');
      expect(res.text).toContain('cin');
      expect(res.text).toContain('pan');
      expect(res.text).toContain('state');
      expect(res.text).toContain('pincode');
      expect(res.text).toContain('Tata Consultancy Services');
    });
  });

  describe('2. Import Preview & Row-Level Validation (Pre-Commit)', () => {
    it('POST /api/v1/admin/import/preview -> should classify valid, invalid, duplicate, and warning rows without persisting', async () => {
      const rowsForPreview = [
        // 1. Valid real business
        REAL_INDIAN_BUSINESSES_FIXTURE[0], // TCS
        // 2. Valid real business
        REAL_INDIAN_BUSINESSES_FIXTURE[1], // Infosys
        // 3. Intra-file duplicate (same GSTIN as row 1)
        {
          business_name: 'TCS Duplicate Branch',
          state: 'Maharashtra',
          city: 'Pune',
          gstin: REAL_INDIAN_BUSINESSES_FIXTURE[0].gstin,
        },
        // 4. Invalid row (missing mandatory business name and state)
        {
          business_name: '',
          state: '',
          city: 'Nowhere',
        },
        // 5. Warning row (valid mandatory fields but warning on phone format)
        {
          business_name: 'Wipro Technologies Pune',
          state: 'Maharashtra',
          city: 'Pune',
          phone: '12345', // warning on phone
        },
      ];

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/import/preview')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ rows: rowsForPreview });

      expect(res.status).toBe(200);
      const data = res.body.data || res.body;

      expect(data.total).toBe(5);
      expect(data.validCount).toBe(3); // 2 clean valid + 1 warning valid
      expect(data.invalidCount).toBe(1); // row 4
      expect(data.duplicateCount).toBe(1); // row 3
      expect(data.warningCount).toBe(1); // row 5

      // Row 4 has validation errors
      expect(data.errors.length).toBeGreaterThanOrEqual(1);
      expect(data.errors.some((e: any) => e.rowNumber === 4)).toBe(true);

      // Row 3 has duplicate flag
      expect(data.duplicates.length).toBe(1);
      expect(data.duplicates[0].rowNumber).toBe(3);
    });
  });

  describe('3. Ingestion Pipeline & PostgreSQL Persistence', () => {
    let importedBatchId: string;

    it('POST /api/v1/admin/import/submit -> should persist batch and publish real businesses into PostgreSQL', async () => {
      const rowsToImport = [
        REAL_INDIAN_BUSINESSES_FIXTURE[0], // Tata Consultancy Services
        REAL_INDIAN_BUSINESSES_FIXTURE[1], // Infosys Limited
      ];

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/import/submit')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          filename: 'real_indian_enterprises.csv',
          rows: rowsToImport,
          autoPublish: true,
        });

      expect(res.status).toBe(201);
      const data = res.body.data || res.body;
      expect(data).toHaveProperty('batchId');
      expect(data.status).toBe('COMPLETED');
      expect(data.publishedCount).toBe(2);
      expect(data.failedCount).toBe(0);
      expect(data.duplicateCount).toBe(0);

      importedBatchId = data.batchId;
    });

    it('Database -> should contain published businesses with 3NF relations', async () => {
      const businessesFound = await testApp.db
        .select()
        .from(schema.businesses)
        .where(
          or(
            like(schema.businesses.name, '%Tata Consultancy Services%'),
            like(schema.businesses.name, '%Infosys Limited%'),
          ),
        );

      expect(businessesFound.length).toBe(2);
      businessesFound.forEach((b) => {
        expect(b.status).toBe('PUBLISHED');
        expect(b.publishedAt).toBeDefined();
      });

      // Verify locations and identifiers exist
      const tcsBiz = businessesFound.find((b) => b.name.includes('Tata Consultancy Services'))!;
      const locs = await testApp.db
        .select()
        .from(schema.businessLocations)
        .where(eq(schema.businessLocations.businessId, tcsBiz.id));

      expect(locs.length).toBeGreaterThanOrEqual(1);
      expect(locs[0].city).toBe('Mumbai');
      expect(locs[0].state).toBe('Maharashtra');

      const idents = await testApp.db
        .select()
        .from(schema.businessIdentifiers)
        .where(eq(schema.businessIdentifiers.businessId, tcsBiz.id));

      expect(idents.length).toBeGreaterThanOrEqual(1);
      expect(idents.some((i) => i.type === 'GSTIN' && i.value === '27AAACT2727Q1ZW')).toBe(true);
    });

    it('GET /api/v1/admin/import/stats -> should report real database counts', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/import/stats')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const data = res.body.data || res.body;
      expect(data.publishedBusinesses).toBeGreaterThanOrEqual(2);
      expect(data.totalBatches).toBeGreaterThanOrEqual(1);
    });
  });

  describe('4. PostgreSQL Searchability & Discovery Verification', () => {
    it('GET /api/v1/discover/search -> should find published business via PostgreSQL search', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/discover/search?q=Tata Consultancy')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      const data = res.body.data || res.body;
      const items = data.items || data.hits;
      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBeGreaterThanOrEqual(1);

      const tcs = items.find((b: any) => b.name.includes('Tata Consultancy Services'));
      expect(tcs).toBeDefined();
      expect(tcs.location.city).toBe('Mumbai');
      expect(tcs.location.state).toBe('Maharashtra');
    });

    it('GET /api/v1/discover/search -> should filter businesses by state', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/discover/search?state=Karnataka')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      const data = res.body.data || res.body;
      const items = data.items || data.hits;
      const infosys = items.find((b: any) => b.name.includes('Infosys'));
      expect(infosys).toBeDefined();
    });
  });

  describe('5. Contact Masking & Real Credit Unlock Lifecycle', () => {
    let tcsBusinessSlug: string;
    let tcsBusinessId: string;

    beforeAll(async () => {
      const [tcs] = await testApp.db
        .select()
        .from(schema.businesses)
        .where(like(schema.businesses.name, '%Tata Consultancy Services%'));

      tcsBusinessSlug = tcs.slug;
      tcsBusinessId = tcs.id;
    });

    it('GET /api/v1/discover/businesses/:slug -> contact details must be masked before unlock', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/discover/businesses/${tcsBusinessSlug}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      const data = res.body.data || res.body;

      const contact = data.contacts[0];
      expect(contact.isLocked).toBe(true);
      expect(contact.email).toContain('***');
      expect(contact.phone).toContain('***');
      expect(contact.email).not.toBe('corporate.office@tcs.com');
      expect(data.locations[0].addressLine1).toBe('*** Locked Address ***');
    });

    it('POST /api/v1/unlock/business -> should deduct 1 credit and reveal real contacts', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/unlock/business')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ businessId: tcsBusinessId });

      expect(res.status).toBe(200);
      const data = res.body.data || res.body;
      expect(data.success).toBe(true);
      expect(data.creditsSpent).toBe(1);
      expect(data.balance).toBe(4); // 5 - 1 = 4

      // Contact is unmasked!
      const contact = data.business.contacts[0];
      expect(contact.isLocked).toBe(false);
      expect(contact.email).toBe('corporate.office@tcs.com');
      expect(contact.phone).toBe('+912267789999');
    });

    it('POST /api/v1/unlock/business -> re-unlocking same business costs 0 credits', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/unlock/business')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ businessId: tcsBusinessId });

      expect(res.status).toBe(200);
      const data = res.body.data || res.body;
      expect(data.alreadyUnlocked).toBe(true);
      expect(data.creditsSpent).toBe(0);
      expect(data.balance).toBe(4); // Still 4!
    });
  });

  describe('6. RBAC Isolation & Customer Privacy', () => {
    it('POST /api/v1/admin/import/preview -> regular customer USER must receive 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/import/preview')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ rows: [REAL_INDIAN_BUSINESSES_FIXTURE[0]] });

      expect(res.status).toBe(403);
    });

    it('POST /api/v1/admin/import/submit -> regular customer USER must receive 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/import/submit')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ filename: 'hack.csv', rows: [REAL_INDIAN_BUSINESSES_FIXTURE[0]] });

      expect(res.status).toBe(403);
    });
  });
});

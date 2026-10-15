import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import * as jwt from 'jsonwebtoken';
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { inArray, like } from 'drizzle-orm';
import { TestAppHelper } from './helpers/test-app.helper';
import { createApprovedSource } from './helpers/approved-source';
import { TEST_SECRETS } from './helpers/test-secrets';
import * as schema from '../src/database/schema';

/**
 * Phase 8, end to end: hostile URLs in imported data never become stored links, and webhook targets that point inside the network (or
 * at non-web ports) are refused when saved. No outbound request is made by this suite.
 */
describe('SSRF and ingestion: URLs from imports and from customers', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const unwrap = (res: any) => res.body.data || res.body;
  const stamp = Date.now();
  const tag = `Ssrf${stamp}`;
  const admin = { Authorization: '' };
  const emails: string[] = [];
  const adminEmail = 'qa.ssrf.admin@monarchsoftwares.com';

  // clearly different names: near-identical ones are (correctly) merged by the duplicate detector
  const WORDS = ['Zephyr Textiles', 'Quantum Forge Works', 'Blue Lotus Agro', 'Granite Peak Mining', 'Saffron Route Logistics', 'Orchid Medical Devices', 'Monsoon Brewing', 'Delta Harbour Shipping', 'Ivory Tower Publishing', 'Copper Kettle Foods'];
  const nameOf = (n: number) => `${WORDS[n]} ${tag}`;
  const baseRow = (n: number, extra: Record<string, unknown>) => ({
    business_name: nameOf(n),
    legal_name: `${nameOf(n)} Limited`,
    address_line1: `${n} Industrial Estate`,
    city: 'Pune',
    district: 'Pune',
    state: 'Maharashtra',
    pincode: '411001',
    phone: `+91 98765 4${String(1000 + n).padStart(4, '0')}`,
    email: `contact${n}.${stamp}@company${n}-${stamp}.example`,
    contact_person: 'Test Person',
    contact_title: 'Director',
    business_type: 'PRIVATE_LIMITED',
    industry: 'Information Technology',
    category: 'IT Services & Consulting',
    ...extra,
  });

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();
    await testApp.cleanupUsers([adminEmail]);
    const adminId = await testApp.provisionAdmin(adminEmail, 'SUPER_ADMIN');
    admin.Authorization = `Bearer ${jwt.sign({ sub: adminId, email: adminEmail, role: 'SUPER_ADMIN', status: 'ACTIVE' }, TEST_SECRETS.jwtAccess, { expiresIn: '1h', issuer: 'orion-api', audience: 'orion-client' })}`;
  });
  beforeEach(() => (app.get(ThrottlerStorage) as any).storage.clear());
  afterAll(async () => {
    const found = await testApp.db.select({ id: schema.businesses.id, slug: schema.businesses.slug }).from(schema.businesses).where(like(schema.businesses.name, `%${tag}`));
    await testApp.cleanupBusinesses(found.map((b) => b.slug));
    await testApp.cleanupUsers([...emails, adminEmail]);
    await testApp.close();
  });

  describe('imported website and LinkedIn values', () => {
    const hostile = [
      { website: 'javascript:alert(document.cookie)', linkedin: 'javascript:alert(1)' },
      { website: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==', linkedin: 'https://evil.example/in/someone' },
      { website: 'http://169.254.169.254/latest/meta-data/', linkedin: 'file:///etc/passwd' },
      { website: 'https://admin:hunter2@acme-portal.example', linkedin: 'https://linkedin.com.evil.example/in/x' },
      { website: 'http://127.0.0.1:8080/admin', linkedin: 'ftp://linkedin.com/in/x' },
    ];

    it('the preview reports each unusable URL as a warning and does not fail the row', async () => {
      const rows = hostile.map((h, i) => baseRow(i, h));
      const res = await api().post('/api/v1/admin/import/preview').set(admin).send({ rows });
      expect(res.status).toBe(200);
      const text = JSON.stringify(unwrap(res));
      expect(text).toContain('was not stored'); // each unusable URL is called out for the admin
      expect(unwrap(res).warningCount).toBe(hostile.length);
      expect(unwrap(res).invalidCount).toBe(0); // and none of the rows is failed for it
    });

    it('submitting them stores none of the hostile values; a clean website in the same file is stored', async () => {
      const rows = [...hostile.map((h, i) => baseRow(i, h)), baseRow(9, { website: 'https://www.clean-company.example/about', linkedin: 'https://www.linkedin.com/company/clean-company' })];
      const res = await api().post('/api/v1/admin/import/submit').set(admin).send({ filename: 'ssrf-probe.csv', rows, autoPublish: true, sourceId: await createApprovedSource(testApp.db) });
      expect(res.status).toBe(201);
      expect(unwrap(res).failedCount).toBe(0); // a bad link is a warning, not a failure
      expect(unwrap(res).duplicateCount).toBe(0);

      const businesses = await testApp.db.select().from(schema.businesses).where(like(schema.businesses.name, `%${tag}`));
      expect(businesses.length).toBe(6);
      const presences = await testApp.db.select().from(schema.digitalPresences).where(inArray(schema.digitalPresences.businessId, businesses.map((b) => b.id)));

      const urls = presences.map((p) => p.url);
      for (const url of urls) {
        expect(url).toMatch(/^https?:\/\//);
        expect(url).not.toMatch(/javascript:|data:|file:|ftp:|169\.254|127\.0\.0\.1|@|hunter2|evil\.example/i);
      }
      const clean = businesses.find((b) => b.name.includes(WORDS[9]))!;
      const cleanPresences = presences.filter((p) => p.businessId === clean.id);
      expect(cleanPresences.map((p) => p.platform).sort()).toEqual(['LINKEDIN', 'WEBSITE']);
      expect(cleanPresences.find((p) => p.platform === 'WEBSITE')!.url).toBe('https://www.clean-company.example/about');
      // the hostile rows still exist as businesses (they flow through the normal review path) but carry no link
      for (const b of businesses.filter((x) => !x.name.includes(WORDS[9]))) {
        expect(presences.filter((p) => p.businessId === b.id)).toEqual([]);
      }
    });
  });

  describe('webhook targets saved by customers', () => {
    let auth: { Authorization: string };
    const create = (targetUrl: string) => api().post('/api/v1/integrations').set(auth).send({ type: 'WEBHOOK', name: 'probe', targetUrl, events: ['lead.unlocked'] });

    beforeAll(async () => {
      const email = `ssrf.user.${stamp}@orion-test.io`;
      emails.push(email);
      const res = unwrap(await api().post('/api/v1/auth/register').send({ email, password: 'SsrfPass123!', firstName: 'Ss', lastName: 'Rf' }));
      auth = { Authorization: `Bearer ${res.tokens.accessToken}` };
    });

    it('refuses addresses that point inside the network, in every spelling, and ports of non-web services', async () => {
      const refused = [
        'https://[0:0:0:0:0:0:0:1]/hook', 'https://[::ffff:7f00:1]/hook', 'https://[::7f00:1]/hook', 'https://[2002:7f00:1::]/hook', 'https://[2002:a9fe:a9fe::1]/hook',
        'https://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/hook', 'https://[fec0::1]/hook', 'https://[64:ff9b:1::1]/hook',
        'https://2130706433/hook', 'https://0x7f000001/hook', 'https://017700000001/hook', 'https://167772161/hook', 'https://2852039166/latest/meta-data/',
        'https://169.254.169.254/latest/meta-data/', 'https://192.88.99.1/hook',
        'https://8.8.8.8:22/hook', 'https://8.8.8.8:6379/hook', 'https://8.8.8.8:3306/hook', 'https://8.8.8.8:9200/hook', 'https://8.8.8.8:25/hook',
        'http://8.8.8.8/hook', 'ftp://8.8.8.8/hook', 'file:///etc/passwd', 'gopher://8.8.8.8:70/_x', 'https://user:pw@8.8.8.8/hook',
      ];
      for (const url of refused) {
        const res = await create(url);
        expect({ url, status: res.status }).toEqual({ url, status: 400 });
        expect(JSON.stringify(res.body)).not.toMatch(/stack|ECONN|getaddrinfo/i);
        clearThrottle();
      }
      const list = unwrap(await api().get('/api/v1/integrations').set(auth));
      expect(JSON.stringify(list)).not.toContain('169.254');
      expect(Array.isArray(list) ? list : list.items ?? []).toHaveLength(0); // nothing was stored
    });

    it('accepts a public address on an ordinary webhook port (control: the rules are not over-broad)', async () => {
      for (const url of ['https://8.8.8.8/hook', 'https://8.8.8.8:8443/hook', 'https://[2606:4700:4700::1111]/hook']) {
        const res = await create(url);
        expect({ url, status: res.status }).toEqual({ url, status: 201 });
        clearThrottle();
      }
    });

    it('an existing integration cannot be edited to point at an internal address', async () => {
      const created = unwrap(await create('https://8.8.4.4/hook'));
      clearThrottle();
      for (const url of ['https://[::1]/x', 'https://8.8.4.4:5432/x', 'https://169.254.169.254/x']) {
        const res = await api().patch(`/api/v1/integrations/${created.id}`).set(auth).send({ targetUrl: url });
        expect({ url, status: res.status }).toEqual({ url, status: 400 });
      }
    });

    function clearThrottle() {
      (app.get(ThrottlerStorage) as any).storage.clear();
    }
  });
});

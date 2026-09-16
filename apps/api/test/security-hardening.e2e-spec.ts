import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import { INestApplication } from '@nestjs/common';
import { TestAppHelper } from './helpers/test-app.helper';
import * as schema from '../src/database/schema';
import { eq } from 'drizzle-orm';
import { CsvSecurityUtil } from '../src/common/utils/csv-security.util';

describe('Enterprise Security Hardening & Data Protection E2E Tests', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;

  const userAEmail = 'user.a.sec@orion.ai';
  const userBEmail = 'user.b.sec@orion.ai';
  const adminEmail = 'super.admin.sec@orion.ai';

  let userAToken: string;
  let userBToken: string;
  let adminToken: string;
  let userAId: string;
  let userBId: string;

  let testBusinessId: string;
  let unpublishedBusinessId: string;

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();

    await testApp.cleanupUsers([userAEmail, userBEmail, adminEmail]);

    // 1. Register User A
    const resA = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: userAEmail,
        password: 'Password123!',
        firstName: 'Alice',
        lastName: 'Auditor',
      });
    userAToken = resA.body.data.tokens.accessToken;
    userAId = resA.body.data.user.id;

    // 2. Register User B
    const resB = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: userBEmail,
        password: 'Password123!',
        firstName: 'Bob',
        lastName: 'Bystander',
      });
    userBToken = resB.body.data.tokens.accessToken;
    userBId = resB.body.data.user.id;

    // 3. Authenticate Admin via hardened OTP flow
    await request(app.getHttpServer())
      .post('/api/v1/admin/auth/send-otp')
      .send({ email: adminEmail });

    const resAdmin = await request(app.getHttpServer())
      .post('/api/v1/admin/auth/verify-otp')
      .send({ email: adminEmail, otp: '123456' });
    adminToken = resAdmin.body.data.adminToken;

    // 4. Ensure a published test business exists with contact & address
    const existingBiz = await testApp.db.query.businesses.findFirst({
      where: eq(schema.businesses.status, 'PUBLISHED'),
    });

    if (existingBiz) {
      testBusinessId = existingBiz.id;
    } else {
      const [newBiz] = await testApp.db
        .insert(schema.businesses)
        .values({
          name: 'Secure Enterprise Systems Pvt Ltd',
          slug: 'secure-enterprise-systems',
          legalName: 'Secure Enterprise Systems Private Limited',
          status: 'PUBLISHED',
        })
        .returning();
      testBusinessId = newBiz.id;

      await testApp.db.insert(schema.businessContacts).values({
        businessId: testBusinessId,
        fullName: 'Chief Security Officer',
        email: 'cso@securesystems.in',
        phone: '+91 98765 43210',
        isPrimary: true,
      });

      await testApp.db.insert(schema.businessLocations).values({
        businessId: testBusinessId,
        addressLine1: '404 Fortress Way, Cyber City',
        city: 'Bengaluru',
        district: 'Bengaluru Urban',
        state: 'Karnataka',
        pincode: '560103',
        country: 'India',
        isPrimary: true,
      });
    }

    // 5. Create an unpublished draft business
    const [draftBiz] = await testApp.db
      .insert(schema.businesses)
      .values({
        name: 'Unpublished Secret Ventures',
        slug: 'unpublished-secret-ventures',
        legalName: 'Unpublished Secret Ventures Ltd',
        status: 'DRAFT',
      })
      .returning();
    unpublishedBusinessId = draftBiz.id;
  });

  afterAll(async () => {
    if (unpublishedBusinessId) {
      await testApp.db.delete(schema.businesses).where(eq(schema.businesses.id, unpublishedBusinessId));
    }
    await testApp.cleanupUsers([userAEmail, userBEmail, adminEmail]);
    await testApp.close();
  });

  // ================= 1. RBAC & PRIVILEGE ESCALATION =================
  describe('1. RBAC & Privilege Escalation Defenses', () => {
    it('Normal user calling admin endpoint should receive 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/credit/admin/packages')
        .set('Authorization', `Bearer ${userAToken}`);

      expect(res.status).toBe(403);
    });

    it('Normal user calling admin batch imports should receive 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/import/batches')
        .set('Authorization', `Bearer ${userAToken}`);

      expect(res.status).toBe(403);
    });

    it('Unauthenticated caller to protected endpoints should receive 401 Unauthorized', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/saved-leads');
      expect(res.status).toBe(401);
    });

    it('Super Admin calling admin endpoint should succeed with 200 OK', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/credit/admin/packages')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });
  });

  // ================= 2. IDOR / BOLA PROTECTION =================
  describe('2. IDOR / BOLA Resource Isolation', () => {
    let userALeadId: string;
    let userASearchId: string;

    it('User A creates saved lead and saved search', async () => {
      // Save lead
      const leadRes = await request(app.getHttpServer())
        .post('/api/v1/saved-leads')
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          businessId: testBusinessId,
          notes: 'User A confidential prospect notes',
          pipelineStage: 'QUALIFIED',
        });
      expect(leadRes.status).toBe(201);
      userALeadId = leadRes.body.data?.id || leadRes.body.id;

      // Save search
      const searchRes = await request(app.getHttpServer())
        .post('/api/v1/saved-searches')
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          name: 'User A High Tech Search',
          filters: { state: 'Karnataka' },
        });
      expect(searchRes.status).toBe(201);
      userASearchId = searchRes.body.data?.id || searchRes.body.id;
    });

    it('User B attempting to patch User A saved lead should receive 404 Not Found', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/saved-leads/${userALeadId}`)
        .set('Authorization', `Bearer ${userBToken}`)
        .send({ notes: 'Hacked by User B' });

      expect(res.status).toBe(404);
    });

    it('User B attempting to delete User A saved lead should receive 404 Not Found', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/saved-leads/${userALeadId}`)
        .set('Authorization', `Bearer ${userBToken}`);

      expect(res.status).toBe(404);
    });

    it('User B attempting to view User A saved search should receive 404 Not Found', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/saved-searches/${userASearchId}`)
        .set('Authorization', `Bearer ${userBToken}`);

      expect(res.status).toBe(404);
    });

    it('User B attempting to delete User A saved search should receive 404 Not Found', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/saved-searches/${userASearchId}`)
        .set('Authorization', `Bearer ${userBToken}`);

      expect(res.status).toBe(404);
    });
  });

  // ================= 3. BUSINESS ID ENUMERATION DEFENSE =================
  describe('3. Business Enumeration & Publication State', () => {
    it('Normal user querying unpublished/draft business ID should receive 404 Not Found', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/businesses/${unpublishedBusinessId}`)
        .set('Authorization', `Bearer ${userAToken}`);

      expect(res.status).toBe(404);
    });

    it('Anonymous user querying unpublished/draft business ID should receive 404 Not Found', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/businesses/${unpublishedBusinessId}`);

      expect(res.status).toBe(404);
    });

    it('Admin querying unpublished business ID should be authorized to review it', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/businesses/${unpublishedBusinessId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });
  });

  // ================= 4. CONTACT DATA PROTECTION & MASKING =================
  describe('4. Contact Data Protection & Backend Masking', () => {
    it('Locked business profile must return masked email, phone, and address without raw exfiltration', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/businesses/${testBusinessId}`)
        .set('Authorization', `Bearer ${userBToken}`);

      expect(res.status).toBe(200);
      const data = res.body.data || res.body;
      expect(data.isUnlocked).toBe(false);

      // Verify contacts are strictly masked
      if (data.contacts && data.contacts.length > 0) {
        data.contacts.forEach((contact: any) => {
          if (contact.email) {
            expect(contact.email).toContain('***');
            expect(contact.email).not.toBe('cso@securesystems.in');
          }
          if (contact.phone) {
            expect(contact.phone).toContain('***');
            expect(contact.phone).not.toBe('+91 98765 43210');
          }
          expect(contact.isLocked).toBe(true);
        });
      }

      // Verify physical address is masked
      if (data.locations && data.locations.length > 0) {
        expect(data.locations[0].addressLine1).toContain('Locked Address');
      }
    });
  });

  // ================= 5. CONCURRENT UNLOCK & RACE CONDITION =================
  describe('5. Concurrency & Race Condition Guard on Unlock', () => {
    it('Concurrent unlock requests must not double-deduct credits or throw 500 error', async () => {
      // Execute 2 concurrent unlock calls for the same business
      const [res1, res2] = await Promise.all([
        request(app.getHttpServer())
          .post('/api/v1/unlock/business')
          .set('Authorization', `Bearer ${userAToken}`)
          .send({ businessId: testBusinessId }),
        request(app.getHttpServer())
          .post('/api/v1/unlock/business')
          .set('Authorization', `Bearer ${userAToken}`)
          .send({ businessId: testBusinessId }),
      ]);

      expect([200, 201]).toContain(res1.status);
      expect([200, 201]).toContain(res2.status);

      const data1 = res1.body.data || res1.body;
      const data2 = res2.body.data || res2.body;

      // Exactly one request should perform the deduction, the other must report alreadyUnlocked
      const wasDeductedCount = (data1.alreadyUnlocked ? 0 : 1) + (data2.alreadyUnlocked ? 0 : 1);
      expect(wasDeductedCount).toBe(1);
    });
  });

  // ================= 6. PAYMENT IDEMPOTENCY & REPLAY PROTECTION =================
  describe('6. Payment Idempotency & Replay Attack Defense', () => {
    it('Verifying an identical payment ID multiple times must not double-credit wallet', async () => {
      // 1. Get packages to find a valid package
      const pkgRes = await request(app.getHttpServer()).get('/api/v1/credit/packages');
      const packages = pkgRes.body.data || pkgRes.body;
      const starterPkg = packages[0];

      const duplicatePaymentId = `pay_replay_test_${Date.now()}`;
      const duplicateOrderId = `order_replay_test_${Date.now()}`;

      // Mock verify payment: first call will fail signature check, proving validation
      const resSigFail = await request(app.getHttpServer())
        .post('/api/v1/payments/verify')
        .set('Authorization', `Bearer ${userBToken}`)
        .send({
          packageId: starterPkg.id,
          razorpayOrderId: duplicateOrderId,
          razorpayPaymentId: duplicatePaymentId,
          razorpaySignature: 'invalid_tampered_signature',
        });

      expect(resSigFail.status).toBe(400);
      expect(resSigFail.body.errorCode).toBe('PAYMENT_VERIFICATION_FAILED');

      // Now manually insert a completed transaction to simulate a verified payment
      const [wallet] = await testApp.db
        .select()
        .from(schema.userWallets)
        .where(eq(schema.userWallets.userId, userBId));

      await testApp.db.insert(schema.creditTransactions).values({
        walletId: wallet.id,
        userId: userBId,
        amount: starterPkg.credits,
        balanceAfter: wallet.balance + starterPkg.credits,
        type: 'PACKAGE_PURCHASE',
        description: `Purchased ${starterPkg.name}`,
        referenceId: duplicatePaymentId,
      });

      // Attempt replay attack with the same payment ID
      const replayRes = await request(app.getHttpServer())
        .post('/api/v1/payments/verify')
        .set('Authorization', `Bearer ${userBToken}`)
        .send({
          packageId: starterPkg.id,
          razorpayOrderId: duplicateOrderId,
          razorpayPaymentId: duplicatePaymentId,
          razorpaySignature: 'any_signature',
        });

      expect(replayRes.status).toBe(200);
      const replayData = replayRes.body.data || replayRes.body;
      expect(replayData.alreadyProcessed).toBe(true);
    });
  });

  // ================= 7. API KEY SECURITY LIFECYCLE =================
  describe('7. API Key Security & Hashing Lifecycle', () => {
    let generatedKeyId: string;
    let plaintextSecret: string;
    let keyPrefix: string;

    it('POST /settings/api-keys -> should generate secure API key with one-time plaintext reveal', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/settings/api-keys')
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          name: 'Production Lead Scraper Key',
          scopes: ['read', 'search'],
          expiresInDays: 30,
        });

      expect(res.status).toBe(201);
      const data = res.body.data || res.body;
      expect(data).toHaveProperty('id');
      expect(data).toHaveProperty('key');
      expect(data.key).toMatch(/^orn_live_[a-zA-Z0-9]+$/);
      expect(data.keyPrefix).toMatch(/^orn_live_/);

      generatedKeyId = data.id;
      plaintextSecret = data.key;
      keyPrefix = data.keyPrefix;

      // Verify in DB that only the hash is stored, never plaintext
      const dbKey = await testApp.db.query.apiKeys.findFirst({
        where: eq(schema.apiKeys.id, generatedKeyId),
      });

      expect(dbKey).toBeDefined();
      expect(dbKey?.keyHash).toBeDefined();
      expect(dbKey?.keyHash).not.toBe(plaintextSecret);
      expect(dbKey?.keyHash.length).toBe(64); // SHA-256 hex length
    });

    it('GET /settings/api-keys -> should list API keys without exposing plaintext secret or hash', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/settings/api-keys')
        .set('Authorization', `Bearer ${userAToken}`);

      expect(res.status).toBe(200);
      const list = res.body.data || res.body;
      expect(Array.isArray(list)).toBe(true);

      const matched = list.find((k: any) => k.id === generatedKeyId);
      expect(matched).toBeDefined();
      expect(matched.keyPrefix).toBe(keyPrefix);
      expect(matched.key).toBeUndefined();
      expect(matched.keyHash).toBeUndefined();
    });

    it('User B attempting to revoke User A API key should receive 404 Not Found', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/settings/api-keys/${generatedKeyId}`)
        .set('Authorization', `Bearer ${userBToken}`);

      expect(res.status).toBe(404);
    });

    it('User A revokes their API key -> status should become inactive', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/settings/api-keys/${generatedKeyId}`)
        .set('Authorization', `Bearer ${userAToken}`);

      expect(res.status).toBe(200);

      const dbKey = await testApp.db.query.apiKeys.findFirst({
        where: eq(schema.apiKeys.id, generatedKeyId),
      });
      expect(dbKey?.isActive).toBe(false);
    });
  });

  // ================= 8. SPREADSHEET FORMULA INJECTION DEFENSE =================
  describe('8. Spreadsheet Formula Injection Protection', () => {
    it('CsvSecurityUtil should prepend single quote to cells beginning with =, +, -, @', () => {
      expect(CsvSecurityUtil.sanitizeCell("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
      expect(CsvSecurityUtil.sanitizeCell('+123456789')).toBe("'+123456789");
      expect(CsvSecurityUtil.sanitizeCell('-100')).toBe("'-100");
      expect(CsvSecurityUtil.sanitizeCell('@SUM(1,2)')).toBe("'@SUM(1,2)");
      expect(CsvSecurityUtil.sanitizeCell('Normal Text')).toBe('Normal Text');
    });

    it('CsvSecurityUtil should format safe CSV rows with quotes escaped', () => {
      const row = ['Acme Corp', '=SUM(A1:B1)', 'Regular Info'];
      const formatted = CsvSecurityUtil.formatCsvRow(row);
      expect(formatted).toBe('"Acme Corp","\'=SUM(A1:B1)","Regular Info"');
    });
  });

  // ================= 9. IMPORT BATCH SIZE PROTECTION =================
  describe('9. Import Pipeline DoS & Size Limiting', () => {
    it('Import preview with > 5000 records should be rejected with 400 Bad Request', async () => {
      const hugeBatch = new Array(5001).fill({ name: 'Bulk Co' });

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/import/preview')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ rows: hugeBatch });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('5,000');
    });
  });
});

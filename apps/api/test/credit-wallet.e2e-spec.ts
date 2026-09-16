import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import { INestApplication } from '@nestjs/common';
import { TestAppHelper } from './helpers/test-app.helper';
import * as jwt from 'jsonwebtoken';

describe('Sprint 16: Credit & Wallet E2E Tests (Jest + Supertest)', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;

  const testUserEmail = 'credits.e2e.tester@orion-test.io';
  const testUserPassword = 'CreditPassword123!';
  let testUserId: string;
  let userToken: string;

  const adminEmail = 'admin@orion.ai';
  let adminToken: string;

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();

    await testApp.cleanupUsers([testUserEmail]);

    // 1. Register test user
    const regRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: testUserEmail,
        password: testUserPassword,
        firstName: 'Credit',
        lastName: 'Tester',
      });
    const regData = regRes.body.data || regRes.body;
    testUserId = regData.user.id;
    userToken = regData.tokens.accessToken;

    // 2. Create admin token
    adminToken = jwt.sign(
      {
        sub: '00000000-0000-0000-0000-000000000001',
        email: adminEmail,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
      },
      process.env.JWT_ACCESS_SECRET || 'orion_super_secret_access_jwt_key_2026_change_in_production',
      { expiresIn: '1h', issuer: 'orion-api', audience: 'orion-client' },
    );
  });

  afterAll(async () => {
    await testApp.cleanupUsers([testUserEmail]);
    await testApp.close();
  });

  describe('1. Wallet Initialization & Retrieval', () => {
    it('GET /api/v1/credit/wallet -> should return user wallet with initial 5 daily credits', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/credit/wallet')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      const data = res.body.data || res.body;
      expect(data).toHaveProperty('balance');
      expect(data.balance).toBe(5);
      expect(data.dailyCredits).toBe(5);
      expect(data.purchasedCredits).toBe(0);
      expect(data.lifetimePurchased).toBe(0);
      expect(data.lifetimeUsed).toBe(0);
    });

    it('GET /api/v1/credit/wallet -> should reject unauthenticated call with 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/credit/wallet');
      expect(res.status).toBe(401);
    });
  });

  describe('2. Public Credit Packages & Pricing Config', () => {
    it('GET /api/v1/credit/packages -> should return active packages without authentication', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/credit/packages');

      expect(res.status).toBe(200);
      const data = res.body.data || res.body;
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThanOrEqual(1);

      const pkg = data[0];
      expect(pkg).toHaveProperty('slug');
      expect(pkg).toHaveProperty('name');
      expect(pkg).toHaveProperty('credits');
      expect(pkg).toHaveProperty('isActive', true);
    });

    it('GET /api/v1/credit/config -> should return pricing settings', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/credit/config');

      expect(res.status).toBe(200);
      const data = res.body.data || res.body;
      expect(data).toHaveProperty('dailyFreeCredits');
      expect(data.dailyFreeCredits).toBe(5);
      expect(data).toHaveProperty('annualDiscountPercentage');
      expect(data).toHaveProperty('defaultCurrency');
    });
  });

  describe('3. Credit Transactions Ledger', () => {
    it('GET /api/v1/credit/transactions -> should return transaction history for user', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/credit/transactions')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      const data = res.body.data || res.body;
      const items = Array.isArray(data) ? data : data.items;
      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBeGreaterThanOrEqual(1);

      const tx = items[0];
      expect(tx).toHaveProperty('amount', 5);
      expect(tx).toHaveProperty('type', 'DAILY_ALLOCATION');
      expect(tx).toHaveProperty('balanceAfter', 5);
    });
  });

  describe('4. Role-Based Authorization Guards on Admin Routes', () => {
    it('GET /api/v1/credit/admin/packages -> should reject regular USER with 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/credit/admin/packages')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('POST /api/v1/credit/admin/adjust -> should reject regular USER with 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/credit/admin/adjust')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          userId: testUserId,
          dailyDelta: 0,
          purchasedDelta: 50,
          reason: 'Unauthorized attempt',
        });

      expect(res.status).toBe(403);
    });

    it('POST /api/v1/credit/admin/adjust -> should allow SUPER_ADMIN to adjust credits', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/credit/admin/adjust')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: testUserId,
          dailyDelta: 0,
          purchasedDelta: 25,
          reason: 'QA Test Credit Grant',
        });

      expect(res.status).toBe(201);

      // Verify wallet reflects updated balance
      const walletRes = await request(app.getHttpServer())
        .get('/api/v1/credit/wallet')
        .set('Authorization', `Bearer ${userToken}`);

      expect(walletRes.status).toBe(200);
      const walletData = walletRes.body.data || walletRes.body;
      expect(walletData.purchasedCredits).toBe(25);
      expect(walletData.balance).toBe(30); // 5 daily + 25 purchased
    });
  });
});

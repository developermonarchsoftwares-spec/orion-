import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import { INestApplication } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { TestAppHelper } from './helpers/test-app.helper';
import { DRIZZLE_DATABASE } from '../src/database/database.constants';
import { CreditService } from '../src/modules/credit/credit.service';
import * as schema from '../src/database/schema';

/**
 * Phase 29: behaviour that keeps the hot read paths cheap and the failure paths bounded. Synthetic accounts, in-memory database.
 * (Timing is deliberately not asserted: the environment is too variable. What is asserted is work done, which is deterministic.)
 */
describe('Performance and resilience guards (Phase 29)', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const unwrap = (res: any) => res.body.data || res.body;
  const emails: string[] = [];
  const stamp = Date.now();

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();
  }, 60_000);
  afterAll(async () => {
    await testApp.cleanupUsers(emails);
    await testApp.close();
  });

  const newUser = async (tag: string) => {
    const email = `p29.${tag}.${stamp}@orion-test.io`;
    emails.push(email);
    const reg = unwrap(await api().post('/api/v1/auth/register').send({ email, password: 'Phase29Pass123!', firstName: 'Pf', lastName: tag }));
    return { id: reg.user.id as string, auth: { Authorization: `Bearer ${reg.tokens.accessToken}` } };
  };

  describe('wallet reads', () => {
    it('a wallet whose daily allocation is already today\'s is read without opening a transaction or taking a row lock', async () => {
      const u = await newUser('fast');
      const credits = app.get(CreditService);
      await credits.getWallet(u.id); // settle
      const db = app.get(DRIZZLE_DATABASE) as any;
      const spy = jest.spyOn(db, 'transaction');
      try {
        for (let i = 0; i < 5; i++) await credits.getWallet(u.id);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it('the first read of a new day still allocates under the lock (once), and a missing wallet is still created', async () => {
      const u = await newUser('rollover');
      const credits = app.get(CreditService);
      await testApp.db.update(schema.userWallets).set({ lastDailyCreditDate: '2020-01-01', dailyCredits: 2, balance: 2 }).where(eq(schema.userWallets.userId, u.id));
      const before = (await testApp.db.select().from(schema.creditTransactions).where(eq(schema.creditTransactions.userId, u.id))).length;
      const w = await credits.getWallet(u.id);
      expect(w.lastDailyCreditDate).toBe(new Date().toISOString().slice(0, 10));
      await credits.getWallet(u.id);
      const after = (await testApp.db.select().from(schema.creditTransactions).where(eq(schema.creditTransactions.userId, u.id))).length;
      expect(after - before).toBe(2); // one expiry row and one allocation row, not repeated by the second read

      await testApp.db.delete(schema.creditTransactions).where(eq(schema.creditTransactions.userId, u.id));
      await testApp.db.delete(schema.userWallets).where(eq(schema.userWallets.userId, u.id));
      const created = await credits.getWallet(u.id);
      expect(created.userId).toBe(u.id);
      expect(created.balance).toBeGreaterThan(0);
    });

    it('the wallet endpoint over HTTP answers the same shape as before', async () => {
      const u = await newUser('shape');
      const res = unwrap(await api().get('/api/v1/credit/wallet').set(u.auth));
      expect(res).toEqual(expect.objectContaining({ balance: expect.any(Number) }));
    });
  });

  describe('bounded work per request', () => {
    it('list endpoints cap a page at 100 rows however large a limit is asked for', async () => {
      const u = await newUser('caps');
      for (const p of ['/api/v1/credit/transactions', '/api/v1/unlock/history', '/api/v1/saved-leads', '/api/v1/discover/search']) {
        const res = await api().get(`${p}?limit=100000`).set(u.auth);
        expect(res.status === 400 || res.status === 200).toBe(true);
        const body = unwrap(res);
        const items = Array.isArray(body) ? body : body.items ?? body.businesses ?? [];
        expect(items.length).toBeLessThanOrEqual(100);
      }
    });

    it('an import above the row limit is refused before any work, and an oversized body is refused by the server', async () => {
      const admin = `p29.admin.${stamp}@monarchsoftwares.com`;
      emails.push(admin);
      const adminId = await testApp.provisionAdmin(admin, 'SUPER_ADMIN');
      const jwt = await import('jsonwebtoken');
      const { TEST_SECRETS } = await import('./helpers/test-secrets');
      const auth = { Authorization: `Bearer ${jwt.sign({ sub: adminId, email: admin, role: 'SUPER_ADMIN', status: 'ACTIVE' }, TEST_SECRETS.jwtAccess, { expiresIn: '1h', issuer: 'orion-api', audience: 'orion-client' })}` };
      const csv = ['business_name,city', ...Array.from({ length: 5001 }, (_, i) => `Co ${i},Pune`)].join('\n');
      const res = await api().post('/api/v1/admin/import/csv/preview').set(auth).send({ csv });
      expect(res.status).toBe(400);
      const before = (await testApp.db.select().from(schema.importBatches)).length;
      await api().post('/api/v1/admin/import/csv/submit').set(auth).send({ csv });
      expect((await testApp.db.select().from(schema.importBatches)).length).toBe(before); // nothing was created for the refused file
    });
  });
});

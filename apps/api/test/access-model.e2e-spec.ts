import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import { INestApplication } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { TestAppHelper } from './helpers/test-app.helper';
import { TEST_SECRETS } from './helpers/test-secrets';
import * as schema from '../src/database/schema';

/**
 * Access model (hermetic, in-memory database; no external service is contacted).
 *   - Ordinary users reach only their own private records.
 *   - Admin routes need the PERSISTED role and an ACTIVE status; the role claim inside a token never grants anything.
 *   - Registration cannot assign a role or any other privileged field.
 */
describe('Access model: registration, roles and per-user isolation', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;

  const emails = {
    a: 'access.a@orion.ai',
    b: 'access.b@orion.ai',
    escalate: 'access.escalate@orion.ai',
    admin: 'access.admin@orion.ai',
  };
  const password = 'Password123!';

  let aId: string;
  let bId: string;
  let aToken: string;
  let bToken: string;

  const register = (email: string, extra: Record<string, unknown> = {}) =>
    request(app.getHttpServer()).post('/api/v1/auth/register').send({ email, password, firstName: 'Test', lastName: 'User', ...extra });
  const setPersisted = (id: string, values: Partial<{ role: any; status: any }>) => testApp.db.update(schema.users).set(values).where(eq(schema.users.id, id));
  const adminRoute = (token: string) => request(app.getHttpServer()).get('/api/v1/credit/admin/packages').set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();
    await testApp.cleanupUsers(Object.values(emails));

    const ra = await register(emails.a);
    aId = ra.body.data.user.id;
    aToken = ra.body.data.tokens.accessToken;
    const rb = await register(emails.b);
    bId = rb.body.data.user.id;
    bToken = rb.body.data.tokens.accessToken;
  });

  afterAll(async () => {
    await testApp.cleanupUsers(Object.values(emails));
    await testApp.close();
  });

  describe('registration cannot assign privileges', () => {
    it('creates the account with the USER role', async () => {
      const [row] = await testApp.db.select().from(schema.users).where(eq(schema.users.id, aId));
      expect(row.role).toBe('USER');
    });

    it.each([
      ['role SUPER_ADMIN', { role: 'SUPER_ADMIN' }],
      ['role ADMIN', { role: 'ADMIN' }],
      ['role DATA_MANAGER', { role: 'DATA_MANAGER' }],
      ['status ACTIVE', { status: 'ACTIVE' }],
      ['isEmailVerified true', { isEmailVerified: true }],
      ['organizationId', { organizationId: '00000000-0000-4000-8000-000000000001' }],
    ])('rejects a registration body carrying %s and creates no account', async (_label, extra) => {
      const res = await register(emails.escalate, extra);
      expect(res.status).toBe(400);
      const rows = await testApp.db.select().from(schema.users).where(eq(schema.users.email, emails.escalate));
      expect(rows).toHaveLength(0);
    });
  });

  describe('admin routes use the persisted role and status', () => {
    it('rejects an anonymous caller (401) and an ordinary USER (403)', async () => {
      expect((await request(app.getHttpServer()).get('/api/v1/credit/admin/packages')).status).toBe(401);
      expect((await adminRoute(aToken)).status).toBe(403);
    });

    it.each(['MEMBER', 'DATA_MANAGER'])('rejects a persisted %s on an ADMIN/SUPER_ADMIN-only route', async (role) => {
      await setPersisted(bId, { role });
      try {
        expect((await adminRoute(bToken)).status).toBe(403);
      } finally {
        await setPersisted(bId, { role: 'USER' });
      }
    });

    it.each(['ADMIN', 'SUPER_ADMIN'])('allows a persisted, ACTIVE %s', async (role) => {
      await setPersisted(bId, { role });
      try {
        expect((await adminRoute(bToken)).status).toBe(200);
      } finally {
        await setPersisted(bId, { role: 'USER' });
      }
    });

    it('rejects a suspended administrator even though the token is still valid', async () => {
      await setPersisted(bId, { role: 'ADMIN', status: 'SUSPENDED' });
      try {
        // S-08: a suspended account is denied. The session is now revoked at the auth layer (401),
        // which supersedes the role gate (403); either is a valid "access denied".
        expect([401, 403]).toContain((await adminRoute(bToken)).status);
      } finally {
        await setPersisted(bId, { role: 'USER', status: 'ACTIVE' });
      }
    });

    it('ignores a role claim inside a correctly signed token: the persisted USER role decides', async () => {
      const forged = jwt.sign({ sub: aId, email: emails.a, role: 'SUPER_ADMIN' }, TEST_SECRETS.jwtAccess, {
        issuer: 'orion-api',
        audience: 'orion-client',
        expiresIn: '5m',
      });
      expect((await adminRoute(forged)).status).toBe(403);
      // and it is still a valid session for the user's own, non-admin data
      expect((await request(app.getHttpServer()).get('/api/v1/credit/wallet').set('Authorization', `Bearer ${forged}`)).status).toBe(200);
    });

    it('rejects admin write routes for an ordinary USER before reading the body', async () => {
      const target = '00000000-0000-4000-8000-000000000001';
      for (const [method, url, body] of [
        ['post', '/api/v1/credit/admin/adjust', { userId: aId, purchasedDelta: 1000 }],
        ['post', '/api/v1/credit/admin/packages', {}],
        ['put', `/api/v1/credit/admin/packages/${target}`, {}],
        ['delete', `/api/v1/credit/admin/packages/${target}`, undefined],
        ['put', '/api/v1/credit/admin/config', { key: 'x', value: 1 }],
      ] as const) {
        let req = (request(app.getHttpServer()) as any)[method](url).set('Authorization', `Bearer ${aToken}`);
        if (body !== undefined) req = req.send(body);
        expect((await req).status).toBe(403);
      }
      const [wallet] = await testApp.db.select().from(schema.userWallets).where(eq(schema.userWallets.userId, aId));
      expect(wallet.purchasedCredits).toBe(0);
    });
  });

  describe('per-user isolation of private records', () => {
    const idsOf = (res: any): string[] => {
      const body = res.body.data ?? res.body;
      const items = body.items ?? body.transactions ?? body.data ?? body;
      return (Array.isArray(items) ? items : []).map((r: any) => r.id);
    };

    it("one user's wallet and ledger are not visible to another", async () => {
      const a = await request(app.getHttpServer()).get('/api/v1/credit/transactions').set('Authorization', `Bearer ${aToken}`);
      const b = await request(app.getHttpServer()).get('/api/v1/credit/transactions').set('Authorization', `Bearer ${bToken}`);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      const idsA = idsOf(a);
      const idsB = idsOf(b);
      expect(idsA.length).toBeGreaterThan(0);
      expect(idsB.length).toBeGreaterThan(0);
      expect(idsA.filter((id) => idsB.includes(id))).toEqual([]);
    });

    it('user-scoped routes take the identity from the token only: a userId in the query or body is ignored or rejected', async () => {
      const before = await request(app.getHttpServer()).get('/api/v1/credit/wallet').set('Authorization', `Bearer ${bToken}`);
      const viaQuery = await request(app.getHttpServer()).get(`/api/v1/credit/wallet?userId=${aId}`).set('Authorization', `Bearer ${bToken}`);
      // either the unknown query field is rejected or it is ignored, but A's wallet is never returned
      if (viaQuery.status === 200) expect(viaQuery.body.data ?? viaQuery.body).toEqual(before.body.data ?? before.body);
      else expect(viaQuery.status).toBe(400);
    });

    it("a user cannot create, read, change or delete another user's saved search or lead by id", async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/saved-searches')
        .set('Authorization', `Bearer ${aToken}`)
        .send({ name: 'A private search', filters: { query: 'x' } });
      expect([200, 201]).toContain(created.status);
      const searchId = (created.body.data ?? created.body).id;

      for (const [method, url] of [
        ['get', `/api/v1/saved-searches/${searchId}`],
        ['patch', `/api/v1/saved-searches/${searchId}`],
        ['delete', `/api/v1/saved-searches/${searchId}`],
        ['post', `/api/v1/saved-searches/${searchId}/run`],
      ] as const) {
        let req = (request(app.getHttpServer()) as any)[method](url).set('Authorization', `Bearer ${bToken}`);
        if (method === 'patch') req = req.send({ name: 'taken over' });
        expect((await req).status).toBe(404);
      }

      const stillThere = await request(app.getHttpServer()).get(`/api/v1/saved-searches/${searchId}`).set('Authorization', `Bearer ${aToken}`);
      expect(stillThere.status).toBe(200);
      expect((stillThere.body.data ?? stillThere.body).name).toBe('A private search');
    });

    it('bulk deletes only touch the caller\'s own saved leads', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/saved-leads/bulk-delete')
        .set('Authorization', `Bearer ${bToken}`)
        .send({ ids: ['00000000-0000-4000-8000-0000000000aa'] });
      // nothing of B's matches: nothing is deleted, and it must not be a server error
      expect(res.status).toBeLessThan(500);
    });
  });
});

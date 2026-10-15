import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { eq } from 'drizzle-orm';
import { TestAppHelper } from './helpers/test-app.helper';
import * as schema from '../src/database/schema';

/**
 * Phase 25: privileged sessions. An administrator access token must be revocable like a customer one: logging out ends it, a newer
 * administrator sign-in supersedes it, a suspended or demoted administrator loses access at once, and a token cannot carry a role the
 * account does not hold. Synthetic accounts only; the OTP flow uses the fixed test code the test environment allows.
 */
describe('Administrator sessions (Phase 25)', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const unwrap = (res: any) => res.body.data || res.body;
  const adminEmail = `qa.p25.${Date.now()}@monarchsoftwares.com`;
  const customerEmails: string[] = [];
  let adminId = '';

  const adminLogin = async () => {
    (app.get(ThrottlerStorage) as any).storage.clear();
    const send = await api().post('/api/v1/admin/auth/send-otp').send({ email: adminEmail });
    expect(send.status).toBe(200);
    const res = await api().post('/api/v1/admin/auth/verify-otp').send({ email: adminEmail, otp: '123456' });
    expect(res.status).toBe(200);
    return unwrap(res).adminToken as string;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const probe = (t: string) => api().get('/api/v1/monitoring/alerts').set(bearer(t));
  const audits = async (action: string) => (await testApp.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, action))) as any[];

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();
    await testApp.cleanupUsers([adminEmail]);
    adminId = await testApp.provisionAdmin(adminEmail, 'ADMIN');
  });
  beforeEach(() => {
    (app.get(ThrottlerStorage) as any).storage.clear();
  });
  afterAll(async () => {
    await testApp.cleanupUsers([adminEmail, ...customerEmails]);
    await testApp.close();
  });

  it('an administrator token works, and is rejected without it', async () => {
    const t = await adminLogin();
    expect((await probe(t)).status).toBe(200);
    expect((await api().get('/api/v1/monitoring/alerts')).status).toBe(401);
  });

  it('logging out ends the session: the same token no longer works on any privileged route', async () => {
    const t = await adminLogin();
    expect((await probe(t)).status).toBe(200);
    const out = await api().post('/api/v1/admin/auth/logout').set(bearer(t));
    expect(out.status).toBe(200);
    const after = await probe(t);
    expect(after.status).toBe(401);
    expect((await api().get('/api/v1/admin/import/batches').set(bearer(t))).status).toBe(401);
  });

  it('a newer administrator sign-in supersedes the older session', async () => {
    const first = await adminLogin();
    const second = await adminLogin();
    expect((await probe(second)).status).toBe(200);
    const old = await probe(first);
    expect(old.status).toBe(401);
  });

  it('logout and sign-in are audited, without a token or code in the record', async () => {
    const t = await adminLogin();
    await api().post('/api/v1/admin/auth/logout').set(bearer(t));
    const rows = [...(await audits('ADMIN_LOGIN_SUCCESS')), ...(await audits('ADMIN_LOGOUT'))].filter((r) => r.userId === adminId);
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(['ADMIN_LOGIN_SUCCESS', 'ADMIN_LOGOUT']));
    const text = JSON.stringify(rows);
    expect(text).not.toContain(t);
    expect(text).not.toContain('123456');
  });

  it('logging out with no token, or with a forged token, revokes nothing and reveals nothing', async () => {
    const t = await adminLogin();
    expect((await api().post('/api/v1/admin/auth/logout')).status).toBe(200);
    expect((await api().post('/api/v1/admin/auth/logout').set(bearer('not.a.token'))).status).toBeLessThan(500);
    expect((await probe(t)).status).toBe(200); // the real session is untouched
  });

  it('a suspended administrator loses access on the very next request, and regains it only when reactivated', async () => {
    const t = await adminLogin();
    await testApp.db.update(schema.users).set({ status: 'SUSPENDED' }).where(eq(schema.users.id, adminId));
    expect((await probe(t)).status).toBe(401);
    await testApp.db.update(schema.users).set({ status: 'ACTIVE' }).where(eq(schema.users.id, adminId));
    expect((await probe(t)).status).toBe(200);
  });

  it('a demoted administrator loses privileged routes at once even though the token still says ADMIN', async () => {
    const t = await adminLogin();
    await testApp.db.update(schema.users).set({ role: 'USER' }).where(eq(schema.users.id, adminId));
    expect((await probe(t)).status).toBe(403);
    await testApp.db.update(schema.users).set({ role: 'ADMIN' }).where(eq(schema.users.id, adminId));
  });

  it('a customer cannot use a customer token to sign in as an administrator, and cannot obtain an administrator token', async () => {
    const email = `p25.cust.${Date.now()}@orion-test.io`;
    customerEmails.push(email);
    const reg = unwrap(await api().post('/api/v1/auth/register').send({ email, password: 'Phase25Pass123!', firstName: 'Cu', lastName: 'St' }));
    const auth = bearer(reg.tokens.accessToken);
    expect((await probe(reg.tokens.accessToken)).status).toBe(403);
    expect((await api().post('/api/v1/admin/auth/send-otp').send({ email })).status).toBe(403); // wrong domain
    // client-controlled role fields are refused on every self-service write
    for (const body of [{ role: 'ADMIN' }, { role: 'SUPER_ADMIN', status: 'ACTIVE' }]) {
      expect((await api().patch('/api/v1/user/profile').set(auth).send(body)).status).toBe(400);
    }
    const settings = await api().patch('/api/v1/user/settings').set(auth).send({ role: 'ADMIN', activeSessionId: 'x' });
    expect([200, 400]).toContain(settings.status);
    const me = unwrap(await api().get('/api/v1/user/me').set(auth));
    expect(me.role ?? me.user?.role).toBe('USER');
  });
});

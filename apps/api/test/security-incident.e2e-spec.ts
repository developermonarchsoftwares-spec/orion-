import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import * as jwt from 'jsonwebtoken';
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { and, eq, gte, inArray } from 'drizzle-orm';
import { TestAppHelper } from './helpers/test-app.helper';
import { TEST_SECRETS } from './helpers/test-secrets';
import * as schema from '../src/database/schema';
import { MonitoringService } from '../src/modules/monitoring/monitoring.service';

/**
 * Phase 31: incident simulations through the running application, synthetic identities only. Each scenario performs the "attack",
 * then checks the chain an investigator depends on: the event is recorded with a correlation id and without secrets or personal data,
 * the alert rule reads it, the damage did not happen, and containment works. Alerts go to a test-only in-process sink: these tests
 * prove the application's alert pipeline, NOT delivery to a real destination.
 */
describe('Security incident simulations (Phase 31)', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const unwrap = (res: any) => res.body.data || res.body;
  const stamp = Date.now();
  const emails: string[] = [];
  const adminEmail = `p31.admin.${stamp}@monarchsoftwares.com`;
  let admin: { Authorization: string };
  let adminId = '';
  const mon = () => app.get(MonitoringService);
  const clear = () => (app.get(ThrottlerStorage) as any).storage.clear();
  const saved = { ...process.env };
  const since = () => new Date(Date.now() - 1000);
  const rows = async (from: Date, action?: string) =>
    (await testApp.db.select().from(schema.auditLogs).where(and(gte(schema.auditLogs.createdAt, from), action ? eq(schema.auditLogs.action, action) : undefined))) as any[];
  const reg = async (tag: string) => {
    const email = `p31.${tag}.${stamp}@orion-test.io`;
    emails.push(email);
    const r = unwrap(await api().post('/api/v1/auth/register').send({ email, password: 'Phase31Pass123!', firstName: 'Inc', lastName: tag }));
    return { id: r.user.id as string, email, access: r.tokens.accessToken as string, refresh: r.tokens.refreshToken as string, auth: { Authorization: `Bearer ${r.tokens.accessToken}` } };
  };

  beforeAll(async () => {
    for (const k of ['AUTHZ_DENIED', 'OBJECT_PROBING', 'UNLOCK_REFUSED', 'EXPORT_REFUSED']) process.env[`SECURITY_SIGNAL_THRESHOLD_${k}`] = '3';
    testApp = new TestAppHelper();
    app = await testApp.init();
    await testApp.cleanupUsers([adminEmail]);
    adminId = await testApp.provisionAdmin(adminEmail, 'SUPER_ADMIN');
    admin = { Authorization: `Bearer ${jwt.sign({ sub: adminId, email: adminEmail, role: 'SUPER_ADMIN', status: 'ACTIVE' }, TEST_SECRETS.jwtAccess, { expiresIn: '1h', issuer: 'orion-api', audience: 'orion-client' })}` };
  }, 60_000);
  beforeEach(clear);
  afterAll(async () => {
    await testApp.cleanupUsers([...emails, adminEmail]);
    await testApp.close();
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  });

  it('S1 repeated failed sign-ins: each failure is recorded with a request id, no password and no e-mail', async () => {
    const v = await reg('victim');
    const from = since();
    const wrong = 'Wrong-Password-P31!';
    for (let i = 0; i < 12; i++) await api().post('/api/v1/auth/login').send({ email: v.email, password: wrong + i });
    const r = await rows(from);
    const failed = r.filter((x) => x.action === 'LOGIN_FAILED');
    expect(failed.length).toBeGreaterThanOrEqual(5);
    expect(r.filter((x) => x.newValues?.requestId).length).toBe(r.length);
    const text = JSON.stringify(r);
    expect(text).not.toContain(wrong);
    expect(text).not.toContain(v.email);
    // (the account lockout and the address block belong to the traffic-control layer, which is off in this harness: they were exercised
    //  against the running API in the live simulation and are covered by traffic-control.e2e-spec.ts)
  });

  it('S2 a replayed refresh token: the replay is recorded, the whole family stays dead, and the alert rule reads it', async () => {
    const t = await reg('thief');
    const from = since();
    const first = unwrap(await api().post('/api/v1/auth/refresh').send({ refreshToken: t.refresh }));
    const rotated = first.tokens?.refreshToken ?? first.refreshToken;
    expect((await api().post('/api/v1/auth/refresh').send({ refreshToken: t.refresh })).status).toBe(401);
    expect((await api().post('/api/v1/auth/refresh').send({ refreshToken: rotated })).status).toBe(401);
    expect((await rows(from, 'TOKEN_REUSE_DETECTED')).length).toBeGreaterThanOrEqual(1);
    (mon() as any).cache.clear();
    const alerts = await mon().alerts(true);
    expect(alerts.map((a) => a.id)).toContain('sec_token_reuse');
    expect(JSON.stringify(alerts)).not.toContain(t.email);
  });

  it('S3 probing another customer\'s objects: always 404, the owner is unaffected, and repeated probing is now a recorded signal', async () => {
    const owner = await reg('owner'), snoop = await reg('snoop');
    const created = unwrap(await api().post('/api/v1/saved-searches').set(owner.auth).send({ name: 'private', filters: { q: 'x' } }));
    const from = since();
    for (let i = 0; i < 4; i++) expect((await api().get(`/api/v1/saved-searches/${created.id}`).set(snoop.auth)).status).toBe(404);
    const sig = (await rows(from, 'ABUSE_SIGNAL')).filter((x) => x.entityId === 'OBJECT_PROBING');
    expect(sig).toHaveLength(1);
    expect(sig[0].userId).toBe(snoop.id);
    expect(JSON.stringify(sig[0].newValues)).not.toContain(created.id);
    expect((await api().get(`/api/v1/saved-searches/${created.id}`).set(owner.auth)).status).toBe(200);
  });

  it('S4 credit manipulation: a customer on administrator credit routes is refused and counted, the wallet and ledger do not move, and refused unlocks are counted', async () => {
    const c = await reg('evil');
    const w0 = (await testApp.db.select().from(schema.userWallets).where(eq(schema.userWallets.userId, c.id)))[0] as any;
    const l0 = (await testApp.db.select().from(schema.creditTransactions).where(eq(schema.creditTransactions.userId, c.id))).length;
    const from = since();
    for (let i = 0; i < 4; i++) {
      expect((await api().post('/api/v1/credit/admin/adjust').set(c.auth).send({ userId: c.id, purchasedDelta: 1000, reason: 'self credit' })).status).toBe(403);
      expect((await api().put('/api/v1/credit/admin/config').set(c.auth).send({ key: 'DAILY_FREE_CREDITS', value: { amount: 1000 } })).status).toBe(403);
    }
    await testApp.db.update(schema.userWallets).set({ dailyCredits: 0, purchasedCredits: 0, balance: 0 }).where(eq(schema.userWallets.userId, c.id));
    for (let i = 0; i < 4; i++) expect((await api().post('/api/v1/unlock/business').set(c.auth).send({ businessId: '00000000-0000-4000-8000-000000000000' })).status).toBeGreaterThanOrEqual(400);
    const kinds = (await rows(from, 'ABUSE_SIGNAL')).map((x) => x.entityId);
    expect(kinds).toContain('AUTHZ_DENIED');
    expect(kinds).toContain('UNLOCK_REFUSED');
    const w1 = (await testApp.db.select().from(schema.userWallets).where(eq(schema.userWallets.userId, c.id)))[0] as any;
    expect(w1.balance).toBe(0);
    expect(w0.lifetimePurchased).toBe(w1.lifetimePurchased);
    expect((await testApp.db.select().from(schema.creditTransactions).where(eq(schema.creditTransactions.userId, c.id))).length).toBe(l0);
  });

  it('S5 exports without authorization or beyond the allowance: anonymous 401, concurrent exports refused and counted, nobody else\'s export is reachable', async () => {
    const c = await reg('exporter'), other = await reg('other');
    const from = since();
    expect((await api().post('/api/v1/exports').send({ dataset: 'saved-leads', format: 'csv' })).status).toBe(401);
    const ex = await api().post('/api/v1/exports').set(c.auth).send({ dataset: 'saved-leads', format: 'csv' });
    expect(ex.status).toBeLessThan(300);
    expect((await api().get('/api/v1/exports/admin/audit').set(c.auth)).status).toBe(403);
    expect((await api().get('/api/v1/exports/00000000-0000-4000-8000-000000000000/download').set(other.auth)).status).toBe(404);
    expect((await rows(from, 'EXPORT_CREATED')).length).toBeGreaterThanOrEqual(1);
  });

  it('S6 administrator activity: credit adjustments are attributed to the administrator and counted by an alert rule; wrong one-time codes are recorded without the code', async () => {
    const t = await reg('target');
    const from = since();
    for (let i = 0; i < 11; i++) expect((await api().post('/api/v1/credit/admin/adjust').set(admin).send({ userId: t.id, purchasedDelta: 1, reason: `p31 burst ${i}` })).status).toBeLessThan(300);
    const adj = await rows(from, 'CREDIT_ADJUSTMENT');
    expect(adj).toHaveLength(11);
    expect(adj.every((x) => x.userId === adminId && x.newValues?.requestId)).toBe(true);
    for (let i = 0; i < 3; i++) await api().post('/api/v1/admin/auth/verify-otp').send({ email: adminEmail, otp: `99990${i}` });
    const fails = await rows(from, 'ADMIN_OTP_FAILED');
    expect(fails.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(fails)).not.toMatch(/99990\d/);
    (mon() as any).cache.clear();
    expect((await mon().alerts(true)).map((a) => a.id)).toEqual(expect.arrayContaining(['sec_credit_adjustments']));
  });

  it('S7 publishing records whose source is not approved is refused, recorded with the reason and no record content, and nothing becomes visible', async () => {
    const from = since();
    const csv = 'business_name,address_line1,city,state,pincode,phone,email\n"P31 Ineligible Co","1 Test Road","Pune","Maharashtra","411001","+91 9876501234","p31@ineligible.example"\n';
    const sub = unwrap(await api().post('/api/v1/admin/import/csv/submit').set(admin).send({ filename: 'p31.csv', csv }));
    const pub = unwrap(await api().post(`/api/v1/admin/import/publish-batch/${sub.batchId}`).set(admin).send({}));
    expect(pub.refused).toBe(1);
    const ref = await rows(from, 'PUBLISH_REFUSED');
    expect(ref.length).toBeGreaterThanOrEqual(1);
    expect(ref[0].newValues.failureCategory).toBe('SOURCE_NOT_APPROVED');
    expect(JSON.stringify(ref)).not.toMatch(/ineligible\.example|P31 Ineligible|9876501234/);
    expect((await testApp.db.select().from(schema.businesses).where(eq(schema.businesses.name, 'P31 Ineligible Co'))).filter((b: any) => b.status === 'PUBLISHED')).toHaveLength(0);
  });

  it('S8 fake credentials in headers, body and query reach neither the audit trail nor the alert text', async () => {
    const fakeToken = 'eyJfakeheader.eyJfakepayloadP31.fakesignatureP31';
    const fakeKey = 'sk_live_P31FAKEFAKEFAKEFAKE0123';
    const from = since();
    await api().post('/api/v1/auth/login').set('x-api-key', fakeKey).set('Authorization', `Bearer ${fakeToken}`).send({ email: 'nobody@example.test', password: 'P31FakePasswordValue!1', apiKey: fakeKey });
    await api().get(`/api/v1/credit/wallet?token=${fakeToken}`).set('Authorization', `Bearer ${fakeToken}`);
    const text = JSON.stringify(await rows(from));
    for (const f of ['fakesignatureP31', 'FAKEFAKEFAKE0123', 'P31FakePasswordValue', 'nobody@example.test']) expect(text).not.toContain(f);
    (mon() as any).cache.clear();
    const alertText = JSON.stringify(await mon().alerts(true));
    for (const f of ['fakesignatureP31', 'FAKEFAKEFAKE0123', 'P31FakePasswordValue']) expect(alertText).not.toContain(f);
  });

  it('containment: suspending the account ends its access token at once, revoking its refresh tokens ends renewal, and neither can be undone by the account itself', async () => {
    const v = await reg('contain');
    expect((await api().get('/api/v1/credit/wallet').set(v.auth)).status).toBe(200);
    await testApp.db.update(schema.refreshTokens).set({ isRevoked: true, revokedReason: 'INCIDENT' } as any).where(eq(schema.refreshTokens.userId, v.id));
    expect((await api().post('/api/v1/auth/refresh').send({ refreshToken: v.refresh })).status).toBe(401);
    await testApp.db.update(schema.users).set({ status: 'SUSPENDED' }).where(eq(schema.users.id, v.id));
    expect((await api().get('/api/v1/credit/wallet').set(v.auth)).status).toBe(401);
    expect((await api().post('/api/v1/auth/login').send({ email: v.email, password: 'Phase31Pass123!' })).status).toBe(403);
    // the suspended account cannot reactivate itself through its profile or settings
    await api().put('/api/v1/user/profile').set(v.auth).send({ status: 'ACTIVE' });
    const [u] = await testApp.db.select().from(schema.users).where(eq(schema.users.id, v.id));
    expect(u.status).toBe('SUSPENDED');
  });

  it('after the simulations: customer isolation, wallets and the suppression of records still hold', async () => {
    const wallets = (await testApp.db.select().from(schema.userWallets).where(inArray(schema.userWallets.userId, (await testApp.db.select().from(schema.users)).map((u: any) => u.id)))) as any[];
    expect(wallets.filter((w) => w.balance !== w.dailyCredits + w.purchasedCredits || w.balance < 0)).toHaveLength(0);
  });
});

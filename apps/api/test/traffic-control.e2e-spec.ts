import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import * as jwt from 'jsonwebtoken';
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { eq } from 'drizzle-orm';
import { TestAppHelper } from './helpers/test-app.helper';
import { TEST_SECRETS } from './helpers/test-secrets';
import { CaptchaService } from '../src/modules/traffic/captcha.service';
import { TrafficLimitsService } from '../src/modules/traffic/traffic-limits.service';
import { TrafficStateService } from '../src/modules/traffic/traffic-state.service';
import * as schema from '../src/database/schema';

/** Defaults for every test: protection on, limits high enough that only the test that lowers one meets it. */
const BASE_ENV: Record<string, string> = {
  TRAFFIC_CONTROL_ENABLED: 'true',
  RATE_LIMIT_IP_BURST_PER_SECOND: '1000',
  RATE_LIMIT_IP_PER_HOUR: '1000000',
  RATE_LIMIT_USER_PER_MINUTE: '1000',
  RATE_LIMIT_USER_PER_DAY: '1000000',
  RATE_LIMIT_USER_BURST_PER_SECOND: '1000',
  RATE_LIMIT_USER_MAX_CONCURRENT: '1000',
  ABUSE_STRIKE_THRESHOLD: '1000000',
  ABUSE_404_PER_MINUTE: '1000000',
  LOGIN_LOCK_AFTER_FAILURES: '1000000',
  LOGIN_CAPTCHA_AFTER_FAILURES: '1000000',
  CAPTCHA_PROVIDER: '',
  CAPTCHA_SECRET_KEY: '',
  CAPTCHA_FAIL_OPEN: '',
  BLOCKED_USER_AGENTS: '',
};

describe('API protection: rate limits, throttling, abuse prevention, IP rules, user limits, bot protection', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const unwrap = (res: any) => res.body.data || res.body;
  const emails: string[] = [];
  const adminEmail = 'qa.traffic.admin@monarchsoftwares.com';
  let adminId: string;
  let adminToken: string;
  let ipSeq = 0;
  /** A fresh client address per use, so one test's strikes never reach another. */
  const newIp = () => `198.51.100.${(++ipSeq % 250) + 1}`;
  const setEnv = (o: Record<string, string>) => Object.assign(process.env, o);
  const as = (ip: string, token = adminToken) => ({ 'X-Forwarded-For': ip, Authorization: `Bearer ${token}` });
  const state = () => app.get(TrafficStateService);

  const newUser = async (name: string, ip = newIp()) => {
    const email = `traffic.${name}.${Date.now()}@orion-test.io`;
    emails.push(email);
    const res = await api().post('/api/v1/auth/register').set('X-Forwarded-For', ip).send({ email, password: 'TrafficPass123!', firstName: 'Tr', lastName: name });
    expect(res.status).toBe(201);
    const d = unwrap(res);
    return { id: d.user.id as string, email, token: d.tokens.accessToken as string, auth: { Authorization: `Bearer ${d.tokens.accessToken}` } };
  };

  beforeAll(async () => {
    setEnv(BASE_ENV);
    testApp = new TestAppHelper();
    app = await testApp.init();
    // behind a proxy the client address is the X-Forwarded-For entry; the tests use that to act as different clients
    (app.getHttpAdapter().getInstance() as any).set('trust proxy', true);
    await testApp.cleanupUsers([adminEmail]);
    adminId = await testApp.provisionAdmin(adminEmail, 'SUPER_ADMIN');
    adminToken = jwt.sign({ sub: adminId, email: adminEmail, role: 'SUPER_ADMIN', status: 'ACTIVE' }, TEST_SECRETS.jwtAccess, { expiresIn: '1h', issuer: 'orion-api', audience: 'orion-client' });
  });

  beforeEach(async () => {
    setEnv(BASE_ENV);
    (app.get(ThrottlerStorage) as any).storage.clear();
    await testApp.db.delete(schema.ipRules);
    await testApp.db.delete(schema.trafficBlocks);
    state().clearCaches();
    await state().refresh();
  });

  afterAll(async () => {
    await testApp.db.delete(schema.ipRules);
    await testApp.db.delete(schema.trafficBlocks);
    await testApp.cleanupUsers([...emails, adminEmail]);
    await testApp.close();
    for (const k of Object.keys(BASE_ENV)) delete process.env[k];
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('IP-based restrictions', () => {
    it('refuses a denied address everywhere (even the health check), leaves others alone, and lifts when the rule is removed', async () => {
      const bad = newIp();
      const good = newIp();
      const add = await api().post('/api/v1/traffic/ip-rules').set(as(newIp())).send({ cidr: bad, action: 'DENY', reason: 'abusive scraper' });
      expect(add.status).toBe(201);
      expect(unwrap(add)).toMatchObject({ cidr: `${bad}/32`, action: 'DENY', scope: 'GLOBAL' });

      for (const path of ['/api/v1/credit/packages', '/api/v1/health', '/api/v1/auth/login']) {
        const r = path.endsWith('login') ? await api().post(path).set('X-Forwarded-For', bad).send({ email: 'a@b.io', password: 'x' }) : await api().get(path).set('X-Forwarded-For', bad);
        expect(r.status).toBe(403);
        expect(JSON.stringify(r.body)).toContain('IP_BLOCKED');
      }
      expect((await api().get('/api/v1/credit/packages').set('X-Forwarded-For', good)).status).toBe(200);
      // the same applies to a whole range
      await api().post('/api/v1/traffic/ip-rules').set(as(newIp())).send({ cidr: '203.0.113.0/24', action: 'DENY', reason: 'hosting range abused' });
      expect((await api().get('/api/v1/credit/packages').set('X-Forwarded-For', '203.0.113.200')).status).toBe(403);
      expect((await api().get('/api/v1/credit/packages').set('X-Forwarded-For', '203.0.114.1')).status).toBe(200);

      const rules = unwrap(await api().get('/api/v1/traffic/ip-rules').set(as(newIp())));
      expect(rules).toHaveLength(2);
      for (const r of rules) expect((await api().delete(`/api/v1/traffic/ip-rules/${r.id}`).set(as(newIp()))).status).toBe(200);
      expect((await api().get('/api/v1/credit/packages').set('X-Forwarded-For', bad)).status).toBe(200);
    });

    it('can attribute requests to the address a trusted proxy puts in a configured header, and ignores it otherwise', async () => {
      const real = newIp();
      const gateway = newIp();
      expect((await api().post('/api/v1/traffic/ip-rules').set(as(newIp())).send({ cidr: real, action: 'DENY', reason: 'abusive customer' })).status).toBe(201);
      // without the setting the header is just data: the request is attributed to the connecting address
      expect((await api().get('/api/v1/credit/packages').set({ 'X-Forwarded-For': gateway, 'x-real-ip': real })).status).toBe(200);
      setEnv({ TRAFFIC_TRUSTED_IP_HEADER: 'x-real-ip' });
      try {
        const denied = await api().get('/api/v1/credit/packages').set({ 'X-Forwarded-For': gateway, 'x-real-ip': real });
        expect(denied.status).toBe(403);
        expect((await api().get('/api/v1/credit/packages').set({ 'X-Forwarded-For': gateway, 'x-real-ip': newIp() })).status).toBe(200); // other customers behind the same gateway
        expect((await api().get('/api/v1/credit/packages').set({ 'X-Forwarded-For': gateway, 'x-real-ip': 'garbage' })).status).toBe(200); // unusable value: falls back
        expect((await api().get('/api/v1/credit/packages').set({ 'X-Forwarded-For': real })).status).toBe(403); // header absent: falls back to the connecting address, which is the denied one
        expect((await api().get('/api/v1/credit/packages').set({ 'X-Forwarded-For': gateway })).status).toBe(200);
      } finally {
        delete process.env.TRAFFIC_TRUSTED_IP_HEADER;
      }
    });

    it('validates rules, and refuses a rule that would lock the administrator out', async () => {
      const me = newIp();
      const post = (b: object) => api().post('/api/v1/traffic/ip-rules').set(as(me)).send(b);
      expect((await post({ cidr: 'not-an-ip', action: 'DENY', reason: 'because' })).status).toBe(400);
      expect((await post({ cidr: '1.2.3.4/33', action: 'DENY', reason: 'because' })).status).toBe(400);
      expect((await post({ cidr: '1.2.3.4', action: 'MAYBE', reason: 'because' })).status).toBe(400);
      expect((await post({ cidr: '1.2.3.4', action: 'DENY', reason: 'x' })).status).toBe(400); // reason too short
      expect((await post({ cidr: '0.0.0.0/0', action: 'DENY', reason: 'block the world' })).status).toBe(400);
      expect((await post({ cidr: '1.2.3.4', action: 'DENY', scope: 'ADMIN', reason: 'admin deny makes no sense' })).status).toBe(400);
      // would block the caller's own address
      const self = await post({ cidr: me, action: 'DENY', reason: 'oops, my own address' });
      expect(self.status).toBe(409);
      expect(JSON.stringify(self.body)).toContain('WOULD_LOCK_OUT_YOU');
      expect((await post({ cidr: `${me.split('.').slice(0, 3).join('.')}.0/24`, action: 'DENY', reason: 'my own range' })).status).toBe(409);
      expect((await api().post('/api/v1/traffic/ip-rules').send({ cidr: '1.2.3.4', action: 'DENY', reason: 'no token here' })).status).toBe(401);
      const u = await newUser('rules-user');
      expect((await api().post('/api/v1/traffic/ip-rules').set(u.auth).send({ cidr: '1.2.3.4', action: 'DENY', reason: 'customers cannot' })).status).toBe(403);
      expect(unwrap(await api().get('/api/v1/traffic/ip-rules').set(as(me)))).toHaveLength(0);
    });

    it('an admin allow-list restricts the admin area to the listed ranges, and only then', async () => {
      const inside = '203.0.113.5';
      const outside = newIp();
      // the first entry must contain the administrator's own address
      const wrong = await api().post('/api/v1/traffic/ip-rules').set(as(outside)).send({ cidr: '203.0.113.0/24', action: 'ALLOW', scope: 'ADMIN', reason: 'office network' });
      expect(wrong.status).toBe(409);
      expect((await api().get('/api/v1/traffic/ip-rules').set(as(outside))).status).toBe(200); // still reachable: nothing was created

      const ok = await api().post('/api/v1/traffic/ip-rules').set(as(inside)).send({ cidr: '203.0.113.0/24', action: 'ALLOW', scope: 'ADMIN', reason: 'office network' });
      expect(ok.status).toBe(201);
      const ruleId = unwrap(ok).id;

      expect((await api().get('/api/v1/traffic/ip-rules').set(as(outside))).status).toBe(403);
      expect(JSON.stringify((await api().get('/api/v1/credit/admin/packages').set(as(outside))).body)).toContain('ADMIN_IP_RESTRICTED');
      expect((await api().get('/api/v1/exports/admin/audit').set(as(outside))).status).toBe(403);
      expect((await api().get('/api/v1/credit/admin/packages').set(as(inside))).status).toBe(200);
      // ordinary routes are untouched, for everyone
      const u = await newUser('allowlist', outside);
      expect((await api().get('/api/v1/credit/wallet').set({ 'X-Forwarded-For': outside, ...u.auth })).status).toBe(200);
      expect((await api().get('/api/v1/traffic/my-limits').set({ 'X-Forwarded-For': outside, ...u.auth })).status).toBe(200);

      expect((await api().delete(`/api/v1/traffic/ip-rules/${ruleId}`).set(as(inside))).status).toBe(200);
      expect((await api().get('/api/v1/traffic/ip-rules').set(as(outside))).status).toBe(200);
    });

    it('a trusted (allow) address skips rate limits, and an expired rule no longer applies', async () => {
      const trusted = newIp();
      setEnv({ RATE_LIMIT_IP_BURST_PER_SECOND: '3' });
      expect((await api().post('/api/v1/traffic/ip-rules').set(as(newIp())).send({ cidr: trusted, action: 'ALLOW', reason: 'partner integration' })).status).toBe(201);
      const results = await Promise.all(Array.from({ length: 12 }, () => api().get('/api/v1/credit/packages').set('X-Forwarded-For', trusted)));
      expect(results.every((r) => r.status === 200)).toBe(true);
      const other = await Promise.all(Array.from({ length: 12 }, () => api().get('/api/v1/credit/packages').set('X-Forwarded-For', newIp())));
      expect(other.every((r) => r.status === 200)).toBe(true); // distinct addresses, one request each

      const bad = newIp();
      const r = unwrap(await api().post('/api/v1/traffic/ip-rules').set(as(newIp())).send({ cidr: bad, action: 'DENY', reason: 'temporary ban', expiresInHours: 1 }));
      expect((await api().get('/api/v1/credit/packages').set('X-Forwarded-For', bad)).status).toBe(403);
      await testApp.db.update(schema.ipRules).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.ipRules.id, r.id));
      await state().refresh();
      expect((await api().get('/api/v1/credit/packages').set('X-Forwarded-For', bad)).status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('API rate limiting and request throttling (per address)', () => {
    it('caps requests per second per address, answers 429 with Retry-After, and other addresses are unaffected', async () => {
      setEnv({ RATE_LIMIT_IP_BURST_PER_SECOND: '5' });
      const ip = newIp();
      const burst = await Promise.all(Array.from({ length: 12 }, () => api().get('/api/v1/credit/packages').set('X-Forwarded-For', ip)));
      const ok = burst.filter((r) => r.status === 200).length;
      const limited = burst.filter((r) => r.status === 429);
      expect(ok).toBeGreaterThanOrEqual(1);
      expect(ok).toBeLessThanOrEqual(5);
      expect(limited.length).toBe(12 - ok);
      const l = limited[0];
      expect(JSON.stringify(l.body)).toContain('RATE_LIMITED');
      expect(JSON.stringify(l.body)).toContain('ip_burst');
      expect(Number(l.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      expect((await api().get('/api/v1/credit/packages').set('X-Forwarded-For', newIp())).status).toBe(200);
      // after the wait it works again (an honest Retry-After)
      await new Promise((r) => setTimeout(r, Number(l.headers['retry-after']) * 1000 + 100));
      expect((await api().get('/api/v1/credit/packages').set('X-Forwarded-For', ip)).status).toBe(200);
    });

    it('caps requests per hour per address', async () => {
      setEnv({ RATE_LIMIT_IP_PER_HOUR: '4' });
      const ip = newIp();
      const codes: number[] = [];
      for (let i = 0; i < 6; i++) codes.push((await api().get('/api/v1/credit/packages').set('X-Forwarded-For', ip)).status);
      expect(codes).toEqual([200, 200, 200, 200, 429, 429]);
    });

    it('never rate-limits the health check or a payment webhook, and CORS pre-flight is not counted', async () => {
      setEnv({ RATE_LIMIT_IP_BURST_PER_SECOND: '2' });
      const ip = newIp();
      const health = await Promise.all(Array.from({ length: 10 }, () => api().get('/api/v1/health').set('X-Forwarded-For', ip)));
      expect(health.some((r) => r.status === 429)).toBe(false);
      const hooks = await Promise.all(Array.from({ length: 6 }, () => api().post('/api/v1/payments/webhook').set('X-Forwarded-For', ip).send({})));
      expect(hooks.some((r) => r.status === 429)).toBe(false);
      const pre = await Promise.all(Array.from({ length: 6 }, () => api().options('/api/v1/credit/packages').set('X-Forwarded-For', ip).set('Origin', 'http://localhost:3000')));
      expect(pre.some((r) => r.status === 429)).toBe(false);
    });

    it('does nothing when protection is switched off', async () => {
      setEnv({ TRAFFIC_CONTROL_ENABLED: 'false', RATE_LIMIT_IP_BURST_PER_SECOND: '1' });
      const ip = newIp();
      const burst = await Promise.all(Array.from({ length: 8 }, () => api().get('/api/v1/credit/packages').set('X-Forwarded-For', ip)));
      expect(burst.every((r) => r.status === 200)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('user-based request limits', () => {
    it('limits a user per minute with plan-based defaults, shows the headers, and keeps users independent', async () => {
      setEnv({ RATE_LIMIT_USER_PER_MINUTE: '5' });
      const a = await newUser('lim-a');
      const b = await newUser('lim-b');
      const ipA = newIp();
      const codes: number[] = [];
      let last: any;
      for (let i = 0; i < 7; i++) {
        last = await api().get('/api/v1/credit/wallet').set({ 'X-Forwarded-For': ipA, ...a.auth });
        codes.push(last.status);
      }
      // the registration call and the wallet reads share the same minute
      expect(codes.filter((c) => c === 200).length).toBeLessThanOrEqual(5);
      expect(codes.at(-1)).toBe(429);
      expect(JSON.stringify(last.body)).toContain('user_minute');
      expect(last.headers['ratelimit-limit']).toBe('5');
      expect(last.headers['ratelimit-remaining']).toBe('0');
      expect(Number(last.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      expect((await api().get('/api/v1/credit/wallet').set({ 'X-Forwarded-For': newIp(), ...b.auth })).status).toBe(200); // another user
      const ok = await api().get('/api/v1/credit/wallet').set({ 'X-Forwarded-For': newIp(), ...b.auth });
      expect(Number(ok.headers['ratelimit-remaining'])).toBeLessThan(5);
    });

    it('a higher plan gets a proportionally larger allowance', async () => {
      setEnv({ RATE_LIMIT_USER_PER_MINUTE: '5' });
      const u = await newUser('plan');
      const free = unwrap(await api().get('/api/v1/traffic/my-limits').set({ 'X-Forwarded-For': newIp(), ...u.auth }));
      expect(free).toMatchObject({ plan: 'free', perMinute: 5, source: 'plan', exempt: false });
      await testApp.db.insert(schema.userSubscriptions).values({ userId: u.id, tier: 'growth', status: 'ACTIVE', expiresAt: new Date(Date.now() + 86_400_000) });
      state().clearCaches();
      const growth = unwrap(await api().get('/api/v1/traffic/my-limits').set({ 'X-Forwarded-For': newIp(), ...u.auth }));
      expect(growth).toMatchObject({ plan: 'growth', perMinute: 20, source: 'plan' });
      expect(growth.perDay).toBe(1000000 * 4);
    });

    it('an administrator can set and clear a per-user override, which wins over the plan', async () => {
      setEnv({ RATE_LIMIT_USER_PER_MINUTE: '5' });
      const u = await newUser('override');
      const put = await api().put(`/api/v1/traffic/users/${u.id}/limits`).set(as(newIp())).send({ perMinute: 50, note: 'trusted reseller' });
      expect(put.status).toBe(200);
      expect(unwrap(put)).toMatchObject({ perMinute: 50, perDay: null });
      const mine = unwrap(await api().get('/api/v1/traffic/my-limits').set({ 'X-Forwarded-For': newIp(), ...u.auth }));
      expect(mine).toMatchObject({ perMinute: 50, source: 'override' });
      expect(unwrap(await api().get(`/api/v1/traffic/users/${u.id}/limits`).set(as(newIp()))).override).toMatchObject({ perMinute: 50, note: 'trusted reseller' });

      expect((await api().put(`/api/v1/traffic/users/${u.id}/limits`).set(as(newIp())).send({ perMinute: 0 })).status).toBe(400);
      expect((await api().put(`/api/v1/traffic/users/${u.id}/limits`).set(as(newIp())).send({ perMinute: 'lots' })).status).toBe(400);
      expect((await api().put('/api/v1/traffic/users/00000000-0000-0000-0000-000000000000/limits').set(as(newIp())).send({ perMinute: 10 })).status).toBe(404);
      expect((await api().put(`/api/v1/traffic/users/${u.id}/limits`).set(u.auth).send({ perMinute: 9999 })).status).toBe(403); // customers cannot

      expect((await api().delete(`/api/v1/traffic/users/${u.id}/limits`).set(as(newIp()))).status).toBe(200);
      expect(unwrap(await api().get('/api/v1/traffic/my-limits').set({ 'X-Forwarded-For': newIp(), ...u.auth }))).toMatchObject({ perMinute: 5, source: 'plan' });
    });

    it('caps requests per second per user, and an administrator is not subject to the user limits', async () => {
      setEnv({ RATE_LIMIT_USER_BURST_PER_SECOND: '3' });
      const u = await newUser('burst');
      const burst = await Promise.all(Array.from({ length: 10 }, () => api().get('/api/v1/credit/wallet').set({ 'X-Forwarded-For': newIp(), ...u.auth })));
      expect(burst.filter((r) => r.status === 429).length).toBeGreaterThan(0);
      expect(burst.filter((r) => r.status === 200).length).toBeLessThanOrEqual(3);
      const admin = await Promise.all(Array.from({ length: 10 }, () => api().get('/api/v1/traffic/limits').set(as(newIp()))));
      expect(admin.every((r) => r.status === 200)).toBe(true);
    });

    it('limits requests in flight at once per user', async () => {
      const limits = app.get(TrafficLimitsService);
      const id = 'user-concurrency-test';
      expect(limits.acquire(id, 2)).toBe(true);
      expect(limits.acquire(id, 2)).toBe(true);
      expect(limits.acquire(id, 2)).toBe(false);
      limits.release(id);
      expect(limits.acquire(id, 2)).toBe(true);
      limits.release(id);
      limits.release(id);
      expect(limits.acquire(id, 1)).toBe(true); // all slots came back
      limits.release(id);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('abuse prevention: strikes and automatic blocks', () => {
    it('blocks an address that probes for secrets, escalates on a repeat, and an administrator can see and lift it', async () => {
      setEnv({ ABUSE_STRIKE_THRESHOLD: '3' });
      const ip = newIp();
      const probe = await api().get('/api/v1/.env').set('X-Forwarded-For', ip);
      expect(probe.status).toBe(404); // an ordinary 404: the scanner learns nothing
      const blocked = await api().get('/api/v1/credit/packages').set('X-Forwarded-For', ip);
      expect(blocked.status).toBe(429);
      expect(JSON.stringify(blocked.body)).toContain('TEMPORARILY_BLOCKED');
      const wait = Number(blocked.headers['retry-after']);
      expect(wait).toBeGreaterThan(200);
      expect(wait).toBeLessThanOrEqual(300); // first offence: 5 minutes
      expect((await api().get('/api/v1/credit/packages').set('X-Forwarded-For', newIp())).status).toBe(200);

      const list = unwrap(await api().get('/api/v1/traffic/blocks').set(as(newIp())));
      const mine = list.find((b: any) => b.subject === ip);
      expect(mine).toMatchObject({ subjectType: 'IP', source: 'AUTO', reason: 'scanner probe' });
      const audit = await testApp.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, 'TRAFFIC_AUTO_BLOCK'));
      expect(audit.some((a) => (a.newValues as any)?.subject === ip)).toBe(true);

      expect((await api().delete(`/api/v1/traffic/blocks/${mine.id}`).set(as(newIp()))).status).toBe(200);
      expect((await api().delete(`/api/v1/traffic/blocks/${mine.id}`).set(as(newIp()))).status).toBe(404); // already lifted
      expect((await api().get('/api/v1/credit/packages').set('X-Forwarded-For', ip)).status).toBe(200);

      // a second offence within a day gets a longer block
      await api().get('/api/v1/wp-login.php').set('X-Forwarded-For', ip);
      const again = await api().get('/api/v1/credit/packages').set('X-Forwarded-For', ip);
      expect(again.status).toBe(429);
      expect(Number(again.headers['retry-after'])).toBeGreaterThan(1500); // 30 minutes
    });

    it('an active block never takes the health probes or the payment webhook out of service, while every other route stays blocked (Phase 31)', async () => {
      setEnv({ ABUSE_STRIKE_THRESHOLD: '3' });
      const ip = newIp();
      await api().get('/api/v1/.env').set('X-Forwarded-For', ip); // scanner probe: the address is blocked
      expect((await api().get('/api/v1/credit/packages').set('X-Forwarded-For', ip)).status).toBe(429);
      expect((await api().get('/api/v1/health/liveness').set('X-Forwarded-For', ip)).status).toBe(200);
      expect((await api().get('/api/v1/health/readiness').set('X-Forwarded-For', ip)).status).not.toBe(429);
      const hook = await api().post('/api/v1/payments/webhook').set('X-Forwarded-For', ip).send({});
      expect(JSON.stringify(hook.body)).not.toContain('TEMPORARILY_BLOCKED');
      expect((await api().get('/api/v1/credit/packages').set('X-Forwarded-For', ip)).status).toBe(429);
    });

    it('blocks attack-tool user agents, but not ordinary HTTP clients', async () => {
      const ip = newIp();
      for (const ua of ['sqlmap/1.7', 'Nikto/2.5', 'Mozilla/5.00 (Nikto/2.1.6)', 'masscan/1.3', 'gobuster/3.6']) {
        const r = await api().get('/api/v1/credit/packages').set('X-Forwarded-For', newIp()).set('User-Agent', ua);
        expect(r.status).toBe(403);
        expect(JSON.stringify(r.body)).toContain('BOT_BLOCKED');
      }
      for (const ua of ['curl/8.4.0', 'python-requests/2.31', 'axios/1.6', 'Mozilla/5.0 (Windows NT 10.0) Chrome/120', '']) {
        expect((await api().get('/api/v1/credit/packages').set('X-Forwarded-For', ip).set('User-Agent', ua)).status).toBe(200);
      }
      setEnv({ BLOCKED_USER_AGENTS: 'evilscraper, badbot\\d+' });
      expect((await api().get('/api/v1/credit/packages').set('X-Forwarded-For', newIp()).set('User-Agent', 'EvilScraper/1')).status).toBe(403);
      expect((await api().get('/api/v1/credit/packages').set('X-Forwarded-For', newIp()).set('User-Agent', 'BadBot42')).status).toBe(403);
    });

    it('treats a flood of unknown URLs as probing, and a repeatedly rate-limited address as abusive', async () => {
      setEnv({ ABUSE_STRIKE_THRESHOLD: '4', ABUSE_404_PER_MINUTE: '3' });
      const ip = newIp();
      const codes: number[] = [];
      for (let i = 0; i < 9; i++) codes.push((await api().get(`/api/v1/no-such-thing-${i}`).set('X-Forwarded-For', ip)).status);
      expect(codes.slice(0, 3)).toEqual([404, 404, 404]);
      expect(codes).toContain(429); // blocked after enough probing

      setEnv({ ABUSE_STRIKE_THRESHOLD: '3', RATE_LIMIT_IP_BURST_PER_SECOND: '2' });
      const noisy = newIp();
      await Promise.all(Array.from({ length: 20 }, () => api().get('/api/v1/credit/packages').set('X-Forwarded-For', noisy)));
      await new Promise((r) => setTimeout(r, 1100));
      const after = await api().get('/api/v1/credit/packages').set('X-Forwarded-For', noisy);
      expect(after.status).toBe(429);
      expect(JSON.stringify(after.body)).toContain('TEMPORARILY_BLOCKED');
    });

    it('an administrator can block and unblock an address or a user, but not themselves', async () => {
      const ip = newIp();
      const u = await newUser('blockme');
      const me = newIp();
      const b1 = await api().post('/api/v1/traffic/blocks').set(as(me)).send({ subjectType: 'IP', subject: ip, reason: 'manual ban', minutes: 30 });
      expect(b1.status).toBe(201);
      expect((await api().get('/api/v1/credit/packages').set('X-Forwarded-For', ip)).status).toBe(429);
      const b2 = await api().post('/api/v1/traffic/blocks').set(as(me)).send({ subjectType: 'USER', subject: u.id, reason: 'manual ban', minutes: 30 });
      expect(b2.status).toBe(201);
      const blocked = await api().get('/api/v1/credit/wallet').set({ 'X-Forwarded-For': newIp(), ...u.auth });
      expect(blocked.status).toBe(429);
      expect(JSON.stringify(blocked.body)).toContain('TEMPORARILY_BLOCKED');
      expect((await api().get('/api/v1/credit/wallet').set({ 'X-Forwarded-For': newIp(), ...newUserAuth(await newUser('other')) })).status).toBe(200);

      expect((await api().post('/api/v1/traffic/blocks').set(as(me)).send({ subjectType: 'IP', subject: me, reason: 'my own address', minutes: 10 })).status).toBe(409);
      expect((await api().post('/api/v1/traffic/blocks').set(as(me)).send({ subjectType: 'USER', subject: adminId, reason: 'myself', minutes: 10 })).status).toBe(409);
      expect((await api().post('/api/v1/traffic/blocks').set(as(me)).send({ subjectType: 'IP', subject: 'nope', reason: 'bad input', minutes: 10 })).status).toBe(400);
      expect((await api().post('/api/v1/traffic/blocks').set(as(me)).send({ subjectType: 'USER', subject: '00000000-0000-0000-0000-000000000000', reason: 'nobody', minutes: 10 })).status).toBe(404);
      expect((await api().post('/api/v1/traffic/blocks').set(as(me)).send({ subjectType: 'IP', subject: newIp(), reason: 'too long', minutes: 999999 })).status).toBe(400);

      for (const b of [unwrap(b1), unwrap(b2)]) expect((await api().delete(`/api/v1/traffic/blocks/${b.id}`).set(as(me))).status).toBe(200);
      expect((await api().get('/api/v1/credit/packages').set('X-Forwarded-For', ip)).status).toBe(200);
      expect((await api().get('/api/v1/credit/wallet').set({ 'X-Forwarded-For': newIp(), ...u.auth })).status).toBe(200);
    });

    it('a block expires by itself', async () => {
      const ip = newIp();
      const b = unwrap(await api().post('/api/v1/traffic/blocks').set(as(newIp())).send({ subjectType: 'IP', subject: ip, reason: 'short ban', minutes: 5 }));
      expect((await api().get('/api/v1/credit/packages').set('X-Forwarded-For', ip)).status).toBe(429);
      await testApp.db.update(schema.trafficBlocks).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.trafficBlocks.id, b.id));
      await state().refresh();
      expect((await api().get('/api/v1/credit/packages').set('X-Forwarded-For', ip)).status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('sign-in protection (credential stuffing)', () => {
    const login = (email: string, password: string, ip: string, extra: Record<string, string> = {}) => api().post('/api/v1/auth/login').set({ 'X-Forwarded-For': ip, ...extra }).send({ email, password });

    it('locks an account after repeated failures, whether or not the e-mail exists, stores no e-mail, and unlocks on release or success', async () => {
      setEnv({ LOGIN_LOCK_AFTER_FAILURES: '3' });
      const u = await newUser('lock');
      const ip = newIp();
      for (let i = 0; i < 3; i++) expect((await login(u.email, 'WrongPassword1!', ip)).status).toBe(401);
      const locked = await login(u.email, 'TrafficPass123!', ip); // even the right password is refused while locked
      expect(locked.status).toBe(429);
      expect(JSON.stringify(locked.body)).toContain('ACCOUNT_TEMPORARILY_LOCKED');
      expect(JSON.stringify(locked.body)).toContain('retryAfterSeconds');

      // the same behaviour for an address that is not registered: lockout reveals nothing
      const ghost = `nobody.${Date.now()}@orion-test.io`;
      for (let i = 0; i < 3; i++) expect((await login(ghost, 'WrongPassword1!', newIp())).status).toBe(401);
      const ghostLocked = await login(ghost, 'WrongPassword1!', newIp());
      expect(ghostLocked.status).toBe(429);
      expect(JSON.stringify(ghostLocked.body)).toContain('ACCOUNT_TEMPORARILY_LOCKED');

      const rows = await testApp.db.select().from(schema.trafficBlocks);
      expect(JSON.stringify(rows)).not.toContain(u.email);
      expect(JSON.stringify(rows)).not.toContain(ghost);
      const listed = unwrap(await api().get('/api/v1/traffic/blocks').set(as(newIp())));
      expect(listed.filter((b: any) => b.subjectType === 'ACCOUNT').every((b: any) => b.subject === '(login account)')).toBe(true);
      const acct = rows.find((r) => r.subjectType === 'ACCOUNT' && r.subject === app.get(TrafficLimitsService).accountKey(u.email))!;
      expect((await api().delete(`/api/v1/traffic/blocks/${acct.id}`).set(as(newIp()))).status).toBe(200);
      const ok = await login(u.email, 'TrafficPass123!', ip);
      expect(ok.status).toBe(200);

      // a success clears the run of failures (the per-route login throttle of the existing guard, 10 per minute, is reset so it does not interfere)
      (app.get(ThrottlerStorage) as any).storage.clear();
      expect((await login(u.email, 'WrongPassword1!', ip)).status).toBe(401);
      expect((await login(u.email, 'WrongPassword1!', ip)).status).toBe(401);
      expect((await login(u.email, 'TrafficPass123!', ip)).status).toBe(200);
      expect((await login(u.email, 'WrongPassword1!', ip)).status).toBe(401);
      expect((await login(u.email, 'WrongPassword1!', ip)).status).toBe(401);
      expect((await login(u.email, 'TrafficPass123!', ip)).status).toBe(200); // never reached three in a row
    });

    it('an address that keeps failing sign-in is blocked by the strike engine', async () => {
      setEnv({ ABUSE_STRIKE_THRESHOLD: '4' });
      const ip = newIp();
      const codes: number[] = [];
      for (let i = 0; i < 7; i++) codes.push((await login(`spray.${i}.${Date.now()}@orion-test.io`, 'WrongPassword1!', ip)).status);
      expect(codes.slice(0, 4)).toEqual([401, 401, 401, 401]);
      expect(codes.slice(4)).toEqual([429, 429, 429]); // each e-mail was tried once: the ADDRESS is what got blocked
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('bot protection: honeypot and CAPTCHA', () => {
    const register = (ip: string, extra: object = {}, headers: Record<string, string> = {}) =>
      api().post('/api/v1/auth/register').set({ 'X-Forwarded-For': ip, ...headers }).send({ email: `bot.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@orion-test.io`, password: 'BotPass12345!', firstName: 'B', lastName: 'T', ...extra });

    it('refuses a form whose hidden field was filled in, and accepts it empty or absent', async () => {
      const ip = newIp();
      const bot = await register(ip, { website: 'http://spam.example' });
      expect(bot.status).toBe(400);
      expect(JSON.stringify(bot.body)).toContain('INVALID_REQUEST');
      const hp2 = await api().post('/api/v1/auth/login').set('X-Forwarded-For', ip).send({ email: 'a@b.io', password: 'x', website: 'filled' });
      expect(hp2.status).toBe(400);
      const forgot = await api().post('/api/v1/auth/forgot-password').set('X-Forwarded-For', ip).send({ email: 'a@b.io', website: 'filled' });
      expect(forgot.status).toBe(400);

      const empty = await register(newIp(), { website: '' });
      expect(empty.status).toBe(201);
      const absent = await register(newIp());
      expect(absent.status).toBe(201);
      emails.push(unwrap(empty).user.email, unwrap(absent).user.email);
    });

    it('requires a CAPTCHA at sign-up and password reset when a provider is configured, and verifies it with the provider', async () => {
      const calls: Array<{ url: string; body: string }> = [];
      const captcha = app.get(CaptchaService);
      const real = captcha.fetchImpl;
      let mode: 'ok' | 'reject' | 'down' | 'http500' = 'ok';
      captcha.fetchImpl = (async (url: any, init: any) => {
        calls.push({ url: String(url), body: String(init?.body) });
        if (mode === 'down') throw new Error('network down');
        if (mode === 'http500') return { ok: false, status: 500, json: async () => ({}) } as any;
        return { ok: true, status: 200, json: async () => ({ success: mode === 'ok' }) } as any;
      }) as any;
      try {
        setEnv({ CAPTCHA_PROVIDER: 'turnstile', CAPTCHA_SECRET_KEY: 'test-captcha-secret' });
        const ip = newIp();
        const missing = await register(ip);
        expect(missing.status).toBe(403);
        expect(JSON.stringify(missing.body)).toContain('CAPTCHA_REQUIRED');
        expect(calls).toHaveLength(0); // nothing to verify: the provider is not called

        const good = await register(ip, {}, { 'x-captcha-token': 'token-from-widget' });
        expect(good.status).toBe(201);
        emails.push(unwrap(good).user.email);
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
        const form = new URLSearchParams(calls[0].body);
        expect(form.get('secret')).toBe('test-captcha-secret');
        expect(form.get('response')).toBe('token-from-widget');
        expect(form.get('remoteip')).toBe(ip);

        mode = 'reject';
        const bad = await register(newIp(), {}, { 'x-captcha-token': 'forged' });
        expect(bad.status).toBe(403);
        expect(JSON.stringify(bad.body)).toContain('CAPTCHA_FAILED');

        // the provider cannot be reached: closed by default, open only when the operator says so
        mode = 'down';
        const down = await register(newIp(), {}, { 'x-captcha-token': 'x' });
        expect(down.status).toBe(503);
        setEnv({ CAPTCHA_FAIL_OPEN: 'true' });
        const open = await register(newIp(), {}, { 'x-captcha-token': 'x' });
        expect(open.status).toBe(201);
        emails.push(unwrap(open).user.email);
        setEnv({ CAPTCHA_FAIL_OPEN: '' });
        mode = 'http500';
        expect((await register(newIp(), {}, { 'x-captcha-token': 'x' })).status).toBe(503);

        // other providers use their own verification address
        mode = 'ok';
        calls.length = 0;
        setEnv({ CAPTCHA_PROVIDER: 'hcaptcha' });
        await register(newIp(), {}, { 'x-captcha-token': 'x' }).then((r: any) => r.status === 201 && emails.push(unwrap(r).user.email));
        setEnv({ CAPTCHA_PROVIDER: 'recaptcha' });
        await register(newIp(), {}, { 'x-captcha-token': 'x' }).then((r: any) => r.status === 201 && emails.push(unwrap(r).user.email));
        expect(calls.map((c) => c.url)).toEqual(['https://api.hcaptcha.com/siteverify', 'https://www.google.com/recaptcha/api/siteverify']);

        // password reset needs it too; ordinary reads do not
        expect((await api().post('/api/v1/auth/forgot-password').set('X-Forwarded-For', newIp()).send({ email: 'a@b.io' })).status).toBe(403);
        expect((await api().get('/api/v1/credit/packages').set('X-Forwarded-For', newIp())).status).toBe(200);
      } finally {
        captcha.fetchImpl = real;
      }
    });

    it('asks for a CAPTCHA at sign-in only after repeated failures', async () => {
      const captcha = app.get(CaptchaService);
      const real = captcha.fetchImpl;
      captcha.fetchImpl = (async () => ({ ok: true, status: 200, json: async () => ({ success: true }) })) as any;
      try {
        const u = await newUser('captcha-login');
        setEnv({ CAPTCHA_PROVIDER: 'turnstile', CAPTCHA_SECRET_KEY: 'test-captcha-secret', LOGIN_CAPTCHA_AFTER_FAILURES: '2', LOGIN_LOCK_AFTER_FAILURES: '1000' });
        const ip = newIp();
        const login = (pw: string, h: Record<string, string> = {}) => api().post('/api/v1/auth/login').set({ 'X-Forwarded-For': ip, ...h }).send({ email: u.email, password: pw });
        expect((await login('Wrong-password-1!')).status).toBe(401);
        expect((await login('Wrong-password-1!')).status).toBe(401);
        const needed = await login('TrafficPass123!');
        expect(needed.status).toBe(403);
        expect(JSON.stringify(needed.body)).toContain('CAPTCHA_REQUIRED');
        expect((await login('TrafficPass123!', { 'x-captcha-token': 'solved' })).status).toBe(200);
      } finally {
        captcha.fetchImpl = real;
      }
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('visibility for administrators', () => {
    it('shows the limits in force and what the protections did, to administrators only', async () => {
      const u = await newUser('stats-user'); // registered before the CAPTCHA is switched on
      setEnv({ RATE_LIMIT_IP_BURST_PER_SECOND: '2', CAPTCHA_PROVIDER: 'turnstile', CAPTCHA_SECRET_KEY: 'secret-that-must-not-leak' });
      const ip = newIp();
      await Promise.all(Array.from({ length: 6 }, () => api().get('/api/v1/credit/packages').set('X-Forwarded-For', ip)));
      const limits = unwrap(await api().get('/api/v1/traffic/limits').set(as(newIp())));
      expect(limits).toMatchObject({ enabled: true, ip: { burstPerSecond: 2 }, captcha: { enabled: true, provider: 'turnstile' } });
      expect(JSON.stringify(limits)).not.toContain('secret-that-must-not-leak');
      const stats = unwrap(await api().get('/api/v1/traffic/stats').set(as(newIp())));
      expect(stats.limited.ip_burst).toBeGreaterThan(0);
      expect(stats.topLimited.some((t: any) => t.subject === ip)).toBe(true);
      for (const path of ['/api/v1/traffic/limits', '/api/v1/traffic/stats', '/api/v1/traffic/blocks', '/api/v1/traffic/ip-rules']) {
        expect((await api().get(path).set({ 'X-Forwarded-For': newIp(), ...u.auth })).status).toBe(403);
        expect((await api().get(path).set('X-Forwarded-For', newIp())).status).toBe(401);
      }
    });
  });
});

/** a registered user's auth header */
function newUserAuth(u: { auth: Record<string, string> }) {
  return u.auth;
}

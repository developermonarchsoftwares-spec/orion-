import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import * as jwt from 'jsonwebtoken';
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { and, eq, inArray } from 'drizzle-orm';
import { TestAppHelper } from './helpers/test-app.helper';
import { TEST_SECRETS } from './helpers/test-secrets';
import * as schema from '../src/database/schema';
import { MonitoringService } from '../src/modules/monitoring/monitoring.service';

/**
 * Phase 24: security monitoring through the running application. Synthetic data, a test-only alert sink, nothing sent outside the process.
 * (Rule thresholds and notifier behaviour are covered by security-alert-rules.spec.ts and security-alerts.integration.spec.ts.)
 */
describe('Security monitoring through the application (Phase 24)', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const unwrap = (res: any) => res.body.data || res.body;
  const tag = `p24${Date.now()}`;
  const emails: string[] = [];
  const adminEmail = `qa.p24.admin.${Date.now()}@monarchsoftwares.com`;
  let admin: { Authorization: string };
  let customer: { Authorization: string };
  const savedEnv = { ...process.env };
  const mon = () => app.get(MonitoringService);

  beforeAll(async () => {
    process.env.SECURITY_SIGNAL_THRESHOLD_AUTH_FAILURE = '3';
    testApp = new TestAppHelper();
    app = await testApp.init();
    await testApp.cleanupUsers([adminEmail]);
    const adminId = await testApp.provisionAdmin(adminEmail, 'SUPER_ADMIN');
    admin = { Authorization: `Bearer ${jwt.sign({ sub: adminId, email: adminEmail, role: 'SUPER_ADMIN', status: 'ACTIVE' }, TEST_SECRETS.jwtAccess, { expiresIn: '1h', issuer: 'orion-api', audience: 'orion-client' })}` };
    const email = `p24.cust.${Date.now()}@orion-test.io`;
    emails.push(email);
    const reg = unwrap(await api().post('/api/v1/auth/register').send({ email, password: 'MonitorPass123!', firstName: 'Mo', lastName: 'Cu' }));
    customer = { Authorization: `Bearer ${reg.tokens.accessToken}` };
  });

  beforeEach(() => {
    (app.get(ThrottlerStorage) as any).storage.clear();
  });

  afterAll(async () => {
    await testApp.db.delete(schema.auditLogs).where(eq(schema.auditLogs.entityType, 'P24_SYNTH'));
    await testApp.cleanupUsers([...emails, adminEmail]);
    await testApp.close();
    for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
    Object.assign(process.env, savedEnv);
  });

  describe('who can see the monitoring data', () => {
    it.each(['/api/v1/monitoring/overview', '/api/v1/monitoring/alerts', '/api/v1/monitoring/errors'])('%s: anonymous 401, customer 403, administrator 200', async (p) => {
      expect((await api().get(p)).status).toBe(401);
      expect((await api().get(p).set(customer)).status).toBe(403);
      expect((await api().get(p).set(admin)).status).toBe(200);
    });

    it('the Prometheus endpoint needs a token or an administrator and is never public', async () => {
      expect((await api().get('/api/v1/metrics')).status).toBe(401);
      expect((await api().get('/api/v1/metrics').set(customer)).status).toBe(401);
    });

    it('the public health routes stay minimal: no counters, no security data, no configuration', async () => {
      const live = JSON.stringify((await api().get('/api/v1/health/live')).body);
      const ready = JSON.stringify((await api().get('/api/v1/health/ready')).body);
      for (const text of [live, ready]) expect(text).not.toMatch(/ABUSE|audit|signal|token|secret|password|DATABASE_URL|@/i);
    });
  });

  describe('a real refusal flow produces the event the alert rules read', () => {
    it('repeated failed sign-ins cross the abuse threshold once: one ABUSE_SIGNAL entry with counts only', async () => {
      const email = `nobody.${tag}@orion-test.io`;
      const before = (await testApp.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, 'ABUSE_SIGNAL'))).length;
      for (let i = 0; i < 6; i++) {
        (app.get(ThrottlerStorage) as any).storage.clear();
        expect((await api().post('/api/v1/auth/login').send({ email, password: `WrongPassword${i}!` })).status).toBe(401);
      }
      await new Promise((r) => setTimeout(r, 400)); // the audit write is in the background
      const rows = (await testApp.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, 'ABUSE_SIGNAL'))) as any[];
      const mine = rows.slice(before).filter((r) => r.entityId === 'AUTH_FAILURE');
      expect(mine.length).toBe(1); // six failures, threshold three: one entry, not four
      const json = JSON.stringify(mine[0]);
      expect(json).not.toContain(email);
      expect(json).not.toContain('WrongPassword');
      expect(mine[0].newValues).toMatchObject({ kind: 'AUTH_FAILURE', threshold: 3, subjectType: 'ADDRESS' });
    });

    it('failed sign-ins are distinguishable from authorization failures: a customer calling an admin route is AUTHZ, not AUTH', async () => {
      const r = await api().get('/api/v1/monitoring/overview').set(customer);
      expect(r.status).toBe(403);
      expect(r.status).not.toBe(401);
      const login = await api().post('/api/v1/auth/login').send({ email: `nobody.${tag}@orion-test.io`, password: 'x-wrong-123' });
      expect(login.status).toBe(401);
    });
  });

  describe('alerts reach the operator through the existing pipeline', () => {
    const insertSignals = async (n: number) => {
      for (let i = 0; i < n; i++) {
        await testApp.db.insert(schema.auditLogs).values({ action: 'ABUSE_SIGNAL', entityType: 'P24_SYNTH', entityId: 'SSRF_REJECTED', ipAddress: `198.51.100.${i + 1}` } as any);
      }
    };

    it('five different sources crossing abuse thresholds raise a critical alert that an administrator can read and that names nobody', async () => {
      await insertSignals(5);
      await mon().alerts(true);
      const res = await api().get('/api/v1/monitoring/alerts').set(admin);
      expect(res.status).toBe(200);
      const alerts = (unwrap(res).alerts ?? unwrap(res)) as any[];
      const a = alerts.find((x) => x.id === 'sec_abuse_signals');
      expect(a).toMatchObject({ severity: 'critical' });
      expect(JSON.stringify(res.body)).not.toContain('198.51.100.');
    });

    it('the alert is sent once to the (test) sink, and the monitor keeps answering while the notifier is broken', async () => {
      const sent: string[] = [];
      const m = mon() as any;
      m.firing = new Map();
      m.alertSink = async (p: { text: string }) => {
        sent.push(p.text);
      };
      await m.evaluateAndNotify();
      expect(sent.join('\n')).toContain('Abuse thresholds reached');
      m.alertSink = async () => {
        throw new Error('notifier down');
      };
      m.firing = new Map();
      await expect(m.evaluateAndNotify()).resolves.toBeDefined();
      expect((await api().get('/api/v1/monitoring/overview').set(admin)).status).toBe(200); // monitoring trouble does not touch the API
      expect((await api().get('/api/v1/monitoring/overview')).status).toBe(401); // and does not open anything either
      m.alertSink = undefined;
      m.firing = new Map();
    });

    it('cleanup removes only this test\'s synthetic rows', async () => {
      await testApp.db.delete(schema.auditLogs).where(and(eq(schema.auditLogs.entityType, 'P24_SYNTH'), inArray(schema.auditLogs.action, ['ABUSE_SIGNAL'])));
      expect((await testApp.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityType, 'P24_SYNTH'))).length).toBe(0);
    });
  });
});

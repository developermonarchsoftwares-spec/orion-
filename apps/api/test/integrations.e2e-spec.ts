import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import * as crypto from 'crypto';
import * as http from 'http';
import * as jwt from 'jsonwebtoken';
import { AddressInfo } from 'net';
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { and, eq } from 'drizzle-orm';
import { TestAppHelper } from './helpers/test-app.helper';
import { TEST_SECRETS } from './helpers/test-secrets';
import { MailService, IMail } from '../src/auth/mail/mail.service';
import { CreditService } from '../src/modules/credit/credit.service';
import { HubSpotClient } from '../src/modules/integrations/crm/hubspot.client';
import { signPayload, verifySignature } from '../src/modules/integrations/integration.constants';
import { IntegrationEventsService } from '../src/modules/integrations/integration-events.service';
import { WebhookDispatcherService } from '../src/modules/integrations/webhook-dispatcher.service';
import * as schema from '../src/database/schema';

interface IReceived {
  path: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

describe('Integrations: webhooks, callbacks, CRM sync, failure monitoring, sync validation', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  const sent: IMail[] = [];
  const api = () => request(app.getHttpServer());
  const unwrap = (res: any) => res.body.data || res.body;
  const emails: string[] = [];
  const adminEmail = 'qa.integrations.admin@monarchsoftwares.com';
  let admin = { Authorization: '' };
  const tag = `zzint${Date.now()}`;

  // ---- a real HTTP receiver on loopback ----
  let server: http.Server;
  let base: string;
  const received: IReceived[] = [];
  let respond: (path: string) => { status: number; headers?: Record<string, string> } = () => ({ status: 200 });

  const newUser = async (name: string) => {
    const email = `int.${name}.${Date.now()}@orion-test.io`;
    emails.push(email);
    const res = unwrap(await api().post('/api/v1/auth/register').send({ email, password: 'IntegrationPass123!', firstName: 'In', lastName: name }));
    return { id: res.user.id as string, email, auth: { Authorization: `Bearer ${res.tokens.accessToken}` } };
  };
  const connect = async (u: { auth: any }, events = ['lead.unlocked', 'export.completed', 'credits.low', 'credits.empty'], path = '/ok') => {
    const res = await api().post('/api/v1/integrations').set(u.auth).send({ type: 'WEBHOOK', name: 'Test hook', targetUrl: `${base}${path}`, events });
    expect(res.status).toBe(201);
    return unwrap(res) as { id: string; signingSecret: string };
  };
  const dispatcher = () => app.get(WebhookDispatcherService);
  const events = () => app.get(IntegrationEventsService);
  const rowOf = async (id: string) => (await testApp.db.select().from(schema.integrations).where(eq(schema.integrations.id, id)))[0];
  const deliveriesOf = (id: string) => testApp.db.select().from(schema.integrationDeliveries).where(eq(schema.integrationDeliveries.integrationId, id));
  const makeDue = (id: string) => testApp.db.update(schema.integrationDeliveries).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(schema.integrationDeliveries.integrationId, id));
  const signedAck = (id: string, secret: string, body: object, t = Math.floor(Date.now() / 1000)) => {
    const raw = JSON.stringify(body);
    return api().post(`/api/v1/integrations/callbacks/${id}`).set('Content-Type', 'application/json').set('x-orion-signature', signPayload(secret, raw, t)).send(raw);
  };

  beforeAll(async () => {
    process.env.INTEGRATIONS_ALLOW_PRIVATE_NETWORK = 'true'; // the receiver is on loopback; production ignores this flag
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ path: req.url ?? '', headers: req.headers, body });
        const r = respond(req.url ?? '');
        res.writeHead(r.status, r.headers).end('{}');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    testApp = new TestAppHelper();
    app = await testApp.init();
    app.get(MailService).transport = { send: async (m) => void sent.push(m) };
    await testApp.cleanupUsers([adminEmail]);
    const adminId = await testApp.provisionAdmin(adminEmail, 'SUPER_ADMIN');
    admin = { Authorization: `Bearer ${jwt.sign({ sub: adminId, email: adminEmail, role: 'SUPER_ADMIN', status: 'ACTIVE' }, TEST_SECRETS.jwtAccess, { expiresIn: '1h', issuer: 'orion-api', audience: 'orion-client' })}` };
  });

  beforeEach(async () => {
    (app.get(ThrottlerStorage) as any).storage.clear();
    await testApp.db.delete(schema.integrationDeliveries);
    received.length = 0;
    respond = () => ({ status: 200 });
    process.env.INTEGRATIONS_ALLOW_PRIVATE_NETWORK = 'true';
  });

  afterAll(async () => {
    const biz = await testApp.db.select({ slug: schema.businesses.slug }).from(schema.businesses);
    await testApp.cleanupBusinesses(biz.map((b) => b.slug).filter((s) => s.startsWith(tag)));
    await testApp.cleanupUsers([...emails, adminEmail]);
    await testApp.close();
    await new Promise<void>((r) => server.close(() => r()));
    delete process.env.INTEGRATIONS_ALLOW_PRIVATE_NETWORK;
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('connecting a webhook', () => {
    it('validates input, returns the signing secret once, and never exposes a secret afterwards', async () => {
      const u = await newUser('create');
      const post = (b: object) => api().post('/api/v1/integrations').set(u.auth).send(b);
      expect((await post({ type: 'WEBHOOK', name: 'x', events: ['lead.unlocked'] })).status).toBe(400); // no URL
      expect((await post({ type: 'WEBHOOK', name: 'x', targetUrl: `${base}/ok`, events: [] })).status).toBe(400);
      expect((await post({ type: 'WEBHOOK', name: 'x', targetUrl: `${base}/ok`, events: ['nope'] })).status).toBe(400);
      expect((await post({ type: 'WEBHOOK', name: 'x', targetUrl: `${base}/ok`, events: ['integration.test'] })).status).toBe(400); // not subscribable
      expect((await post({ type: 'FAX', name: 'x' })).status).toBe(400);
      expect((await post({ type: 'WEBHOOK', name: '', targetUrl: `${base}/ok`, events: ['lead.unlocked'] })).status).toBe(400);
      expect((await post({ type: 'HUBSPOT', name: 'crm' })).status).toBe(400); // no token
      expect((await api().post('/api/v1/integrations').send({})).status).toBe(401);

      const created = await post({ type: 'WEBHOOK', name: ' Prod hook ', targetUrl: `${base}/ok`, events: ['lead.unlocked', 'lead.unlocked', 'export.completed'] });
      expect(created.status).toBe(201);
      const c = unwrap(created);
      expect(c.signingSecret).toMatch(/^whsec_/);
      expect(c).toMatchObject({ type: 'WEBHOOK', name: 'Prod hook', status: 'ACTIVE', events: ['lead.unlocked', 'export.completed'], health: { state: 'HEALTHY' } });

      const again = JSON.stringify(unwrap(await api().get(`/api/v1/integrations/${c.id}`).set(u.auth)));
      const listed = JSON.stringify(unwrap(await api().get('/api/v1/integrations').set(u.auth)));
      expect(again).not.toContain(c.signingSecret);
      expect(listed).not.toContain(c.signingSecret);
      expect(again).not.toMatch(/signingSecret|signing_secret|credential_enc/);
      const row = await rowOf(c.id);
      expect(row.signingSecretEnc).not.toContain(c.signingSecret); // sealed at rest
      expect(row.signingSecretEnc.startsWith('v1.')).toBe(true);
    });

    it('refuses targets that would reach an internal network (checked with the private-network allowance off)', async () => {
      const u = await newUser('ssrf');
      delete process.env.INTEGRATIONS_ALLOW_PRIVATE_NETWORK;
      const post = (targetUrl: string) => api().post('/api/v1/integrations').set(u.auth).send({ type: 'WEBHOOK', name: 'x', targetUrl, events: ['lead.unlocked'] });
      for (const url of ['https://127.0.0.1/hook', 'https://localhost/hook', 'https://169.254.169.254/latest/meta-data/', 'https://10.0.0.5/x', 'https://[::1]/x', 'https://[::ffff:127.0.0.1]/x', 'https://2130706433/x', 'http://example.com/hook', 'ftp://example.com/x', 'file:///etc/passwd', 'https://user:pw@example.com/x', 'not a url']) {
        const r = await post(url);
        expect([400]).toContain(r.status);
      }
      expect(JSON.stringify((await post('https://169.254.169.254/x')).body)).toContain('UNSAFE_TARGET_URL');
      expect(unwrap(await api().get('/api/v1/integrations').set(u.auth))).toHaveLength(0);
    });

    it('re-checks the URL when it is changed, and keeps integrations private to their owner', async () => {
      const a = await newUser('own-a');
      const b = await newUser('own-b');
      const c = await connect(a);
      delete process.env.INTEGRATIONS_ALLOW_PRIVATE_NETWORK;
      expect((await api().patch(`/api/v1/integrations/${c.id}`).set(a.auth).send({ targetUrl: 'https://169.254.169.254/x' })).status).toBe(400);
      process.env.INTEGRATIONS_ALLOW_PRIVATE_NETWORK = 'true';
      expect((await api().patch(`/api/v1/integrations/${c.id}`).set(a.auth).send({ name: 'Renamed' })).status).toBe(200);
      const calls: Array<() => any> = [
        () => api().get(`/api/v1/integrations/${c.id}`),
        () => api().patch(`/api/v1/integrations/${c.id}`).send({ name: 'x' }),
        () => api().delete(`/api/v1/integrations/${c.id}`),
        () => api().post(`/api/v1/integrations/${c.id}/test`),
        () => api().post(`/api/v1/integrations/${c.id}/rotate-secret`),
        () => api().get(`/api/v1/integrations/${c.id}/deliveries`),
        () => api().post(`/api/v1/integrations/${c.id}/validate`).send({}),
      ];
      for (const call of calls) expect((await call().set(b.auth)).status).toBe(404);
      expect((await api().get('/api/v1/integrations/not-a-uuid').set(a.auth)).status).toBe(404);
      expect(unwrap(await api().get('/api/v1/integrations').set(b.auth))).toHaveLength(0);
    });

    it('limits a user to 10 integrations, and deleting one removes its delivery history', async () => {
      const u = await newUser('limit');
      const first = await connect(u);
      for (let i = 1; i < 10; i++) await connect(u);
      expect((await api().post('/api/v1/integrations').set(u.auth).send({ type: 'WEBHOOK', name: 'x', targetUrl: `${base}/ok`, events: ['lead.unlocked'] })).status).toBe(409);
      await events().emit(u.id, 'lead.unlocked', { businessId: 'b' });
      expect((await deliveriesOf(first.id)).length).toBe(1);
      expect((await api().delete(`/api/v1/integrations/${first.id}`).set(u.auth)).status).toBe(200);
      expect(await deliveriesOf(first.id)).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('delivery: signing, filtering, retries', () => {
    it('a test ping is signed, carries its delivery id and callback URL, and a failing endpoint is reported without hurting health', async () => {
      const u = await newUser('ping');
      const c = await connect(u);
      const ok = unwrap(await api().post(`/api/v1/integrations/${c.id}/test`).set(u.auth));
      expect(ok).toMatchObject({ ok: true, statusCode: 200 });
      expect(received).toHaveLength(1);
      const r = received[0];
      expect(r.headers['x-orion-event']).toBe('integration.test');
      expect(r.headers['user-agent']).toBe('Orion-Webhooks/1.0');
      expect(verifySignature(c.signingSecret, r.body, r.headers['x-orion-signature'] as string)).toBe(true);
      expect(verifySignature('whsec_wrong', r.body, r.headers['x-orion-signature'] as string)).toBe(false);
      const body = JSON.parse(r.body);
      expect(body).toMatchObject({ type: 'integration.test', deliveryId: r.headers['x-orion-delivery'] });
      expect(body.callbackUrl).toContain(`/integrations/callbacks/${c.id}`);

      respond = () => ({ status: 500 });
      const bad = unwrap(await api().post(`/api/v1/integrations/${c.id}/test`).set(u.auth));
      expect(bad).toMatchObject({ ok: false, statusCode: 500 });
      expect((await rowOf(c.id)).consecutiveFailures).toBe(0); // a manual test says nothing about real traffic
    });

    it('delivers only subscribed events, only for the owner, only while active', async () => {
      const a = await newUser('route-a');
      const b = await newUser('route-b');
      const onlyCredits = await connect(a, ['credits.low']);
      const exportsHook = await connect(a, ['export.completed']);
      const bHook = await connect(b, ['export.completed']);
      const paused = await connect(a, ['export.completed']);
      await api().patch(`/api/v1/integrations/${paused.id}`).set(a.auth).send({ status: 'PAUSED' });

      const exp = await api().post('/api/v1/exports').set(a.auth).send({ dataset: 'saved-leads', format: 'csv' });
      expect(exp.status).toBe(200);
      expect(await deliveriesOf(onlyCredits.id)).toHaveLength(0);
      expect(await deliveriesOf(bHook.id)).toHaveLength(0);
      expect(await deliveriesOf(paused.id)).toHaveLength(0);
      const mine = await deliveriesOf(exportsHook.id);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ event: 'export.completed', status: 'PENDING' });

      expect(await dispatcher().tick()).toMatchObject({ attempted: 1, succeeded: 1 });
      expect(received).toHaveLength(1);
      const body = JSON.parse(received[0].body);
      expect(body.data).toMatchObject({ dataset: 'saved-leads', format: 'csv', rowCount: 0, source: 'ON_DEMAND' });
      expect(JSON.stringify(body)).not.toMatch(/@|password|token/); // ids and counts only
      expect((await deliveriesOf(exportsHook.id))[0]).toMatchObject({ status: 'SUCCEEDED', attempts: 1, lastStatusCode: 200 });
      expect((await rowOf(exportsHook.id)).lastSuccessAt).not.toBeNull();
    });

    it('credit warnings and unlock events reach the webhook through the real code paths', async () => {
      const u = await newUser('real');
      const c = await connect(u, ['credits.low', 'credits.empty']);
      const credit = app.get(CreditService);
      await api().post('/api/v1/credit/admin/adjust').set(admin).send({ userId: u.id, dailyDelta: -4, reason: 'QA balance setup' });
      expect(await credit.notifyIfLow(u.id)).toBe('LOW');
      await api().post('/api/v1/credit/admin/adjust').set(admin).send({ userId: u.id, dailyDelta: -1, reason: 'QA balance setup' });
      expect(await credit.notifyIfLow(u.id)).toBe('EMPTY');
      const rows = await deliveriesOf(c.id);
      expect(rows.map((r) => r.event).sort()).toEqual(['credits.empty', 'credits.low']);
      expect(rows.find((r) => r.event === 'credits.low')!.payload).toMatchObject({ data: { balance: 1, threshold: 2 } });
    });

    it('retries a failing endpoint with growing waits, ends DEAD after six attempts, and can be redelivered once fixed', async () => {
      const u = await newUser('retry');
      const c = await connect(u);
      await events().emit(u.id, 'lead.unlocked', { businessId: 'b1' });
      respond = () => ({ status: 503 });

      const waits: number[] = [];
      for (let attempt = 1; attempt <= 6; attempt++) {
        expect((await dispatcher().tick()).attempted).toBe(1);
        const [d] = await deliveriesOf(c.id);
        expect(d.attempts).toBe(attempt);
        expect(d.lastError).toBe('HTTP 503');
        if (attempt < 6) {
          expect(d.status).toBe('FAILED');
          waits.push(d.nextAttemptAt.getTime() - Date.now());
          expect(await dispatcher().tick()).toMatchObject({ attempted: 0 }); // not due yet: no hammering
          await makeDue(c.id);
        } else expect(d.status).toBe('DEAD');
      }
      // 30 s, 2 min, 10 min, 1 h, 6 h
      [30_000, 120_000, 600_000, 3_600_000, 21_600_000].forEach((w, i) => {
        expect(waits[i]).toBeGreaterThan(w - 10_000);
        expect(waits[i]).toBeLessThanOrEqual(w);
      });
      expect(await dispatcher().tick()).toMatchObject({ attempted: 0 }); // dead: left alone
      expect(unwrap(await api().get(`/api/v1/integrations/${c.id}`).set(u.auth)).health).toMatchObject({ state: 'FAILING', last24h: { dead: 1 } });

      respond = () => ({ status: 200 });
      const [dead] = await deliveriesOf(c.id);
      expect((await api().post(`/api/v1/integrations/${c.id}/deliveries/${dead.id}/redeliver`).set(u.auth)).status).toBe(200);
      expect(await dispatcher().tick()).toMatchObject({ attempted: 1, succeeded: 1 });
      expect((await deliveriesOf(c.id))[0]).toMatchObject({ status: 'SUCCEEDED', attempts: 1 });
      expect((await rowOf(c.id)).consecutiveFailures).toBe(0);
      // a delivery that already succeeded cannot be "redelivered"
      expect((await api().post(`/api/v1/integrations/${c.id}/deliveries/${dead.id}/redeliver`).set(u.auth)).status).toBe(404);
    });

    it('does not follow a redirect to somewhere else: a 3xx is a failed delivery', async () => {
      const u = await newUser('redirect');
      const c = await connect(u, ['lead.unlocked'], '/redirect');
      respond = (p) => (p === '/redirect' ? { status: 302, headers: { location: `${base}/internal` } } : { status: 200 });
      await events().emit(u.id, 'lead.unlocked', { businessId: 'b' });
      await dispatcher().tick();
      expect((await deliveriesOf(c.id))[0]).toMatchObject({ status: 'FAILED', lastStatusCode: 302 });
      expect(received.some((r) => r.path === '/internal')).toBe(false);
    });

    it('two overlapping passes deliver an event once', async () => {
      const u = await newUser('once');
      const c = await connect(u);
      await events().emit(u.id, 'lead.unlocked', { businessId: 'b' });
      const [a, b] = await Promise.all([dispatcher().tick(), dispatcher().tick()]);
      expect(a.attempted + b.attempted).toBe(1);
      expect(received).toHaveLength(1);
      expect((await deliveriesOf(c.id))[0].attempts).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('failure monitoring', () => {
    it('ten failures in a row switch the integration off, tell the owner, audit it, queue nothing more, and it can be switched back on', async () => {
      const u = await newUser('disable');
      const c = await connect(u);
      respond = () => ({ status: 500 });
      for (let i = 0; i < 10; i++) await events().emit(u.id, 'lead.unlocked', { businessId: `b${i}` });
      sent.length = 0;
      expect(await dispatcher().tick()).toMatchObject({ attempted: 10, succeeded: 0 });

      const row = await rowOf(c.id);
      expect(row).toMatchObject({ status: 'DISABLED', consecutiveFailures: 10, lastError: 'HTTP 500' });
      expect(row.disabledReason).toContain('10 failures in a row');
      expect(sent.some((m) => m.to === u.email && m.subject.includes('was switched off'))).toBe(true);
      const audit = await testApp.db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.userId, u.id), eq(schema.auditLogs.action, 'INTEGRATION_DISABLED')));
      expect(audit).toHaveLength(1);

      expect(await events().emit(u.id, 'lead.unlocked', { businessId: 'later' })).toBe(0); // switched off: nothing is queued
      expect(unwrap(await api().get(`/api/v1/integrations/${c.id}`).set(u.auth)).health.state).toBe('DISABLED');

      respond = () => ({ status: 200 });
      const on = unwrap(await api().patch(`/api/v1/integrations/${c.id}`).set(u.auth).send({ status: 'ACTIVE' }));
      expect(on).toMatchObject({ status: 'ACTIVE', consecutiveFailures: 0, disabledReason: null });
      expect(await events().emit(u.id, 'lead.unlocked', { businessId: 'again' })).toBe(1);
    });

    it('an endpoint that answers 410 Gone is switched off at once and its delivery is not retried', async () => {
      const u = await newUser('gone');
      const c = await connect(u);
      respond = () => ({ status: 410 });
      await events().emit(u.id, 'lead.unlocked', { businessId: 'b' });
      await dispatcher().tick();
      expect((await deliveriesOf(c.id))[0]).toMatchObject({ status: 'DEAD', attempts: 1 });
      expect(await rowOf(c.id)).toMatchObject({ status: 'DISABLED', disabledReason: 'endpoint returned 410 Gone' });
    });

    it('a success clears the run of failures', async () => {
      const u = await newUser('recover');
      const c = await connect(u);
      respond = () => ({ status: 500 });
      for (let i = 0; i < 3; i++) await events().emit(u.id, 'lead.unlocked', { businessId: `b${i}` });
      await dispatcher().tick();
      expect((await rowOf(c.id)).consecutiveFailures).toBe(3);
      expect(unwrap(await api().get(`/api/v1/integrations/${c.id}`).set(u.auth)).health.state).toBe('DEGRADED');
      respond = () => ({ status: 200 });
      await makeDue(c.id);
      await dispatcher().tick();
      expect((await rowOf(c.id)).consecutiveFailures).toBe(0);
      expect(unwrap(await api().get(`/api/v1/integrations/${c.id}`).set(u.auth)).health.state).toBe('HEALTHY');
    });

    it('administrators see unhealthy integrations across customers and the delivery backlog; customers cannot', async () => {
      const u = await newUser('adminview');
      const c = await connect(u);
      respond = () => ({ status: 500 });
      await events().emit(u.id, 'lead.unlocked', { businessId: 'b' });
      await dispatcher().tick();
      expect((await api().get('/api/v1/integrations/admin/health').set(u.auth)).status).toBe(403);
      expect((await api().get('/api/v1/integrations/admin/health')).status).toBe(401);
      const h = unwrap(await api().get('/api/v1/integrations/admin/health').set(admin));
      expect(h.totals).toEqual(expect.objectContaining({ HEALTHY: expect.any(Number), DISABLED: expect.any(Number) }));
      const mine = h.problems.find((p: any) => p.id === c.id);
      expect(mine).toMatchObject({ userEmail: u.email, state: 'DEGRADED', consecutiveFailures: 1, lastError: 'HTTP 500' });
      expect(h.deliveries.last7days.queued).toBeGreaterThan(0);
      expect(JSON.stringify(h)).not.toMatch(/whsec_|signing/);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('API callbacks (receiver reports the outcome)', () => {
    it('accepts a correctly signed acknowledgement and refuses everything else', async () => {
      const a = await newUser('cb-a');
      const c = await connect(a);
      const other = await connect(a);
      await events().emit(a.id, 'lead.unlocked', { businessId: 'b' });
      await dispatcher().tick();
      const [d] = await deliveriesOf(c.id);

      const ok = await signedAck(c.id, c.signingSecret, { deliveryId: d.id, status: 'PROCESSED', message: 'created in CRM' });
      expect(ok.status).toBe(200);
      expect((await deliveriesOf(c.id))[0]).toMatchObject({ ackStatus: 'PROCESSED', ackMessage: 'created in CRM' });
      expect((await deliveriesOf(c.id))[0].ackedAt).not.toBeNull();

      const good = { deliveryId: d.id, status: 'PROCESSED' };
      expect((await signedAck(c.id, 'whsec_wrong-secret', good)).status).toBe(401);
      expect((await signedAck(c.id, c.signingSecret, good, Math.floor(Date.now() / 1000) - 3600)).status).toBe(401); // too old: replay window
      expect((await signedAck(c.id, c.signingSecret, good, Math.floor(Date.now() / 1000) + 3600)).status).toBe(401);
      expect((await signedAck(other.id, c.signingSecret, good)).status).toBe(401); // another integration's secret
      expect((await signedAck('00000000-0000-0000-0000-000000000000', c.signingSecret, good)).status).toBe(401);
      expect((await signedAck('not-a-uuid', c.signingSecret, good)).status).toBe(401);
      expect((await api().post(`/api/v1/integrations/callbacks/${c.id}`).send(good)).status).toBe(401); // unsigned
      // a signature is for one exact body: change it and it no longer verifies
      const raw = JSON.stringify(good);
      const tampered = await api().post(`/api/v1/integrations/callbacks/${c.id}`).set('Content-Type', 'application/json').set('x-orion-signature', signPayload(c.signingSecret, raw)).send(raw.replace('PROCESSED', 'REJECTED'));
      expect(tampered.status).toBe(401);

      expect((await signedAck(c.id, c.signingSecret, { deliveryId: d.id, status: 'MAYBE' })).status).toBe(400);
      expect((await signedAck(c.id, c.signingSecret, { status: 'PROCESSED' })).status).toBe(400);
      expect((await signedAck(c.id, c.signingSecret, { deliveryId: '11111111-1111-1111-1111-111111111111', status: 'PROCESSED' })).status).toBe(404);
      // a delivery of a different integration cannot be acknowledged through this one
      await events().emit(a.id, 'lead.unlocked', { businessId: 'b2' });
      await dispatcher().tick();
      const [od] = await deliveriesOf(other.id);
      expect((await signedAck(c.id, c.signingSecret, { deliveryId: od.id, status: 'PROCESSED' })).status).toBe(404);
      expect((await deliveriesOf(other.id))[0].ackStatus).toBeNull();
    });

    it('rotating the secret makes the old one stop working at once', async () => {
      const u = await newUser('rotate');
      const c = await connect(u);
      await events().emit(u.id, 'lead.unlocked', { businessId: 'b' });
      await dispatcher().tick();
      const [d] = await deliveriesOf(c.id);
      const rot = unwrap(await api().post(`/api/v1/integrations/${c.id}/rotate-secret`).set(u.auth));
      expect(rot.signingSecret).toMatch(/^whsec_/);
      expect(rot.signingSecret).not.toBe(c.signingSecret);
      expect((await signedAck(c.id, c.signingSecret, { deliveryId: d.id, status: 'PROCESSED' })).status).toBe(401);
      expect((await signedAck(c.id, rot.signingSecret, { deliveryId: d.id, status: 'PROCESSED' })).status).toBe(200);
      // deliveries made after the rotation are signed with the new secret
      received.length = 0;
      await events().emit(u.id, 'lead.unlocked', { businessId: 'b2' });
      await dispatcher().tick();
      expect(verifySignature(rot.signingSecret, received[0].body, received[0].headers['x-orion-signature'] as string)).toBe(true);
      expect(verifySignature(c.signingSecret, received[0].body, received[0].headers['x-orion-signature'] as string)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('synchronisation validation for webhooks', () => {
    it('reconciles emitted, delivered, dead and rejected events, and flags what needs attention', async () => {
      const u = await newUser('recon');
      const c = await connect(u);
      for (let i = 0; i < 4; i++) await events().emit(u.id, 'lead.unlocked', { businessId: `b${i}` });
      respond = (p) => ({ status: 200 });
      await dispatcher().tick();
      const rows = await deliveriesOf(c.id);
      // 0: processed, 1: rejected by the receiver, 2: delivered but never acknowledged, 3: forced dead
      await signedAck(c.id, c.signingSecret, { deliveryId: rows[0].id, status: 'PROCESSED' });
      await signedAck(c.id, c.signingSecret, { deliveryId: rows[1].id, status: 'REJECTED', message: 'unknown company' });
      await testApp.db.update(schema.integrationDeliveries).set({ status: 'DEAD', lastError: 'HTTP 500' }).where(eq(schema.integrationDeliveries.id, rows[3].id));

      const rep = unwrap(await api().post(`/api/v1/integrations/${c.id}/validate`).set(u.auth).send({}));
      expect(rep).toMatchObject({ kind: 'DELIVERIES', consistent: false });
      expect(rep.summary).toMatchObject({ emitted: 4, delivered: 3, dead: 1, processedByReceiver: 1, rejectedByReceiver: 1, deliveredButUnacknowledged: 1, inFlight: 0, overdue: 0 });
      expect(rep.problems.map((p: any) => p.status === 'DEAD' || p.ackStatus === 'REJECTED').every(Boolean)).toBe(true);
      expect(rep.problems).toHaveLength(2);
      expect((await rowOf(c.id)).lastValidatedAt).not.toBeNull();

      // clean state: a fresh webhook whose events were all delivered is consistent
      const clean = await connect(u, ['export.completed']);
      await events().emit(u.id, 'export.completed', { exportId: 'e' });
      await dispatcher().tick();
      expect(unwrap(await api().post(`/api/v1/integrations/${clean.id}/validate`).set(u.auth).send({})).consistent).toBe(true);
    });

    it('flags events that are overdue (queued far longer than they should be)', async () => {
      const u = await newUser('overdue');
      const c = await connect(u);
      await events().emit(u.id, 'lead.unlocked', { businessId: 'b' });
      await testApp.db.update(schema.integrationDeliveries).set({ nextAttemptAt: new Date(Date.now() - 3_600_000) }).where(eq(schema.integrationDeliveries.integrationId, c.id));
      const rep = unwrap(await api().post(`/api/v1/integrations/${c.id}/validate`).set(u.auth).send({}));
      expect(rep).toMatchObject({ consistent: false, summary: { inFlight: 1, overdue: 1 } });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('CRM integration (HubSpot, against a fake CRM)', () => {
    interface IFake {
      companies: Map<string, any>;
      contacts: Map<string, any>;
      calls: Array<{ method: string; path: string; body?: any; token: string }>;
      mode: { auth?: boolean; rateLimitAfter?: number; duplicateEmail?: string; deleted?: Set<string> };
    }
    let fake: IFake;
    let nextId = 1000;
    const installFake = () => {
      fake = { companies: new Map(), contacts: new Map(), calls: [], mode: {} };
      nextId = 1000;
      app.get(HubSpotClient).request = (async (token: string, method: string, path: string, body?: any) => {
        fake.calls.push({ method, path, body, token });
        if (fake.mode.auth) return { status: 401, json: { message: 'Authentication credentials not valid' } };
        if (fake.mode.rateLimitAfter !== undefined && fake.calls.filter((c) => c.method !== 'GET').length > fake.mode.rateLimitAfter) return { status: 429, json: { message: 'rate limit' }, retryAfterSeconds: 10 };
        const isCompany = path.includes('/companies');
        const store = isCompany ? fake.companies : fake.contacts;
        const m = /\/(?:companies|contacts)\/(\d+)(?:\?.*)?$/.exec(path);
        if (method === 'POST') {
          if (!isCompany && body.properties.email === fake.mode.duplicateEmail) return { status: 409, json: { message: 'Contact already exists. Existing ID: 555' } };
          const id = String(nextId++);
          store.set(id, { id, properties: { ...body.properties }, associations: body.associations });
          return { status: 201, json: { id, properties: body.properties } };
        }
        if (method === 'PATCH' && m) {
          if (m[1] === '555') {
            fake.contacts.set('555', { id: '555', properties: { ...body.properties } });
            return { status: 200, json: { id: '555' } };
          }
          if (!store.has(m[1]) || fake.mode.deleted?.has(m[1])) return { status: 404, json: { message: 'not found' } };
          store.get(m[1]).properties = { ...store.get(m[1]).properties, ...body.properties };
          return { status: 200, json: { id: m[1] } };
        }
        if (method === 'GET' && m) {
          if (!store.has(m[1]) || fake.mode.deleted?.has(m[1])) return { status: 404, json: { message: 'not found' } };
          return { status: 200, json: store.get(m[1]) };
        }
        if (method === 'GET') return { status: 200, json: { results: [] } };
        if (method === 'PUT') return { status: 200, json: {} };
        return { status: 400, json: { message: 'unexpected' } };
      }) as any;
    };
    const lead = async (u: { id: string }, n: string, contactEmail: string) => {
      const b = await testApp.createTestBusiness({ slug: `${tag}-${n}`, name: `Crm ${n} Pvt`, contactEmail, contactPhone: '+91 9000000010' });
      await testApp.db.insert(schema.leadUnlocks).values({ userId: u.id, businessId: b.id });
      return b;
    };
    const connectCrm = async (u: { auth: any }) => {
      const r = await api().post('/api/v1/integrations').set(u.auth).send({ type: 'HUBSPOT', name: 'HubSpot', credential: 'pat-na1-0123456789abcdef-secret-token' });
      expect(r.status).toBe(201);
      return unwrap(r) as { id: string; signingSecret: string };
    };
    const sync = (u: { auth: any }, id: string, body: object = {}) => api().post(`/api/v1/integrations/${id}/sync`).set(u.auth).send(body);
    const validate = (u: { auth: any }, id: string, body: object = {}) => unwrap(api().post(`/api/v1/integrations/${id}/validate`).set(u.auth).send(body) as any);

    beforeEach(() => installFake());

    it('stores the token sealed, never returns it, and a connection test reads with it', async () => {
      const u = await newUser('crm-token');
      const c = await connectCrm(u);
      const row = await rowOf(c.id);
      expect(row.credentialEnc).toBeTruthy();
      expect(row.credentialEnc).not.toContain('pat-na1');
      expect(JSON.stringify(unwrap(await api().get(`/api/v1/integrations/${c.id}`).set(u.auth)))).not.toContain('pat-na1');
      expect(unwrap(await api().get(`/api/v1/integrations/${c.id}`).set(u.auth))).toMatchObject({ type: 'HUBSPOT', hasCredential: true, targetUrl: null });
      expect(unwrap(await api().post(`/api/v1/integrations/${c.id}/test`).set(u.auth))).toMatchObject({ ok: true });
      expect(fake.calls[0]).toMatchObject({ method: 'GET', token: 'pat-na1-0123456789abcdef-secret-token' });
      fake.mode.auth = true;
      expect(unwrap(await api().post(`/api/v1/integrations/${c.id}/test`).set(u.auth))).toMatchObject({ ok: false, statusCode: 401 });
      // CRM-only operations are refused for a webhook, and the other way round
      const hook = await connect(u);
      expect((await sync(u, hook.id)).status).toBe(400);
    });

    it('pushes only UNLOCKED leads: companies first, contacts attached to their company, and a second sync sends nothing', async () => {
      const u = await newUser('crm-sync');
      await lead(u, 'a', 'a.contact@example.com');
      await lead(u, 'b', 'b.contact@example.com');
      await testApp.createTestBusiness({ slug: `${tag}-locked`, name: 'Crm Locked Pvt', contactEmail: 'locked.nobody@example.com', contactPhone: '+91 9000000011' });
      const c = await connectCrm(u);

      const r = unwrap(await sync(u, c.id));
      expect(r).toMatchObject({ attempted: 4, created: 4, updated: 0, failed: 0, remaining: 0, rateLimited: false });
      expect([...fake.companies.values()].map((x) => x.properties.name).sort()).toEqual(['Crm a Pvt', 'Crm b Pvt']);
      expect(JSON.stringify([...fake.contacts.values()])).not.toContain('locked.nobody');
      expect(JSON.stringify(fake.calls)).not.toContain('Crm Locked');
      // the order of calls: both companies before any contact
      const methods = fake.calls.filter((x) => x.method === 'POST').map((x) => (x.path.includes('companies') ? 'C' : 'P')).join('');
      expect(methods).toBe('CCPP');
      const contactCall = fake.calls.find((x) => x.path.includes('/contacts'))!;
      expect(contactCall.body.properties).toMatchObject({ email: expect.stringContaining('@example.com'), firstname: 'Vikram', lastname: 'Aditya Sharma', jobtitle: 'Chief Technology Officer' });
      expect(contactCall.body.associations[0]).toMatchObject({ types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 279 }] });
      expect(Number(contactCall.body.associations[0].to.id)).toBeGreaterThanOrEqual(1000);
      expect(await testApp.db.select().from(schema.syncRecords).where(eq(schema.syncRecords.integrationId, c.id))).toHaveLength(4);

      fake.calls.length = 0;
      expect(unwrap(await sync(u, c.id))).toMatchObject({ attempted: 0, created: 0, updated: 0 });
      expect(fake.calls).toHaveLength(0);
      expect((await rowOf(c.id)).lastSuccessAt).not.toBeNull();
    });

    it('validation finds missing, stale, failed and orphaned records, a sync fixes them, and remote checks catch CRM-side drift', async () => {
      const u = await newUser('crm-validate');
      const a = await lead(u, 'va', 'va.contact@example.com');
      const c = await connectCrm(u);

      // nothing pushed yet: everything is missing
      let rep = unwrap(await api().post(`/api/v1/integrations/${c.id}/validate`).set(u.auth).send({}));
      expect(rep).toMatchObject({ kind: 'CRM', consistent: false, summary: { expected: 2, missing: 2, inSync: 0 } });
      await sync(u, c.id);
      rep = unwrap(await api().post(`/api/v1/integrations/${c.id}/validate`).set(u.auth).send({}));
      expect(rep).toMatchObject({ consistent: true, summary: { expected: 2, inSync: 2, missing: 0, stale: 0, failed: 0, orphaned: 0 } });

      // a local change makes the pushed record stale; a new unlock is missing; a removed contact is orphaned
      await testApp.db.update(schema.businesses).set({ name: 'Crm va Renamed Pvt' }).where(eq(schema.businesses.id, a.id));
      const b = await lead(u, 'vb', 'vb.contact@example.com');
      await testApp.db.delete(schema.businessContacts).where(eq(schema.businessContacts.businessId, a.id));
      rep = unwrap(await api().post(`/api/v1/integrations/${c.id}/validate`).set(u.auth).send({}));
      expect(rep.consistent).toBe(false);
      expect(rep.summary).toMatchObject({ stale: 1, missing: 2, orphaned: 1 });
      expect(rep.samples.stale[0]).toMatchObject({ entityType: 'COMPANY', localId: a.id });
      expect(rep.samples.orphaned[0]).toMatchObject({ entityType: 'CONTACT' });

      // the sync updates the changed company (PATCH) and creates the new ones
      fake.calls.length = 0;
      const r = unwrap(await sync(u, c.id));
      expect(r).toMatchObject({ created: 2, updated: 1, failed: 0 });
      expect(fake.calls.some((x) => x.method === 'PATCH' && x.path.includes('/companies/'))).toBe(true);
      rep = unwrap(await api().post(`/api/v1/integrations/${c.id}/validate`).set(u.auth).send({}));
      expect(rep.summary).toMatchObject({ missing: 0, stale: 0, failed: 0, orphaned: 1 }); // orphans are reported, never deleted remotely
      expect(rep.advice).toMatch(/Orphaned records are not deleted/);

      // CRM-side drift, seen only with a remote check
      const recs = await testApp.db.select().from(schema.syncRecords).where(and(eq(schema.syncRecords.integrationId, c.id), eq(schema.syncRecords.entityType, 'COMPANY')));
      const recB = recs.find((x) => x.localId === b.id)!;
      const recA = recs.find((x) => x.localId === a.id)!;
      fake.mode.deleted = new Set([recB.externalId!]);
      fake.companies.get(recA.externalId!).properties.name = 'Someone edited this in the CRM';
      rep = unwrap(await api().post(`/api/v1/integrations/${c.id}/validate`).set(u.auth).send({ remote: true }));
      expect(rep.consistent).toBe(false);
      expect(rep.summary).toMatchObject({ remoteMissing: 1, remoteMismatch: 1 });
      expect(rep.samples.remoteMissing[0]).toMatchObject({ entityType: 'COMPANY', localId: b.id });
      expect(rep.samples.remoteMismatch[0]).toMatchObject({ entityType: 'COMPANY', localId: a.id, field: 'name' });

      // a record deleted at the CRM is created again by the next sync
      fake.mode.deleted = new Set([recB.externalId!]);
      await testApp.db.update(schema.businesses).set({ name: 'Crm vb Renamed Pvt' }).where(eq(schema.businesses.id, b.id));
      const again = unwrap(await sync(u, c.id));
      expect(again.failed).toBe(0);
      expect(fake.calls.filter((x) => x.method === 'POST' && x.path.includes('companies')).length).toBeGreaterThanOrEqual(1);
    });

    it('a rejected token switches the integration off; a rate limit stops the run without counting as a failure', async () => {
      const u = await newUser('crm-fail');
      await lead(u, 'f1', 'f1.contact@example.com');
      await lead(u, 'f2', 'f2.contact@example.com');
      const c = await connectCrm(u);

      fake.mode.rateLimitAfter = 1;
      const limited = unwrap(await sync(u, c.id));
      expect(limited).toMatchObject({ rateLimited: true, created: 1, remaining: 3 });
      expect((await rowOf(c.id)).consecutiveFailures).toBe(0);
      expect((await rowOf(c.id)).status).toBe('ACTIVE');
      fake.mode.rateLimitAfter = undefined;
      expect(unwrap(await sync(u, c.id))).toMatchObject({ created: 3, remaining: 0, rateLimited: false }); // resumes where it stopped

      await testApp.db.update(schema.businesses).set({ name: 'Crm f1 Changed Pvt' }).where(like1(tag, 'f1'));
      fake.mode.auth = true;
      sent.length = 0;
      const rej = unwrap(await sync(u, c.id));
      expect(rej).toMatchObject({ credentialRejected: true, failed: 1 });
      expect(await rowOf(c.id)).toMatchObject({ status: 'DISABLED', disabledReason: 'access token rejected by the CRM' });
      expect(sent.some((m) => m.to === u.email && m.subject.includes('was switched off'))).toBe(true);
      expect((await sync(u, c.id)).status).toBe(409); // switched off: no more calls until the owner acts

      // replacing the token switches it back on
      fake.mode.auth = false;
      const fixed = unwrap(await api().patch(`/api/v1/integrations/${c.id}`).set(u.auth).send({ credential: 'pat-na1-new-token-0123456789abcdef' }));
      expect(fixed).toMatchObject({ status: 'ACTIVE', consecutiveFailures: 0 });
      expect(unwrap(await sync(u, c.id))).toMatchObject({ failed: 0 });
      expect(fake.calls.at(-1)!.token).toBe('pat-na1-new-token-0123456789abcdef');
    });

    it('adopts an existing CRM contact with the same e-mail instead of failing', async () => {
      const u = await newUser('crm-dup');
      await lead(u, 'd1', 'dup.contact@example.com');
      fake.mode.duplicateEmail = 'dup.contact@example.com';
      const c = await connectCrm(u);
      const r = unwrap(await sync(u, c.id));
      expect(r).toMatchObject({ failed: 0, created: 1, updated: 1 });
      const rec = (await testApp.db.select().from(schema.syncRecords).where(and(eq(schema.syncRecords.integrationId, c.id), eq(schema.syncRecords.entityType, 'CONTACT'))))[0];
      expect(rec).toMatchObject({ externalId: '555', status: 'SYNCED' });
      expect(fake.calls.some((x) => x.method === 'PUT' && x.path.includes('/associations/default/company/'))).toBe(true);
    });
  });
});

/** businesses whose slug is `<tag>-<n>` */
function like1(tag: string, n: string) {
  return eq(schema.businesses.slug, `${tag}-${n}`);
}

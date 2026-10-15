import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import * as http from 'http';
import * as jwt from 'jsonwebtoken';
import { AddressInfo } from 'net';
import { INestApplication, Logger } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { eq, inArray } from 'drizzle-orm';
import { TestAppHelper } from './helpers/test-app.helper';
import { TEST_SECRETS } from './helpers/test-secrets';
import { errorTracker } from '../src/common/observability/error-tracker';
import { requestStats } from '../src/common/observability/rolling-stats';
import { StructuredLogger } from '../src/common/observability/structured-logger';
import { tracer } from '../src/common/observability/tracing';
import { CreditService } from '../src/modules/credit/credit.service';
import { BusinessException } from '../src/common/errors/business.exception';
import { QueueService } from '../src/modules/queue/queue.service';
import { MonitoringService } from '../src/modules/monitoring/monitoring.service';
import * as schema from '../src/database/schema';

interface IReceived {
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** A local HTTP server that records what it is sent and answers with a configurable status. */
const listen = async (status = () => 200) => {
  const got: IReceived[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      got.push({ url: req.url ?? '', headers: req.headers, body });
      res.writeHead(status(), { 'retry-after': '120' }).end('{}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { got, port: (server.address() as AddressInfo).port, close: () => new Promise<void>((r) => server.close(() => r())), set status(v: () => number) { status = v; } };
};

const waitFor = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return check();
};

describe('Monitoring and observability: tracing, metrics, error tracking, structured logs, health, queues, search, alerts', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const unwrap = (res: any) => res.body.data || res.body;
  const emails: string[] = [];
  const adminEmail = 'qa.monitoring.admin@monarchsoftwares.com';
  let adminToken: string;
  let admin: { Authorization: string };
  let sentry: Awaited<ReturnType<typeof listen>>;
  let collector: Awaited<ReturnType<typeof listen>>;
  let webhook: Awaited<ReturnType<typeof listen>>;
  let sentryStatus = 200;
  const baseEnv = { ...process.env };
  const monitoring = () => app.get(MonitoringService);

  const newUser = async (name: string) => {
    const email = `mon.${name}.${Date.now()}@orion-test.io`;
    emails.push(email);
    const d = unwrap(await api().post('/api/v1/auth/register').send({ email, password: 'MonitorPass123!', firstName: 'Mo', lastName: name }));
    return { id: d.user.id as string, email, auth: { Authorization: `Bearer ${d.tokens.accessToken}` } };
  };
  const sentryEvents = () => sentry.got.map((g) => JSON.parse(g.body.trim().split('\n')[2]));

  beforeAll(async () => {
    sentry = await listen(() => sentryStatus);
    collector = await listen();
    webhook = await listen();
    Object.assign(process.env, {
      SENTRY_DSN: `http://pubkey123@127.0.0.1:${sentry.port}/7`,
      SENTRY_ENVIRONMENT: 'e2e',
      SENTRY_RELEASE: 'orion@e2e',
      TRACE_SAMPLE_RATE: '1',
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${collector.port}`,
      METRICS_TOKEN: 'metrics-scrape-token-0123456789',
      MONITORING_ALERT_WEBHOOK_URL: `http://127.0.0.1:${webhook.port}/alert`,
      INTEGRATIONS_ALLOW_PRIVATE_NETWORK: 'true',
    });
    testApp = new TestAppHelper();
    app = await testApp.init();
    await testApp.cleanupUsers([adminEmail]);
    const adminId = await testApp.provisionAdmin(adminEmail, 'SUPER_ADMIN');
    adminToken = jwt.sign({ sub: adminId, email: adminEmail, role: 'SUPER_ADMIN', status: 'ACTIVE' }, TEST_SECRETS.jwtAccess, { expiresIn: '1h', issuer: 'orion-api', audience: 'orion-client' });
    admin = { Authorization: `Bearer ${adminToken}` };
  });

  beforeEach(async () => {
    await errorTracker.flush(2000); // a report sent by the previous test must not land in this one
    (app.get(ThrottlerStorage) as any).storage.clear();
    errorTracker.reset();
    tracer.reset();
    requestStats.reset();
    sentry.got.length = 0;
    collector.got.length = 0;
    webhook.got.length = 0;
    sentryStatus = 200;
  });

  afterAll(async () => {
    await testApp.db.delete(schema.queueJobs).where(inArray(schema.queueJobs.queueName, ['obs-test', 'obs-crit']));
    await testApp.cleanupUsers([...emails, adminEmail]);
    await testApp.close();
    await Promise.all([sentry.close(), collector.close(), webhook.close()]);
    for (const k of Object.keys(process.env)) if (!(k in baseEnv)) delete process.env[k];
    Object.assign(process.env, baseEnv);
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('distributed tracing', () => {
    it('starts a trace for every request and answers with its identifiers', async () => {
      const r = await api().get('/api/v1/credit/packages');
      expect(r.headers['x-trace-id']).toMatch(/^[0-9a-f]{32}$/);
      expect(r.headers['traceparent']).toMatch(new RegExp(`^00-${r.headers['x-trace-id']}-[0-9a-f]{16}-0[01]$`));
      const again = await api().get('/api/v1/credit/packages');
      expect(again.headers['x-trace-id']).not.toBe(r.headers['x-trace-id']);
    });

    it('continues a trace sent by the caller (a gateway, a browser) and keeps its sampling decision; an invalid header starts a new trace', async () => {
      const tid = '4bf92f3577b34da6a3ce929d0e0e4736';
      const r = await api().get('/api/v1/credit/packages').set('traceparent', `00-${tid}-00f067aa0ba902b7-01`);
      expect(r.headers['x-trace-id']).toBe(tid);
      expect(r.headers['traceparent']).toMatch(new RegExp(`^00-${tid}-(?!00f067aa0ba902b7)[0-9a-f]{16}-01$`)); // our own span, same trace, still sampled
      const unsampled = await api().get('/api/v1/credit/packages').set('traceparent', `00-${'a'.repeat(32)}-00f067aa0ba902b7-00`);
      expect(unsampled.headers['traceparent']).toMatch(/-00$/);
      const bad = await api().get('/api/v1/credit/packages').set('traceparent', `00-${'0'.repeat(32)}-00f067aa0ba902b7-01`);
      expect(bad.headers['x-trace-id']).not.toBe('0'.repeat(32));
      const junk = await api().get('/api/v1/credit/packages').set('traceparent', 'not-a-trace');
      expect(junk.headers['x-trace-id']).toMatch(/^[0-9a-f]{32}$/);
      expect(tracer.getTrace(tid)[0]).toMatchObject({ kind: 'SERVER', parentSpanId: '00f067aa0ba902b7' });
    });

    it('records the server span with the route pattern, status and user, never the query string, and serves it to administrators only', async () => {
      const u = await newUser('trace');
      const r = await api().get('/api/v1/credit/wallet?email=secret@example.com&page=2').set(u.auth);
      expect(r.status).toBe(200);
      const tid = r.headers['x-trace-id'];
      const spans = unwrap(await api().get(`/api/v1/monitoring/traces/${tid}`).set(admin)).spans;
      expect(spans).toHaveLength(1);
      expect(spans[0]).toMatchObject({ kind: 'SERVER', status: 'OK', name: 'GET /api/v1/credit/wallet', attributes: { 'http.method': 'GET', 'http.route': '/api/v1/credit/wallet', 'http.status_code': 200, 'enduser.id': u.id } });
      expect(JSON.stringify(spans)).not.toMatch(/secret@example|email=/);
      expect(spans[0].durationMs).toBeGreaterThanOrEqual(0);

      expect((await api().get(`/api/v1/monitoring/traces/${tid}`).set(u.auth)).status).toBe(403);
      expect((await api().get(`/api/v1/monitoring/traces/${tid}`)).status).toBe(401);
      expect((await api().get('/api/v1/monitoring/traces/not-hex').set(admin)).status).toBe(400);
      expect((await api().get(`/api/v1/monitoring/traces/${'f'.repeat(32)}`).set(admin)).status).toBe(404);
    });

    it('lists the slowest recent requests, and marks a failed request as an error', async () => {
      const spy = jest.spyOn(CreditService.prototype, 'getPackages').mockRejectedValue(new Error('db exploded'));
      try {
        const bad = await api().get('/api/v1/credit/packages');
        expect(bad.status).toBe(500);
        const span = tracer.getTrace(bad.headers['x-trace-id'])[0];
        expect(span).toMatchObject({ status: 'ERROR', attributes: { 'http.status_code': 500 } });
      } finally {
        spy.mockRestore();
      }
      const slow = unwrap(await api().get('/api/v1/monitoring/traces?limit=5').set(admin));
      expect(slow.slowest.length).toBeGreaterThan(0);
      expect(slow.slowest[0]).toEqual(expect.objectContaining({ traceId: expect.any(String), name: expect.any(String), durationMs: expect.any(Number) }));
      expect(slow.tracing).toMatchObject({ sampleRate: 1, exporter: 'otlp-http' });
    });

    it('exports sampled traces to the OpenTelemetry collector over OTLP/HTTP', async () => {
      const tid = 'c'.repeat(32);
      await api().get('/api/v1/credit/packages').set('traceparent', `00-${tid}-00f067aa0ba902b7-01`);
      await api().get('/api/v1/credit/packages').set('traceparent', `00-${'d'.repeat(32)}-00f067aa0ba902b7-00`); // caller said: do not sample
      await tracer.flush();
      expect(collector.got).toHaveLength(1);
      expect(collector.got[0].url).toBe('/v1/traces');
      const body = JSON.parse(collector.got[0].body);
      const spans = body.resourceSpans[0].scopeSpans[0].spans;
      expect(spans.map((s: any) => s.traceId)).toEqual([tid]);
      expect(spans[0]).toMatchObject({ name: 'GET /api/v1/credit/packages', kind: 2, parentSpanId: '00f067aa0ba902b7' });
      expect(body.resourceSpans[0].resource.attributes).toContainEqual({ key: 'service.name', value: { stringValue: 'orion-api' } });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('metrics (Prometheus)', () => {
    it('is never public: it needs the metrics token or an administrator token', async () => {
      expect((await api().get('/api/v1/metrics')).status).toBe(401);
      expect((await api().get('/api/v1/metrics').set('Authorization', 'Bearer wrong-token-0123456789')).status).toBe(401);
      const u = await newUser('metrics');
      expect((await api().get('/api/v1/metrics').set(u.auth)).status).toBe(401); // a customer is not enough
      expect((await api().get('/api/v1/metrics').set('Authorization', 'Bearer metrics-scrape-token-0123456789')).status).toBe(200);
      expect((await api().get('/api/v1/metrics').set(admin)).status).toBe(200);
      const saved = process.env.METRICS_TOKEN;
      delete process.env.METRICS_TOKEN; // no token configured: nothing but an administrator gets in, and an empty bearer is not a match
      expect((await api().get('/api/v1/metrics').set('Authorization', 'Bearer ')).status).toBe(401);
      expect((await api().get('/api/v1/metrics')).status).toBe(401);
      process.env.METRICS_TOKEN = saved;
    });

    it('exposes request counts and latency by route pattern (bounded labels), process, database, queue and search gauges', async () => {
      const u = await newUser('labels');
      await api().get('/api/v1/credit/packages');
      await api().get('/api/v1/exports/5f1c2d3e-1111-2222-3333-444455556666/download').set(u.auth); // a parameterised route
      await api().get('/api/v1/definitely/not/a/route/5f1c2d3e-1111-2222-3333-444455556666'); // matches nothing
      const res = await api().get('/api/v1/metrics').set('Authorization', 'Bearer metrics-scrape-token-0123456789');
      expect(res.headers['content-type']).toMatch(/^text\/plain; version=0\.0\.4/);
      const t = res.text;
      expect(t).toContain('http_requests_total{method="GET",route="/api/v1/credit/packages",status_class="2xx"}');
      expect(t).toMatch(/http_request_duration_seconds_bucket\{method="GET",route="\/api\/v1\/credit\/packages",le="0\.005"\}/);
      expect(t).toContain('route="/api/v1/exports/:id/download"'); // the pattern, not the id
      expect(t).toContain('route="unmatched"');
      expect(t).not.toMatch(/5f1c2d3e|definitely|@example|orion-test/);
      for (const name of ['process_resident_memory_bytes', 'nodejs_heap_used_bytes', 'nodejs_eventloop_lag_p99_seconds', 'process_uptime_seconds', 'app_info{', 'db_up 1', 'search_up{provider="postgres"} 1', 'tracing_spans_total', 'orion_metrics_dropped_series_total']) expect(t).toContain(name);
      for (const line of t.trim().split('\n')) expect(line).toMatch(/^(#.*|[a-zA-Z_:][a-zA-Z0-9_:]*(\{.*\})? (-?[0-9.]+(e[+-]?\d+)?|NaN|\+Inf|-Inf))$/);
    });

    it('counts the requests the protection layer refuses and the server errors', async () => {
      const spy = jest.spyOn(CreditService.prototype, 'getPackages').mockRejectedValue(new Error('x'));
      try {
        await api().get('/api/v1/credit/packages');
      } finally {
        spy.mockRestore();
      }
      const t = (await api().get('/api/v1/metrics').set(admin)).text;
      expect(t).toMatch(/http_requests_total\{method="GET",route="\/api\/v1\/credit\/packages",status_class="5xx"\} [1-9]/);
      expect(t).toMatch(/errors_captured_total\{source="http"\} [1-9]/);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('error tracking (Sentry)', () => {
    it('reports an unexpected error with a scrubbed message, request and user, and the trace id of the failing request', async () => {
      const u = await newUser('sentry');
      const spy = jest.spyOn(CreditService.prototype, 'getWalletWithStatus').mockRejectedValue(new Error('boom for jane@example.com using token=abc12345'));
      let r: any;
      // production mode for this one request: the filter then hides internals from the customer (development and test show the message)
      process.env.NODE_ENV = 'production';
      process.env.TRAFFIC_CONTROL_ENABLED = 'false';
      try {
        r = await api().get('/api/v1/credit/wallet?email=jane@example.com').set(u.auth).set('User-Agent', 'jest-agent').set('Cookie', 'session=zzz');
      } finally {
        process.env.NODE_ENV = 'test';
        delete process.env.TRAFFIC_CONTROL_ENABLED;
        spy.mockRestore();
      }
      expect(r.status).toBe(500);
      expect(JSON.stringify(r.body)).not.toMatch(/jane@example|boom/); // the customer never sees internals either
      expect(await waitFor(() => sentry.got.length === 1)).toBe(true);

      const g = sentry.got[0];
      expect(g.url).toBe('/api/7/envelope/');
      expect(g.headers['x-sentry-auth']).toContain('sentry_key=pubkey123');
      expect(g.headers['content-type']).toBe('application/x-sentry-envelope');
      const ev = sentryEvents()[0];
      expect(ev).toMatchObject({ platform: 'node', level: 'error', environment: 'e2e', release: 'orion@e2e', logger: 'http' });
      expect(ev.exception.values[0].value).toBe('boom for [email] using token=[redacted]');
      expect(ev.exception.values[0].stacktrace.frames.length).toBeGreaterThan(0);
      expect(ev.request).toEqual({ method: 'GET', url: '/api/v1/credit/wallet', headers: expect.objectContaining({ 'user-agent': 'jest-agent' }) });
      expect(ev.request.headers.authorization).toBeUndefined();
      expect(ev.request.headers.cookie).toBeUndefined();
      expect(ev.user).toEqual({ id: u.id });
      expect(ev.tags).toMatchObject({ source: 'http', status: '500' });
      expect(ev.contexts.trace.trace_id).toBe(r.headers['x-trace-id']); // errors and traces share an id
      expect(ev.tags.request_id).toBe(r.headers['x-request-id']);
      expect(g.body).not.toMatch(/jane@example|abc12345|session=zzz|secret/);
    });

    it('does not report client errors or deliberate "service unavailable" answers, but does report a failed upstream', async () => {
      const u = await newUser('noise');
      expect((await api().get('/api/v1/credit/wallet')).status).toBe(401);
      expect((await api().get('/api/v1/no-such-route')).status).toBe(404);
      expect((await api().post('/api/v1/auth/login').send({ email: 'x@y.io' })).status).toBe(400);
      const s503 = jest.spyOn(CreditService.prototype, 'getWalletWithStatus').mockRejectedValue(new BusinessException('Online payments are not configured', 'PAYMENTS_NOT_CONFIGURED', 503));
      expect((await api().get('/api/v1/credit/wallet').set(u.auth)).status).toBe(503);
      s503.mockRestore();
      await new Promise((r) => setTimeout(r, 100));
      expect(errorTracker.summary().captured).toBe(0);

      const s502 = jest.spyOn(CreditService.prototype, 'getWalletWithStatus').mockRejectedValue(new BusinessException('The payment gateway failed', 'GATEWAY_ERROR', 502));
      expect((await api().get('/api/v1/credit/wallet').set(u.auth)).status).toBe(502);
      s502.mockRestore();
      expect(await waitFor(() => sentry.got.length === 1)).toBe(true);
      expect(sentryEvents()[0]).toMatchObject({ level: 'warning', tags: { errorCode: 'GATEWAY_ERROR', status: '502' } });
    });

    it('groups repeats instead of flooding the tracker, and keeps a list for administrators even without Sentry', async () => {
      const u = await newUser('group');
      const spy = jest.spyOn(CreditService.prototype, 'getWalletWithStatus').mockRejectedValue(new Error('same failure 42'));
      try {
        for (let i = 0; i < 8; i++) await api().get('/api/v1/credit/wallet').set(u.auth);
      } finally {
        spy.mockRestore();
      }
      await new Promise((r) => setTimeout(r, 200));
      expect(sentry.got.length).toBe(5); // at most 5 reports per distinct error per minute
      const list = unwrap(await api().get('/api/v1/monitoring/errors').set(admin));
      expect(list.errors).toHaveLength(1);
      expect(list.errors[0]).toMatchObject({ type: 'Error', message: 'same failure 42', occurrences: 8, source: 'http', route: '/api/v1/credit/wallet' });
      expect(list.tracking).toMatchObject({ enabled: true, captured: 8, droppedRateLimited: 3 });
      expect((await api().get('/api/v1/monitoring/errors').set(u.auth)).status).toBe(403);
    });

    it('a failing or rate-limiting Sentry never affects the customer response, and back-off is honoured', async () => {
      const u = await newUser('sentrydown');
      sentryStatus = 429;
      const spy = jest.spyOn(CreditService.prototype, 'getWalletWithStatus').mockRejectedValue(new Error('first'));
      try {
        expect((await api().get('/api/v1/credit/wallet').set(u.auth)).status).toBe(500);
        await errorTracker.flush();
        spy.mockRejectedValue(new TypeError('second, different error'));
        expect((await api().get('/api/v1/credit/wallet').set(u.auth)).status).toBe(500);
        await errorTracker.flush();
      } finally {
        spy.mockRestore();
      }
      expect(sentry.got).toHaveLength(1); // Sentry said 429 with Retry-After: the second report was not sent
      expect(errorTracker.summary()).toMatchObject({ failed: 1, captured: 2 });
    });

    it('reports a job that failed for the last time, with its queue and job name', async () => {
      const queue = app.get(QueueService);
      queue.registerWorker('obs-test', async () => {
        throw new Error('worker blew up for ops@example.com');
      });
      await queue.addJob('obs-test', 'import-rows', { secret: 'must-not-leave' }, { attempts: 1 });
      expect(await waitFor(() => sentry.got.length >= 1, 5000)).toBe(true);
      const ev = sentryEvents()[0];
      expect(ev).toMatchObject({ logger: 'queue', tags: { queue: 'obs-test', job: 'import-rows', attempts: '1' } });
      expect(sentry.got[0].body).not.toMatch(/ops@example|must-not-leave/);
      queue.unregisterWorker('obs-test');
    });

    it('lets an administrator send a test event to check the wiring', async () => {
      const u = await newUser('testerr');
      expect((await api().post('/api/v1/monitoring/test-error').set(u.auth)).status).toBe(403);
      const r = await api().post('/api/v1/monitoring/test-error').set(admin);
      expect(r.status).toBe(201);
      expect(unwrap(r)).toMatchObject({ enabled: true, provider: 'sentry', sent: 1 });
      expect(sentryEvents()[0]).toMatchObject({ level: 'warning', logger: 'test', event_id: unwrap(r).eventId });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('structured logging', () => {
    it('writes one JSON access-log line per request with route, status, duration and the request / trace / user ids, and no query values', async () => {
      const lines: Array<{ line: string; level: string }> = [];
      Logger.overrideLogger(new StructuredLogger({ format: 'json', level: 'debug', sink: (line, level) => lines.push({ line, level }) }));
      process.env.ACCESS_LOG = 'true';
      process.env.SLOW_REQUEST_MS = '1';
      try {
        const u = await newUser('log');
        lines.length = 0;
        const r = await api().get('/api/v1/credit/wallet?email=a@b.io&token=zzz123456').set(u.auth).set('x-request-id', 'req-from-client-1');
        await waitFor(() => lines.some((l) => JSON.parse(l.line).event === 'http_request' && JSON.parse(l.line).route === '/api/v1/credit/wallet'));
        const e = lines.map((l) => JSON.parse(l.line)).find((x) => x.event === 'http_request' && x.route === '/api/v1/credit/wallet');
        expect(e).toMatchObject({ level: 'warn', context: 'HTTP', method: 'GET', status: 200, path: '/api/v1/credit/wallet', requestId: 'req-from-client-1', traceId: r.headers['x-trace-id'], userId: u.id, slow: true });
        expect(typeof e.durationMs).toBe('number');
        expect(JSON.stringify(e)).not.toMatch(/a@b\.io|zzz123456/);

        const spy = jest.spyOn(CreditService.prototype, 'getPackages').mockRejectedValue(new Error('exploded'));
        lines.length = 0;
        try {
          await api().get('/api/v1/credit/packages');
        } finally {
          spy.mockRestore();
        }
        await waitFor(() => lines.some((l) => l.level === 'error' && JSON.parse(l.line).event === 'http_request'));
        const serverError = lines.map((l) => ({ ...JSON.parse(l.line), sinkLevel: l.level })).find((x) => x.event === 'http_request' && x.status === 500);
        expect(serverError).toMatchObject({ level: 'error', sinkLevel: 'error' });
        // every line inside a request carries the same trace id, including the framework's own error log
        const ids = new Set(lines.map((l) => JSON.parse(l.line).traceId).filter(Boolean));
        expect(ids.size).toBe(1);
      } finally {
        delete process.env.ACCESS_LOG;
        delete process.env.SLOW_REQUEST_MS;
        Logger.overrideLogger(['error', 'warn']);
      }
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('system dashboard, application and database monitoring', () => {
    it('serves the dashboard page without any data, and the overview only to administrators', async () => {
      const page = await api().get('/api/v1/monitoring/dashboard');
      expect(page.status).toBe(200);
      expect(page.headers['content-type']).toMatch(/text\/html/);
      expect(page.headers['cache-control']).toBe('no-store');
      expect(page.text).toContain('System dashboard');
      expect(page.text).not.toMatch(/orion-test|postgres:\/\/|SENTRY_DSN/);
      expect(page.text).not.toMatch(/innerHTML|document\.write|eval\(/); // everything is inserted as text
      const u = await newUser('overview');
      expect((await api().get('/api/v1/monitoring/overview')).status).toBe(401);
      expect((await api().get('/api/v1/monitoring/overview').set(u.auth)).status).toBe(403);
    });

    it('reports application, HTTP, process, database, queue, search, error-tracking and tracing state in one overview', async () => {
      for (let i = 0; i < 3; i++) await api().get('/api/v1/credit/packages');
      const o = unwrap(await api().get('/api/v1/monitoring/overview?fresh=true').set(admin));
      expect(['OK', 'DEGRADED', 'CRITICAL']).toContain(o.status);
      expect(o.app).toMatchObject({ name: 'orion-api', environment: 'test', node: process.version });
      expect(o.app.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(o.http.last5m.requests).toBeGreaterThanOrEqual(3);
      expect(o.http.last5m).toEqual(expect.objectContaining({ perSecond: expect.any(Number), errorRate5xx: 0, p95Ms: expect.any(Number) }));
      expect(o.http.busiestRoutes[0].route).toBe('GET /api/v1/credit/packages');
      expect(o.process.memory.heapUsedMb).toBeGreaterThan(0);
      expect(o.process.eventLoop).toHaveProperty('p99Ms');
      expect(o.database).toMatchObject({ reachable: true });
      expect(o.database.pingMs).toBeGreaterThanOrEqual(0);
      expect(o.queues).toMatchObject({ available: true });
      expect(o.search).toMatchObject({ provider: 'postgres', status: 'OK' });
      expect(o.errorTracking).toMatchObject({ enabled: true, provider: 'sentry', environment: 'e2e' });
      expect(o.tracing).toMatchObject({ sampleRate: 1, exporter: 'otlp-http' });
      expect(o.protection).toBeDefined();
      expect(JSON.stringify(o)).not.toMatch(/pubkey123|metrics-scrape-token|whsec_|password/); // no secret in the report
      // the standalone views agree with the overview
      expect(unwrap(await api().get('/api/v1/monitoring/database').set(admin)).reachable).toBe(true);
      expect(unwrap(await api().get('/api/v1/monitoring/search').set(admin)).provider).toBe('postgres');
    });

    it('measures the database: latency, pool, and whatever the server statistics views allow', async () => {
      const db = unwrap(await api().get('/api/v1/monitoring/database?fresh=true').set(admin));
      expect(db.reachable).toBe(true);
      expect(typeof db.pingMs).toBe('number');
      expect(db.pool).toHaveProperty('max');
      for (const key of ['connections', 'locksWaiting', 'sizeBytes', 'cacheHitRatio', 'transactions', 'deadTuples', 'migrations']) expect(db).toHaveProperty(key); // present, or null where this database cannot say
    });

    it('answers soft when the database cannot be reached: reported as down, with a critical alert, never an error', async () => {
      const m = monitoring() as any;
      const real = m.pool.query;
      m.pool.query = () => Promise.reject(new Error('connection refused'));
      try {
        const db = await monitoring().database(true);
        expect(db).toMatchObject({ reachable: false, pingMs: null });
        const alerts = await monitoring().alerts(true);
        expect(alerts).toContainEqual(expect.objectContaining({ id: 'db_down', severity: 'critical' }));
        expect(monitoring().statusOf(alerts)).toBe('CRITICAL');
      } finally {
        m.pool.query = real;
        await monitoring().database(true);
      }
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('queue monitoring', () => {
    const jobs = (rows: Array<Partial<typeof schema.queueJobs.$inferInsert>>) => testApp.db.insert(schema.queueJobs).values(rows.map((r) => ({ queueName: 'obs-crit', jobName: 'work', data: { secret: 'never-shown' }, ...r })) as any);

    it('shows depth, oldest waiting job, stuck jobs, throughput and failures per queue, and never job data', async () => {
      await testApp.db.delete(schema.queueJobs).where(eq(schema.queueJobs.queueName, 'obs-crit'));
      const ago = (min: number) => new Date(Date.now() - min * 60_000);
      await jobs([
        { status: 'WAITING', createdAt: ago(20) },
        { status: 'WAITING', createdAt: ago(2) },
        { status: 'ACTIVE', lockedAt: ago(30), createdAt: ago(31) },
        { status: 'COMPLETED', processedAt: ago(5), createdAt: ago(6) },
        { status: 'COMPLETED', processedAt: ago(8), createdAt: ago(9) },
        { status: 'FAILED', attempts: 3, maxAttempts: 3, error: 'Cannot send to owner@example.com', updatedAt: ago(1), createdAt: ago(3) },
      ]);
      const q = unwrap(await api().get('/api/v1/monitoring/queues?fresh=true').set(admin));
      const mine = q.queues.find((x: any) => x.name === 'obs-crit');
      expect(mine).toMatchObject({ status: 'CRITICAL', counts: { WAITING: 2, ACTIVE: 1, COMPLETED: 2, FAILED: 1 }, stuckActive: 1, completedLastHour: 2, failedLastHour: 1 });
      expect(mine.oldestWaitingSeconds).toBeGreaterThanOrEqual(19 * 60);
      expect(mine.failureRateLastHour).toBeCloseTo(1 / 3, 2);
      expect(q.status).toBe('CRITICAL');
      const failure = q.recentFailures.find((f: any) => f.queue === 'obs-crit');
      expect(failure).toMatchObject({ job: 'work', attempts: 3, maxAttempts: 3 });
      expect(failure.error).toBe('Cannot send to [email]');
      expect(JSON.stringify(q)).not.toMatch(/never-shown|owner@example/);

      const alerts = unwrap(await api().get('/api/v1/monitoring/alerts').set(admin));
      expect(alerts.status).toBe('CRITICAL');
      expect(alerts.alerts).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'queue_stuck:obs-crit', severity: 'critical' }), expect.objectContaining({ id: 'queue_backlog:obs-crit', severity: 'critical' })]),
      );
      const metricsText = (await api().get('/api/v1/metrics').set(admin)).text;
      expect(metricsText).toContain('queue_jobs{queue="obs-crit",status="WAITING"} 2');
      expect(metricsText).toContain('queue_stuck_jobs{queue="obs-crit"} 1');
      await testApp.db.delete(schema.queueJobs).where(eq(schema.queueJobs.queueName, 'obs-crit'));
    });

    it('a healthy queue is OK, and a failure burst is a warning', async () => {
      await testApp.db.delete(schema.queueJobs).where(eq(schema.queueJobs.queueName, 'obs-crit'));
      const now = new Date();
      await jobs([{ status: 'COMPLETED', processedAt: now }, { status: 'WAITING', createdAt: now }]);
      let q = unwrap(await api().get('/api/v1/monitoring/queues?fresh=true').set(admin));
      expect(q.queues.find((x: any) => x.name === 'obs-crit').status).toBe('OK');
      await jobs(Array.from({ length: 6 }, () => ({ status: 'FAILED', error: 'x', updatedAt: now })));
      q = unwrap(await api().get('/api/v1/monitoring/queues?fresh=true').set(admin));
      expect(q.queues.find((x: any) => x.name === 'obs-crit').status).toBe('DEGRADED');
      expect((await monitoring().alerts(true)).find((a) => a.id === 'queue_failures:obs-crit')?.severity).toBe('warning');
      await testApp.db.delete(schema.queueJobs).where(eq(schema.queueJobs.queueName, 'obs-crit'));
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('search cluster monitoring', () => {
    const fakeCluster = (over: Partial<Record<'health' | 'debug' | 'metrics' | 'stats' | 'collections', () => Promise<any>>> = {}) => ({
      health: { retrieve: over.health ?? (async () => ({ ok: true })) },
      debug: { retrieve: over.debug ?? (async () => ({ version: '27.1' })) },
      metrics: { retrieve: over.metrics ?? (async () => ({ system_disk_total_bytes: '1000', system_disk_used_bytes: '300', system_memory_total_bytes: '1000', system_memory_used_bytes: '400', typesense_memory_active_bytes: '20971520' })) },
      stats: { retrieve: over.stats ?? (async () => ({ search_latency_ms: 4, import_latency_ms: 9, search_requests_per_second: 2.5, pending_write_batches: 0 })) },
      collections: () => ({ retrieve: over.collections ?? (async () => [{ name: 'businesses', num_documents: 0 }]) }),
    });
    const withCluster = async (cluster: object, fn: () => Promise<void>) => {
      const m = monitoring() as any;
      m.typesense = cluster;
      try {
        await fn();
      } finally {
        m.typesense = null;
        await monitoring().search(true);
      }
    };
    const published = async () => (await monitoring().search(true)).publishedBusinesses as number;

    it('reports a healthy cluster: version, resources, latency and per-collection document counts', async () => {
      const n = await published();
      await withCluster(fakeCluster({ collections: async () => [{ name: 'businesses', num_documents: n }] }), async () => {
        const s: any = await monitoring().search(true);
        expect(s).toMatchObject({ provider: 'typesense', status: 'OK', reachable: true, version: '27.1', collections: [{ name: 'businesses', documents: n }], indexDrift: n ? { ratio: 0 } : null });
        expect(s.resources).toMatchObject({ diskUsedRatio: 0.3, memoryUsedRatio: 0.4, memoryActiveMb: 20 });
        expect(s.latencyMs).toMatchObject({ avgSearch: 4, searchRequestsPerSecond: 2.5 });
        expect((await monitoring().alerts(true)).some((a) => a.id.startsWith('search_'))).toBe(false);
      });
    });

    it('detects an index that has drifted from the database, a nearly full disk, and an unreachable cluster', async () => {
      await testApp.createTestBusiness({ slug: `mon-drift-${Date.now()}`, name: 'Drift Co', contactEmail: 'd@example.com', contactPhone: '+91 9000000099' });
      const n = await published();
      expect(n).toBeGreaterThan(0);
      await withCluster(fakeCluster({ collections: async () => [{ name: 'businesses', num_documents: 0 }], metrics: async () => ({ system_disk_total_bytes: '100', system_disk_used_bytes: '95', system_memory_total_bytes: '100', system_memory_used_bytes: '10' }) }), async () => {
        const s: any = await monitoring().search(true);
        expect(s).toMatchObject({ status: 'DEGRADED', indexDrift: { databasePublished: n, indexed: 0, ratio: 1 } });
        const ids = (await monitoring().alerts(true)).map((a) => a.id);
        expect(ids).toEqual(expect.arrayContaining(['search_drift', 'search_disk']));
      });
      await withCluster(fakeCluster({ health: async () => Promise.reject(new Error('ECONNREFUSED')), debug: async () => Promise.reject(new Error('x')), metrics: async () => Promise.reject(new Error('x')), stats: async () => Promise.reject(new Error('x')), collections: async () => Promise.reject(new Error('x')) }), async () => {
        const s: any = await monitoring().search(true);
        expect(s).toMatchObject({ status: 'DOWN', reachable: false });
        const alerts = await monitoring().alerts(true);
        expect(alerts).toContainEqual(expect.objectContaining({ id: 'search_down', severity: 'critical' }));
        const text = (await api().get('/api/v1/metrics').set(admin)).text;
        expect(text).toContain('search_up{provider="typesense"} 0');
      });
      const slug = (await testApp.db.select({ s: schema.businesses.slug }).from(schema.businesses)).map((b) => b.s).filter((s) => s.startsWith('mon-drift-'));
      await testApp.cleanupBusinesses(slug);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('alert notification', () => {
    it('sends a message when an alert starts, none while it persists, and one when it resolves', async () => {
      const m = monitoring() as any;
      m.firing = new Map();
      await testApp.db.delete(schema.queueJobs).where(eq(schema.queueJobs.queueName, 'obs-crit'));
      await testApp.db.insert(schema.queueJobs).values({ queueName: 'obs-crit', jobName: 'work', data: {}, status: 'ACTIVE', lockedAt: new Date(Date.now() - 45 * 60_000) } as any);

      const first = await monitoring().evaluateAndNotify();
      expect(first).toMatchObject({ notified: true });
      expect(await waitFor(() => webhook.got.length === 1)).toBe(true);
      expect(webhook.got[0].url).toBe('/alert');
      const msg = JSON.parse(webhook.got[0].body);
      expect(msg.text).toContain('stuck jobs');
      expect(msg.text).toContain('obs-crit');
      expect(msg.alerts.map((a: any) => a.id)).toContain('queue_stuck:obs-crit');

      expect(await monitoring().evaluateAndNotify()).toMatchObject({ notified: false }); // still firing: no repeat
      expect(webhook.got).toHaveLength(1);

      await testApp.db.delete(schema.queueJobs).where(eq(schema.queueJobs.queueName, 'obs-crit'));
      expect(await monitoring().evaluateAndNotify()).toMatchObject({ notified: true });
      expect(await waitFor(() => webhook.got.length === 2)).toBe(true);
      expect(JSON.parse(webhook.got[1].body).text).toContain('Resolved: queue_stuck:obs-crit');
      expect(await monitoring().evaluateAndNotify()).toMatchObject({ notified: false });
    });

    it('does nothing (and does not fail) when no webhook is configured or the webhook is down', async () => {
      const m = monitoring() as any;
      m.firing = new Map();
      await testApp.db.insert(schema.queueJobs).values({ queueName: 'obs-crit', jobName: 'work', data: {}, status: 'ACTIVE', lockedAt: new Date(Date.now() - 45 * 60_000) } as any);
      const saved = process.env.MONITORING_ALERT_WEBHOOK_URL;
      process.env.MONITORING_ALERT_WEBHOOK_URL = 'http://127.0.0.1:1/unreachable';
      try {
        await expect(monitoring().evaluateAndNotify()).resolves.toMatchObject({ notified: true });
      } finally {
        process.env.MONITORING_ALERT_WEBHOOK_URL = saved;
        await testApp.db.delete(schema.queueJobs).where(eq(schema.queueJobs.queueName, 'obs-crit'));
        m.firing = new Map();
      }
      expect(webhook.got).toHaveLength(0);
    });
  });
});

import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import * as jwt from 'jsonwebtoken';
import * as net from 'net';
import { AddressInfo } from 'net';
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { TestAppHelper } from './helpers/test-app.helper';
import { TEST_SECRETS } from './helpers/test-secrets';
import { DatabaseService } from '../src/database/database.service';
import { HealthService } from '../src/modules/health/health.service';
import { HealthController } from '../src/modules/health/health.controller';
import { THROTTLER_SKIP } from '@nestjs/throttler/dist/throttler.constants';
import { StorageService } from '../src/modules/storage/storage.service';
import { TypesenseService } from '../src/modules/typesense/typesense.service';

/** A fake Redis that answers PING / INFO (and AUTH when a password is required). `up` can be switched off to simulate an outage. */
async function fakeRedis(password?: string) {
  const state = { up: true, commands: [] as string[] };
  const server = net.createServer((sock) => {
    sock.on('error', () => undefined);
    sock.on('data', (chunk) => {
      if (!state.up) return sock.destroy();
      const text = chunk.toString('utf8');
      let out = '';
      for (const m of text.matchAll(/\*\d+\r\n\$\d+\r\n(\w+)\r\n/g)) {
        const name = m[1].toUpperCase();
        state.commands.push(name);
        if (name === 'AUTH') out += password && text.includes(password) ? '+OK\r\n' : '-WRONGPASS invalid\r\n';
        else if (name === 'PING') out += '+PONG\r\n';
        else if (name === 'INFO') {
          const body = '# Server\r\nredis_version:7.0.15\r\nredis_mode:standalone\r\n';
          out += `$${Buffer.byteLength(body)}\r\n${body}\r\n`;
        }
      }
      sock.write(out);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { state, port: (server.address() as AddressInfo).port, close: () => new Promise<void>((r) => server.close(() => r())) };
}

describe('Health check infrastructure: liveness, readiness, and one endpoint per dependency', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const unwrap = (res: any) => res.body.data || res.body;
  const adminEmail = 'qa.health.admin@monarchsoftwares.com';
  let admin: { Authorization: string };
  const svc = () => app.get(HealthService);
  const baseEnv = { ...process.env };
  let redis: Awaited<ReturnType<typeof fakeRedis>>;
  const spies: jest.SpyInstance[] = [];
  const spy = <T extends jest.SpyInstance>(s: T) => (spies.push(s), s);

  beforeAll(async () => {
    redis = await fakeRedis();
    testApp = new TestAppHelper();
    app = await testApp.init();
    await testApp.cleanupUsers([adminEmail]);
    const adminId = await testApp.provisionAdmin(adminEmail, 'SUPER_ADMIN');
    admin = { Authorization: `Bearer ${jwt.sign({ sub: adminId, email: adminEmail, role: 'SUPER_ADMIN', status: 'ACTIVE' }, TEST_SECRETS.jwtAccess, { expiresIn: '1h', issuer: 'orion-api', audience: 'orion-client' })}` };
  });

  beforeEach(() => {
    (app.get(ThrottlerStorage) as any).storage.clear();
    process.env.HEALTH_CACHE_MS = '0'; // every probe checks for real, unless a test says otherwise
    delete process.env.HEALTH_CHECK_TIMEOUT_MS;
    for (const k of ['REDIS_URL', 'REDIS_HOST', 'REDIS_PORT', 'REDIS_PASSWORD', 'REDIS_REQUIRED', 'READINESS_REQUIRES_STORAGE', 'LIVENESS_MAX_LAG_MS']) delete process.env[k];
    redis.state.up = true;
    svc().setShuttingDown(false);
    (svc() as any).typesenseClient = null;
    svc().clearCache();
    // the hermetic test setup has no object storage (it would honestly report down): every test starts with a healthy one
    spy(jest.spyOn(StorageService.prototype, 'checkHealth').mockResolvedValue(true));
  });

  afterEach(() => {
    while (spies.length) spies.pop()!.mockRestore();
  });

  afterAll(async () => {
    await testApp.cleanupUsers([adminEmail]);
    await testApp.close();
    await redis.close();
    for (const k of Object.keys(process.env)) if (!(k in baseEnv)) delete process.env[k];
    Object.assign(process.env, baseEnv);
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('liveness', () => {
    it('answers 200 on /live and the older /liveness path, with uptime and the event-loop delay, uncached and without credentials', async () => {
      for (const path of ['/api/v1/health/live', '/api/v1/health/liveness']) {
        const r = await api().get(path);
        expect(r.status).toBe(200);
        expect(r.headers['cache-control']).toBe('no-store');
        expect(unwrap(r)).toMatchObject({ status: 'ok' });
        expect(unwrap(r).uptime).toBeGreaterThan(0);
        expect(unwrap(r).eventLoopLagMs).toBeGreaterThanOrEqual(0);
        expect(new Date(unwrap(r).timestamp).getTime()).toBeGreaterThan(Date.now() - 5000);
      }
    });

    it('does not depend on any dependency: with the database, search and storage all down, it is still 200', async () => {
      spy(jest.spyOn(DatabaseService.prototype, 'ping').mockResolvedValue(false));
      spy(jest.spyOn(StorageService.prototype, 'checkHealth').mockResolvedValue(false));
      process.env.REDIS_HOST = '127.0.0.1';
      process.env.REDIS_PORT = '1';
      expect((await api().get('/api/v1/health/live')).status).toBe(200);
      expect((await api().get('/api/v1/health/ready')).status).toBe(503); // ... while readiness says "not me"
    });

    it('fails only when the event loop is wedged, so the orchestrator restarts a stuck process', async () => {
      spy(jest.spyOn(svc() as any, 'eventLoopLag').mockResolvedValue(9000));
      const r = await api().get('/api/v1/health/live');
      expect(r.status).toBe(503);
      expect(unwrap(r)).toMatchObject({ status: 'unresponsive', eventLoopLagMs: 9000 });
      process.env.LIVENESS_MAX_LAG_MS = '20000';
      expect((await api().get('/api/v1/health/live')).status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('readiness', () => {
    it('is ready when the required dependencies are up; search and Redis are reported as skipped when not in use', async () => {
      const r = await api().get('/api/v1/health/ready');
      expect(r.status).toBe(200);
      expect(r.headers['cache-control']).toBe('no-store');
      const d = unwrap(r);
      expect(d).toMatchObject({ status: 'ok', ready: true });
      expect(d.checks.database).toMatchObject({ status: 'up', required: true });
      expect(d.checks.typesense).toMatchObject({ status: 'skipped', reason: 'search_provider_is_postgres', required: false });
      expect(d.checks.redis).toMatchObject({ status: 'skipped', reason: 'not_configured', required: false });
      expect(d.checks.storage).toMatchObject({ required: false });
      expect((await api().get('/api/v1/health/readiness')).status).toBe(200); // the long form works too
    });

    it('is NOT ready (503) when the database is down, and says which dependency and why, with a fixed reason code', async () => {
      spy(jest.spyOn(DatabaseService.prototype, 'ping').mockRejectedValue(new Error('password authentication failed for user "orion" at db.internal.example:5432')));
      const r = await api().get('/api/v1/health/ready');
      expect(r.status).toBe(503);
      expect(unwrap(r)).toMatchObject({ status: 'unavailable', ready: false });
      expect(unwrap(r).checks.database).toMatchObject({ status: 'down', reason: 'unreachable', required: true });
      expect(JSON.stringify(r.body)).not.toMatch(/password authentication|orion"|db\.internal/); // no raw error text, ever
    });

    it('gives up on a dependency that does not answer in time, instead of hanging the probe', async () => {
      process.env.HEALTH_CHECK_TIMEOUT_MS = '150';
      spy(jest.spyOn(DatabaseService.prototype, 'ping').mockImplementation(() => new Promise(() => undefined)));
      const t0 = Date.now();
      const r = await api().get('/api/v1/health/ready');
      expect(Date.now() - t0).toBeLessThan(1500);
      expect(r.status).toBe(503);
      expect(unwrap(r).checks.database).toMatchObject({ status: 'down', reason: 'timeout' });
    });

    it('requires search when Typesense is the provider, and an optional dependency that is down only degrades', async () => {
      (svc() as any).typesenseClient = {}; // Typesense is the provider
      const ping = spy(jest.spyOn(TypesenseService.prototype, 'ping').mockResolvedValue(true));
      let r = await api().get('/api/v1/health/ready');
      expect(r.status).toBe(200);
      expect(unwrap(r).checks.typesense).toMatchObject({ status: 'up', required: true });
      ping.mockResolvedValue(false);
      r = await api().get('/api/v1/health/ready');
      expect(r.status).toBe(503);
      expect(unwrap(r).checks.typesense).toMatchObject({ status: 'down', reason: 'unreachable', required: true });

      (svc() as any).typesenseClient = null;
      spy(jest.spyOn(StorageService.prototype, 'checkHealth').mockResolvedValue(false));
      r = await api().get('/api/v1/health/ready');
      expect(r.status).toBe(200); // storage is optional by default: still takes traffic
      expect(unwrap(r)).toMatchObject({ status: 'degraded', ready: true });
      expect(unwrap(r).checks.storage).toMatchObject({ status: 'down', required: false });
      process.env.READINESS_REQUIRES_STORAGE = 'true';
      expect((await api().get('/api/v1/health/ready')).status).toBe(503);
    });

    it('answers not-ready the moment shutdown starts, so the load balancer drains the instance, while liveness stays 200', async () => {
      svc().setShuttingDown(true);
      const r = await api().get('/api/v1/health/ready');
      expect(r.status).toBe(503);
      expect(unwrap(r)).toMatchObject({ status: 'shutting_down', ready: false });
      expect((await api().get('/api/v1/health/live')).status).toBe(200);
      svc().setShuttingDown(false);
      expect((await api().get('/api/v1/health/ready')).status).toBe(200);
    });

    it('drains for the configured time before the process stops', async () => {
      process.env.HEALTH_SHUTDOWN_DRAIN_SECONDS = '1';
      const t0 = Date.now();
      await svc().beforeApplicationShutdown();
      expect(Date.now() - t0).toBeGreaterThanOrEqual(950);
      expect(svc().isShuttingDown()).toBe(true);
      delete process.env.HEALTH_SHUTDOWN_DRAIN_SECONDS;
    });

    it('protects the dependencies from probe traffic: simultaneous probes share one check, and results are briefly reused', async () => {
      const ping = spy(jest.spyOn(DatabaseService.prototype, 'ping').mockImplementation(() => new Promise((r) => setTimeout(() => r(true), 50))));
      const burst = await Promise.all(Array.from({ length: 20 }, () => api().get('/api/v1/health/ready')));
      expect(burst.every((r) => r.status === 200)).toBe(true);
      expect(ping).toHaveBeenCalledTimes(1);

      process.env.HEALTH_CACHE_MS = '5000';
      svc().clearCache();
      ping.mockClear();
      await api().get('/api/v1/health/ready');
      await api().get('/api/v1/health/ready');
      await api().get('/api/v1/health/database');
      expect(ping).toHaveBeenCalledTimes(1); // the readiness and the database endpoint share the cached result
    });

    it('is exempt from the global per-address throttler as well (a 429 would take a healthy instance out of rotation)', () => {
      expect(Reflect.getMetadata(`${THROTTLER_SKIP}default`, HealthController)).toBe(true);
    });

    it('is never rate-limited, even when the protection layer is strict', async () => {
      process.env.TRAFFIC_CONTROL_ENABLED = 'true';
      process.env.RATE_LIMIT_IP_BURST_PER_SECOND = '2';
      try {
        const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => api().get(i % 2 ? '/api/v1/health/ready' : '/api/v1/health/live')));
        expect(rs.some((r) => r.status === 429)).toBe(false);
      } finally {
        delete process.env.TRAFFIC_CONTROL_ENABLED;
        delete process.env.RATE_LIMIT_IP_BURST_PER_SECOND;
      }
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('one endpoint per dependency', () => {
    it('/health/database: up with its latency, 503 when it cannot answer; details only for an administrator', async () => {
      const pub = await api().get('/api/v1/health/database');
      expect(pub.status).toBe(200);
      expect(unwrap(pub)).toMatchObject({ name: 'database', status: 'up', required: true });
      expect(unwrap(pub).latencyMs).toBeGreaterThanOrEqual(0);
      expect(unwrap(pub).details).toBeUndefined();
      const adm = await api().get('/api/v1/health/database').set(admin);
      expect(unwrap(adm).details).toHaveProperty('pool');

      spy(jest.spyOn(DatabaseService.prototype, 'ping').mockResolvedValue(false));
      const down = await api().get('/api/v1/health/database');
      expect(down.status).toBe(503);
      expect(unwrap(down)).toMatchObject({ name: 'database', status: 'down', reason: 'unreachable', latencyMs: expect.any(Number) });
    });

    it('/health/typesense: skipped while PostgreSQL is the search provider; when Typesense is used, up or 503', async () => {
      const skipped = await api().get('/api/v1/health/typesense');
      expect(skipped.status).toBe(200);
      expect(unwrap(skipped)).toMatchObject({ name: 'typesense', status: 'skipped', reason: 'search_provider_is_postgres', latencyMs: null, required: false });

      (svc() as any).typesenseClient = {};
      const ping = spy(jest.spyOn(TypesenseService.prototype, 'ping').mockResolvedValue(true));
      spy(jest.spyOn(TypesenseService.prototype, 'getCollections').mockResolvedValue([{ name: 'businesses' }] as any));
      expect(unwrap(await api().get('/api/v1/health/typesense'))).toMatchObject({ status: 'up', required: true });
      expect(unwrap(await api().get('/api/v1/health/typesense')).details).toBeUndefined();
      expect(unwrap(await api().get('/api/v1/health/typesense').set(admin)).details).toEqual({ collections: 1 });
      ping.mockResolvedValue(false);
      const down = await api().get('/api/v1/health/typesense');
      expect(down.status).toBe(503);
      expect(unwrap(down)).toMatchObject({ status: 'down', reason: 'unreachable' });
    });

    it('/health/redis: "not configured" (200) when there is no Redis, which is the case for this stack today', async () => {
      const r = await api().get('/api/v1/health/redis');
      expect(r.status).toBe(200);
      expect(unwrap(r)).toMatchObject({ name: 'redis', status: 'skipped', reason: 'not_configured', latencyMs: null, required: false });
    });

    it('/health/redis: pings a configured Redis, reports its version only to administrators, and 503 when it goes down', async () => {
      process.env.REDIS_HOST = '127.0.0.1';
      process.env.REDIS_PORT = String(redis.port);
      const up = await api().get('/api/v1/health/redis');
      expect(up.status).toBe(200);
      expect(unwrap(up)).toMatchObject({ status: 'up', latencyMs: expect.any(Number) });
      expect(unwrap(up).details).toBeUndefined();
      expect(unwrap(await api().get('/api/v1/health/redis').set(admin)).details).toMatchObject({ version: '7.0.15', mode: 'standalone', tls: false });
      expect(redis.state.commands).toEqual(expect.arrayContaining(['PING', 'INFO']));

      redis.state.up = false;
      const down = await api().get('/api/v1/health/redis');
      expect(down.status).toBe(503);
      expect(unwrap(down)).toMatchObject({ status: 'down', reason: expect.stringMatching(/^(error|timeout|protocol_error|connection_refused)$/) });
      // nothing about the address or credentials leaks
      process.env.REDIS_PASSWORD = 'very-secret-redis-password';
      process.env.REDIS_HOST = 'redis.internal.example';
      process.env.REDIS_PORT = '1';
      const body = JSON.stringify((await api().get('/api/v1/health/redis')).body);
      expect(body).not.toMatch(/very-secret|internal\.example/);
    });

    it('a configured Redis is optional for readiness (degraded) unless REDIS_REQUIRED=true', async () => {
      process.env.REDIS_HOST = '127.0.0.1';
      process.env.REDIS_PORT = String(redis.port);
      expect(unwrap(await api().get('/api/v1/health/ready')).checks.redis).toMatchObject({ status: 'up', required: false });
      redis.state.up = false;
      const degraded = await api().get('/api/v1/health/ready');
      expect(degraded.status).toBe(200);
      expect(unwrap(degraded)).toMatchObject({ status: 'degraded', ready: true });
      process.env.REDIS_REQUIRED = 'true';
      const unavailable = await api().get('/api/v1/health/ready');
      expect(unavailable.status).toBe(503);
      expect(unwrap(unavailable)).toMatchObject({ status: 'unavailable', ready: false });
      expect(unwrap(unavailable).checks.redis).toMatchObject({ status: 'down', required: true });
      redis.state.up = true;
      expect((await api().get('/api/v1/health/ready')).status).toBe(200);
    });

    it('/health/storage works the same way, and an unknown dependency is a 404, not a probe of something else', async () => {
      expect(unwrap(await api().get('/api/v1/health/storage'))).toMatchObject({ name: 'storage', required: false });
      for (const bad of ['mysql', 'DATABASE', '..%2fetc', 'metrics']) {
        const r = await api().get(`/api/v1/health/${bad}`);
        expect(r.status).toBe(404);
        expect(unwrap(r)).toMatchObject({ status: 'unknown' });
      }
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('comprehensive application health (/health)', () => {
    it('reports every dependency including Redis (skipped when absent), and 503 when a configured one is down', async () => {
      const ok = await api().get('/api/v1/health');
      expect(ok.status).toBe(200);
      const d = unwrap(ok);
      expect(d.status).toBe('ok');
      expect(Object.keys(d.details).sort()).toEqual(['database', 'memory_heap', 'redis', 'storage', 'typesense']);
      expect(d.details.redis).toMatchObject({ status: 'up', note: 'skipped_not_configured' });
      expect(d.details.typesense).toMatchObject({ status: 'up', note: 'skipped_postgres_active' }); // a skipped component is now listed, with a note

      process.env.REDIS_HOST = '127.0.0.1';
      process.env.REDIS_PORT = String(redis.port);
      expect((await api().get('/api/v1/health')).status).toBe(200);
      redis.state.up = false;
      const bad = await api().get('/api/v1/health');
      expect(bad.status).toBe(503);
      expect(JSON.stringify(bad.body)).toContain('redis');
    });

    it('the container health check used by docker-compose (the /liveness path) keeps working', async () => {
      expect((await api().get('/api/v1/health/liveness')).status).toBe(200);
    });
  });
});

import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import express from 'express';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cors = require('cors'); // the package Nest's enableCors uses; it ships no types
import { INestApplication } from '@nestjs/common';
import { TestAppHelper } from './helpers/test-app.helper';
import { apiCorsOptions, securityMiddleware } from '../src/common/http/security-headers';
import { parseCorsOrigins } from '../src/config/cors';
import { DASHBOARD_HTML } from '../src/modules/monitoring/dashboard.html';
import { htmlPageCsp } from '../src/common/http/security-headers';

/**
 * Phase 14: headers, CORS and cache behaviour on real HTTP responses. The middleware chain under test is the one main.ts mounts
 * (securityMiddleware, apiCorsOptions), so a change to production bootstrap is a change to these tests' subject.
 */
const buildApp = (production: boolean, corsOrigins: string[]) => {
  const app = express();
  for (const mw of securityMiddleware(production)) app.use(mw);
  app.use(cors(apiCorsOptions(corsOrigins)));
  app.get('/api/v1/user/profile', (_req, res) => res.json({ ok: true }));
  app.get('/api/v1/credit/packages', (_req, res) => res.json({ ok: true }));
  app.get('/api/v1/own-cache', (_req, res) => {
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.json({ ok: true });
  });
  return app;
};

describe('API security headers on real responses (Phase 14)', () => {
  const prod = buildApp(true, ['https://app.orion-test.example']);
  const dev = buildApp(false, parseCorsOrigins(undefined, false).origins);

  it('production responses carry the full header set, with a single Content-Security-Policy and no includeSubDomains / preload', async () => {
    const r = await request(prod).get('/api/v1/credit/packages');
    expect(r.headers['content-security-policy']).toBe("default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    expect(r.headers['strict-transport-security']).toBe('max-age=31536000');
    expect(r.headers['strict-transport-security']).not.toMatch(/includeSubDomains|preload/i);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['referrer-policy']).toBeDefined();
    expect(r.headers['permissions-policy']).toContain('camera=()');
    expect(r.headers['x-powered-by']).toBeUndefined();
    expect(String(r.headers['content-security-policy']).split("default-src").length - 1).toBe(1); // one policy, not two merged
  });

  it('development responses do not claim HSTS (plain HTTP)', async () => {
    const r = await request(dev).get('/api/v1/credit/packages');
    expect(r.headers['strict-transport-security']).toBeUndefined();
    expect(r.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('credentialed responses are no-store; anonymous ones keep normal caching; a route that sets its own policy keeps it', async () => {
    expect((await request(prod).get('/api/v1/user/profile').set('Authorization', 'Bearer test.token.value')).headers['cache-control']).toBe('no-store');
    expect((await request(prod).get('/api/v1/credit/packages')).headers['cache-control']).toBeUndefined();
    expect((await request(prod).get('/api/v1/own-cache').set('Authorization', 'Bearer test.token.value')).headers['cache-control']).toBe('private, max-age=60');
  });

  describe('CORS', () => {
    it('an approved origin gets exactly that origin back, with credentials, never a wildcard', async () => {
      const r = await request(prod).get('/api/v1/credit/packages').set('Origin', 'https://app.orion-test.example');
      expect(r.headers['access-control-allow-origin']).toBe('https://app.orion-test.example');
      expect(r.headers['access-control-allow-credentials']).toBe('true');
      expect(r.headers['access-control-allow-origin']).not.toBe('*');
      expect(String(r.headers['vary'])).toMatch(/Origin/i);
    });

    it('an unapproved origin, a look-alike and the local web app are not allowed in production', async () => {
      for (const origin of ['https://evil.example', 'https://app.orion-test.example.evil.example', 'http://app.orion-test.example', 'http://localhost:3000', 'null']) {
        const r = await request(prod).get('/api/v1/credit/packages').set('Origin', origin);
        // no Allow-Origin: the browser blocks the response. (The cors package still adds Allow-Credentials; without an Allow-Origin it grants nothing.)
        expect(r.headers['access-control-allow-origin']).toBeUndefined();
      }
    });

    it('with no CORS_ORIGINS in production nothing cross-origin is allowed at all', async () => {
      const none = buildApp(true, parseCorsOrigins(undefined, true).origins);
      const r = await request(none).get('/api/v1/credit/packages').set('Origin', 'http://localhost:3000');
      expect(r.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('the preflight of an approved origin lists the real methods and headers; an unapproved one gets none', async () => {
      const ok = await request(prod).options('/api/v1/user/profile').set('Origin', 'https://app.orion-test.example').set('Access-Control-Request-Method', 'PATCH').set('Access-Control-Request-Headers', 'authorization,content-type');
      expect(ok.status).toBe(204);
      expect(ok.headers['access-control-allow-origin']).toBe('https://app.orion-test.example');
      expect(ok.headers['access-control-allow-methods']).toContain('PATCH');
      expect(ok.headers['access-control-allow-headers']).toMatch(/authorization/i);
      const no = await request(prod).options('/api/v1/user/profile').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'DELETE');
      expect(no.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});

describe('Pages and endpoints served by the Nest application (Phase 14)', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();
  });
  afterAll(async () => {
    await testApp.close();
  });

  it('the monitoring dashboard page carries its own hash-based policy, is not cached and is not indexed', async () => {
    const r = await api().get('/api/v1/monitoring/dashboard');
    expect(r.status).toBe(200);
    expect(r.headers['content-security-policy']).toBe(htmlPageCsp(DASHBOARD_HTML));
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['x-robots-tag']).toBe('noindex');
    expect(r.headers['content-security-policy']).not.toMatch(/unsafe-inline.*script|script-src[^;]*unsafe-inline/);
  });

  it('public health answers carry status and latency only, never versions, hosts, pool figures or error text; they are not cacheable', async () => {
    for (const p of ['/api/v1/health', '/api/v1/health/live', '/api/v1/health/ready', '/api/v1/health/database']) {
      const r = await api().get(p);
      expect([200, 503]).toContain(r.status);
      expect(r.headers['cache-control']).toMatch(/no-store/);
      const json = JSON.stringify(r.body);
      expect(json).not.toMatch(/postgres(ql)?:\/\/|password|secret|version"|nodeVersion|hostname|stack|at .*\.ts|[A-Z]:\\|\/home\//i);
    }
  });

  it('an unknown route or a malformed body returns a generic error with no stack, SQL or file path', async () => {
    for (const r of [await api().get('/api/v1/definitely/not/a/route'), await api().post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"email":')]) {
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
      expect(JSON.stringify(r.body)).not.toMatch(/stack|node_modules|select |insert |[A-Z]:\\|\/usr\/|\.ts:\d+/i);
    }
  });

  it('no API explorer or diagnostic page is served anonymously in the test environment unless it is the explorer itself', async () => {
    for (const p of ['/api/v1/.env', '/api/v1/debug', '/api/v1/metrics/raw', '/api/v1/admin/debug', '/.git/config', '/api/v1/../../package.json']) {
      const r = await api().get(p);
      expect([400, 401, 403, 404]).toContain(r.status);
    }
  });
});

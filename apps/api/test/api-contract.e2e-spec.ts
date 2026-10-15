import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import * as jwt from 'jsonwebtoken';
import { INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { ModulesContainer, Reflector } from '@nestjs/core';
import { ThrottlerStorage } from '@nestjs/throttler';
import { eq } from 'drizzle-orm';
import { IS_PUBLIC_KEY, ROLES_KEY } from '../src/auth/decorators';
import { TestAppHelper } from './helpers/test-app.helper';
import { TEST_SECRETS } from './helpers/test-secrets';
import * as schema from '../src/database/schema';

/**
 * Phase 28: API contract behaviour tested from the outside. The route list is read from the running application, so a route added
 * later is covered without editing this file. Synthetic accounts and an in-memory database only.
 *
 *  - every route, called as a customer and as an administrator with malformed, mistyped, oversized, prototype-polluting and
 *    ownership/role/price-overriding payloads, answers with a client error or success, never a server error, and never with a
 *    body that carries a stack trace, SQL, a file path or a credential;
 *  - values a client must not control (role, status, balance, price, ownership, verification, publication) are refused or ignored;
 *  - repeated requests against credit-sensitive endpoints do not repeat the charge;
 *  - no GET changes stored state.
 */
const HTTP: Record<number, string> = { 0: 'get', 1: 'post', 2: 'put', 3: 'delete', 4: 'patch' };
const ZERO = '00000000-0000-4000-8000-000000000000';

describe('API contract: validation, safe errors, protected fields, idempotency (Phase 28)', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const unwrap = (res: any) => res.body.data || res.body;
  const stamp = Date.now();
  const emails: string[] = [];
  const slugs: string[] = [];
  const clear = () => (app.get(ThrottlerStorage) as any).storage.clear();
  let customer: { id: string; email: string; auth: { Authorization: string } };
  let admin: { Authorization: string };
  let routes: Array<{ method: string; path: string; roles: string[]; isPublic: boolean }> = [];

  const discover = () => {
    const reflector = new Reflector();
    const out: typeof routes = [];
    for (const mod of app.get(ModulesContainer).values()) {
      for (const ctrl of mod.controllers.values()) {
        const type = ctrl.metatype as any;
        if (!type) continue;
        const bases = ([] as any[]).concat(Reflect.getMetadata(PATH_METADATA, type) ?? '').map(String);
        for (const name of Object.getOwnPropertyNames(type.prototype)) {
          const fn = type.prototype[name];
          if (typeof fn !== 'function') continue;
          const method = Reflect.getMetadata(METHOD_METADATA, fn);
          if (method === undefined || HTTP[method] === undefined) continue;
          const subs = ([] as any[]).concat(Reflect.getMetadata(PATH_METADATA, fn) ?? '').map(String);
          const roles = (reflector.getAllAndOverride<string[]>(ROLES_KEY, [fn, type]) ?? []).map(String);
          const isPublic = Boolean(reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [fn, type]));
          for (const b of bases) for (const s of subs) out.push({ method: HTTP[method], path: `/api/v1/${b}/${s}`.replace(/\/+/g, '/').replace(/\/$/, ''), roles, isPublic });
        }
      }
    }
    return out;
  };
  // the hostile sweep calls logout and password routes, which legitimately end the swept account's session: later tests use fresh accounts
  const freshCustomer = async (tag: string) => {
    const email = `p28.${tag}.${stamp}@orion-test.io`;
    emails.push(email);
    const reg = unwrap(await api().post('/api/v1/auth/register').send({ email, password: 'Phase28Pass123!', firstName: 'Api', lastName: tag }));
    return { id: reg.user.id as string, auth: { Authorization: `Bearer ${reg.tokens.accessToken}` } };
  };
  const concrete = (p: string) => p.replace(/:[A-Za-z]+/g, ZERO);

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();
    const adminEmail = `p28.admin.${stamp}@monarchsoftwares.com`;
    emails.push(adminEmail);
    const adminId = await testApp.provisionAdmin(adminEmail, 'SUPER_ADMIN');
    admin = { Authorization: `Bearer ${jwt.sign({ sub: adminId, email: adminEmail, role: 'SUPER_ADMIN', status: 'ACTIVE' }, TEST_SECRETS.jwtAccess, { expiresIn: '1h', issuer: 'orion-api', audience: 'orion-client' })}` };
    const email = `p28.cust.${stamp}@orion-test.io`;
    emails.push(email);
    const reg = unwrap(await api().post('/api/v1/auth/register').send({ email, password: 'Phase28Pass123!', firstName: 'Api', lastName: 'Contract' }));
    customer = { id: reg.user.id, email, auth: { Authorization: `Bearer ${reg.tokens.accessToken}` } };
    routes = discover();
  }, 60_000);
  beforeEach(clear);
  afterAll(async () => {
    await testApp.cleanupBusinesses(slugs);
    await testApp.cleanupUsers(emails);
    await testApp.close();
  });

  /** What must never appear in any response body, whatever the request. */
  const LEAK = /node_modules|\bat [\w.<>$ ]+ \(.*:\d+:\d+\)|\bSELECT\b.+\bFROM\b|\bINSERT INTO\b|\bUPDATE\b.+\bSET\b|password_hash|passwordHash|postgres(ql)?:\/\/|BEGIN (RSA |EC )?PRIVATE|\.ts:\d+|[A-Z]:\\Users\\|\/home\/|stack"\s*:/i;

  const deep = (n: number): any => (n === 0 ? 'x' : { a: deep(n - 1) });
  const PAYLOADS: Array<[string, any]> = [
    ['empty object', {}],
    ['array instead of object', [1, 2, 3]],
    ['string instead of object', 'just text'],
    ['wrong types', { email: 12345, name: { $ne: null }, id: [1, 2], page: 'abc', limit: {}, amount: 'NaN', businessId: 42 }],
    ['prototype pollution', JSON.parse('{"__proto__":{"role":"SUPER_ADMIN"},"constructor":{"prototype":{"isAdmin":true}}}')],
    ['protected fields', { role: 'SUPER_ADMIN', status: 'ACTIVE', balance: 1e9, credits: 1e9, price: 0, amount: -1, userId: ZERO, ownerId: ZERO, isVerified: true, isPublished: true, publishedAt: '2000-01-01' }],
    ['very deep nesting', deep(60)],
    ['long strings', { name: 'x'.repeat(60_000), q: 'y'.repeat(60_000), notes: 'z'.repeat(60_000) }],
    ['control characters', { name: 'a\u0000b\u0007c', email: 'a\u0000@b.c', q: '‮\u0000' }],
  ];
  const QUERIES = ['?page=abc&limit=-1', '?page=1e30&limit=1e9', '?q=%00%27%22&sortBy=%3B--', '?limit[]=1&page[x]=2', '?__proto__[admin]=1&constructor[prototype][x]=1'];

  const sweep = async (who: { Authorization: string }, label: string) => {
    const bad: string[] = [];
    let n = 0;
    const targets = [...new Map(routes.map((r) => [`${r.method} ${r.path}`, r])).values()].filter((r) => !/\/(upload|files?)$/.test(r.path));
    for (const r of targets) {
      const url = concrete(r.path);
      const calls: Array<{ desc: string; run: () => Promise<any> }> =
        r.method === 'get' || r.method === 'delete'
          ? QUERIES.map((q) => ({ desc: `${r.method.toUpperCase()} ${url}${q}`, run: () => (api() as any)[r.method](url + q).set(who as any) }))
          : PAYLOADS.map(([name, body]) => ({
              desc: `${r.method.toUpperCase()} ${url} [${name}]`,
              run: () => (api() as any)[r.method](url).set(who as any).set('Content-Type', 'application/json').send(typeof body === 'string' ? JSON.stringify(body) : JSON.stringify(body)),
            }));
      for (const c of calls) {
        if (++n % 25 === 0) clear();
        const res = await c.run();
        const text = JSON.stringify(res.body ?? {}) + String(res.text ?? '').slice(0, 4000);
        if (res.status >= 500 && !(res.status === 503 && /\/health(\/|$|\?)/.test(c.desc))) bad.push(`${label} ${res.status} ${c.desc}`);
        else if (LEAK.test(text)) bad.push(`${label} LEAK ${res.status} ${c.desc}: ${(text.match(LEAK) ?? [''])[0].slice(0, 40)}`);
      }
    }
    return bad;
  };

  describe('every route, hostile requests', () => {
    it('the route list is read from the running application', () => {
      expect(routes.length).toBeGreaterThanOrEqual(190);
    });

    it('as a customer: no server error and no internal detail in any response', async () => {
      const bad = await sweep(customer.auth, 'customer');
      expect(bad).toEqual([]);
    }, 900_000);

    it('as an administrator: no server error and no internal detail in any response', async () => {
      const bad = await sweep(admin, 'admin');
      expect(bad).toEqual([]);
    }, 900_000);

    it('a malformed JSON body is a 400 with a fixed message, not a parser stack', async () => {
      const res = await api().post('/api/v1/saved-leads').set(customer.auth).set('Content-Type', 'application/json').send('{"businessId": ');
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toMatch(LEAK);
      expect(res.body.message).toMatch(/valid JSON/i);
    });

    it('an unsupported content type is refused cleanly', async () => {
      const res = await api().post('/api/v1/saved-leads').set(customer.auth).set('Content-Type', 'text/xml').send('<a/>');
      expect(res.status).toBeLessThan(500);
    });
  });

  describe('declared contract', () => {
    /** Request bodies whose type is not a validated class: the pipe cannot check them. Each is administrator-only and checked by hand in its handler. */
    const UNVALIDATED_BODY_ALLOWLIST = [
      'AdminImportController.previewRows',
      'AdminImportController.submitBatch',
      'AdminImportController.previewCsv',
      'AdminImportController.submitCsv',
    ];

    it('every route that reads a request body declares a validated class for it (an inline type is not validated by the pipe)', () => {
      const bad: string[] = [];
      const seen: string[] = [];
      for (const mod of app.get(ModulesContainer).values()) {
        for (const ctrl of mod.controllers.values()) {
          const type = ctrl.metatype as any;
          if (!type) continue;
          for (const name of Object.getOwnPropertyNames(type.prototype)) {
            const fn = type.prototype[name];
            if (typeof fn !== 'function' || Reflect.getMetadata(METHOD_METADATA, fn) === undefined) continue;
            const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, type, name) ?? {};
            const paramTypes: any[] = Reflect.getMetadata('design:paramtypes', type.prototype, name) ?? [];
            for (const key of Object.keys(args)) {
              const [kind] = key.split(':');
              if (Number(kind) !== RouteParamtypes.BODY) continue;
              const t = paramTypes[args[key].index];
              const validated = typeof t === 'function' && ![Object, Array, String, Number, Boolean].includes(t);
              if (!validated) {
                seen.push(`${type.name}.${name}`);
                if (!UNVALIDATED_BODY_ALLOWLIST.includes(`${type.name}.${name}`)) bad.push(`${type.name}.${name}`);
              }
            }
          }
        }
      }
      expect(bad).toEqual([]);
      // the allowlist only holds what still exists (an entry for a route that was fixed or removed must be deleted)
      for (const a of UNVALIDATED_BODY_ALLOWLIST) expect(seen).toContain(a);
    });
  });

  describe('values the client must not control', () => {
    it('registration ignores or refuses role, status and verification fields: the account is an ordinary active customer', async () => {
      const email = `p28.over.${stamp}@orion-test.io`;
      emails.push(email);
      const res = await api().post('/api/v1/auth/register').send({ email, password: 'Phase28Pass123!', firstName: 'Ov', lastName: 'Er', role: 'SUPER_ADMIN', status: 'ACTIVE', emailVerified: true, isEmailVerified: true });
      expect(res.status).toBeLessThan(500);
      const [row] = await testApp.db.select().from(schema.users).where(eq(schema.users.email, email));
      if (row) expect(row.role).toBe('USER');
    });

    it('profile update cannot change role, status, e-mail verification or credits', async () => {
      const before = (await testApp.db.select().from(schema.users).where(eq(schema.users.id, customer.id)))[0] as any;
      for (const [m, p] of [['put', '/api/v1/user/profile'], ['patch', '/api/v1/user/profile'], ['patch', '/api/v1/user/me'], ['put', '/api/v1/settings'], ['patch', '/api/v1/settings']] as const) {
        await (api() as any)[m](p).set(customer.auth).send({ role: 'SUPER_ADMIN', status: 'SUSPENDED', emailVerified: true, isEmailVerified: true, credits: 1e9, balance: 1e9, firstName: 'Changed' });
      }
      const after = (await testApp.db.select().from(schema.users).where(eq(schema.users.id, customer.id)))[0] as any;
      expect([after.role, after.status, after.emailVerified ?? null]).toEqual([before.role, before.status, before.emailVerified ?? null]);
      const w = (await testApp.db.select().from(schema.userWallets).where(eq(schema.userWallets.userId, customer.id)))[0] as any;
      expect(w.balance).toBeLessThan(1000);
    });

    it('a customer cannot set a price, credit amount, balance or publication state through any customer route', async () => {
      const slug = `p28-biz-${stamp}`;
      slugs.push(slug);
      const biz = await testApp.createTestBusiness({ slug, name: 'P28 Contract Corp', contactEmail: `${slug}@lead.example`, contactPhone: '+91 9000000028' });
      await testApp.db.update(schema.businesses).set({ status: 'DRAFT' } as any).where(eq(schema.businesses.id, biz.id));
      for (const [m, p] of [['post', '/api/v1/unlock/business'], ['post', '/api/v1/saved-leads'], ['post', '/api/v1/payments/create-order'], ['post', '/api/v1/credit/admin/adjust'], ['patch', `/api/v1/business/${biz.id}`], ['put', `/api/v1/business/${biz.id}`]] as const) {
        const res = await (api() as any)[m](p).set(customer.auth).send({ businessId: biz.id, status: 'PUBLISHED', creditsSpent: 0, amount: 0, price: 0, credits: 1e9, balance: 1e9, userId: ZERO });
        expect([m, p, res.status < 300]).toEqual([m, p, false]);
      }
      const [b] = await testApp.db.select().from(schema.businesses).where(eq(schema.businesses.id, biz.id));
      expect(b.status).toBe('DRAFT');
      const w = (await testApp.db.select().from(schema.userWallets).where(eq(schema.userWallets.userId, customer.id)))[0] as any;
      expect(w.balance).toBeLessThan(1000);
    });
  });

  describe('repeated requests and HTTP semantics', () => {
    it('repeating an unlock request charges once and answers consistently', async () => {
      const slug = `p28-unlock-${stamp}`;
      slugs.push(slug);
      const biz = await testApp.createTestBusiness({ slug, name: 'P28 Unlock Corp', contactEmail: `${slug}@lead.example`, contactPhone: '+91 9000000029' });
      const buyer = await freshCustomer('unlock');
      const before = ((await testApp.db.select().from(schema.userWallets).where(eq(schema.userWallets.userId, buyer.id)))[0] as any).balance;
      const results = [];
      for (let i = 0; i < 4; i++) results.push(await api().post('/api/v1/unlock/business').set(buyer.auth).send({ businessId: biz.id }));
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
      expect(results.filter((r) => unwrap(r).alreadyUnlocked === false)).toHaveLength(1);
      const after = ((await testApp.db.select().from(schema.userWallets).where(eq(schema.userWallets.userId, buyer.id)))[0] as any).balance;
      expect(before - after).toBe(1);
    });

    it('no GET request changes stored data (row counts of the user-owned tables are equal before and after every GET)', async () => {
      const count = async () => {
        const t = [schema.userWallets, schema.creditTransactions, schema.leadUnlocks, schema.savedLeads, schema.savedSearches, schema.exportJobs, schema.auditLogs] as any[];
        const out: number[] = [];
        for (const x of t) out.push((await testApp.db.select().from(x)).length);
        return out;
      };
      const reader = await freshCustomer('reader');
      let answered = 0;
      const gets = [...new Set(routes.filter((r) => r.method === 'get').map((r) => concrete(r.path)))];
      const changed: string[] = [];
      let n = 0;
      for (const url of gets) {
        if (++n % 30 === 0) clear();
        // audit rows for the read itself are allowed (an audit is not a state change of business data): compare all but the audit table
        const a = (await count()).slice(0, 6);
        const r1 = await api().get(url).set(reader.auth);
        if (r1.status === 200) answered++;
        await api().get(url).set(admin);
        const b = (await count()).slice(0, 6);
        if (a.join() !== b.join()) changed.push(url);
      }
      expect(changed).toEqual([]);
      expect(answered).toBeGreaterThan(20); // the check is not vacuous: the reader's session stayed valid and many routes answered
    }, 600_000);

    // Cache-Control: no-store on credentialed responses is set by the security middleware that main.ts mounts; this harness does not
    // mount it, so that behaviour is proved in security-headers.e2e-spec.ts (which does), not here.
  });
});

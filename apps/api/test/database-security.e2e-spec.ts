import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { eq, sql } from 'drizzle-orm';
import { TestAppHelper } from './helpers/test-app.helper';
import * as schema from '../src/database/schema';

/**
 * Phase 27: database-facing behaviour tested from the outside, with synthetic accounts and data only.
 *  - hostile text in every kind of query input never changes a query's structure and never produces a server error;
 *  - extreme paging values and oversized bulk lists are refused or bounded, never a database error or unbounded work;
 *  - a second customer cannot read, change or delete the first customer's records by identifier, singly or in bulk;
 *  - customer-facing responses never carry password hashes, token digests or other security fields.
 */
describe('Database security: query safety, bounds, customer isolation, field minimisation (Phase 27)', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const unwrap = (res: any) => res.body.data || res.body;
  const stamp = Date.now();
  const emails: string[] = [];
  const slugs: string[] = [];
  const items = (d: any): any[] => (Array.isArray(d) ? d : d?.items ?? []);
  const clear = () => (app.get(ThrottlerStorage) as any).storage.clear();
  const ZERO = '00000000-0000-4000-8000-000000000000';

  type Cust = { id: string; email: string; auth: { Authorization: string } };
  let a: Cust;
  let b: Cust;
  let bizA: { id: string; slug: string };
  let leadA = '';
  let searchA = '';

  const register = async (tag: string): Promise<Cust> => {
    const email = `p27.${tag}.${stamp}@orion-test.io`;
    emails.push(email);
    const reg = unwrap(await api().post('/api/v1/auth/register').send({ email, password: 'Phase27Pass123!', firstName: 'Db', lastName: tag }));
    return { id: reg.user.id, email, auth: { Authorization: `Bearer ${reg.tokens.accessToken}` } };
  };

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();
    a = await register('a');
    b = await register('b');
    const slug = `p27-biz-${stamp}`;
    slugs.push(slug);
    bizA = await testApp.createTestBusiness({ slug, name: 'P27 Isolation Corp', contactEmail: `${slug}@lead.example`, contactPhone: '+91 9000000027' });
    leadA = unwrap(await api().post('/api/v1/saved-leads').set(a.auth).send({ businessId: bizA.id, notes: 'private note of A', tags: ['a-only'] })).id;
    searchA = unwrap(await api().post('/api/v1/saved-searches').set(a.auth).send({ name: 'A private search', filters: { q: 'p27' } })).id;
  }, 60_000);
  beforeEach(clear);
  afterAll(async () => {
    await testApp.cleanupBusinesses(slugs);
    await testApp.cleanupUsers(emails);
    await testApp.close();
  });

  const HOSTILE = [
    `' OR '1'='1`,
    `'; DROP TABLE users; --`,
    `" OR ""="`,
    `\\'; SELECT pg_sleep(5); --`,
    `%`,
    `_`,
    `\\`,
    `%' AND 1=1 --`,
    `a\u0000b`,
    `)) UNION SELECT password_hash FROM users --`,
    'x'.repeat(5000),
    `{"$ne":null}`,
    `😀`,
  ];

  describe('hostile text in query inputs', () => {
    it('search text, filters and sort values never change a query or cause a server error, and the data is intact', async () => {
      const bad: string[] = [];
      for (const h of HOSTILE) {
        clear();
        const enc = encodeURIComponent(h);
        for (const path of [
          `/api/v1/discover/search?q=${enc}`,
          `/api/v1/discover/search?city=${enc}`,
          `/api/v1/discover/search?industry=${enc}`,
          `/api/v1/discover/search?sortBy=${enc}`,
          `/api/v1/discover/suggestions?q=${enc}`,
          `/api/v1/discover/businesses/${enc}`,
          `/api/v1/saved-leads?stage=${enc}&tag=${enc}&search=${enc}`,
        ]) {
          const res = await api().get(path).set(a.auth);
          if (res.status >= 500) bad.push(`${res.status} ${path.slice(0, 60)}`);
        }
      }
      expect(bad).toEqual([]);
      const [{ n }] = (await testApp.db.select({ n: sql<number>`count(*)::int` }).from(schema.users)) as any;
      expect(n).toBeGreaterThanOrEqual(2); // the users table still exists and still holds rows
    });

    it('a hostile search never returns more than an empty/ordinary search (no "OR 1=1" widening)', async () => {
      const all = unwrap(await api().get('/api/v1/discover/search').set(a.auth));
      const total = (r: any) => r.pagination?.totalItems ?? r.meta?.total ?? r.total ?? (r.items ?? r.businesses ?? []).length;
      const widened = unwrap(await api().get(`/api/v1/discover/search?q=${encodeURIComponent(`' OR '1'='1`)}`).set(a.auth));
      expect(total(widened)).toBeLessThanOrEqual(total(all));
    });

    it('hostile JSON in a saved search is stored as data, and running it does not error', async () => {
      const created = await api().post('/api/v1/saved-searches').set(a.auth).send({ name: `x'; DROP TABLE users;--`, filters: { q: `' OR 1=1 --`, sortBy: 'name;DROP' } });
      expect(created.status).toBeLessThan(500);
      if (created.status < 300) {
        const run = await api().post(`/api/v1/saved-searches/${unwrap(created).id}/run`).set(a.auth);
        expect(run.status).toBeLessThan(500);
      }
    });
  });

  describe('references to rows that do not exist', () => {
    it('saving, unlocking or bulk-saving a company that does not exist is a client error, never a foreign-key (database) error', async () => {
      const calls: Array<[string, string, any]> = [
        ['post', '/api/v1/saved-leads', { businessId: ZERO }],
        ['post', '/api/v1/saved-leads', { businessId: ZERO, personId: ZERO }],
        ['post', '/api/v1/saved-leads/bulk-save', { businessIds: [ZERO] }],
        ['post', '/api/v1/unlock/business', { businessId: ZERO }],
        ['post', '/api/v1/saved-searches/' + ZERO + '/run', undefined],
      ];
      for (const [m, p, body] of calls) {
        const res = await (api() as any)[m](p).set(a.auth).send(body);
        expect([m, p, res.status < 500]).toEqual([m, p, true]);
      }
      // and nothing was stored for it
      const rows = await testApp.db.select().from(schema.savedLeads).where(eq(schema.savedLeads.businessId, ZERO));
      expect(rows).toHaveLength(0);
    });
  });

  describe('paging and list bounds', () => {
    it('extreme page and limit values are refused or clamped on every customer list, never a database error', async () => {
      const lists = ['/api/v1/unlock/history', '/api/v1/credit/transactions', '/api/v1/saved-leads', '/api/v1/discover/search', '/api/v1/export/history', '/api/v1/billing/history'];
      const values = ['1e30', '99999999999999999999', '9007199254740993', '-1', '0', 'NaN', 'abc', '1e9', '2147483648', '1.5'];
      const bad: string[] = [];
      for (const p of lists) {
        for (const v of values) {
          clear();
          for (const q of [`page=${v}`, `limit=${v}`, `page=${v}&limit=${v}`]) {
            const res = await api().get(`${p}?${q}`).set(a.auth);
            if (res.status >= 500) bad.push(`${res.status} ${p}?${q}`);
          }
        }
      }
      expect(bad).toEqual([]);
    });

    it('a huge limit never returns more than the documented maximum', async () => {
      const res = await api().get('/api/v1/credit/transactions?limit=100000').set(a.auth);
      if (res.status === 200) expect(items(unwrap(res)).length).toBeLessThanOrEqual(100);
      else expect(res.status).toBe(400);
    });

    it('bulk lists are bounded: an oversized bulk save or delete is refused before any database work', async () => {
      const ids = Array.from({ length: 150 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
      const save = await api().post('/api/v1/saved-leads/bulk-save').set(a.auth).send({ businessIds: ids });
      const del = await api().post('/api/v1/saved-leads/bulk-delete').set(a.auth).send({ leadIds: ids });
      expect(save.status).toBe(400);
      expect(del.status).toBe(400);
      // the first customer's record is untouched
      const mine = unwrap(await api().get('/api/v1/saved-leads').set(a.auth));
      expect(items(mine).some((x: any) => x.id === leadA)).toBe(true);
    });
  });

  describe('customer isolation by identifier (a second synthetic customer, every route that takes an id)', () => {
    it('B cannot read, change or delete A\'s saved lead, singly or in bulk', async () => {
      const patch = await api().patch(`/api/v1/saved-leads/${leadA}`).set(b.auth).send({ notes: 'hijacked' });
      expect(patch.status).toBe(404);
      const del = await api().delete(`/api/v1/saved-leads/${leadA}`).set(b.auth);
      expect(del.status).toBe(404);
      const bulk = await api().post('/api/v1/saved-leads/bulk-delete').set(b.auth).send({ leadIds: [leadA] });
      expect(unwrap(bulk).deletedCount ?? 0).toBe(0);
      const listB = unwrap(await api().get('/api/v1/saved-leads').set(b.auth));
      expect(JSON.stringify(listB)).not.toContain('private note of A');
      const [row] = await testApp.db.select().from(schema.savedLeads).where(eq(schema.savedLeads.id, leadA));
      expect([row?.notes, row?.userId]).toEqual(['private note of A', a.id]);
    });

    it('B cannot read, run, change or delete A\'s saved search', async () => {
      for (const [m, p, body] of [
        ['get', `/api/v1/saved-searches/${searchA}`, undefined],
        ['post', `/api/v1/saved-searches/${searchA}/run`, undefined],
        ['patch', `/api/v1/saved-searches/${searchA}`, { name: 'hijacked' }],
        ['delete', `/api/v1/saved-searches/${searchA}`, undefined],
      ] as const) {
        const res = await (api() as any)[m](p).set(b.auth).send(body);
        expect([m, p, res.status]).toEqual([m, p, 404]);
      }
      const [row] = await testApp.db.select().from(schema.savedSearches).where(eq(schema.savedSearches.id, searchA));
      expect(row?.name).toBe('A private search');
      expect(JSON.stringify(unwrap(await api().get('/api/v1/saved-searches').set(b.auth)))).not.toContain('A private search');
    });

    it('A\'s unlock appears only for A: B has no unlock, no history entry, and the profile stays masked for B', async () => {
      await testApp.db.update(schema.userWallets).set({ purchasedCredits: 5, balance: 10 }).where(eq(schema.userWallets.userId, a.id));
      const unlocked = await api().post('/api/v1/unlock/business').set(a.auth).send({ businessId: bizA.id });
      expect(unlocked.status).toBeLessThan(300);
      const histB = unwrap(await api().get('/api/v1/unlock/history').set(b.auth));
      expect(items(histB)).toHaveLength(0);
      const statusB = unwrap(await api().get(`/api/v1/unlock/status/${bizA.id}`).set(b.auth));
      expect(statusB.isUnlocked).toBe(false);
      expect(JSON.stringify(unwrap(await api().get(`/api/v1/discover/businesses/${bizA.slug}`).set(b.auth)))).not.toContain(`${bizA.slug}@lead.example`);
    });

    it('B cannot reach A\'s invoices, export jobs, export schedules or integrations by identifier', async () => {
      const sched = await api().post('/api/v1/export/schedules').set(a.auth).send({ dataset: 'saved-leads', format: 'csv', frequency: 'DAILY', hourUtc: 3 });
      const schedId = sched.status < 300 ? unwrap(sched).id : ZERO;
      for (const [m, p] of [
        ['patch', `/api/v1/export/schedules/${schedId}`],
        ['delete', `/api/v1/export/schedules/${schedId}`],
        ['get', `/api/v1/export/${schedId}/download`],
        ['get', `/api/v1/billing/invoices/${schedId}`],
        ['get', `/api/v1/billing/invoices/${schedId}/html`],
        ['get', `/api/v1/integrations/${schedId}`],
        ['delete', `/api/v1/integrations/${schedId}`],
        ['post', `/api/v1/integrations/${schedId}/rotate-secret`],
      ] as const) {
        const res = await (api() as any)[m](p).set(b.auth).send(m === 'patch' ? { enabled: false } : undefined);
        expect([m, p, res.status >= 400 && res.status < 500]).toEqual([m, p, true]);
      }
      if (schedId !== ZERO) {
        const [row] = await testApp.db.select().from(schema.exportSchedules).where(eq(schema.exportSchedules.id, schedId));
        expect(row?.enabled).toBe(true);
      }
    });

    it('a client-supplied user identifier in a body or query never overrides the authenticated customer', async () => {
      const res = await api().post('/api/v1/saved-leads').set(b.auth).send({ businessId: bizA.id, userId: a.id });
      expect(res.status).toBe(400); // unknown property refused
      const rows = await testApp.db.select().from(schema.savedLeads).where(eq(schema.savedLeads.userId, b.id));
      expect(rows).toHaveLength(0);
      const tx = unwrap(await api().get(`/api/v1/credit/transactions?userId=${a.id}`).set(b.auth));
      expect(items(tx).every((r: any) => r.userId === b.id)).toBe(true);
    });
  });

  describe('customer-facing responses carry no security fields', () => {
    const FORBIDDEN = /(?<!has)password|hash|digest|refresh_?token|secret|otp|salt|signingSecret|credentialEnc|mfa|recoveryCode/i;
    const keysOf = (v: any, out: string[] = []): string[] => {
      if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); keysOf(x, out); }
      return out;
    };

    it('no property name in the account, wallet, history, saved-item, billing, export or integration responses refers to a credential', async () => {
      const paths = [
        '/api/v1/auth/me', '/api/v1/user/profile', '/api/v1/credit/wallet', '/api/v1/credit/transactions', '/api/v1/unlock/history',
        '/api/v1/saved-leads', '/api/v1/saved-searches', '/api/v1/billing/subscription', '/api/v1/billing/history', '/api/v1/billing/invoices',
        '/api/v1/export/history', '/api/v1/export/schedules', '/api/v1/integrations', '/api/v1/dashboard/summary', '/api/v1/privacy/requests',
      ];
      const found: string[] = [];
      for (const p of paths) {
        clear();
        const res = await api().get(p).set(a.auth);
        if (res.status >= 500) found.push(`${res.status} ${p}`);
        if (res.status === 200) for (const k of keysOf(res.body)) if (FORBIDDEN.test(k)) found.push(`${p}: ${k}`);
      }
      expect(found).toEqual([]);
    });

    it('registration and login responses carry tokens as designed but no hash or secret property', async () => {
      const res = await api().post('/api/v1/auth/login').send({ email: a.email, password: 'Phase27Pass123!' });
      expect(res.status).toBeLessThan(300);
      const names = keysOf(res.body).filter((k) => FORBIDDEN.test(k) && !/^(accessToken|refreshToken|tokens)$/.test(k));
      expect(names).toEqual([]);
    });
  });
});

import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { like } from 'drizzle-orm';
import { TestAppHelper } from './helpers/test-app.helper';
import * as schema from '../src/database/schema';
import { ContactSuppressionService } from '../src/modules/privacy/contact-suppression.service';

/**
 * Phase 10: classification, masking and minimisation, checked on real HTTP responses and on the bytes of a real export.
 * Synthetic data only (reserved example domains, invented names and numbers).
 */
const binary = (res: any, cb: (e: Error | null, b?: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

/** Keys that must never appear anywhere in a customer-facing response. */
const FORBIDDEN_KEYS = [
  'passwordHash', 'password_hash', 'twoFactorSecret', 'two_factor_secret', 'metadata', 'sourceId', 'source_id', 'masterBusinessId', 'master_business_id',
  'confidenceScore', 'reviewNotes', 'adminNotes', 'moderationNotes', 'sourceUrl', 'source_url', 'fingerprint', 'normalizedValue', 'normalized_value',
  'accountId', 'deletedAt', 'refreshToken', 'tokenHash', 'apiKeyHash', 'ipAddress', 'userAgent',
];

function keysOf(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out.add(k);
      keysOf(val, out);
    }
  }
  return out;
}

describe('Privacy classification, masking and minimisation (Phase 10)', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const unwrap = (res: any) => res.body.data || res.body;
  const tag = `zzpriv${Date.now()}`;
  const emails: string[] = [];
  const slug = `${tag}-acme`;
  let bizId = '';
  const contactCount = { n: 0 };
  let registerUser: unknown = null;

  const newUser = async (name: string) => {
    const email = `priv.${name}.${Date.now()}@orion-test.io`;
    emails.push(email);
    const res = unwrap(await api().post('/api/v1/auth/register').send({ email, password: 'PrivacyPass123!', firstName: 'Pr', lastName: name }));
    registerUser = res.user;
    return { id: res.user.id as string, email, auth: { Authorization: `Bearer ${res.tokens.accessToken}` } };
  };

  let owner: Awaited<ReturnType<typeof newUser>>;
  let other: Awaited<ReturnType<typeof newUser>>;

  // The raw values seeded below; none of them may appear in a locked response.
  const RAW = {
    role: 'info@acme-example.com',
    work: 'vikram.sharma@acme-example.com',
    personal: 'vikram.sharma@gmail.com',
    unknown: 'zq7@gmail.com',
    mobile: '+91 9000000071',
    landline: '022 2345 6789',
    panIndividual: 'ABCPD1234E',
    gstinIndividual: '27ABCPD1234E1Z5',
    panCompany: 'AAACA1234B',
    cin: 'U12345MH2010PTC123456',
  };

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();
    const biz = await testApp.createTestBusiness({ slug, name: `${tag} Acme Co`, contactEmail: RAW.work, contactPhone: RAW.mobile });
    bizId = biz.id;
    const mk = (fullName: string, email: string | null, phone: string | null, extra: Record<string, unknown> = {}) => ({ businessId: bizId, fullName, email, phone, ...extra });
    await testApp.db.insert(schema.businessContacts).values([
      mk('Front Desk', RAW.role, RAW.landline),
      mk('Vikram Sharma', RAW.personal, null),
      mk('Quiet Person', RAW.unknown, null),
    ] as any);
    contactCount.n = 4;
    await testApp.db.insert(schema.businessIdentifiers).values([
      { businessId: bizId, type: 'PAN', value: RAW.panIndividual, normalizedValue: `${tag}-pan1` },
      { businessId: bizId, type: 'GSTIN', value: RAW.gstinIndividual, normalizedValue: `${tag}-gst1` },
      { businessId: bizId, type: 'PAN', value: RAW.panCompany, normalizedValue: `${tag}-pan2` },
      { businessId: bizId, type: 'CIN', value: RAW.cin, normalizedValue: `${tag}-cin1` },
    ] as any);
    owner = await newUser('owner');
    other = await newUser('other');
  });

  beforeEach(() => {
    (app.get(ThrottlerStorage) as any).storage.clear();
  });

  afterAll(async () => {
    const biz = await testApp.db.select({ slug: schema.businesses.slug }).from(schema.businesses).where(like(schema.businesses.slug, `${tag}%`));
    await testApp.cleanupBusinesses(biz.map((b) => b.slug));
    await testApp.cleanupUsers(emails);
    await testApp.close();
  });

  const detail = (who: { auth: any } | null, path = `/api/v1/discover/businesses/${slug}`) => {
    const r = api().get(path);
    return who ? r.set(who.auth) : r;
  };

  const rawValuesIn = (json: string) =>
    [RAW.role, RAW.work, RAW.personal, RAW.unknown, RAW.mobile, RAW.landline, RAW.panIndividual, RAW.gstinIndividual, RAW.panCompany, '9000000071', '23456789', 'Sharma', 'ABCPD', 'AAACA'].filter((v) => json.includes(v));

  // ---------------------------------------------------------------------------------------------------------------
  describe('before unlock: server-side masking by classification', () => {
    it('returns masked contacts with the right kind, and no raw value anywhere in the response', async () => {
      const res = await detail(other);
      expect(res.status).toBe(200);
      const d = unwrap(res);
      const byName = (n: string) => d.contacts.find((c: any) => c.fullName.startsWith(n));
      expect(d.contacts).toHaveLength(contactCount.n);
      for (const c of d.contacts) expect(c.isLocked).toBe(true);

      const desk = byName('Front');
      expect(desk.emailKind).toBe('BUSINESS');
      expect(desk.email).toBe('info@a***e.com'); // a role mailbox keeps its role name; the domain is masked
      expect(desk.phoneKind).toBe('BUSINESS');
      expect(desk.phone).toBe('22******89');

      expect(d.contacts.map((c: any) => c.email)).toContain('v*****@gmail.com');
      const kinds = d.contacts.map((c: any) => c.emailKind).sort();
      expect(kinds).toEqual(['BUSINESS', 'INDIVIDUAL_WORK', 'PERSONAL', 'UNKNOWN']);
      expect(d.contacts.find((c: any) => c.emailKind === 'UNKNOWN').email).toBe('z*****@gmail.com');
      expect(d.contacts.find((c: any) => c.emailKind === 'INDIVIDUAL_WORK').email).toBe('v*****@a***e.com');
      expect(d.contacts.find((c: any) => c.phoneKind === 'INDIVIDUAL_WORK').phone).toBe('+91 ********71');

      expect(rawValuesIn(JSON.stringify(d))).toEqual([]);
    });

    it('masks identifiers: nothing of a PAN, only the state of a GSTIN, the public CIN as before', async () => {
      const d = unwrap(await detail(other));
      const ids = Object.fromEntries(d.identifiers.map((i: any) => [`${i.type}:${i.value.length}`, i.value]));
      const all = d.identifiers.map((i: any) => i.value) as string[];
      for (const v of all.filter((x) => x !== RAW.cin)) expect(v).not.toContain('1234');
      expect(all).toContain(RAW.cin);
      expect(all).toContain('27*************');
      expect(all.filter((v) => /^\*+$/.test(v))).toHaveLength(2);
      expect(Object.keys(ids).length).toBeGreaterThan(0);
    });

    it('an anonymous visitor and the public businesses route get the same masked view', async () => {
      for (const res of [await detail(null), await detail(null, `/api/v1/businesses/${slug}`), await detail(other, `/api/v1/businesses/${bizId}`)]) {
        expect(res.status).toBe(200);
        const d = unwrap(res);
        expect(d.isUnlocked).toBe(false);
        expect(rawValuesIn(JSON.stringify(d))).toEqual([]);
        for (const c of d.contacts) expect(c.isLocked).toBe(true);
      }
    });

    it('direct attempts to bypass masking change nothing: flags in the query, headers, another user id, id instead of slug', async () => {
      const attempts = [
        `/api/v1/discover/businesses/${slug}?unlocked=true`,
        `/api/v1/discover/businesses/${slug}?isUnlocked=true&showContacts=1&reveal=true`,
        `/api/v1/discover/businesses/${slug}?userId=${owner.id}`,
        `/api/v1/discover/businesses/${bizId}?unlocked=true`,
        `/api/v1/businesses/${slug}?includeContacts=true&raw=1`,
      ];
      for (const p of attempts) {
        const res = await detail(other, p).set('x-unlocked', '1').set('x-user-id', owner.id).set('x-forwarded-user', owner.id);
        expect([200, 400]).toContain(res.status);
        if (res.status === 200) expect(rawValuesIn(JSON.stringify(unwrap(res)))).toEqual([]);
      }
      // a forged token does not unlock either
      const forged = await api().get(`/api/v1/discover/businesses/${slug}`).set('Authorization', 'Bearer not.a.token');
      if (forged.status === 200) expect(rawValuesIn(JSON.stringify(unwrap(forged)))).toEqual([]);
      // the unlock history of another account is not readable through any list
      const list = unwrap(await api().get('/api/v1/unlock/history').set(other.auth));
      expect(JSON.stringify(list)).not.toContain(slug);
    });

    it('search results carry availability flags only: no contact value, masked or raw, and no contact object', async () => {
      const res = await api().get(`/api/v1/discover/search?q=${tag}`).set(other.auth);
      expect(res.status).toBe(200);
      const json = JSON.stringify(unwrap(res));
      expect(json).toContain(`${tag} Acme Co`);
      expect(rawValuesIn(json)).toEqual([]);
      expect(json).not.toContain('***');
      const hit = (unwrap(res).items ?? unwrap(res).hits ?? unwrap(res).businesses ?? []).find((b: any) => b.slug === slug);
      expect(hit).toBeDefined();
      expect(hit.contactAvailability).toMatchObject({ hasEmail: true, hasPhone: true });
      expect(Object.keys(hit)).not.toContain('contacts');
      expect(Object.keys(hit)).not.toContain('email');
      expect(Object.keys(hit)).not.toContain('phone');
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('after a valid unlock', () => {
    beforeAll(async () => {
      const r = await api().post('/api/v1/unlock/business').set(owner.auth).send({ businessId: bizId });
      expect(r.status).toBe(200);
    });

    it('the owner sees the full contact values (the paid product), with the same kinds', async () => {
      const d = unwrap(await detail(owner));
      expect(d.isUnlocked).toBe(true);
      const emails = d.contacts.map((c: any) => c.email);
      expect(emails).toEqual(expect.arrayContaining([RAW.role, RAW.work, RAW.personal, RAW.unknown]));
      expect(d.contacts.map((c: any) => c.phone)).toEqual(expect.arrayContaining([RAW.mobile, RAW.landline]));
      for (const c of d.contacts) expect(c.isLocked).toBe(false);
      expect(d.contacts.map((c: any) => c.emailKind).sort()).toEqual(['BUSINESS', 'INDIVIDUAL_WORK', 'PERSONAL', 'UNKNOWN']);
    });

    it('an individual PAN, and the PAN inside a GSTIN, stay masked even after unlock; a company PAN and the CIN are shown', async () => {
      const d = unwrap(await detail(owner));
      const vals = d.identifiers.map((i: any) => i.value) as string[];
      expect(vals).toContain(RAW.panCompany);
      expect(vals).toContain(RAW.cin);
      expect(vals).toContain('*********E');
      expect(vals).toContain('27**********1Z5');
      const json = JSON.stringify(d.identifiers);
      expect(json).not.toContain('ABCPD');
      expect(json).not.toContain(RAW.panIndividual);
    });

    it('the unlock response and the unlocked list give the owner the values and none to anyone else', async () => {
      const list = unwrap(await api().get('/api/v1/unlock/history').set(owner.auth));
      const json = JSON.stringify(list);
      expect(json).toContain(RAW.work);
      expect(json).toContain('emailKind');
      expect(json).not.toContain('metadata');
      const again = await api().post('/api/v1/unlock/business').set(owner.auth).send({ businessId: bizId });
      expect(JSON.stringify(unwrap(again))).not.toMatch(/metadata|sourceId|ABCPD/);
      const theirs = unwrap(await api().get('/api/v1/unlock/history').set(other.auth));
      expect(JSON.stringify(theirs)).not.toContain(RAW.work);
      // the other customer is still masked after the owner unlocked
      expect(rawValuesIn(JSON.stringify(unwrap(await detail(other))))).toEqual([]);
    });

    it('the export keeps the unlocked values exactly and contains nothing the screen would not show', async () => {
      const r = await api().post('/api/v1/exports').set(owner.auth).send({ dataset: 'unlocked-leads', format: 'csv' }).buffer(true).parse(binary);
      expect(r.status).toBe(200);
      const text = (r.body as Buffer).toString('utf8');
      for (const v of [RAW.role, RAW.work, RAW.personal, RAW.unknown, RAW.mobile, RAW.landline]) expect(text).toContain(v);
      // identifiers are not part of the export at all
      for (const v of [RAW.panIndividual, RAW.gstinIndividual, RAW.panCompany, 'ABCPD']) expect(text).not.toContain(v);
      const o = await api().post('/api/v1/exports').set(other.auth).send({ dataset: 'unlocked-leads', format: 'csv' }).buffer(true).parse(binary);
      expect((o.body as Buffer).toString('utf8')).not.toContain(RAW.work);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('minimisation of customer-facing responses', () => {
    it('no internal or secret key appears in any customer response', async () => {
      const bodies: Record<string, unknown> = {
        detailLocked: unwrap(await detail(other)),
        detailUnlocked: unwrap(await detail(owner)),
        search: unwrap(await api().get(`/api/v1/discover/search?q=${tag}`).set(owner.auth)),
        unlockList: unwrap(await api().get('/api/v1/unlock/history').set(owner.auth)),
        profile: unwrap(await api().get('/api/v1/user/profile').set(owner.auth)),
        me: unwrap(await api().get('/api/v1/user/me').set(owner.auth)),
        savedLeads: unwrap(await api().get('/api/v1/saved-leads').set(owner.auth)),
        exportHistory: unwrap(await api().get('/api/v1/exports/history').set(owner.auth)),
        registerUser,
        suggestions: unwrap(await api().get(`/api/v1/discover/suggestions?query=${tag}`).set(owner.auth)),
      };
      for (const [name, body] of Object.entries(bodies)) {
        const found = [...keysOf(body)].filter((k) => FORBIDDEN_KEYS.includes(k));
        expect({ name, found }).toEqual({ name, found: [] });
      }
    });

    it('error responses name no internals and echo no contact values', async () => {
      const r = await api().get('/api/v1/discover/businesses/does-not-exist-' + tag).set(other.auth);
      expect(r.status).toBe(404);
      expect(JSON.stringify(r.body)).not.toMatch(/select |from "|stack|node_modules|[A-Z]:\\|passwordHash/i);
      const bad = await api().post('/api/v1/unlock/business').set(other.auth).send({ businessId: 'x', email: RAW.work });
      expect(bad.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(bad.body)).not.toContain(RAW.work);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('who may change contact data or its verification', () => {
    it('customers cannot reach the review, publish or import routes that set contact state', async () => {
      const fakeId = '00000000-0000-4000-8000-000000000000';
      const calls = [
        api().post(`/api/v1/internal/people-review/contacts/${fakeId}/publish`).set(owner.auth).send({ reason: 'x' }),
        api().post(`/api/v1/internal/people-review/contacts/${fakeId}/unpublish`).set(owner.auth).send({ reason: 'x' }),
        api().post('/api/v1/admin/import/submit').set(owner.auth).send({}),
        api().get('/api/v1/admin/import/batches').set(owner.auth),
      ];
      for (const r of await Promise.all(calls)) expect([401, 403, 404]).toContain(r.status);
      const unauth = await api().post(`/api/v1/internal/people-review/contacts/${fakeId}/publish`).send({ reason: 'x' });
      expect(unauth.status).toBe(401);
    });

    it('a customer cannot set verification, role or classification fields through their own profile or saved-lead updates', async () => {
      for (const body of [{ role: 'ADMIN' }, { isEmailVerified: true }, { emailClass: 'BUSINESS_CONTACT_DATA' }, { status: 'ACTIVE' }]) {
        const r = await api().patch('/api/v1/user/profile').set(owner.auth).send(body);
        expect(r.status).toBe(400);
      }
      const me = unwrap(await api().get('/api/v1/user/me').set(owner.auth));
      expect(me.role ?? me.user?.role).toBe('USER');
      const lead = await api().post('/api/v1/saved-leads').set(owner.auth).send({ businessId: bizId });
      expect([200, 201]).toContain(lead.status);
      const id = unwrap(lead).id;
      const upd = await api().patch(`/api/v1/saved-leads/${id}`).set(owner.auth).send({ emailKind: 'BUSINESS', isVerified: true });
      expect(upd.status).toBe(400);
      // the business itself is unchanged by any of it
      const d = unwrap(await detail(other));
      expect(d.contacts.map((c: any) => c.emailKind).sort()).toEqual(['BUSINESS', 'INDIVIDUAL_WORK', 'PERSONAL', 'UNKNOWN']);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('suppression of a company contact (Phase 22, SG-05)', () => {
    it('after a suppression the value is gone from the detail page, the unlock list and a new export, for every customer, and cannot be written back', async () => {
      // before: the owner (who unlocked this business above) sees the value everywhere
      expect(JSON.stringify(unwrap(await detail(owner)))).toContain(RAW.work);

      const result = await app.get(ContactSuppressionService).suppress({ kind: 'EMAIL', value: RAW.work.toUpperCase(), reasonCode: 'REMOVAL' });
      expect(result).toMatchObject({ created: true, scope: 'CONTACT', contactsRemoved: 1 });

      // the primary contact row carried the work e-mail and the mobile number; it is removed as a whole
      const owned = unwrap(await detail(owner));
      expect(owned.contacts).toHaveLength(contactCount.n - 1);
      const ownerJson = JSON.stringify(owned);
      for (const v of [RAW.work, RAW.mobile]) expect(ownerJson).not.toContain(v);
      expect(ownerJson).toContain(RAW.role); // an unrelated contact is untouched

      const masked = unwrap(await detail(other));
      expect(masked.contacts).toHaveLength(contactCount.n - 1);
      expect(JSON.stringify(masked)).not.toContain('v*****@a***e.com'); // not even its masked form

      const history = JSON.stringify(unwrap(await api().get('/api/v1/unlock/history').set(owner.auth)));
      expect(history).not.toContain(RAW.work);
      expect(history).not.toContain(RAW.mobile);

      const exported = await api().post('/api/v1/exports').set(owner.auth).send({ dataset: 'unlocked-leads', format: 'csv' }).buffer(true).parse(binary);
      expect(exported.status).toBe(200);
      const text = (exported.body as Buffer).toString('utf8');
      expect(text).not.toContain(RAW.work);
      expect(text).not.toContain(RAW.mobile);
      expect(text).toContain(RAW.role);

      // any writer is refused, whatever the case or spacing
      const again = await testApp.db.insert(schema.businessContacts).values({ businessId: bizId, fullName: 'Again', email: `  ${RAW.work.toUpperCase()} ` } as any).returning();
      expect(again).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('dependencies not testable yet', () => {
    it.todo('suppressed company contact: excluded from CRM sync (needs a HubSpot test double; detail, unlock list and export are covered in "suppression of a company contact" above)');
    it.todo('reviewer correction of a classification with an audit entry (no correction workflow or stored classification exists)');
  });
});

import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { eq, like } from 'drizzle-orm';
import { TestAppHelper } from './helpers/test-app.helper';
import * as schema from '../src/database/schema';
import { PeoplePublishingService } from '../src/modules/people/people-publishing.service';

/**
 * Phase 32: workflow-to-workflow bypass checks. Each control below already has its own test; these check that the control of one
 * workflow (suppression, logout) is honoured by the OTHER workflows a customer can reach afterwards (export, list, detail, unlock).
 * Synthetic records and accounts only.
 */
const binary = (res: any, cb: (e: Error | null, b?: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('Cross-workflow security regression (Phase 32)', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const unwrap = (res: any) => res.body.data || res.body;
  const tag = `zzp32${Date.now()}`;
  const emails: string[] = [];
  const PERSON_EMAIL = `meera.${tag}@meridian-example.com`;
  let bizId = '';
  let personId = '';
  let seq = 0;

  const newCustomer = async (label: string) => {
    const email = `p32.${label}.${Date.now()}.${++seq}@orion-test.io`;
    emails.push(email);
    const reg = unwrap(await api().post('/api/v1/auth/register').send({ email, password: 'Phase32Pass123!', firstName: 'Cw', lastName: label }));
    (app.get(ThrottlerStorage) as any).storage.clear();
    return { id: reg.user.id as string, auth: { Authorization: `Bearer ${reg.tokens.accessToken}` }, refresh: reg.tokens.refreshToken as string };
  };
  const exportPeople = async (auth: { Authorization: string }) => {
    (app.get(ThrottlerStorage) as any).storage.clear();
    const res = await api().post('/api/v1/exports').set(auth).send({ dataset: 'unlocked-people', format: 'csv' }).buffer(true).parse(binary);
    return { status: res.status, text: Buffer.isBuffer(res.body) ? (res.body as Buffer).toString('utf8') : JSON.stringify(res.body) };
  };
  const balance = async (auth: { Authorization: string }) => {
    const w = unwrap(await api().get('/api/v1/credit/wallet').set(auth));
    return w.balance ?? w.creditsBalance ?? w.availableCredits ?? w.wallet?.balance;
  };

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();
    const biz = await testApp.createTestBusiness({ slug: `${tag}-co`, name: `${tag} Co`, contactEmail: `info.${tag}@meridian-example.com`, contactPhone: '+91 9000000097' });
    bizId = biz.id;
    const db = testApp.db as any;
    const [person] = await db.insert(schema.people).values({ fullName: 'Meera Testperson', normalizedName: `meera testperson ${tag}`, dataStatus: 'PUBLISHED', normalizedLinkedinUrl: `linkedin.com/in/${tag}` }).returning();
    personId = person.id;
    await db.insert(schema.companyPeople).values({ businessId: bizId, personId, jobTitleAtCompany: 'Director', normalizedJobTitle: 'director', isCurrent: true, isPublished: true, reviewStatus: 'APPROVED' });
    await db.insert(schema.personContacts).values({ personId, contactType: 'WORK_EMAIL', contactValue: PERSON_EMAIL, normalizedValue: PERSON_EMAIL, isPublished: true });
  });

  afterAll(async () => {
    const db = testApp.db as any;
    await db.delete(schema.people).where(eq(schema.people.id, personId)).catch(() => undefined); // the suppression register is append-only by design
    const biz = await db.select({ slug: schema.businesses.slug }).from(schema.businesses).where(like(schema.businesses.slug, `${tag}%`));
    await testApp.cleanupBusinesses(biz.map((b: any) => b.slug));
    await testApp.cleanupUsers(emails);
    await testApp.close();
  });

  it('a person suppressed AFTER a customer unlocked them disappears from every later customer path, and nothing is charged', async () => {
    const owner = await newCustomer('owner');
    const stranger = await newCustomer('stranger');
    const db = testApp.db as any;
    await db.insert(schema.personUnlocks).values({ userId: owner.id, personId });

    // premise: before the suppression the owner can read, list and export the person's e-mail
    expect((await api().get(`/api/v1/people/${personId}`).set(owner.auth)).status).toBe(200);
    expect(JSON.stringify(unwrap(await api().get('/api/v1/people/unlocked').set(owner.auth)))).toContain('Meera');
    const before = await exportPeople(owner.auth);
    expect(before.status).toBe(200);
    expect(before.text).toContain(PERSON_EMAIL);

    await app.get(PeoplePublishingService).suppressPerson(personId, 'Phase 32 removal request test');
    const walletBefore = await balance(stranger.auth);
    expect(walletBefore).toEqual(expect.any(Number)); // a missing field would make the final equality vacuous

    // new on-demand export (the stored-file case is covered elsewhere)
    const after = await exportPeople(owner.auth);
    expect(after.text).not.toContain(PERSON_EMAIL);
    expect(after.text).not.toContain('Meera');

    // list, detail, company view and bulk export
    expect(JSON.stringify(unwrap(await api().get('/api/v1/people/unlocked').set(owner.auth)))).not.toContain('Meera');
    expect((await api().get(`/api/v1/people/${personId}`).set(owner.auth)).status).toBe(404);
    expect(JSON.stringify(unwrap(await api().get(`/api/v1/companies/${bizId}/people`).set(owner.auth)))).not.toContain('Meera');
    (app.get(ThrottlerStorage) as any).storage.clear();
    const bulk = await api().post('/api/v1/people/export').set(owner.auth).send({ personIds: [personId] }).buffer(true).parse(binary);
    expect(Buffer.isBuffer(bulk.body) ? (bulk.body as Buffer).toString('utf8') : JSON.stringify(bulk.body)).not.toContain(PERSON_EMAIL);

    // a customer who never unlocked them cannot buy them now, and a refused unlock costs nothing
    const unlock = await api().post(`/api/v1/people/${personId}/unlock`).set(stranger.auth).send({});
    expect(unlock.status).toBe(404);
    expect(JSON.stringify(unlock.body)).not.toContain(PERSON_EMAIL);
    expect(await balance(stranger.auth)).toBe(walletBefore);
  });

  it('after logout the old access token reaches neither export, nor unlock, nor the wallet, and the refresh token is dead', async () => {
    const c = await newCustomer('logout');
    expect((await api().get('/api/v1/credit/wallet').set(c.auth)).status).toBe(200);
    const out = await api().post('/api/v1/auth/logout').set(c.auth).send({ refreshToken: c.refresh });
    expect([200, 201, 204]).toContain(out.status);
    (app.get(ThrottlerStorage) as any).storage.clear();

    for (const [method, path, body] of [
      ['get', '/api/v1/credit/wallet', undefined],
      ['post', '/api/v1/exports', { dataset: 'unlocked-leads', format: 'csv' }],
      ['post', '/api/v1/unlock/business', { businessId: bizId }],
      ['get', '/api/v1/unlock/history', undefined],
    ] as const) {
      const res = await (api() as any)[method](path).set(c.auth).send(body ?? {});
      expect({ path, status: res.status }).toEqual({ path, status: 401 });
    }
    expect((await api().post('/api/v1/auth/refresh').send({ refreshToken: c.refresh })).status).toBe(401);
    // and no unlock row or charge appeared for the dead session
    const rows = await (testApp.db as any).select().from(schema.leadUnlocks).where(eq(schema.leadUnlocks.userId, c.id));
    expect(rows).toHaveLength(0);
  });
});

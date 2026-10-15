import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import { INestApplication } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import * as crypto from 'crypto';
import { TestAppHelper } from './helpers/test-app.helper';
import * as schema from '../src/database/schema';

/**
 * API keys: lifecycle, validation, isolation, audit, and whether a key can actually authenticate a request.
 * Tests wrapped in `it.failing` document a KNOWN GAP (found in the 2026-10-07 security assessment, I-2 and the notes below): they pass
 * while the gap exists and start FAILING when it is fixed, which is the signal to change them to plain `it`.
 */
describe('API keys', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  const aEmail = 'apikey.a@orion.ai';
  const bEmail = 'apikey.b@orion.ai';
  let aToken: string;
  let bToken: string;
  let aId: string;

  const server = () => app.getHttpServer();
  const create = (token: string | undefined, body: any) => {
    const r = request(server()).post('/api/v1/settings/api-keys');
    if (token) r.set('Authorization', `Bearer ${token}`);
    return r.send(body);
  };
  const data = (res: any) => res.body.data ?? res.body;

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();
    await testApp.cleanupUsers([aEmail, bEmail]);
    const a = await request(server()).post('/api/v1/auth/register').send({ email: aEmail, password: 'Password123!', firstName: 'Key', lastName: 'Alice' });
    aToken = a.body.data.tokens.accessToken;
    aId = a.body.data.user.id;
    const b = await request(server()).post('/api/v1/auth/register').send({ email: bEmail, password: 'Password123!', firstName: 'Key', lastName: 'Bob' });
    bToken = b.body.data.tokens.accessToken;
  });

  afterAll(async () => {
    await testApp.cleanupUsers([aEmail, bEmail]);
    await testApp.close();
  });

  describe('creation', () => {
    it('requires authentication', async () => {
      expect((await create(undefined, { name: 'No auth key' })).status).toBe(401);
    });

    it('returns the secret once, in the documented format, and stores only its SHA-256', async () => {
      const res = await create(aToken, { name: 'Format check', scopes: ['read'], expiresInDays: 30 });
      expect(res.status).toBe(201);
      const d = data(res);
      expect(d.key).toMatch(/^orn_live_[A-Za-z0-9]{20,}$/);
      expect(d.keyPrefix).toBe(d.key.slice(0, 16));
      const row = await testApp.db.query.apiKeys.findFirst({ where: eq(schema.apiKeys.id, d.id) });
      expect(row!.keyHash).toBe(crypto.createHash('sha256').update(d.key).digest('hex'));
      expect(JSON.stringify(row)).not.toContain(d.key);
      expect(row!.userId).toBe(aId);
      expect(row!.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 29 * 86400000);
      expect(row!.expiresAt!.getTime()).toBeLessThan(Date.now() + 31 * 86400000);
    });

    it('generates a different secret each time', async () => {
      const [x, y] = [data(await create(aToken, { name: 'Unique one' })), data(await create(aToken, { name: 'Unique two' }))];
      expect(x.key).not.toBe(y.key);
    });

    it('defaults to the read scope and no expiry', async () => {
      const d = data(await create(aToken, { name: 'Defaults' }));
      expect(d.scopes).toEqual(['read']);
      expect(d.expiresAt).toBeNull();
    });

    it.each([
      ['a one-character name', { name: 'x' }],
      ['an empty name', { name: '' }],
      ['a 101-character name', { name: 'n'.repeat(101) }],
      ['no name', {}],
      ['expiresInDays 0', { name: 'Bad expiry', expiresInDays: 0 }],
      ['expiresInDays 366', { name: 'Bad expiry', expiresInDays: 366 }],
      ['expiresInDays as text', { name: 'Bad expiry', expiresInDays: 'soon' }],
      ['scopes that is not a list', { name: 'Bad scopes', scopes: 'read' }],
      ['non-string scopes', { name: 'Bad scopes', scopes: [1, 2] }],
      ['an unknown field (mass assignment)', { name: 'Extra', userId: '00000000-0000-0000-0000-000000000000', isActive: false }],
    ])('rejects %s', async (_label, body) => {
      expect((await create(aToken, body)).status).toBe(400);
    });

    it('cannot be created for another user by passing a userId', async () => {
      const res = await create(aToken, { name: 'Impersonate', userId: aId });
      expect(res.status).toBe(400); // forbidNonWhitelisted
    });
  });

  describe('listing and isolation', () => {
    it("lists only the caller's keys, never the secret or the hash", async () => {
      await create(bToken, { name: 'Bob only key' });
      const list = data(await request(server()).get('/api/v1/settings/api-keys').set('Authorization', `Bearer ${aToken}`));
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThan(0);
      expect(list.some((k: any) => k.name === 'Bob only key')).toBe(false);
      for (const k of list) {
        expect(k.key).toBeUndefined();
        expect(k.keyHash).toBeUndefined();
        expect(k.keyPrefix).toMatch(/^orn_live_/);
      }
    });

    it('requires authentication to list', async () => {
      expect((await request(server()).get('/api/v1/settings/api-keys')).status).toBe(401);
    });
  });

  describe('revocation', () => {
    it('revokes, is idempotent for the owner, and refuses another user and unknown ids', async () => {
      const d = data(await create(aToken, { name: 'To revoke' }));
      expect((await request(server()).delete(`/api/v1/settings/api-keys/${d.id}`).set('Authorization', `Bearer ${bToken}`)).status).toBe(404);
      expect((await request(server()).delete(`/api/v1/settings/api-keys/${d.id}`).set('Authorization', `Bearer ${aToken}`)).status).toBe(200);
      const row = await testApp.db.query.apiKeys.findFirst({ where: eq(schema.apiKeys.id, d.id) });
      expect(row!.isActive).toBe(false);
      const again = await request(server()).delete(`/api/v1/settings/api-keys/${d.id}`).set('Authorization', `Bearer ${aToken}`);
      expect([200, 404]).toContain(again.status);
      expect((await request(server()).delete('/api/v1/settings/api-keys/00000000-0000-0000-0000-000000000000').set('Authorization', `Bearer ${aToken}`)).status).toBe(404);
    });

    it('answers a malformed id with a client error, not a server error', async () => {
      const res = await request(server()).delete('/api/v1/settings/api-keys/not-a-uuid').set('Authorization', `Bearer ${aToken}`);
      expect(res.status).toBeLessThan(500);
    });
  });

  describe('audit trail', () => {
    it('records creation and revocation without the secret', async () => {
      const d = data(await create(aToken, { name: 'Audited key' }));
      await request(server()).delete(`/api/v1/settings/api-keys/${d.id}`).set('Authorization', `Bearer ${aToken}`);
      const logs = await testApp.db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.userId, aId), eq(schema.auditLogs.entityId, d.id)));
      expect(logs.map((l) => l.action).sort()).toEqual(['API_KEY_CREATED', 'API_KEY_REVOKED']);
      expect(JSON.stringify(logs)).not.toContain(d.key);
    });
  });

  describe('using a key to call the API', () => {
    // KNOWN GAP: keys are issued and stored but nothing authenticates a request with them (no guard reads x-api-key or an orn_live_ bearer).
    // When key authentication is implemented these two flip to failing: change them to `it`, and add scope and rate-limit tests.
    it.failing('KNOWN GAP: a valid key in x-api-key authenticates a request', async () => {
      const d = data(await create(aToken, { name: 'Header auth', scopes: ['read'] }));
      const res = await request(server()).get('/api/v1/user/profile').set('x-api-key', d.key);
      expect(res.status).toBe(200);
    });

    it.failing('KNOWN GAP: a valid key as a bearer token authenticates a request', async () => {
      const d = data(await create(aToken, { name: 'Bearer auth', scopes: ['read'] }));
      const res = await request(server()).get('/api/v1/user/profile').set('Authorization', `Bearer ${d.key}`);
      expect(res.status).toBe(200);
    });

    it('a made-up or revoked key never authenticates', async () => {
      expect((await request(server()).get('/api/v1/user/profile').set('x-api-key', 'orn_live_' + 'a'.repeat(32))).status).toBe(401);
      const d = data(await create(aToken, { name: 'Revoked then used' }));
      await request(server()).delete(`/api/v1/settings/api-keys/${d.id}`).set('Authorization', `Bearer ${aToken}`);
      expect((await request(server()).get('/api/v1/user/profile').set('x-api-key', d.key)).status).toBe(401);
      expect((await request(server()).get('/api/v1/user/profile').set('Authorization', `Bearer ${d.key}`)).status).toBe(401);
    });
  });

  describe('hardening gaps found while testing', () => {
    it.failing('KNOWN GAP: unknown scopes are refused (only documented scopes may be granted)', async () => {
      const res = await create(aToken, { name: 'Scope probe', scopes: ['admin', '*', 'anything-goes'] });
      expect(res.status).toBe(400);
    });

    it.failing('KNOWN GAP: the number of active keys per user is limited', async () => {
      const results: number[] = [];
      for (let i = 0; i < 30; i++) results.push((await create(bToken, { name: `Bulk key ${i}` })).status);
      expect(results.some((s) => s === 400 || s === 409 || s === 429)).toBe(true);
    });
  });
});

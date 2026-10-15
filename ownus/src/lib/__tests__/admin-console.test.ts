/* eslint-disable @typescript-eslint/no-explicit-any -- a fake fetch / localStorage / window, and deliberately malformed API rows */
import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { entityOf, normalizeActivityLog, normalizeActivityLogs, verbOf } from '../admin-activity.ts';
import { adminFetch, ADMIN_SESSION_EXPIRED_EVENT, ADMIN_TOKEN_KEY } from '../admin-fetch.ts';

describe('activity log normaliser (API audit rows -> console rows)', () => {
  it('maps the API shape to the shape the view needs, so no field is ever undefined', () => {
    const e = normalizeActivityLog({ id: 'a1', action: 'ADMIN_OTP_GENERATED', actor: 'System / Automated', target: 'x@monarchsoftwares.com', details: '{}', ipAddress: '::1', status: 'Success', timestamp: '2026-09-25 07:45' });
    assert.deepEqual(e, { id: 'a1', user: 'System / Automated', action: 'Created', entityType: 'User', entityId: 'a1', entityName: 'x@monarchsoftwares.com', details: 'ADMIN_OTP_GENERATED', ipAddress: '::1', timestamp: '2026-09-25 07:45' });
  });

  it('survives rows with missing, null or wrongly typed fields (the crash this replaces)', () => {
    for (const row of [{}, null, undefined, { action: null, actor: 5, details: {} }, 'oops', []]) {
      const e = normalizeActivityLog(row as any);
      for (const k of ['id', 'user', 'action', 'entityType', 'entityId', 'entityName', 'details', 'ipAddress', 'timestamp'] as const) assert.equal(typeof e[k], 'string', `${k} for ${JSON.stringify(row)}`);
      assert.ok(e.user.includes('') && e.details.toLowerCase().includes(''), 'the view calls .includes on these');
    }
    assert.deepEqual(normalizeActivityLogs('not a list'), []);
  });

  it('classifies verbs and entities', () => {
    assert.equal(verbOf('USER_DELETED'), 'Deleted');
    assert.equal(verbOf('BUSINESS_UNPUBLISHED'), 'Unpublished');
    assert.equal(verbOf('BUSINESS_PUBLISHED'), 'Published');
    assert.equal(verbOf('IMPORT_COMPLETED'), 'Imported');
    assert.equal(verbOf('SOMETHING_ELSE'), 'Updated');
    assert.equal(entityOf('CREDIT_PURCHASE'), 'Credits');
    assert.equal(entityOf('IMPORT_BATCH_DONE'), 'Batch');
    assert.equal(entityOf('API_KEY_CREATED'), 'Settings');
    assert.equal(entityOf('LOGIN'), 'User');
  });

  it('keeps the raw action and details visible and flags a failed row', () => {
    assert.equal(normalizeActivityLog({ action: 'PAYMENT_CAPTURED', details: 'order 7', status: 'Failed' }).details, 'PAYMENT_CAPTURED: order 7 (failed)');
  });
});

const store = new Map<string, string>();
const events: string[] = [];
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
(globalThis as any).window = { dispatchEvent: (e: any) => { events.push(e.type); return true; } };
(globalThis as any).CustomEvent = class { type: string; constructor(type: string) { this.type = type; } };

describe('adminFetch', () => {
  beforeEach(() => { store.clear(); events.length = 0; });

  it('sends the administrator token', async () => {
    store.set(ADMIN_TOKEN_KEY, 'tok-1');
    let auth: string | null = null;
    (globalThis as any).fetch = async (_u: string, init: any) => { auth = new Headers(init.headers).get('Authorization'); return new Response('{}', { status: 200 }); };
    await adminFetch('/api/v1/admin/users');
    assert.equal(auth, 'Bearer tok-1');
  });

  it('does not overwrite an Authorization header the caller set', async () => {
    store.set(ADMIN_TOKEN_KEY, 'tok-1');
    let auth: string | null = null;
    (globalThis as any).fetch = async (_u: string, init: any) => { auth = new Headers(init.headers).get('Authorization'); return new Response('{}', { status: 200 }); };
    await adminFetch('/x', { headers: { Authorization: 'Bearer other' } });
    assert.equal(auth, 'Bearer other');
  });

  it('a 401 clears the stored session and announces it once', async () => {
    store.set(ADMIN_TOKEN_KEY, 'tok-1');
    store.set('orion_admin_email', 'a@monarchsoftwares.com');
    (globalThis as any).fetch = async () => new Response('{}', { status: 401 });
    const res = await adminFetch('/api/v1/admin/users');
    assert.equal(res.status, 401);
    assert.equal(store.has(ADMIN_TOKEN_KEY), false);
    assert.equal(store.has('orion_admin_email'), false);
    assert.deepEqual(events, [ADMIN_SESSION_EXPIRED_EVENT]);
  });

  it('a 401 for an old token does not log out a newer sign-in', async () => {
    store.set(ADMIN_TOKEN_KEY, 'old');
    (globalThis as any).fetch = async () => { store.set(ADMIN_TOKEN_KEY, 'new'); return new Response('{}', { status: 401 }); };
    await adminFetch('/x');
    assert.equal(store.get(ADMIN_TOKEN_KEY), 'new');
    assert.deepEqual(events, []);
  });

  it('without a token it sends no Authorization header and does not announce expiry', async () => {
    let auth: string | null = 'unset';
    (globalThis as any).fetch = async (_u: string, init: any) => { auth = new Headers(init.headers).get('Authorization'); return new Response('{}', { status: 401 }); };
    await adminFetch('/x');
    assert.equal(auth, null);
    assert.deepEqual(events, []);
  });
});

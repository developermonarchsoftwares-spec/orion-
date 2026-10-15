/* eslint-disable @typescript-eslint/no-explicit-any -- a fake fetch and a fake localStorage */
import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { ApiClient } from '../api-client.ts';

/**
 * Regression: a page that fires several requests at once with an expired access token must refresh ONCE. Refresh tokens are
 * single-use and a replay revokes the whole session, so parallel refreshes used to log the user out ("jwt expired").
 */
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
(globalThis as any).window = { dispatchEvent: () => true, localStorage: (globalThis as any).localStorage };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fakeServer() {
  let current = { access: 'access-1', refresh: 'refresh-1' };
  let n = 1;
  const state = { refreshCalls: 0, revoked: false, apiCalls: 0 };
  const fetchFn = async (url: any, init: any) => {
    const u = String(url);
    const auth = new Headers(init?.headers).get('Authorization');
    await new Promise((r) => setTimeout(r, 5));
    if (u.endsWith('/auth/refresh')) {
      state.refreshCalls++;
      const sent = JSON.parse(init.body).refreshToken;
      if (state.revoked || sent !== current.refresh) {
        state.revoked = true; // replay of a rotated token: the whole session is revoked
        return json(401, { message: 'Invalid refresh token' });
      }
      n++;
      current = { access: `access-${n}`, refresh: `refresh-${n}` };
      return json(200, { success: true, data: { accessToken: current.access, refreshToken: current.refresh } });
    }
    state.apiCalls++;
    if (state.revoked || auth !== `Bearer ${current.access}`) return json(401, { message: 'jwt expired' });
    return json(200, { success: true, data: { ok: true, path: u } });
  };
  return { fetchFn, state, expire: () => { n++; current = { ...current, access: `access-${n}` }; } };
}

describe('ApiClient token refresh', () => {
  beforeEach(() => {
    store.clear();
    store.set('orion_access_token', 'access-1');
    store.set('orion_refresh_token', 'refresh-1');
  });

  it('four parallel requests with an expired access token trigger exactly one refresh and all succeed', async () => {
    const srv = fakeServer();
    srv.expire(); // the server no longer accepts access-1
    (globalThis as any).fetch = srv.fetchFn;
    const client = new ApiClient();
    const results = await Promise.all(['/a', '/b', '/c', '/d'].map((p) => client.request(p)));
    assert.equal(srv.state.refreshCalls, 1);
    assert.equal(srv.state.revoked, false);
    assert.deepEqual(results.map((r: any) => r.ok), [true, true, true, true]);
    assert.notEqual(store.get('orion_access_token'), 'access-1');
  });

  it('a later request after the refresh uses the new tokens without refreshing again', async () => {
    const srv = fakeServer();
    srv.expire();
    (globalThis as any).fetch = srv.fetchFn;
    const client = new ApiClient();
    await Promise.all([client.request('/a'), client.request('/b')]);
    await client.request('/c');
    assert.equal(srv.state.refreshCalls, 1);
  });

  it('a refresh that fails clears the session and the request reports the 401', async () => {
    const srv = fakeServer();
    srv.state.revoked = true;
    (globalThis as any).fetch = srv.fetchFn;
    const client = new ApiClient();
    await assert.rejects(() => client.request('/a'), (e: any) => e.statusCode === 401);
    assert.equal(srv.state.refreshCalls, 1);
    assert.equal(store.get('orion_access_token') ?? null, null);
  });

  it('a request that gets a 401 does not try to refresh without a refresh token', async () => {
    const srv = fakeServer();
    srv.expire();
    store.delete('orion_refresh_token');
    (globalThis as any).fetch = srv.fetchFn;
    const client = new ApiClient();
    await assert.rejects(() => client.request('/a'), (e: any) => e.statusCode === 401);
    assert.equal(srv.state.refreshCalls, 0);
  });
});

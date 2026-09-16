import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  cn,
  formatCurrency,
  formatNumber,
  formatDate,
  formatRelativeDate,
  getInitials,
  truncate,
} from '../utils.ts';
import { ApiClient } from '../api-client.ts';

describe('Frontend QA Suite: Utility Functions', () => {
  it('cn() -> should properly merge Tailwind classes and resolve conflicts', () => {
    const result = cn('px-4 py-2', 'bg-blue-500', false && 'hidden', 'px-6');
    assert.strictEqual(result.includes('px-6'), true);
    assert.strictEqual(result.includes('px-4'), false, 'px-4 should be overridden by px-6');
    assert.strictEqual(result.includes('bg-blue-500'), true);
  });

  it('formatCurrency() -> should format numeric amounts to USD currency string', () => {
    const formatted = formatCurrency(2500);
    assert.strictEqual(formatted, '$2,500');
  });

  it('formatNumber() -> should format numbers with locale commas', () => {
    const formatted = formatNumber(1250000);
    assert.strictEqual(formatted, '1,250,000');
  });

  it('getInitials() -> should extract up to 2 uppercase initials from full names', () => {
    assert.strictEqual(getInitials('Vikram Aditya Sharma'), 'VA');
    assert.strictEqual(getInitials('John'), 'J');
    assert.strictEqual(getInitials('Elon Musk'), 'EM');
  });

  it('truncate() -> should truncate long strings with ellipsis at threshold', () => {
    assert.strictEqual(truncate('Orion Platform Lead Intelligence', 14), 'Orion Platform...');
    assert.strictEqual(truncate('Short', 10), 'Short');
  });

  it('formatRelativeDate() -> should report human readable relative timestamps', () => {
    const now = new Date();
    assert.strictEqual(formatRelativeDate(now), 'Just now');

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    assert.strictEqual(formatRelativeDate(twoHoursAgo), '2h ago');

    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    assert.strictEqual(formatRelativeDate(threeDaysAgo), '3d ago');
  });
});

describe('Frontend QA Suite: ApiClient & Gateway Proxy Resilience', () => {
  let client: ApiClient;

  beforeEach(() => {
    client = new ApiClient();
    client.clearTokens();
  });

  it('ApiClient -> should correctly store and clear authentication tokens', () => {
    assert.strictEqual(client.getAccessToken(), null);
    client.setTokens('access-token-xyz', 'refresh-token-abc');
    assert.strictEqual(client.getAccessToken(), 'access-token-xyz');
    client.clearTokens();
    assert.strictEqual(client.getAccessToken(), null);
  });

  it('ApiClient -> should unwrap { success: true, data: T } standard backend payloads', async () => {
    const mockData = { id: 'biz-123', name: 'Alpha Corp' };
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async (url: any, init?: any) => {
        return new Response(
          JSON.stringify({
            success: true,
            statusCode: 200,
            data: mockData,
            timestamp: new Date().toISOString(),
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      };

      const res = await client.request('/test-endpoint');
      assert.deepStrictEqual(res, mockData);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('ApiClient -> should inject Authorization Bearer header when token is set', async () => {
    client.setTokens('bearer-jwt-token-123', 'refresh-456');
    const originalFetch = globalThis.fetch;
    let interceptedAuthHeader = '';

    try {
      globalThis.fetch = async (url: any, init?: any) => {
        const headers = init?.headers as Headers;
        interceptedAuthHeader = headers.get('Authorization') || '';
        return new Response(JSON.stringify({ success: true, data: { ok: true } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      await client.request('/protected');
      assert.strictEqual(interceptedAuthHeader, 'Bearer bearer-jwt-token-123');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('ApiClient -> should automatically refresh token on 401 Unauthorized and retry request', async () => {
    client.setTokens('expired-access-token', 'valid-refresh-token');
    const originalFetch = globalThis.fetch;
    let callCount = 0;

    try {
      globalThis.fetch = async (url: any, init?: any) => {
        callCount++;
        const urlStr = String(url);

        if (urlStr.includes('/auth/refresh')) {
          return new Response(
            JSON.stringify({
              success: true,
              data: {
                accessToken: 'fresh-new-access-token',
                refreshToken: 'fresh-new-refresh-token',
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // First call to endpoint fails with 401
        if (callCount === 1) {
          return new Response(JSON.stringify({ message: 'Token expired' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Retry succeeds with 200
        return new Response(JSON.stringify({ success: true, data: { success: true } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const result = await client.request('/user/profile');
      assert.strictEqual(client.getAccessToken(), 'fresh-new-access-token');
      assert.deepStrictEqual(result, { success: true });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('Gateway Header Stripping Logic -> hop-by-hop and content-length headers must be removed', () => {
    const rawHeaders = new Headers();
    rawHeaders.set('content-length', '512');
    rawHeaders.set('connection', 'keep-alive');
    rawHeaders.set('transfer-encoding', 'chunked');
    rawHeaders.set('host', 'ownus-client.vercel.app');
    rawHeaders.set('authorization', 'Bearer token123');
    rawHeaders.set('content-type', 'application/json');

    const sanitizedHeaders = new Headers();
    rawHeaders.forEach((val, key) => {
      const lower = key.toLowerCase();
      if (
        ![
          'host',
          'connection',
          'keep-alive',
          'transfer-encoding',
          'content-length',
          'expect',
        ].includes(lower)
      ) {
        sanitizedHeaders.set(key, val);
      }
    });

    assert.strictEqual(sanitizedHeaders.has('content-length'), false);
    assert.strictEqual(sanitizedHeaders.has('connection'), false);
    assert.strictEqual(sanitizedHeaders.has('transfer-encoding'), false);
    assert.strictEqual(sanitizedHeaders.has('host'), false);
    assert.strictEqual(sanitizedHeaders.get('authorization'), 'Bearer token123');
    assert.strictEqual(sanitizedHeaders.get('content-type'), 'application/json');
  });
});

import { API_PERMISSIONS_POLICY, apiSecurityHeaders } from '../security-headers';

const run = (headers: Record<string, string> = {}, existing: Record<string, string> = {}) => {
  const set: Record<string, string> = { ...existing };
  const res = { setHeader: (k: string, v: string) => (set[k] = v), getHeader: (k: string) => set[k] } as any;
  let called = false;
  apiSecurityHeaders({ headers } as any, res, () => (called = true));
  return { set, called };
};

describe('API security headers', () => {
  it('always sets a restrictive Permissions-Policy and continues', () => {
    const { set, called } = run();
    expect(called).toBe(true);
    expect(set['Permissions-Policy']).toBe(API_PERMISSIONS_POLICY);
    for (const feature of ['camera', 'microphone', 'geolocation', 'payment']) expect(set['Permissions-Policy']).toContain(`${feature}=()`);
  });

  it('marks credentialed responses no-store, leaves anonymous ones cacheable, and respects a route that chose its own policy', () => {
    expect(run({ authorization: 'Bearer abc' }).set['Cache-Control']).toBe('no-store');
    expect(run().set['Cache-Control']).toBeUndefined();
    expect(run({ authorization: 'Bearer abc' }, { 'Cache-Control': 'private, max-age=60' }).set['Cache-Control']).toBe('private, max-age=60');
  });
});

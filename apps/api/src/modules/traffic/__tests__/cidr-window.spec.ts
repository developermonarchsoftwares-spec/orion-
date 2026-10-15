import { ipInCidr, normalizeIp, parseCidr, parseIp } from '../cidr.util';
import { WindowCounter } from '../window-counter';

describe('normalizeIp / parseIp', () => {
  it('treats an IPv4 client on a dual-stack socket as plain IPv4', () => {
    expect(normalizeIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(normalizeIp('::FFFF:cb00:7107')).toBe('203.0.113.7');
    expect(normalizeIp(' [2001:DB8::1] ')).toBe('2001:db8::1');
    expect(normalizeIp('fe80::1%eth0')).toBe('fe80::1');
    expect(normalizeIp(undefined)).toBe('');
  });

  it('parses valid addresses and rejects garbage', () => {
    expect(parseIp('1.2.3.4')).toMatchObject({ version: 4, value: 16909060n });
    expect(parseIp('::1')).toMatchObject({ version: 6, value: 1n });
    expect(parseIp('2001:db8::')).toMatchObject({ version: 6 });
    for (const bad of ['', 'abc', '1.2.3', '1.2.3.256', '1.2.3.4.5', '2001:::1', '12345::1', 'g::1', '1:2:3:4:5:6:7:8:9']) expect(parseIp(bad)).toBeNull();
  });
});

describe('parseCidr / ipInCidr', () => {
  it('canonicalises, clears host bits and defaults a bare address to a single host', () => {
    expect(parseCidr('203.0.113.7')?.text).toBe('203.0.113.7/32');
    expect(parseCidr('203.0.113.77/24')?.text).toBe('203.0.113.0/24');
    expect(parseCidr('10.1.2.3/8')?.text).toBe('10.0.0.0/8');
    expect(parseCidr('0.0.0.0/0')?.text).toBe('0.0.0.0/0');
    expect(parseCidr('2001:db8::1')?.text).toBe('2001:db8::1/128');
    expect(parseCidr('2001:db8:abcd::1/32')?.text).toBe('2001:db8::/32');
    expect(parseCidr('::ffff:203.0.113.7')?.text).toBe('203.0.113.7/32'); // a mapped address is the IPv4 host
  });

  it.each(['', '1.2.3.4/33', '1.2.3.4/-1', '1.2.3.4/x', '1.2.3.4/24/1', '::1/129', 'nope', '1.2.3.4/'])('rejects %p', (bad) => expect(parseCidr(bad)).toBeNull());

  it('matches addresses inside a range and nothing outside it, per family', () => {
    const net = parseCidr('203.0.113.0/24')!;
    expect(ipInCidr(parseIp('203.0.113.0'), net)).toBe(true);
    expect(ipInCidr(parseIp('203.0.113.255'), net)).toBe(true);
    expect(ipInCidr(parseIp('203.0.114.0'), net)).toBe(false);
    expect(ipInCidr(parseIp('203.0.112.255'), net)).toBe(false);
    expect(ipInCidr(parseIp('::ffff:203.0.113.9'), net)).toBe(true); // dual-stack client
    expect(ipInCidr(parseIp('2001:db8::1'), net)).toBe(false); // other family never matches
    const v6 = parseCidr('2001:db8::/32')!;
    expect(ipInCidr(parseIp('2001:db8:ffff::1'), v6)).toBe(true);
    expect(ipInCidr(parseIp('2001:db9::1'), v6)).toBe(false);
    expect(ipInCidr(parseIp('203.0.113.1'), v6)).toBe(false);
    expect(ipInCidr(parseIp('8.8.8.8'), parseCidr('0.0.0.0/0')!)).toBe(true);
    expect(ipInCidr(parseIp('8.8.8.9'), parseCidr('8.8.8.8')!)).toBe(false);
    expect(ipInCidr(null, net)).toBe(false);
  });
});

describe('WindowCounter', () => {
  const W = 1000;
  it('allows up to the limit in a window, then refuses with a retry time, and does not count refused requests', () => {
    const c = new WindowCounter(W);
    const t = 10_000;
    const r = [1, 2, 3].map(() => c.hit('k', 3, t));
    expect(r.map((x) => x.allowed)).toEqual([true, true, true]);
    expect(r.map((x) => x.remaining)).toEqual([2, 1, 0]);
    const over = c.hit('k', 3, t + 100);
    expect(over).toMatchObject({ allowed: false, remaining: 0, limit: 3 });
    expect(over.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < 50; i++) c.hit('k', 3, t + 200); // hammering does not push recovery further out
    // the previous window still weighs almost fully right after it rolls over (that is what prevents a double burst) ...
    expect(c.hit('k', 3, t + W + 1).allowed).toBe(false);
    // ... so the advised wait is longer than the time to the next window, and it is accurate: waiting exactly that long works
    expect(c.hit('k', 3, t + 100 + over.retryAfterSeconds * 1000).allowed).toBe(true);
  });

  it('keys are independent', () => {
    const c = new WindowCounter(W);
    expect(c.hit('a', 1, 0).allowed).toBe(true);
    expect(c.hit('a', 1, 1).allowed).toBe(false);
    expect(c.hit('b', 1, 1).allowed).toBe(true);
  });

  it('weights the previous window, so there is no double burst at a boundary', () => {
    const c = new WindowCounter(W);
    for (let i = 0; i < 10; i++) expect(c.hit('k', 10, 900).allowed).toBe(true); // 10 at the end of window [0,1000)
    // 100 ms into the next window 90% of the old window still counts: far fewer than 10 more may pass
    let passed = 0;
    for (let i = 0; i < 10; i++) if (c.hit('k', 10, 1100).allowed) passed++;
    expect(passed).toBeLessThanOrEqual(1);
    const blocked = c.hit('k', 10, 1100);
    expect(blocked.allowed).toBe(false);
    expect(c.hit('k', 10, 1100 + blocked.retryAfterSeconds * 1000).allowed).toBe(true); // Retry-After is honest in this case too
    // a full window later everything has aged out
    expect(c.hit('k', 10, 2100).allowed).toBe(true);
    expect(c.hit('k', 10, 5000).remaining).toBe(9);
  });

  it('peeks without counting, resets a key, and prunes idle keys', () => {
    const c = new WindowCounter(W);
    c.hit('k', 5, 0);
    c.hit('k', 5, 0);
    expect(c.peek('k', 10)).toBe(2);
    expect(c.peek('k', 10)).toBe(2);
    expect(c.peek('missing')).toBe(0);
    c.reset('k');
    expect(c.peek('k', 20)).toBe(0);
    c.hit('old', 5, 0);
    c.hit('fresh', 5, 5000);
    expect(c.prune(5000)).toBe(1);
    expect(c.size).toBe(1);
  });

  it('stays bounded: at the key limit it makes room instead of growing', () => {
    const c = new WindowCounter(W, 100);
    for (let i = 0; i < 1000; i++) c.hit(`k${i}`, 5, 100 + i);
    expect(c.size).toBeLessThanOrEqual(100);
  });
});

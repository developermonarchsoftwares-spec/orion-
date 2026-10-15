import { ipInCidr, parseCidr, parseIp } from '../cidr.util';
import { WindowCounter } from '../window-counter';

/**
 * Performance budgets for the code that runs on EVERY request (traffic middleware). Budgets are deliberately loose (about 20x
 * typical on a laptop) so they catch an accidental O(n^2) or an allocation storm, not normal machine noise.
 */
const time = (fn: () => void) => {
  const t = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t) / 1e6;
};

describe('traffic hot path performance', () => {
  it('matches 100k client IPs against 200 CIDR rules within budget', () => {
    const rules = Array.from({ length: 200 }, (_, i) => parseCidr(`10.${i}.0.0/16`)!);
    const ips = Array.from({ length: 100_000 }, (_, i) => parseIp(`10.${i % 256}.${(i >> 8) % 256}.${i % 250}`));
    let hits = 0;
    const ms = time(() => {
      for (const ip of ips) for (const r of rules) if (ipInCidr(ip, r)) { hits++; break; }
    });
    expect(hits).toBeGreaterThan(0);
    expect(ms).toBeLessThan(4000);
  });

  it('parses 200k addresses (IPv4 and IPv6) within budget', () => {
    const ms = time(() => {
      for (let i = 0; i < 100_000; i++) {
        parseIp(`192.168.${i % 256}.${i % 250}`);
        parseIp(`2001:db8::${(i % 65535).toString(16)}`);
      }
    });
    expect(ms).toBeLessThan(3000);
  });

  it('keeps the sliding-window counter bounded in memory under 200k hits from 50k subjects', () => {
    const counter = new WindowCounter(60_000, 100_000);
    const before = process.memoryUsage().heapUsed;
    const ms = time(() => {
      for (let i = 0; i < 200_000; i++) counter.hit(`user:${i % 50_000}`, 1_000_000);
    });
    const grownMb = (process.memoryUsage().heapUsed - before) / 1024 / 1024;
    expect(ms).toBeLessThan(5000);
    expect(grownMb).toBeLessThan(300);
  });
});

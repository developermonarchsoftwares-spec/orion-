/**
 * Sliding-window request counter held in memory: the count of the current window plus the previous window weighted by how much of it still
 * overlaps (the usual two-bucket approximation, so there is no burst at a window boundary). O(1) per request, bounded memory.
 *
 * Counters are PER PROCESS. With several API instances behind a load balancer the effective limit is the limit times the number of
 * instances; blocks (database-backed) are shared.
 */
export interface IHitResult {
  allowed: boolean;
  limit: number;
  /** Requests still allowed in the window (0 when refused). */
  remaining: number;
  /** Seconds until a refused client may try again (also the window reset when allowed). */
  retryAfterSeconds: number;
}

interface IBucket {
  start: number;
  count: number;
  prev: number;
  lastSeen: number;
}

export class WindowCounter {
  private readonly buckets = new Map<string, IBucket>();
  constructor(
    readonly windowMs: number,
    private readonly maxKeys = 100_000,
  ) {}

  private roll(key: string, now: number): IBucket {
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) this.evict(now);
      b = { start: now - (now % this.windowMs), count: 0, prev: 0, lastSeen: now };
      this.buckets.set(key, b);
      return b;
    }
    const start = now - (now % this.windowMs);
    if (start !== b.start) {
      // one window later the old count becomes "previous"; two or more windows later it is forgotten
      b.prev = start - b.start === this.windowMs ? b.count : 0;
      b.count = 0;
      b.start = start;
    }
    b.lastSeen = now;
    return b;
  }

  private estimate(b: IBucket, now: number): number {
    const overlap = 1 - (now - b.start) / this.windowMs;
    return b.count + b.prev * Math.max(0, overlap);
  }

  /** Counts one request and says whether it is within `limit`. A refused request is NOT counted (so a client that backs off recovers). */
  hit(key: string, limit: number, now = Date.now()): IHitResult {
    const b = this.roll(key, now);
    const est = this.estimate(b, now);
    const resetMs = b.start + this.windowMs - now;
    if (est + 1 > limit) {
      return { allowed: false, limit, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil(this.retryMs(b, limit, now) / 1000)) };
    }
    b.count++;
    return { allowed: true, limit, remaining: Math.max(0, Math.floor(limit - est - 1)), retryAfterSeconds: Math.max(1, Math.ceil(resetMs / 1000)) };
  }

  /**
   * How long until one more request fits. The estimate is `count + prev * overlap`, and the overlap shrinks as the window progresses, so
   * the wait is the time for it to shrink enough. If this window's own count is already at the limit, nothing fits until the window
   * rolls over, and then until that count has decayed as the "previous" window.
   */
  private retryMs(b: IBucket, limit: number, now: number): number {
    const elapsed = now - b.start;
    const resetMs = b.start + this.windowMs - now;
    const room = limit - 1 - b.count; // how much weight the previous window may still carry
    if (b.prev > 0 && room >= 0) {
      const targetOverlap = room / b.prev;
      if (targetOverlap < 1) return Math.min(2 * this.windowMs, Math.max(1000, (1 - targetOverlap) * this.windowMs - elapsed));
    }
    const afterRoll = b.count > 0 ? this.windowMs * Math.max(0, 1 - (limit - 1) / b.count) : 0;
    return Math.min(2 * this.windowMs, Math.max(1000, resetMs + afterRoll));
  }

  /** Read the current estimate without counting a request. */
  peek(key: string, now = Date.now()): number {
    const b = this.buckets.get(key);
    if (!b) return 0;
    return Math.ceil(this.estimate(this.roll(key, now), now));
  }

  reset(key: string) {
    this.buckets.delete(key);
  }

  /** Drops keys not seen for two windows. */
  prune(now = Date.now()): number {
    let n = 0;
    for (const [k, b] of this.buckets) {
      if (now - b.lastSeen > this.windowMs * 2) {
        this.buckets.delete(k);
        n++;
      }
    }
    return n;
  }

  private evict(now: number) {
    if (this.prune(now) > 0) return;
    // everything is recent: drop the least recently seen tenth
    const oldest = [...this.buckets.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen).slice(0, Math.ceil(this.maxKeys / 10));
    for (const [k] of oldest) this.buckets.delete(k);
  }

  get size() {
    return this.buckets.size;
  }
}

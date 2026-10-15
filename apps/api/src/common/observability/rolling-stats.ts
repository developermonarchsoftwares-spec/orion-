/**
 * Request statistics over the last hour in one-minute buckets: how many requests, how many failed, and a latency histogram, overall and per
 * route. Used for the dashboard and for alert rules, where "the last 5 minutes" matters more than "since the process started".
 * Percentiles are estimated from the histogram (accurate to the bucket width), which keeps memory constant.
 */
export const LATENCY_BOUNDS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

interface IBucket {
  minute: number;
  count: number;
  errors5xx: number;
  errors4xx: number;
  sumMs: number;
  hist: number[]; // one slot per bound, plus a last slot for "slower than the last bound"
}

const blank = (minute: number): IBucket => ({ minute, count: 0, errors5xx: 0, errors4xx: 0, sumMs: 0, hist: new Array(LATENCY_BOUNDS_MS.length + 1).fill(0) });

export interface IWindowStats {
  windowMinutes: number;
  requests: number;
  perSecond: number;
  errorRate5xx: number;
  clientErrorRate4xx: number;
  avgMs: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
}

function percentile(hist: number[], total: number, q: number): number | null {
  if (!total) return null;
  const target = total * q;
  let cum = 0;
  for (let i = 0; i < hist.length; i++) {
    const prev = cum;
    cum += hist[i];
    if (cum >= target) {
      const lo = i === 0 ? 0 : LATENCY_BOUNDS_MS[i - 1];
      const hi = i < LATENCY_BOUNDS_MS.length ? LATENCY_BOUNDS_MS[i] : LATENCY_BOUNDS_MS[LATENCY_BOUNDS_MS.length - 1] * 2;
      const within = hist[i] ? (target - prev) / hist[i] : 1;
      return Math.round(lo + (hi - lo) * Math.min(1, Math.max(0, within)));
    }
  }
  return LATENCY_BOUNDS_MS[LATENCY_BOUNDS_MS.length - 1];
}

function add(into: IBucket, from: IBucket) {
  into.count += from.count;
  into.errors5xx += from.errors5xx;
  into.errors4xx += from.errors4xx;
  into.sumMs += from.sumMs;
  from.hist.forEach((n, i) => (into.hist[i] += n));
}

function summarise(b: IBucket, minutes: number): IWindowStats {
  return {
    windowMinutes: minutes,
    requests: b.count,
    perSecond: Math.round((b.count / (minutes * 60)) * 100) / 100,
    errorRate5xx: b.count ? Math.round((b.errors5xx / b.count) * 10000) / 10000 : 0,
    clientErrorRate4xx: b.count ? Math.round((b.errors4xx / b.count) * 10000) / 10000 : 0,
    avgMs: b.count ? Math.round(b.sumMs / b.count) : 0,
    p50Ms: percentile(b.hist, b.count, 0.5),
    p95Ms: percentile(b.hist, b.count, 0.95),
    p99Ms: percentile(b.hist, b.count, 0.99),
  };
}

const MAX_ROUTES = 300;

export class RollingStats {
  private readonly total = new Map<number, IBucket>();
  private readonly routes = new Map<string, Map<number, IBucket>>();

  constructor(private readonly retentionMinutes = 60) {}

  record(route: string, status: number, durationMs: number, now = Date.now()) {
    const minute = Math.floor(now / 60_000);
    this.hit(this.total, minute, status, durationMs);
    let per = this.routes.get(route);
    if (!per) {
      if (this.routes.size >= MAX_ROUTES) return;
      per = new Map();
      this.routes.set(route, per);
    }
    this.hit(per, minute, status, durationMs);
    this.trim(minute);
  }

  private hit(map: Map<number, IBucket>, minute: number, status: number, ms: number) {
    let b = map.get(minute);
    if (!b) {
      b = blank(minute);
      map.set(minute, b);
    }
    b.count++;
    b.sumMs += ms;
    if (status >= 500) b.errors5xx++;
    else if (status >= 400) b.errors4xx++;
    let i = LATENCY_BOUNDS_MS.findIndex((bound) => ms <= bound);
    if (i === -1) i = LATENCY_BOUNDS_MS.length;
    b.hist[i]++;
  }

  private trim(nowMinute: number) {
    const cutoff = nowMinute - this.retentionMinutes;
    for (const m of [...this.total.keys()]) if (m <= cutoff) this.total.delete(m);
    for (const [route, per] of this.routes) {
      for (const m of [...per.keys()]) if (m <= cutoff) per.delete(m);
      if (!per.size) this.routes.delete(route);
    }
  }

  private merge(map: Map<number, IBucket>, minutes: number, now: number): IBucket {
    const nowMinute = Math.floor(now / 60_000);
    const out = blank(nowMinute);
    for (const [m, b] of map) if (m > nowMinute - minutes && m <= nowMinute) add(out, b);
    return out;
  }

  window(minutes: number, now = Date.now()): IWindowStats {
    return summarise(this.merge(this.total, minutes, now), minutes);
  }

  /** The busiest / slowest / most failing routes in a window. */
  topRoutes(minutes: number, by: 'count' | 'p95' | 'errors', n = 10, now = Date.now()) {
    const rows = [...this.routes.entries()].map(([route, per]) => ({ route, ...summarise(this.merge(per, minutes, now), minutes), errors5xx: this.merge(per, minutes, now).errors5xx }));
    const live = rows.filter((r) => r.requests > 0);
    live.sort((a, b) => (by === 'count' ? b.requests - a.requests : by === 'errors' ? b.errors5xx - a.errors5xx : (b.p95Ms ?? 0) - (a.p95Ms ?? 0)));
    return live.slice(0, n).map((r) => ({ route: r.route, requests: r.requests, errors5xx: r.errors5xx, errorRate5xx: r.errorRate5xx, avgMs: r.avgMs, p50Ms: r.p50Ms, p95Ms: r.p95Ms, p99Ms: r.p99Ms }));
  }

  reset() {
    this.total.clear();
    this.routes.clear();
  }
}

export const requestStats = new RollingStats();

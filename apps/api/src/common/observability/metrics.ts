/**
 * A small, dependency-free metrics registry that renders the Prometheus text exposition format (and a JSON snapshot). Counters, gauges
 * and histograms with labels; a bounded number of series per metric so a label fed by user input can never grow memory without limit.
 */
export type Labels = Record<string, string | number | undefined>;

const MAX_SERIES_PER_METRIC = 500;
export const DEFAULT_BUCKETS_SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
const key = (labels: Labels | undefined): string =>
  labels
    ? Object.keys(labels)
        .filter((k) => labels[k] !== undefined)
        .sort()
        .map((k) => `${k}="${esc(String(labels[k]))}"`)
        .join(',')
    : '';
const fmt = (n: number) => (Number.isFinite(n) ? String(n) : n > 0 ? '+Inf' : n < 0 ? '-Inf' : 'NaN');

abstract class Metric {
  protected dropped = 0;
  constructor(
    readonly name: string,
    readonly help: string,
    readonly type: 'counter' | 'gauge' | 'histogram',
  ) {}
  abstract lines(): string[];
  get droppedSeries() {
    return this.dropped;
  }
  protected head(): string[] {
    return [`# HELP ${this.name} ${this.help.replace(/\n/g, ' ')}`, `# TYPE ${this.name} ${this.type}`];
  }
}

export class Counter extends Metric {
  private readonly values = new Map<string, number>();
  constructor(name: string, help: string) {
    super(name, help, 'counter');
  }
  inc(labels?: Labels, n = 1) {
    const k = key(labels);
    if (!this.values.has(k) && this.values.size >= MAX_SERIES_PER_METRIC) {
      this.dropped++;
      return;
    }
    this.values.set(k, (this.values.get(k) ?? 0) + n);
  }
  get(labels?: Labels): number {
    return this.values.get(key(labels)) ?? 0;
  }
  total(): number {
    let t = 0;
    for (const v of this.values.values()) t += v;
    return t;
  }
  lines() {
    const out = this.head();
    if (!this.values.size) out.push(`${this.name} 0`);
    for (const [k, v] of this.values) out.push(`${this.name}${k ? `{${k}}` : ''} ${fmt(v)}`);
    return out;
  }
}

export class Gauge extends Metric {
  private readonly values = new Map<string, number>();
  constructor(name: string, help: string) {
    super(name, help, 'gauge');
  }
  set(labels: Labels | undefined, v: number) {
    const k = key(labels);
    if (!this.values.has(k) && this.values.size >= MAX_SERIES_PER_METRIC) {
      this.dropped++;
      return;
    }
    this.values.set(k, v);
  }
  inc(labels?: Labels, n = 1) {
    this.set(labels, (this.values.get(key(labels)) ?? 0) + n);
  }
  dec(labels?: Labels, n = 1) {
    this.inc(labels, -n);
  }
  get(labels?: Labels): number | undefined {
    return this.values.get(key(labels));
  }
  clear() {
    this.values.clear();
  }
  lines() {
    const out = this.head();
    for (const [k, v] of this.values) out.push(`${this.name}${k ? `{${k}}` : ''} ${fmt(v)}`);
    return out;
  }
}

export class Histogram extends Metric {
  private readonly series = new Map<string, { buckets: number[]; sum: number; count: number }>();
  constructor(
    name: string,
    help: string,
    readonly bounds: number[] = DEFAULT_BUCKETS_SECONDS,
  ) {
    super(name, help, 'histogram');
  }
  observe(labels: Labels | undefined, value: number) {
    const k = key(labels);
    let s = this.series.get(k);
    if (!s) {
      if (this.series.size >= MAX_SERIES_PER_METRIC) {
        this.dropped++;
        return;
      }
      s = { buckets: new Array(this.bounds.length).fill(0), sum: 0, count: 0 };
      this.series.set(k, s);
    }
    s.count++;
    s.sum += value;
    for (let i = 0; i < this.bounds.length; i++) {
      if (value <= this.bounds[i]) {
        s.buckets[i]++;
        break;
      }
    }
  }
  count(labels?: Labels) {
    return this.series.get(key(labels))?.count ?? 0;
  }
  lines() {
    const out = this.head();
    for (const [k, s] of this.series) {
      let cum = 0;
      const base = k ? `${k},` : '';
      this.bounds.forEach((b, i) => {
        cum += s.buckets[i];
        out.push(`${this.name}_bucket{${base}le="${b}"} ${cum}`);
      });
      out.push(`${this.name}_bucket{${base}le="+Inf"} ${s.count}`);
      out.push(`${this.name}_sum${k ? `{${k}}` : ''} ${fmt(s.sum)}`);
      out.push(`${this.name}_count${k ? `{${k}}` : ''} ${s.count}`);
    }
    return out;
  }
}

export class MetricsRegistry {
  private readonly metrics = new Map<string, Metric>();
  private readonly collectors: Array<() => void> = [];

  private add<T extends Metric>(m: T): T {
    const existing = this.metrics.get(m.name);
    if (existing) return existing as T; // registering twice returns the same metric (module reloads, tests)
    this.metrics.set(m.name, m);
    return m;
  }
  counter(name: string, help: string) {
    return this.add(new Counter(name, help));
  }
  gauge(name: string, help: string) {
    return this.add(new Gauge(name, help));
  }
  histogram(name: string, help: string, bounds?: number[]) {
    return this.add(new Histogram(name, help, bounds));
  }
  /** A function run just before every render, to refresh gauges from live state (process memory, pool size, ...). */
  onCollect(fn: () => void) {
    this.collectors.push(fn);
  }
  render(): string {
    for (const c of this.collectors) {
      try {
        c();
      } catch {
        /* a failing collector must not break the scrape */
      }
    }
    const lines: string[] = [];
    for (const m of this.metrics.values()) lines.push(...m.lines());
    const dropped = [...this.metrics.values()].reduce((a, m) => a + m.droppedSeries, 0);
    lines.push('# HELP orion_metrics_dropped_series_total Series not recorded because a metric hit its series limit', '# TYPE orion_metrics_dropped_series_total counter', `orion_metrics_dropped_series_total ${dropped}`);
    return `${lines.join('\n')}\n`;
  }
}

/** The process-wide registry. */
export const metrics = new MetricsRegistry();

// The HTTP, error and tracing metrics every other module records into.
export const httpRequests = metrics.counter('http_requests_total', 'HTTP requests by method, route and status class');
export const httpDuration = metrics.histogram('http_request_duration_seconds', 'HTTP request duration by method and route');
export const httpInFlight = metrics.gauge('http_requests_in_flight', 'HTTP requests being handled now');
export const errorsCaptured = metrics.counter('errors_captured_total', 'Errors captured by the error tracker, by source');
export const dbQueryDuration = metrics.histogram('db_query_duration_seconds', 'Database query duration by operation');
export const dbSlowQueries = metrics.counter('db_slow_queries_total', 'Database queries slower than the slow-query threshold');
export const dbQueryErrors = metrics.counter('db_query_errors_total', 'Database queries that failed');
export const outboundDuration = metrics.histogram('outbound_request_duration_seconds', 'Outbound HTTP request duration by target host');
export const outboundErrors = metrics.counter('outbound_request_errors_total', 'Outbound HTTP requests that failed, by target host');

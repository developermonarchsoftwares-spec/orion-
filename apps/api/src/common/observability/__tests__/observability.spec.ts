import { EventEmitter } from 'events';
import { ErrorTracker, parseDsn, parseStack } from '../error-tracker';
import { instrumentPool, operationOf } from '../db-instrumentation';
import { MetricsRegistry, dbQueryDuration, dbSlowQueries, dbQueryErrors } from '../metrics';
import { RollingStats } from '../rolling-stats';
import { scrubHeaders, scrubText, scrubUrl } from '../scrub';
import { StructuredLogger } from '../structured-logger';
import { Tracer, formatTraceparent, parseTraceparent } from '../tracing';

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const PARENT = '00f067aa0ba902b7';

describe('scrub', () => {
  it('removes e-mail addresses, tokens, secrets, connection strings and long numbers from text', () => {
    const out = scrubText('user a.b@example.com failed with Bearer abcdef1234567890 and token=xyz12345 on postgres://u:pw@db.host/app card 4111111111111111 jwt eyJhbGciOi.eyJzdWIiOiIx.abcdefghij key whsec_abcdefghij');
    expect(out).not.toMatch(/a\.b@example\.com|abcdef1234567890|xyz12345|u:pw|4111111111111111|eyJhbGciOi|whsec_abcdefghij/);
    expect(out).toContain('[email]');
    expect(out).toContain('[connection-string]');
  });
  it('keeps ordinary text, and bounds the length', () => {
    expect(scrubText('Job 42 failed after 3 attempts')).toBe('Job 42 failed after 3 attempts');
    expect(scrubText('x'.repeat(5000), 100)).toHaveLength(101);
    expect(scrubText(new Error('boom a@b.io'))).toBe('boom [email]');
    expect(scrubText({ a: 1 })).toBe('{"a":1}');
  });
  it('drops sensitive headers and scrubs the rest', () => {
    const h = scrubHeaders({ Authorization: 'Bearer x', Cookie: 'a=b', 'X-Refresh-Token': 't', 'x-api-key': 'k', 'x-captcha-token': 'c', 'user-agent': 'curl/8', 'x-forwarded-for': ['1.2.3.4', '5.6.7.8'], referer: 'https://x.io/?email=a@b.io' });
    expect(Object.keys(h).sort()).toEqual(['referer', 'user-agent', 'x-forwarded-for']);
    expect(h['x-forwarded-for']).toBe('1.2.3.4, 5.6.7.8');
    expect(h.referer).not.toContain('a@b.io');
  });
  it('reduces a URL to its path (ids generalised) and the names of harmless query parameters', () => {
    expect(scrubUrl('/api/v1/exports/5f1c2d3e-1111-2222-3333-444455556666/download?token=abc&page=2&email=a@b.io')).toEqual({ path: '/api/v1/exports/:id/download', queryKeys: ['page'] });
    expect(scrubUrl('/x')).toEqual({ path: '/x', queryKeys: [] });
  });
});

describe('MetricsRegistry', () => {
  it('counts, sets and observes, and renders valid Prometheus text', () => {
    const r = new MetricsRegistry();
    const c = r.counter('jobs_total', 'Jobs');
    c.inc({ queue: 'a' });
    c.inc({ queue: 'a' }, 2);
    c.inc({ queue: 'b' });
    const g = r.gauge('depth', 'Depth');
    g.set({ q: 'a' }, 7);
    g.inc({ q: 'a' });
    g.dec({ q: 'a' }, 3);
    const h = r.histogram('latency_seconds', 'Latency', [0.1, 1]);
    h.observe({ r: '/x' }, 0.05);
    h.observe({ r: '/x' }, 0.5);
    h.observe({ r: '/x' }, 5);
    const text = r.render();
    expect(text).toContain('# TYPE jobs_total counter');
    expect(text).toContain('jobs_total{queue="a"} 3');
    expect(text).toContain('jobs_total{queue="b"} 1');
    expect(text).toContain('depth{q="a"} 5');
    expect(text).toContain('latency_seconds_bucket{r="/x",le="0.1"} 1');
    expect(text).toContain('latency_seconds_bucket{r="/x",le="1"} 2');
    expect(text).toContain('latency_seconds_bucket{r="/x",le="+Inf"} 3');
    expect(text).toContain('latency_seconds_count{r="/x"} 3');
    expect(text).toMatch(/latency_seconds_sum\{r="\/x"\} 5\.55/);
    expect(c.get({ queue: 'a' })).toBe(3);
    expect(c.total()).toBe(4);
    expect(h.count({ r: '/x' })).toBe(3);
    for (const line of text.trim().split('\n')) expect(line).toMatch(/^(#|[a-zA-Z_:][a-zA-Z0-9_:]*(\{.*\})? -?[0-9.+eInf]+$)/);
  });

  it('escapes label values, runs collectors before rendering, and survives a failing collector', () => {
    const r = new MetricsRegistry();
    const g = r.gauge('info', 'Info');
    r.onCollect(() => g.set({ v: 'a"b\\c\nd' }, 1));
    r.onCollect(() => {
      throw new Error('collector broke');
    });
    expect(r.render()).toContain('info{v="a\\"b\\\\c\\nd"} 1');
  });

  it('registering the same metric twice returns the same one, and a metric stops adding series at its limit', () => {
    const r = new MetricsRegistry();
    expect(r.counter('x_total', 'x')).toBe(r.counter('x_total', 'x'));
    const c = r.counter('many_total', 'many');
    for (let i = 0; i < 600; i++) c.inc({ id: String(i) });
    const lines = r.render().split('\n').filter((l) => l.startsWith('many_total{'));
    expect(lines).toHaveLength(500);
    expect(r.render()).toContain('orion_metrics_dropped_series_total 100');
    c.inc({ id: '3' }); // an existing series still counts
    expect(c.get({ id: '3' })).toBe(2);
  });
});

describe('RollingStats', () => {
  const T = 1_700_000_000_000;
  it('summarises a window: rate, error rate and percentiles estimated from the histogram', () => {
    const s = new RollingStats();
    for (let i = 0; i < 95; i++) s.record('GET /a', 200, 20, T);
    for (let i = 0; i < 5; i++) s.record('GET /a', 500, 3000, T);
    const w = s.window(5, T);
    expect(w.requests).toBe(100);
    expect(w.errorRate5xx).toBe(0.05);
    expect(w.perSecond).toBeCloseTo(100 / 300, 2);
    expect(w.p50Ms).toBeLessThanOrEqual(25);
    expect(w.p95Ms).toBeLessThanOrEqual(25);
    expect(w.p99Ms).toBeGreaterThan(2500);
    expect(w.avgMs).toBe(Math.round((95 * 20 + 5 * 3000) / 100));
  });
  it('only counts what falls inside the window, and forgets old minutes', () => {
    const s = new RollingStats(60);
    s.record('GET /a', 200, 10, T);
    s.record('GET /a', 200, 10, T + 10 * 60_000);
    expect(s.window(5, T + 10 * 60_000).requests).toBe(1);
    expect(s.window(15, T + 10 * 60_000).requests).toBe(2);
    s.record('GET /a', 200, 10, T + 2 * 3_600_000);
    expect(s.window(60, T + 2 * 3_600_000).requests).toBe(1);
  });
  it('ranks routes by traffic, errors and latency, and has no percentiles when empty', () => {
    const s = new RollingStats();
    for (let i = 0; i < 10; i++) s.record('GET /busy', 200, 5, T);
    for (let i = 0; i < 3; i++) s.record('GET /slow', 200, 4000, T);
    for (let i = 0; i < 4; i++) s.record('POST /broken', 500, 10, T);
    expect(s.topRoutes(5, 'count', 3, T)[0].route).toBe('GET /busy');
    expect(s.topRoutes(5, 'p95', 3, T)[0].route).toBe('GET /slow');
    expect(s.topRoutes(5, 'errors', 3, T)[0]).toMatchObject({ route: 'POST /broken', errors5xx: 4, errorRate5xx: 1 });
    expect(new RollingStats().window(5, T)).toMatchObject({ requests: 0, p95Ms: null, errorRate5xx: 0 });
  });
});

describe('tracing', () => {
  it('parses and formats W3C traceparent, and ignores anything invalid', () => {
    expect(parseTraceparent(`00-${TRACE}-${PARENT}-01`)).toEqual({ traceId: TRACE, parentId: PARENT, sampled: true });
    expect(parseTraceparent(`00-${TRACE}-${PARENT}-00`)?.sampled).toBe(false);
    expect(parseTraceparent(`00-${TRACE.toUpperCase()}-${PARENT}-01`)?.traceId).toBe(TRACE);
    for (const bad of [undefined, '', 'garbage', `01-${TRACE}-${PARENT}-01`, `00-${'0'.repeat(32)}-${PARENT}-01`, `00-${TRACE}-${'0'.repeat(16)}-01`, `00-${TRACE.slice(1)}-${PARENT}-01`, `00-${TRACE}-${PARENT}`]) expect(parseTraceparent(bad as any)).toBeNull();
    expect(formatTraceparent(TRACE, PARENT, true)).toBe(`00-${TRACE}-${PARENT}-01`);
    expect(formatTraceparent(TRACE, PARENT, false)).toBe(`00-${TRACE}-${PARENT}-00`);
  });

  it('continues an incoming trace (and its sampling decision) or starts a new one', () => {
    const t = new Tracer();
    const cont = t.startRequest({ traceparent: `00-${TRACE}-${PARENT}-01`, tracestate: 'vendor=x' }, 'GET /a');
    expect(cont.ctx).toMatchObject({ traceId: TRACE, sampled: true, tracestate: 'vendor=x' });
    expect(cont.span).toMatchObject({ traceId: TRACE, parentSpanId: PARENT, kind: 'SERVER' });
    expect(cont.span.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(t.startRequest({ traceparent: `00-${TRACE}-${PARENT}-00` }, 'GET /a').ctx.sampled).toBe(false); // the caller said do not sample
    const fresh = t.startRequest({}, 'GET /a');
    expect(fresh.ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(fresh.span.parentSpanId).toBeUndefined();
    expect(t.startRequest({ traceparent: 'nonsense' }, 'GET /a').ctx.traceId).not.toBe(TRACE);
  });

  it('nests spans: children point at their parent, durations and errors are recorded, and a failure is rethrown', async () => {
    const t = new Tracer();
    const { ctx, span } = t.startRequest({ traceparent: `00-${TRACE}-${PARENT}-01` }, 'GET /a');
    await t.run(ctx, async () => {
      await t.withSpan('outer', { a: 1 }, async () => {
        await t.withSpan('inner', {}, async () => new Promise((r) => setTimeout(r, 15)));
        await expect(
          t.withSpan('failing', {}, async () => {
            throw new Error('nope');
          }),
        ).rejects.toThrow('nope');
      });
    });
    t.endSpan(span);
    const spans = t.getTrace(TRACE);
    const by = Object.fromEntries(spans.map((s) => [s.name, s]));
    expect(Object.keys(by).sort()).toEqual(['GET /a', 'failing', 'inner', 'outer']);
    expect(by.outer.parentSpanId).toBe(span.spanId);
    expect(by.inner.parentSpanId).toBe(by.outer.spanId);
    expect(by.failing.parentSpanId).toBe(by.outer.spanId);
    expect(by.inner.durationMs).toBeGreaterThanOrEqual(10);
    expect(by.failing).toMatchObject({ status: 'ERROR', error: 'nope' });
    expect(by.outer.status).toBe('OK');
    expect(by.outer.attributes).toEqual({ a: 1 });
    expect(t.slowRequests(5)[0]).toMatchObject({ traceId: TRACE, name: 'GET /a', spans: 4 });
  });

  it('does nothing outside a trace, and ending a span twice records it once', async () => {
    const t = new Tracer();
    expect(await t.withSpan('x', {}, () => 42)).toBe(42);
    expect(t.startSpan('x')).toBeNull();
    expect(t.outboundHeaders()).toEqual({});
    t.endSpan(null);
    const { ctx, span } = t.startRequest({}, 'GET /b');
    t.run(ctx, () => undefined);
    t.endSpan(span);
    t.endSpan(span);
    expect(t.counters.spans).toBe(1);
  });

  it('gives outbound calls the current span as parent', async () => {
    const t = new Tracer();
    const { ctx } = t.startRequest({ traceparent: `00-${TRACE}-${PARENT}-01`, tracestate: 'a=b' }, 'GET /a');
    await t.run(ctx, async () =>
      t.withSpan('call', {}, async (s) => {
        expect(t.outboundHeaders()).toEqual({ traceparent: `00-${TRACE}-${s!.spanId}-01`, tracestate: 'a=b' });
      }),
    );
  });

  it('keeps a bounded number of recent spans', () => {
    const t = new Tracer();
    for (let i = 0; i < 3500; i++) {
      const { span } = t.startRequest({}, `GET /${i}`);
      t.endSpan(span);
    }
    expect(t.summary().bufferedSpans).toBe(3000);
  });

  describe('OTLP export', () => {
    const env = { ...process.env };
    afterEach(() => {
      process.env = { ...env };
    });

    it('sends sampled spans to the collector as OTLP JSON, with resource attributes and parent links, and drops unsampled ones', async () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector.local:4318/';
      process.env.OTEL_EXPORTER_OTLP_HEADERS = 'Authorization=Bearer abc, x-team=orion';
      process.env.OTEL_SERVICE_NAME = 'orion-test';
      process.env.TRACE_SAMPLE_RATE = '1';
      const t = new Tracer();
      const calls: Array<{ url: string; init: any }> = [];
      t.fetchImpl = (async (url: any, init: any) => {
        calls.push({ url: String(url), init });
        return { ok: true } as any;
      }) as any;
      const { ctx, span } = t.startRequest({ traceparent: `00-${TRACE}-${PARENT}-01` }, 'GET /a');
      await t.run(ctx, async () => t.withSpan('db.select', { 'db.system': 'postgresql', rows: 3, slow: false, ratio: 0.5 }, async () => undefined, 'CLIENT'));
      t.endSpan(span, undefined, { 'http.status_code': 200 });
      const unsampled = t.startRequest({ traceparent: `00-${'a'.repeat(32)}-${PARENT}-00` }, 'GET /skip');
      t.endSpan(unsampled.span);

      await t.flush();
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('http://collector.local:4318/v1/traces');
      expect(calls[0].init.headers).toMatchObject({ authorization: 'Bearer abc', 'x-team': 'orion', 'content-type': 'application/json' });
      const body = JSON.parse(calls[0].init.body);
      const res = body.resourceSpans[0].resource.attributes;
      expect(res).toContainEqual({ key: 'service.name', value: { stringValue: 'orion-test' } });
      const spans = body.resourceSpans[0].scopeSpans[0].spans;
      expect(spans).toHaveLength(2);
      const server = spans.find((s: any) => s.name === 'GET /a');
      const db = spans.find((s: any) => s.name === 'db.select');
      expect(server).toMatchObject({ traceId: TRACE, parentSpanId: PARENT, kind: 2, status: { code: 1 } });
      expect(db).toMatchObject({ traceId: TRACE, parentSpanId: server.spanId, kind: 3 });
      expect(db.attributes).toEqual(expect.arrayContaining([{ key: 'db.system', value: { stringValue: 'postgresql' } }, { key: 'rows', value: { intValue: '3' } }, { key: 'slow', value: { boolValue: false } }, { key: 'ratio', value: { doubleValue: 0.5 } }]));
      expect(BigInt(server.endTimeUnixNano)).toBeGreaterThanOrEqual(BigInt(server.startTimeUnixNano));
      expect(server.startTimeUnixNano).toMatch(/^\d{19}$/);
      expect(t.counters.exported).toBe(2);
    });

    it('counts a failed export and does not retry forever, and exports nothing when no endpoint is set', async () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector.local:4318';
      process.env.TRACE_SAMPLE_RATE = '1';
      const t = new Tracer();
      let n = 0;
      t.fetchImpl = (async () => {
        n++;
        throw new Error('down');
      }) as any;
      const { span } = t.startRequest({}, 'GET /a');
      t.endSpan(span);
      await t.flush();
      expect(t.counters.exportFailures).toBe(1);
      await t.flush();
      expect(n).toBe(1); // the failed batch was dropped, not retried

      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      const t2 = new Tracer();
      let called = false;
      t2.fetchImpl = (async () => {
        called = true;
        return { ok: true } as any;
      }) as any;
      const s2 = t2.startRequest({}, 'GET /a');
      t2.endSpan(s2.span);
      await t2.flush();
      expect(called).toBe(false);
      expect(t2.summary().exporter).toBe('none');
    });
  });
});

describe('error tracker', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });
  const DSN = 'https://publickey123@o4504.ingest.sentry.io/4505001';

  it('parses DSNs (public key, secret, path prefix) and rejects bad ones', () => {
    expect(parseDsn(DSN)).toMatchObject({ endpoint: 'https://o4504.ingest.sentry.io/api/4505001/envelope/', key: 'publickey123', host: 'o4504.ingest.sentry.io' });
    expect(parseDsn('https://k:s3cret@sentry.example.com:9000/prefix/sub/7')).toMatchObject({ endpoint: 'https://sentry.example.com:9000/prefix/sub/api/7/envelope/', key: 'k', secret: 's3cret' });
    for (const bad of ['', 'nope', 'https://host/123', 'https://key@host/abc', 'https://key@host/']) expect(parseDsn(bad)).toBeNull();
  });

  it('parses a V8 stack into Sentry frames, oldest call first, with in-app detection and app-relative paths', () => {
    const cwd = process.cwd().replace(/\\/g, '/');
    const stack = `Error: x\n    at doThing (${cwd}/src/a/b.ts:10:5)\n    at async Object.<anonymous> (${cwd}/node_modules/lib/index.js:3:1)\n    at ${cwd}/src/main.ts:7:9\n    at node:internal/process/task_queues:95:5`;
    const frames = parseStack(stack, process.cwd());
    expect(frames.map((f) => f.filename)).toEqual(['node:internal/process/task_queues', 'src/main.ts', 'node_modules/lib/index.js', 'src/a/b.ts']);
    expect(frames.map((f) => f.in_app)).toEqual([false, true, false, true]);
    expect(frames.at(-1)).toMatchObject({ function: 'doThing', lineno: 10, colno: 5 });
  });

  it('sends an envelope to the DSN host with the right headers and a scrubbed, correlated event', async () => {
    process.env.SENTRY_DSN = DSN;
    process.env.SENTRY_ENVIRONMENT = 'staging';
    process.env.SENTRY_RELEASE = 'orion@1.2.3';
    const et = new ErrorTracker();
    const calls: Array<{ url: string; init: any }> = [];
    et.fetchImpl = (async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      return { ok: true, status: 200 } as any;
    }) as any;
    const t = new Tracer();
    const { ctx } = t.startRequest({ traceparent: `00-${TRACE}-${PARENT}-01` }, 'GET /a');
    ctx.requestId = 'req-1';
    const err = new Error('failed for jane.doe@example.com with token=abc12345');
    const id = t.run(ctx, () => et.capture(err, { source: 'http', request: { method: 'POST', url: '/api/v1/exports/5f1c2d3e-1111-2222-3333-444455556666/download?token=zzz', headers: { authorization: 'Bearer secret1234', cookie: 'a=b', 'user-agent': 'jest' } }, userId: 'user-uuid-1', tags: { queue: 'imports' }, extra: { count: 3, note: 'mail a@b.io' } }));
    await et.flush();

    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://o4504.ingest.sentry.io/api/4505001/envelope/');
    expect(calls[0].init.headers['content-type']).toBe('application/x-sentry-envelope');
    expect(calls[0].init.headers['x-sentry-auth']).toMatch(/^Sentry sentry_version=7, sentry_client=orion-observability\/[\d.]+, sentry_key=publickey123$/);
    const [head, item, payload] = calls[0].init.body.trim().split('\n').map((l: string) => JSON.parse(l));
    expect(head.event_id).toBe(id);
    expect(item).toEqual({ type: 'event' });
    expect(payload).toMatchObject({ event_id: id, platform: 'node', level: 'error', environment: 'staging', release: 'orion@1.2.3', logger: 'http' });
    expect(payload.exception.values[0]).toMatchObject({ type: 'Error' });
    expect(payload.exception.values[0].value).toBe('failed for [email] with token=[redacted]');
    expect(payload.exception.values[0].stacktrace.frames.length).toBeGreaterThan(0);
    expect(payload.request).toEqual({ method: 'POST', url: '/api/v1/exports/:id/download', headers: { 'user-agent': 'jest' } });
    expect(payload.user).toEqual({ id: 'user-uuid-1' });
    expect(payload.tags).toMatchObject({ source: 'http', request_id: 'req-1', queue: 'imports' });
    expect(payload.contexts.trace).toMatchObject({ trace_id: TRACE });
    expect(payload.extra).toEqual({ count: 3, note: 'mail [email]' });
    expect(calls[0].init.body).not.toMatch(/jane\.doe|secret1234|abc12345|zzz/);
    expect(et.summary()).toMatchObject({ enabled: true, captured: 1, sent: 1, host: 'o4504.ingest.sentry.io' });
    expect(et.recent()[0]).toMatchObject({ eventId: id, type: 'Error', source: 'http', route: '/api/v1/exports/:id/download', traceId: TRACE, requestId: 'req-1', userId: 'user-uuid-1', sent: true });
  });

  it('with no DSN it only keeps an in-memory list, and never calls out', () => {
    delete process.env.SENTRY_DSN;
    const et = new ErrorTracker();
    let called = false;
    et.fetchImpl = (async () => {
      called = true;
      return { ok: true } as any;
    }) as any;
    et.capture(new Error('quiet'));
    expect(called).toBe(false);
    expect(et.summary()).toMatchObject({ enabled: false, provider: 'none', captured: 1, sent: 0 });
    expect(et.recent()[0]).toMatchObject({ message: 'quiet', sent: false });
  });

  it('groups repeats, caps sends per fingerprint and per minute, honours Sentry\'s back-off, and samples', async () => {
    process.env.SENTRY_DSN = DSN;
    const et = new ErrorTracker();
    let sent = 0;
    let status = 200;
    et.fetchImpl = (async () => {
      sent++;
      return { ok: status === 200, status, headers: { get: () => '120' } } as any;
    }) as any;
    for (let i = 0; i < 12; i++) et.capture(new Error(`order ${i} failed`)); // same fingerprint: numbers are generalised
    await et.flush();
    expect(sent).toBe(5);
    expect(et.counters.droppedRateLimited).toBe(7);
    expect(et.recent()).toHaveLength(1);
    expect(et.recent()[0].occurrences).toBe(12);

    process.env.SENTRY_MAX_EVENTS_PER_MINUTE = '7';
    sent = 0;
    for (let i = 0; i < 10; i++) {
      const e = new Error('distinct ' + 'x'.repeat(i) + 'y');
      e.name = `Kind${i}`;
      et.capture(e);
    }
    await et.flush();
    expect(sent).toBe(2); // 5 already used this minute, the cap is 7

    const et2 = new ErrorTracker();
    et2.fetchImpl = (async () => {
      sent++;
      return { ok: false, status: 429, headers: { get: () => '120' } } as any;
    }) as any;
    sent = 0;
    et2.capture(new Error('first'));
    await et2.flush();
    et2.capture(new TypeError('second'));
    await et2.flush();
    expect(sent).toBe(1); // paused after the 429
    expect(et2.counters.failed).toBe(1);

    process.env.SENTRY_SAMPLE_RATE = '0';
    const et3 = new ErrorTracker();
    et3.fetchImpl = (async () => {
      sent++;
      return { ok: true } as any;
    }) as any;
    sent = 0;
    et3.capture(new Error('sampled out'));
    expect(sent).toBe(0);
    expect(et3.counters.droppedSampled).toBe(1);
  });

  it('never throws, even for odd values or a failing network, and counts a failed send', async () => {
    process.env.SENTRY_DSN = DSN;
    const et = new ErrorTracker();
    et.fetchImpl = (async () => {
      throw new Error('network down');
    }) as any;
    for (const v of ['a string', 42, null, undefined, { circular: undefined as any }, Symbol('s')]) expect(() => et.capture(v as any)).not.toThrow();
    await et.flush();
    expect(et.counters.failed).toBeGreaterThan(0);
    await expect(et.flush(50)).resolves.toBeUndefined();
  });
});

describe('StructuredLogger', () => {
  const make = (extra: object = {}) => {
    const lines: Array<{ line: string; level: string }> = [];
    const logger = new StructuredLogger({ format: 'json', level: 'debug', service: 'svc', sink: (line, level) => lines.push({ line, level }), ...extra });
    const last = () => JSON.parse(lines.at(-1)!.line);
    return { logger, lines, last };
  };

  it('writes one JSON object per call with the fixed fields, and takes the context from the last parameter', () => {
    const { logger, last, lines } = make();
    logger.log('Started', 'BootstrapContext');
    expect(last()).toMatchObject({ level: 'info', service: 'svc', context: 'BootstrapContext', message: 'Started' });
    expect(new Date(last().timestamp).toISOString()).toBe(last().timestamp);
    logger.warn('Careful', 'Ctx');
    logger.error('Broke', 'at x\n    at y (file.ts:1:1)', 'Ctx');
    logger.debug('detail');
    logger.verbose('more');
    logger.fatal('dead', 'Ctx');
    expect(lines.map((l) => JSON.parse(l.line).level)).toEqual(['info', 'warn', 'error', 'debug', 'debug', 'fatal']);
    expect(lines.map((l) => l.level)).toEqual(['info', 'warn', 'error', 'debug', 'debug', 'fatal']);
  });

  it('attaches the stack of an error, merges object messages as fields, and cannot be made to overwrite its own fields', () => {
    const { logger, last } = make();
    logger.error(new Error('kaboom'), 'Ctx');
    expect(last().message).toBe('kaboom');
    expect(last().stack).toContain('Error: kaboom');
    logger.log({ event: 'http_request', status: 200, durationMs: 12, level: 'hacked', timestamp: 'fake', stack: 'fake' }, 'HTTP');
    expect(last()).toMatchObject({ event: 'http_request', status: 200, durationMs: 12, level: 'info', context: 'HTTP' });
    expect(last().timestamp).not.toBe('fake');
    expect(last().stack).toBeUndefined();
  });

  it('removes personal data and secrets from messages, fields and stacks', () => {
    const { logger, last } = make();
    logger.log('Reset sent to jane@example.com using Bearer abcdefghijkl and password=hunter22', 'Ctx');
    logger.log({ event: 'x', email: 'bob@example.com', note: 'token=abc12345' });
    expect(JSON.stringify(last())).not.toMatch(/bob@example|abc12345/);
    logger.error('failed', 'Error: boom for a@b.io\n    at f (x.ts:1:1)', 'Ctx');
    expect(last().stack).not.toContain('a@b.io');
  });

  it('adds request, trace and user ids inside a request, and nothing outside one', () => {
    const { logger, last } = make();
    const t = new Tracer();
    logger.log('outside');
    expect(last().traceId).toBeUndefined();
    const { ctx } = t.startRequest({ traceparent: `00-${TRACE}-${PARENT}-01` }, 'GET /a');
    ctx.requestId = 'req-9';
    ctx.userId = 'user-3';
    // the logger reads the process-wide tracer context, so run it through the real singleton
    const { tracer } = require('../tracing');
    tracer.run(ctx, () => logger.log('inside'));
    expect(last()).toMatchObject({ requestId: 'req-9', traceId: TRACE, spanId: ctx.spanId, userId: 'user-3' });
  });

  it('filters by level, and the pretty format is a readable single line', () => {
    const { logger, lines } = make({ level: 'warn' });
    logger.log('hidden');
    logger.debug('hidden');
    logger.warn('shown');
    expect(lines).toHaveLength(1);
    const p = make({ format: 'pretty' });
    p.logger.log({ event: 'http_request', method: 'GET', route: '/x', status: 200, durationMs: 7 }, 'HTTP');
    expect(p.lines[0].line).toMatch(/INFO\s+\[HTTP\] GET \/x 200 7ms$/);
  });
});

describe('database instrumentation', () => {
  const fakePool = () => {
    const p: any = new EventEmitter();
    p.totalCount = 3;
    p.idleCount = 2;
    p.waitingCount = 1;
    p.options = { max: 10 };
    p.query = (...args: any[]) => {
      const cb = args[args.length - 1];
      const text = typeof args[0] === 'string' ? args[0] : args[0].text;
      if (typeof cb === 'function') return cb(null, { rows: [] });
      if (/FAIL/.test(text)) return Promise.reject(new Error('relation does not exist'));
      return new Promise((r) => setTimeout(() => r({ rows: [{ x: 1 }] }), /SLEEP/.test(text) ? 30 : 0));
    };
    return p;
  };

  it('names the operation without ever keeping the SQL', () => {
    expect(operationOf('  select * from users where email = $1')).toBe('SELECT');
    expect(operationOf('/* tag */ INSERT INTO x VALUES (1)')).toBe('INSERT');
    expect(operationOf('WITH a AS (select 1) select * from a')).toBe('WITH');
    expect(operationOf('vacuum full')).toBe('OTHER');
    expect(operationOf(undefined)).toBe('OTHER');
  });

  it('times queries, counts slow and failed ones, adds child spans to the current trace, and passes results and errors through unchanged', async () => {
    process.env.DB_SLOW_QUERY_MS = '20';
    const pool = instrumentPool(fakePool());
    const { tracer } = require('../tracing');
    const before = dbQueryDuration.count({ operation: 'SELECT' });
    const { ctx, span } = tracer.startRequest({}, 'GET /q');
    await tracer.run(ctx, async () => {
      expect(await pool.query('SELECT 1')).toEqual({ rows: [{ x: 1 }] });
      await pool.query({ text: 'SELECT SLEEP', values: ['secret@example.com'] });
      await expect(pool.query('SELECT FAIL')).rejects.toThrow('relation does not exist');
    });
    tracer.endSpan(span);
    expect(dbQueryDuration.count({ operation: 'SELECT' })).toBe(before + 3);
    expect(dbSlowQueries.get({ operation: 'SELECT' })).toBe(1);
    expect(dbQueryErrors.get({ operation: 'SELECT' })).toBe(1);
    const dbSpans = tracer.getTrace(ctx.traceId).filter((s: any) => s.name === 'db.select');
    expect(dbSpans).toHaveLength(3);
    expect(dbSpans.every((s: any) => s.parentSpanId === span.spanId && s.kind === 'CLIENT')).toBe(true);
    expect(dbSpans.some((s: any) => s.status === 'ERROR')).toBe(true);
    expect(JSON.stringify(dbSpans)).not.toMatch(/SELECT 1|secret@example|SLEEP/); // no SQL text, no parameters
    delete process.env.DB_SLOW_QUERY_MS;
  });

  it('leaves callback-style calls alone, instruments each connection once, and exposes pool gauges', () => {
    const pool = fakePool();
    instrumentPool(pool);
    const wrappedOnce = pool.query;
    instrumentPool(pool);
    expect(pool.query).toBe(wrappedOnce);
    let got: any;
    pool.query('SELECT 1', (_e: unknown, r: unknown) => (got = r));
    expect(got).toEqual({ rows: [] });
    const client: any = { query: (_t: string) => Promise.resolve('ok') };
    pool.emit('connect', client);
    const wrappedClient = client.query;
    pool.emit('connect', client);
    expect(client.query).toBe(wrappedClient);
    const { metrics } = require('../metrics');
    const text = metrics.render();
    expect(text).toContain('db_pool_connections{state="waiting"} 1');
    expect(text).toContain('db_pool_max_connections 10');
  });
});

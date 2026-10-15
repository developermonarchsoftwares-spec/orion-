import { AsyncLocalStorage } from 'async_hooks';
import { randomBytes } from 'crypto';
import { performance } from 'perf_hooks';

/**
 * Distributed tracing without an SDK: W3C Trace Context in and out, spans carried through async work with AsyncLocalStorage, a bounded
 * in-memory store of recent spans (for the admin dashboard and for looking a trace up by id), and export of sampled spans over
 * OTLP/HTTP (JSON) to any OpenTelemetry-compatible collector or backend.
 *
 * What is traced: every HTTP request (a server span), every database query and outbound HTTP call made while serving a request (child
 * spans, named by operation or host only, never by SQL text or URL query), and anything wrapped with `withSpan`. The trace id is
 * also written into every log line and every error report, which is what links the three together.
 */
export interface ITraceContext {
  traceId: string;
  /** The span currently open: the parent of any span started now. */
  spanId: string;
  sampled: boolean;
  tracestate?: string;
  requestId?: string;
  userId?: string;
}

export type SpanKind = 'SERVER' | 'CLIENT' | 'INTERNAL';
export type SpanAttributes = Record<string, string | number | boolean>;

export interface ISpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: SpanKind;
  /** Wall-clock start, epoch milliseconds (fractional). */
  startMs: number;
  durationMs?: number;
  status: 'UNSET' | 'OK' | 'ERROR';
  attributes: SpanAttributes;
  error?: string;
  sampled: boolean;
  /** monotonic start, internal */
  _p: number;
}

const als = new AsyncLocalStorage<ITraceContext>();
const hex = (bytes: number) => randomBytes(bytes).toString('hex');
const ZERO32 = '0'.repeat(32);
const ZERO16 = '0'.repeat(16);

export const currentContext = (): ITraceContext | undefined => als.getStore();

/** `00-<32 hex trace id>-<16 hex parent id>-<2 hex flags>`; anything else (or an all-zero id) is ignored, never trusted. */
export function parseTraceparent(header: string | string[] | undefined): { traceId: string; parentId: string; sampled: boolean } | null {
  const v = Array.isArray(header) ? header[0] : header;
  const m = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(String(v ?? '').trim().toLowerCase());
  if (!m || m[1] === ZERO32 || m[2] === ZERO16) return null;
  return { traceId: m[1], parentId: m[2], sampled: (parseInt(m[3], 16) & 1) === 1 };
}

export const formatTraceparent = (traceId: string, spanId: string, sampled: boolean) => `00-${traceId}-${spanId}-${sampled ? '01' : '00'}`;

const attr = (k: string, v: string | number | boolean) =>
  typeof v === 'number' ? (Number.isInteger(v) ? { key: k, value: { intValue: String(v) } } : { key: k, value: { doubleValue: v } }) : typeof v === 'boolean' ? { key: k, value: { boolValue: v } } : { key: k, value: { stringValue: v } };

export interface ITracerConfig {
  sampleRate: number;
  endpoint: string | null;
  headers: Record<string, string>;
  serviceName: string;
  serviceVersion: string;
  environment: string;
}

export function tracerConfig(env: NodeJS.ProcessEnv = process.env): ITracerConfig {
  const rateRaw = parseFloat(env.TRACE_SAMPLE_RATE ?? '');
  const base = (env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '').trim().replace(/\/+$/, '');
  const explicit = (env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? '').trim();
  const headers: Record<string, string> = {};
  for (const pair of String(env.OTEL_EXPORTER_OTLP_HEADERS ?? '').split(',')) {
    const i = pair.indexOf('=');
    if (i > 0) headers[pair.slice(0, i).trim().toLowerCase()] = pair.slice(i + 1).trim();
  }
  return {
    sampleRate: Number.isFinite(rateRaw) ? Math.min(1, Math.max(0, rateRaw)) : env.NODE_ENV === 'production' ? 0.1 : 1,
    endpoint: explicit || (base ? `${base}/v1/traces` : null),
    headers,
    serviceName: env.OTEL_SERVICE_NAME || 'orion-api',
    serviceVersion: env.APP_VERSION || env.GIT_SHA || 'unknown',
    environment: env.NODE_ENV || 'development',
  };
}

const MAX_RECENT = 3000;
const MAX_EXPORT_QUEUE = 5000;
const BATCH = 200;

export class Tracer {
  private recent: ISpan[] = [];
  private exportQueue: ISpan[] = [];
  private flushing?: Promise<void>;
  readonly counters = { spans: 0, exported: 0, exportFailures: 0, droppedExport: 0 };
  /** Replaceable in tests. */
  fetchImpl: typeof fetch = (...a) => fetch(...a);

  // ---------------------------------------------------------------------------------------------------------------
  // Context
  // ---------------------------------------------------------------------------------------------------------------

  private shouldSample(parent?: boolean): boolean {
    return parent !== undefined ? parent : Math.random() < tracerConfig().sampleRate;
  }

  /**
   * Opens the server span of an incoming request. Continues the caller's trace when a valid `traceparent` came in (and honours its
   * sampling flag); otherwise starts a new trace. Returns the context to run the request in, and the span to end when it finishes.
   */
  startRequest(headers: Record<string, unknown>, name: string): { ctx: ITraceContext; span: ISpan } {
    const parent = parseTraceparent(headers['traceparent'] as string | undefined);
    const traceId = parent?.traceId ?? hex(16);
    const sampled = this.shouldSample(parent?.sampled);
    const span = this.open(traceId, parent?.parentId, name, 'SERVER', sampled, {});
    const tracestate = typeof headers['tracestate'] === 'string' ? (headers['tracestate'] as string).slice(0, 512) : undefined;
    return { ctx: { traceId, spanId: span.spanId, sampled, tracestate }, span };
  }

  run<T>(ctx: ITraceContext, fn: () => T): T {
    return als.run(ctx, fn);
  }

  private open(traceId: string, parentSpanId: string | undefined, name: string, kind: SpanKind, sampled: boolean, attributes: SpanAttributes): ISpan {
    return { traceId, spanId: hex(8), parentSpanId, name: name.slice(0, 120), kind, startMs: performance.timeOrigin + performance.now(), status: 'UNSET', attributes, sampled, _p: performance.now() };
  }

  /** A child of the span that is open now, or null when there is no trace in progress. */
  startSpan(name: string, kind: SpanKind = 'INTERNAL', attributes: SpanAttributes = {}): ISpan | null {
    const ctx = als.getStore();
    if (!ctx) return null;
    return this.open(ctx.traceId, ctx.spanId, name, kind, ctx.sampled, attributes);
  }

  endSpan(span: ISpan | null, error?: unknown, extra?: SpanAttributes) {
    if (!span || span.durationMs !== undefined) return;
    span.durationMs = Math.round((performance.now() - span._p) * 1000) / 1000;
    if (extra) Object.assign(span.attributes, extra);
    if (error) {
      span.status = 'ERROR';
      span.error = String((error as Error)?.message ?? error).slice(0, 200);
    } else if (span.status === 'UNSET') span.status = 'OK';
    this.record(span);
  }

  /** Runs `fn` inside a child span (a context where that span is the parent of anything started within). With no trace in progress it just runs. */
  async withSpan<T>(name: string, attributes: SpanAttributes, fn: (span: ISpan | null) => Promise<T> | T, kind: SpanKind = 'INTERNAL'): Promise<T> {
    const ctx = als.getStore();
    const span = this.startSpan(name, kind, attributes);
    if (!span || !ctx) return fn(null);
    try {
      const out = await als.run({ ...ctx, spanId: span.spanId }, () => fn(span));
      this.endSpan(span);
      return out;
    } catch (err) {
      this.endSpan(span, err);
      throw err;
    }
  }

  /** `traceparent` (and `tracestate`) for a call to a service of ours, so the trace continues across the hop. */
  outboundHeaders(): Record<string, string> {
    const ctx = als.getStore();
    if (!ctx) return {};
    return { traceparent: formatTraceparent(ctx.traceId, ctx.spanId, ctx.sampled), ...(ctx.tracestate ? { tracestate: ctx.tracestate } : {}) };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Storage and export
  // ---------------------------------------------------------------------------------------------------------------

  private record(span: ISpan) {
    this.counters.spans++;
    this.recent.push(span);
    if (this.recent.length > MAX_RECENT) this.recent.splice(0, this.recent.length - MAX_RECENT);
    if (span.sampled && tracerConfig().endpoint) {
      this.exportQueue.push(span);
      if (this.exportQueue.length > MAX_EXPORT_QUEUE) {
        this.counters.droppedExport += this.exportQueue.length - MAX_EXPORT_QUEUE;
        this.exportQueue.splice(0, this.exportQueue.length - MAX_EXPORT_QUEUE);
      }
    }
  }

  getTrace(traceId: string): ISpan[] {
    return this.recent.filter((s) => s.traceId === traceId).sort((a, b) => a.startMs - b.startMs);
  }

  /** Slowest recent requests (server spans), with how many spans each trace holds. */
  slowRequests(limit = 20, minMs = 0) {
    const counts = new Map<string, number>();
    for (const s of this.recent) counts.set(s.traceId, (counts.get(s.traceId) ?? 0) + 1);
    return this.recent
      .filter((s) => s.kind === 'SERVER' && (s.durationMs ?? 0) >= minMs)
      .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
      .slice(0, Math.min(Math.max(limit, 1), 100))
      .map((s) => ({ traceId: s.traceId, name: s.name, durationMs: Math.round(s.durationMs ?? 0), status: s.status, spans: counts.get(s.traceId) ?? 1, startedAt: new Date(s.startMs).toISOString(), statusCode: s.attributes['http.status_code'] ?? null }));
  }

  summary() {
    const cfg = tracerConfig();
    return { sampleRate: cfg.sampleRate, exporter: cfg.endpoint ? 'otlp-http' : 'none', endpointHost: cfg.endpoint ? new URL(cfg.endpoint).host : null, serviceName: cfg.serviceName, bufferedSpans: this.recent.length, queuedForExport: this.exportQueue.length, ...this.counters };
  }

  private toOtlp(spans: ISpan[]) {
    const cfg = tracerConfig();
    return {
      resourceSpans: [
        {
          resource: { attributes: [attr('service.name', cfg.serviceName), attr('service.version', cfg.serviceVersion), attr('deployment.environment', cfg.environment)] },
          scopeSpans: [
            {
              scope: { name: 'orion-api' },
              spans: spans.map((s) => ({
                traceId: s.traceId,
                spanId: s.spanId,
                ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}),
                name: s.name,
                kind: s.kind === 'SERVER' ? 2 : s.kind === 'CLIENT' ? 3 : 1,
                startTimeUnixNano: String(BigInt(Math.round(s.startMs * 1000)) * 1000n),
                endTimeUnixNano: String(BigInt(Math.round((s.startMs + (s.durationMs ?? 0)) * 1000)) * 1000n),
                attributes: Object.entries(s.attributes).map(([k, v]) => attr(k, v)),
                status: { code: s.status === 'ERROR' ? 2 : s.status === 'OK' ? 1 : 0, ...(s.error ? { message: s.error } : {}) },
              })),
            },
          ],
        },
      ],
    };
  }

  /** Sends queued sampled spans to the collector. Never throws; a failed batch is counted and dropped (tracing must not hold memory or retry forever). */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    const cfg = tracerConfig();
    if (!cfg.endpoint || !this.exportQueue.length) return Promise.resolve();
    this.flushing = (async () => {
      try {
        while (this.exportQueue.length) {
          const batch = this.exportQueue.splice(0, BATCH);
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 5000);
          try {
            const res = await this.fetchImpl(cfg.endpoint as string, { method: 'POST', headers: { 'content-type': 'application/json', ...cfg.headers }, body: JSON.stringify(this.toOtlp(batch)), signal: ctrl.signal, redirect: 'error' });
            if (res.ok) this.counters.exported += batch.length;
            else this.counters.exportFailures++;
          } catch {
            this.counters.exportFailures++;
          } finally {
            clearTimeout(timer);
          }
        }
      } finally {
        this.flushing = undefined;
      }
    })();
    return this.flushing;
  }

  reset() {
    this.recent = [];
    this.exportQueue = [];
    this.counters.spans = this.counters.exported = this.counters.exportFailures = this.counters.droppedExport = 0;
  }
}

export const tracer = new Tracer();
export const withSpan = tracer.withSpan.bind(tracer);

import { createHash, randomBytes } from 'crypto';
import * as os from 'os';
import { errorsCaptured } from './metrics';
import { scrubHeaders, scrubText, scrubUrl } from './scrub';
import { currentContext } from './tracing';

/**
 * Error tracking for Sentry (or a Sentry-compatible server such as GlitchTip), speaking Sentry's documented envelope API directly, so no
 * SDK is needed. Active when SENTRY_DSN is set; with no DSN, errors are still kept in a small in-memory list for the admin dashboard.
 *
 * What a report carries: the error type, a scrubbed message, the stack (paths relative to the app), the request method and path (query
 * values and sensitive headers removed, never the body), the user's id (never e-mail or name), the trace and request ids, release and
 * environment. What it does not: SDK extras such as breadcrumbs, release health, source maps, profiling or session replay. If you need
 * those, install `@sentry/node` and send from there; this reporter stays useful as the dependency-free default.
 *
 * Not run against a live Sentry project here: the envelope format follows Sentry's published developer documentation and is tested
 * against a local receiver. Send a test event (POST /monitoring/test-error) after configuring the DSN.
 */
export interface ICaptureContext {
  request?: { method?: string; url?: string; headers?: Record<string, unknown> };
  userId?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  level?: 'fatal' | 'error' | 'warning';
  /** where it was caught: http, queue, process, manual ... */
  source?: string;
}

export interface IRecentError {
  eventId: string;
  at: string;
  type: string;
  message: string;
  fingerprint: string;
  level: string;
  source: string;
  route: string | null;
  traceId: string | null;
  requestId: string | null;
  userId: string | null;
  sent: boolean;
  /** how many times this fingerprint was seen while this entry was the latest */
  occurrences: number;
}

interface IParsedDsn {
  endpoint: string;
  key: string;
  secret?: string;
  host: string;
}

export function parseDsn(dsn: string): IParsedDsn | null {
  try {
    const u = new URL(dsn.trim());
    const parts = u.pathname.split('/').filter(Boolean);
    const project = parts.pop();
    if (!u.username || !project || !/^\d+$/.test(project)) return null;
    const prefix = parts.length ? `/${parts.join('/')}` : '';
    return { endpoint: `${u.protocol}//${u.host}${prefix}/api/${project}/envelope/`, key: decodeURIComponent(u.username), secret: u.password ? decodeURIComponent(u.password) : undefined, host: u.host };
  } catch {
    return null;
  }
}

interface IFrame {
  filename: string;
  function?: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
}

export function parseStack(stack: string | undefined, cwd = process.cwd()): IFrame[] {
  const root = cwd.replace(/\\/g, '/').replace(/\/+$/, '') + '/';
  const frames: IFrame[] = [];
  for (const line of String(stack ?? '').split('\n')) {
    const m = /^\s*at (?:async )?(?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (!m) continue;
    let file = m[2].replace(/^file:\/\/\/?/, '').replace(/\\/g, '/');
    if (file.startsWith(root)) file = file.slice(root.length);
    else file = file.replace(/^[A-Za-z]:\//, '').replace(/^\/(?:home|Users)\/[^/]+\//, '');
    frames.push({ filename: file, function: m[1], lineno: Number(m[3]), colno: Number(m[4]), in_app: !file.includes('node_modules') && !file.startsWith('node:') && !m[2].startsWith('node:') });
  }
  return frames.slice(0, 50).reverse(); // Sentry wants the oldest call first
}

const MAX_RECENT = 100;
const PER_FINGERPRINT_PER_MINUTE = 5;

export class ErrorTracker {
  private readonly recentErrors: IRecentError[] = [];
  private readonly seen = new Map<string, { minute: number; sent: number }>();
  private readonly pending = new Set<Promise<void>>();
  private minute = 0;
  private sentThisMinute = 0;
  private pausedUntil = 0;
  readonly counters = { captured: 0, sent: 0, failed: 0, droppedRateLimited: 0, droppedSampled: 0 };
  /** Replaceable in tests. */
  fetchImpl: typeof fetch = (...a) => fetch(...a);

  config() {
    const dsn = parseDsn(process.env.SENTRY_DSN ?? '');
    const rate = parseFloat(process.env.SENTRY_SAMPLE_RATE ?? '');
    const max = parseInt(process.env.SENTRY_MAX_EVENTS_PER_MINUTE ?? '', 10);
    return {
      dsn,
      enabled: !!dsn,
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
      release: process.env.SENTRY_RELEASE || process.env.APP_VERSION || process.env.GIT_SHA || undefined,
      sampleRate: Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : 1,
      maxPerMinute: Number.isFinite(max) && max > 0 ? max : 60,
    };
  }

  enabled() {
    return this.config().enabled;
  }

  /** Records an error and, when a DSN is configured, reports it. Never throws. Returns the event id. */
  capture(error: unknown, ctx: ICaptureContext = {}): string {
    const eventId = randomBytes(16).toString('hex');
    try {
      const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : scrubText(error));
      const frames = parseStack(err.stack);
      const type = err.name || 'Error';
      const message = scrubText(err.message, 1000);
      const topFrame = [...frames].reverse().find((f) => f.in_app) ?? frames[frames.length - 1];
      const fingerprint = createHash('sha1')
        .update(`${type}|${message.replace(/\b[0-9a-f]{8}-[0-9a-f-]{27}\b/gi, ':id').replace(/\d+/g, '#')}|${topFrame?.filename ?? ''}:${topFrame?.function ?? ''}`)
        .digest('hex')
        .slice(0, 16);
      const trace = currentContext();
      const route = ctx.request?.url ? scrubUrl(ctx.request.url).path : null;
      const source = ctx.source ?? 'manual';

      this.counters.captured++;
      errorsCaptured.inc({ source });
      const entry: IRecentError = { eventId, at: new Date().toISOString(), type, message, fingerprint, level: ctx.level ?? 'error', source, route, traceId: trace?.traceId ?? null, requestId: trace?.requestId ?? null, userId: ctx.userId ?? trace?.userId ?? null, sent: false, occurrences: 1 };
      const prior = this.recentErrors.findIndex((e) => e.fingerprint === fingerprint);
      if (prior !== -1) entry.occurrences = this.recentErrors.splice(prior, 1)[0].occurrences + 1;
      this.recentErrors.unshift(entry);
      if (this.recentErrors.length > MAX_RECENT) this.recentErrors.pop();

      const cfg = this.config();
      if (!cfg.dsn) return eventId;
      if (cfg.sampleRate < 1 && Math.random() >= cfg.sampleRate) {
        this.counters.droppedSampled++;
        return eventId;
      }
      const nowMin = Math.floor(Date.now() / 60_000);
      if (nowMin !== this.minute) {
        this.minute = nowMin;
        this.sentThisMinute = 0;
        for (const [k, v] of this.seen) if (v.minute !== nowMin) this.seen.delete(k);
      }
      const fp = this.seen.get(fingerprint) ?? { minute: nowMin, sent: 0 };
      if (Date.now() < this.pausedUntil || this.sentThisMinute >= cfg.maxPerMinute || fp.sent >= PER_FINGERPRINT_PER_MINUTE) {
        this.counters.droppedRateLimited++;
        return eventId;
      }
      fp.sent++;
      this.seen.set(fingerprint, fp);
      this.sentThisMinute++;
      entry.sent = true;

      const event = {
        event_id: eventId,
        timestamp: Date.now() / 1000,
        platform: 'node',
        level: ctx.level ?? 'error',
        logger: source,
        server_name: os.hostname(),
        release: cfg.release,
        environment: cfg.environment,
        sdk: { name: 'orion.observability', version: '1.0.0' },
        exception: { values: [{ type, value: message, stacktrace: { frames } }] },
        ...(ctx.request ? { request: { method: ctx.request.method, url: route ?? undefined, headers: scrubHeaders(ctx.request.headers) } } : {}),
        ...(ctx.userId || trace?.userId ? { user: { id: ctx.userId ?? trace?.userId } } : {}),
        tags: { source, ...(trace?.requestId ? { request_id: trace.requestId } : {}), ...(ctx.tags ?? {}) },
        contexts: { runtime: { name: 'node', version: process.version }, ...(trace ? { trace: { trace_id: trace.traceId, span_id: trace.spanId } } : {}) },
        extra: Object.fromEntries(Object.entries(ctx.extra ?? {}).slice(0, 20).map(([k, v]) => [k, typeof v === 'number' || typeof v === 'boolean' ? v : scrubText(v, 300)])),
      };
      this.send(cfg.dsn, eventId, event);
    } catch {
      /* error reporting must never throw into the code path that is already failing */
    }
    return eventId;
  }

  private send(dsn: NonNullable<ReturnType<ErrorTracker['config']>['dsn']>, eventId: string, event: object) {
    const body = `${JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}\n`;
    const auth = `Sentry sentry_version=7, sentry_client=orion-observability/1.0.0, sentry_key=${dsn.key}${dsn.secret ? `, sentry_secret=${dsn.secret}` : ''}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const p: Promise<void> = this.fetchImpl(dsn.endpoint, { method: 'POST', headers: { 'content-type': 'application/x-sentry-envelope', 'x-sentry-auth': auth }, body, signal: ctrl.signal, redirect: 'error' })
      .then((res) => {
        if (res.ok) this.counters.sent++;
        else {
          this.counters.failed++;
          if (res.status === 429) this.pausedUntil = Date.now() + Math.min(300, Number(res.headers?.get?.('retry-after')) || 60) * 1000; // Sentry asked us to back off
        }
      })
      .catch(() => {
        this.counters.failed++;
      })
      .finally(() => {
        clearTimeout(timer);
        this.pending.delete(p);
      });
    this.pending.add(p);
  }

  /** Waits for reports in flight (up to `timeoutMs`): call before the process exits. */
  async flush(timeoutMs = 2000): Promise<void> {
    if (!this.pending.size) return;
    await Promise.race([Promise.allSettled([...this.pending]), new Promise((r) => setTimeout(r, timeoutMs))]);
  }

  recent(limit = 50): IRecentError[] {
    return this.recentErrors.slice(0, Math.min(Math.max(limit, 1), MAX_RECENT));
  }

  summary() {
    const cfg = this.config();
    return { enabled: cfg.enabled, provider: cfg.enabled ? 'sentry' : 'none', host: cfg.dsn?.host ?? null, environment: cfg.environment, release: cfg.release ?? null, sampleRate: cfg.sampleRate, ...this.counters, recentErrors: this.recentErrors.length };
  }

  reset() {
    this.recentErrors.length = 0;
    this.seen.clear();
    this.pending.clear();
    this.pausedUntil = 0;
    this.sentThisMinute = 0;
    Object.assign(this.counters, { captured: 0, sent: 0, failed: 0, droppedRateLimited: 0, droppedSampled: 0 });
  }
}

export const errorTracker = new ErrorTracker();
export const captureException = (error: unknown, ctx?: ICaptureContext) => errorTracker.capture(error, ctx);

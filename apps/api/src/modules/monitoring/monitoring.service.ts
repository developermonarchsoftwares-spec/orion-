import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { evaluateSecurityRules, SECURITY_ACTIONS, SECURITY_COUNTS_SQL, type IAuditCountRow } from './security-alert-rules';
import * as os from 'os';
import * as v8 from 'v8';
import { monitorEventLoopDelay, performance } from 'perf_hooks';
import type { Pool } from 'pg';
import type { Client } from 'typesense';
import { errorTracker } from '../../common/observability/error-tracker';
import { httpInFlight, metrics } from '../../common/observability/metrics';
import { requestStats } from '../../common/observability/rolling-stats';
import { scrubText } from '../../common/observability/scrub';
import { tracer } from '../../common/observability/tracing';
import { PG_POOL } from '../../database/database.constants';
import { TYPESENSE_CLIENT } from '../typesense/typesense.constants';
import { safeRequest } from '../integrations/net/safe-http';
import { TrafficLimitsService } from '../traffic/traffic-limits.service';

export type Severity = 'critical' | 'warning' | 'info';
export interface IAlert {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
}
export type Health = 'OK' | 'DEGRADED' | 'CRITICAL';

const STARTED_AT = new Date();
const mb = (n: number) => Math.round((n / 1024 / 1024) * 10) / 10;
const rowsOf = (res: any): any[] => res?.rows ?? [];
const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms} ms`)), ms))]);

/** How long a database / queue / search snapshot is reused, so a dashboard or a scraper polling every few seconds does not hammer them. */
const SNAPSHOT_TTL_MS = 10_000;

interface ICached<T> {
  at: number;
  value: T;
}

/**
 * Application, database, queue and search-cluster health in one place, plus the alert rules that turn those numbers into a status. Every
 * probe is bounded by a timeout and fails soft: a part that cannot be measured is reported as unavailable, it never breaks the report.
 */
@Injectable()
export class MonitoringService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitoringService.name);
  private readonly loop = monitorEventLoopDelay({ resolution: 20 });
  private readonly timers: NodeJS.Timeout[] = [];
  private lastCpu = process.cpuUsage();
  private lastCpuAt = performance.now();
  private cpuPercent = 0;
  private readonly cache = new Map<string, ICached<unknown>>();
  private firing = new Map<string, { since: number; lastNotified: number }>();
  private snapshotsForMetrics: { queues?: any; search?: any; database?: any } = {};
  /** Replaceable in tests. */
  alertSink?: (payload: { text: string; alerts: IAlert[] }) => Promise<void>;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Optional() @Inject(TYPESENSE_CLIENT) private readonly typesense?: Client | null,
    @Optional() private readonly traffic?: TrafficLimitsService,
  ) {}

  // ---------------------------------------------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------------------------------------------

  onModuleInit() {
    this.loop.enable();
    this.registerMetrics();
    if (process.env.NODE_ENV === 'test') return;
    this.timers.push(setInterval(() => this.loop.reset(), 60_000));
    if (tracer.summary().exporter !== 'none') this.timers.push(setInterval(() => void tracer.flush(), 5_000));
    this.timers.push(setInterval(() => void this.evaluateAndNotify(), 60_000));
    for (const t of this.timers) t.unref();
    this.installProcessHandlers();
  }

  async onModuleDestroy() {
    for (const t of this.timers) clearInterval(t);
    this.loop.disable();
    await Promise.allSettled([tracer.flush(), errorTracker.flush(2000)]);
  }

  /**
   * Keeps the process's default behaviour (a fatal error ends it) but makes sure it is reported first: the error is logged, sent to the
   * error tracker, the report is given up to two seconds to leave, then the process exits with status 1. An unhandled promise rejection is
   * turned into the same path (Node's default would also end the process).
   */
  private installProcessHandlers() {
    process.on('unhandledRejection', (reason) => {
      throw reason instanceof Error ? reason : new Error(`Unhandled rejection: ${scrubText(reason)}`);
    });
    process.on('uncaughtException', (err) => {
      this.logger.error({ event: 'uncaught_exception', message: `Uncaught exception: ${err?.message}` }, err?.stack);
      errorTracker.capture(err, { source: 'process', level: 'fatal' });
      void Promise.allSettled([errorTracker.flush(2000), tracer.flush()]).finally(() => process.exit(1));
    });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Application and process
  // ---------------------------------------------------------------------------------------------------------------

  appInfo() {
    return {
      name: process.env.OTEL_SERVICE_NAME || 'orion-api',
      version: process.env.APP_VERSION || process.env.npm_package_version || 'unknown',
      commit: process.env.GIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || null,
      environment: process.env.NODE_ENV || 'development',
      node: process.version,
      host: os.hostname(),
      startedAt: STARTED_AT.toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  processStats() {
    const mem = process.memoryUsage();
    const heap = v8.getHeapStatistics();
    const now = performance.now();
    const cpu = process.cpuUsage();
    const elapsedUs = (now - this.lastCpuAt) * 1000;
    if (elapsedUs > 1_000_000) {
      this.cpuPercent = Math.round(((cpu.user - this.lastCpu.user + (cpu.system - this.lastCpu.system)) / elapsedUs) * 1000) / 10;
      this.lastCpu = cpu;
      this.lastCpuAt = now;
    }
    const ms = (ns: number) => (Number.isFinite(ns) ? Math.round((ns / 1e6) * 10) / 10 : null);
    return {
      memory: { rssMb: mb(mem.rss), heapUsedMb: mb(mem.heapUsed), heapTotalMb: mb(mem.heapTotal), heapLimitMb: mb(heap.heap_size_limit), heapUsedRatio: Math.round((mem.heapUsed / heap.heap_size_limit) * 1000) / 1000, externalMb: mb(mem.external) },
      cpu: { percent: this.cpuPercent, cores: os.cpus().length, loadAverage1m: Math.round(os.loadavg()[0] * 100) / 100 },
      eventLoop: { meanMs: ms(this.loop.mean), p99Ms: ms(this.loop.percentile(99)), maxMs: ms(this.loop.max) },
      system: { totalMemoryMb: mb(os.totalmem()), freeMemoryMb: mb(os.freemem()) },
    };
  }

  private registerMetrics() {
    const g = (n: string, h: string) => metrics.gauge(n, h);
    const rss = g('process_resident_memory_bytes', 'Resident memory');
    const heapUsed = g('nodejs_heap_used_bytes', 'V8 heap in use');
    const heapLimit = g('nodejs_heap_limit_bytes', 'V8 heap limit');
    const cpu = g('process_cpu_percent', 'CPU used by the process over the last interval, percent of one core');
    const lag = g('nodejs_eventloop_lag_p99_seconds', 'Event loop delay, 99th percentile since the last reset');
    const up = g('process_uptime_seconds', 'Process uptime');
    const info = g('app_info', 'Build and runtime information');
    const queueJobs = g('queue_jobs', 'Jobs by queue and status');
    const queueOldest = g('queue_oldest_waiting_seconds', 'Age of the oldest waiting job per queue');
    const queueStuck = g('queue_stuck_jobs', 'Jobs marked active for too long per queue');
    const searchUp = g('search_up', 'Search cluster reachable (1) or not (0)');
    const searchDocs = g('search_documents', 'Documents per search collection');
    const dbUp = g('db_up', 'Database reachable (1) or not (0)');
    const dbPing = g('db_ping_seconds', 'Latency of a trivial database query');
    const dbSize = g('db_size_bytes', 'Database size');
    const dbConn = g('db_server_connections', 'Server-side connections by state');
    const traffic = g('traffic_limited_total', 'Requests refused by the protection layer since start, by reason');
    const spans = g('tracing_spans_total', 'Spans recorded since start');
    const tracer_ = g('tracing_export_failures_total', 'Failed trace exports since start');
    metrics.onCollect(() => {
      const p = this.processStats();
      const m = process.memoryUsage();
      rss.set(undefined, m.rss);
      heapUsed.set(undefined, m.heapUsed);
      heapLimit.set(undefined, v8.getHeapStatistics().heap_size_limit);
      cpu.set(undefined, p.cpu.percent);
      lag.set(undefined, (p.eventLoop.p99Ms ?? 0) / 1000);
      up.set(undefined, process.uptime());
      info.set({ version: this.appInfo().version, node: process.version, environment: this.appInfo().environment }, 1);
      const s = this.snapshotsForMetrics;
      if (s.queues) {
        queueJobs.clear();
        for (const q of s.queues.queues) {
          for (const [status, n] of Object.entries(q.counts)) queueJobs.set({ queue: q.name, status }, n as number);
          queueOldest.set({ queue: q.name }, q.oldestWaitingSeconds ?? 0);
          queueStuck.set({ queue: q.name }, q.stuckActive);
        }
      }
      if (s.search) {
        searchUp.set({ provider: s.search.provider }, s.search.status === 'DOWN' ? 0 : 1);
        searchDocs.clear();
        for (const c of s.search.collections ?? []) searchDocs.set({ collection: c.name }, c.documents);
      }
      if (s.database) {
        dbUp.set(undefined, s.database.reachable ? 1 : 0);
        if (s.database.pingMs !== null) dbPing.set(undefined, s.database.pingMs / 1000);
        if (s.database.sizeBytes != null) dbSize.set(undefined, s.database.sizeBytes);
        for (const [state, n] of Object.entries(s.database.connections?.byState ?? {})) dbConn.set({ state }, n as number);
      }
      if (this.traffic) for (const [reason, n] of Object.entries(this.traffic.stats.limited)) traffic.set({ reason }, n);
      const t = tracer.summary();
      spans.set(undefined, t.spans);
      tracer_.set(undefined, t.exportFailures);
    });
  }

  /** Reads the (cached) database, queue and search snapshots so the gauges are fresh; called before a metrics scrape. */
  async refreshSnapshots() {
    await Promise.allSettled([this.database(), this.queues(), this.search()]);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Cached probes
  // ---------------------------------------------------------------------------------------------------------------

  private async cached<T>(key: string, fn: () => Promise<T>, force = false): Promise<T> {
    const hit = this.cache.get(key) as ICached<T> | undefined;
    if (!force && hit && Date.now() - hit.at < SNAPSHOT_TTL_MS) return hit.value;
    const value = await fn();
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  private async q(text: string, params: unknown[] = []): Promise<any[] | null> {
    try {
      return rowsOf(await withTimeout(this.pool.query(text, params as any[]), 4000, 'database query'));
    } catch {
      return null; // a view that does not exist here (managed or embedded database) or a slow server: report "unavailable", not an error
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Database health
  // ---------------------------------------------------------------------------------------------------------------

  database(force = false) {
    return this.cached(
      'database',
      async () => {
        const t0 = performance.now();
        const ping = await this.q('SELECT 1 AS ok');
        const reachable = !!ping?.length;
        const pingMs = reachable ? Math.round((performance.now() - t0) * 10) / 10 : null;
        const poolMax = (this.pool as any).options?.max ?? null;
        const base = {
          reachable,
          pingMs,
          pool: { total: this.pool.totalCount, idle: this.pool.idleCount, waiting: this.pool.waitingCount, max: poolMax },
          connections: null as null | { total: number; max: number | null; byState: Record<string, number>; idleInTransactionOldestSeconds: number | null; longestRunningQuerySeconds: number | null },
          locksWaiting: null as number | null,
          sizeBytes: null as number | null,
          cacheHitRatio: null as number | null,
          transactions: null as null | { committed: number; rolledBack: number; deadlocks: number; tempFiles: number },
          deadTuples: null as null | Array<{ table: string; live: number; dead: number }>,
          migrations: null as null | { applied: number; lastAppliedAt: string | null },
          note: undefined as string | undefined,
        };
        if (!reachable) {
          this.snapshotsForMetrics.database = base;
          return base;
        }
        const [act, maxc, locks, stat, dead, mig] = await Promise.all([
          this.q(`SELECT coalesce(state,'background') AS state, count(*)::int AS n, max(extract(epoch FROM (now() - xact_start)))::float AS xact_age, max(extract(epoch FROM (now() - query_start))) FILTER (WHERE state = 'active')::float AS query_age FROM pg_stat_activity WHERE datname = current_database() GROUP BY 1`),
          this.q(`SELECT current_setting('max_connections')::int AS max`),
          this.q(`SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted`),
          this.q(`SELECT pg_database_size(current_database())::bigint AS size, blks_hit, blks_read, xact_commit, xact_rollback, deadlocks, temp_files FROM pg_stat_database WHERE datname = current_database()`),
          this.q(`SELECT relname, n_live_tup::bigint AS live, n_dead_tup::bigint AS dead FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 5`),
          this.q(`SELECT count(*)::int AS n, max(created_at)::bigint AS last FROM drizzle.__drizzle_migrations`),
        ]);
        if (act) {
          const byState: Record<string, number> = {};
          let total = 0;
          let idleTx: number | null = null;
          let longest: number | null = null;
          for (const r of act) {
            byState[r.state] = r.n;
            total += r.n;
            if (r.state === 'idle in transaction' && r.xact_age != null) idleTx = Math.max(idleTx ?? 0, Math.round(r.xact_age));
            if (r.query_age != null) longest = Math.max(longest ?? 0, Math.round(r.query_age));
          }
          base.connections = { total, max: maxc?.[0]?.max ?? null, byState, idleInTransactionOldestSeconds: idleTx, longestRunningQuerySeconds: longest };
        }
        if (locks) base.locksWaiting = locks[0]?.n ?? 0;
        if (stat?.[0]) {
          const s = stat[0];
          base.sizeBytes = Number(s.size);
          const reads = Number(s.blks_hit) + Number(s.blks_read);
          base.cacheHitRatio = reads > 0 ? Math.round((Number(s.blks_hit) / reads) * 10000) / 10000 : null;
          base.transactions = { committed: Number(s.xact_commit), rolledBack: Number(s.xact_rollback), deadlocks: Number(s.deadlocks), tempFiles: Number(s.temp_files) };
        }
        if (dead) base.deadTuples = dead.map((r) => ({ table: r.relname, live: Number(r.live), dead: Number(r.dead) }));
        if (mig?.[0]) base.migrations = { applied: mig[0].n, lastAppliedAt: mig[0].last ? new Date(Number(mig[0].last)).toISOString() : null };
        if (!act && !stat) base.note = 'Server statistics views are not available on this database; only reachability, latency and the pool are reported.';
        this.snapshotsForMetrics.database = base;
        return base;
      },
      force,
    );
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Queue monitoring
  // ---------------------------------------------------------------------------------------------------------------

  queues(force = false) {
    return this.cached(
      'queues',
      async () => {
        const [counts, health, failed] = await Promise.all([
          this.q(`SELECT queue_name, status, count(*)::int AS n FROM queue_jobs GROUP BY queue_name, status`),
          this.q(`SELECT queue_name,
                    max(extract(epoch FROM (now() - created_at))) FILTER (WHERE status = 'WAITING')::float AS oldest_waiting,
                    count(*) FILTER (WHERE status = 'ACTIVE' AND locked_at < now() - interval '10 minutes')::int AS stuck,
                    count(*) FILTER (WHERE status = 'COMPLETED' AND processed_at > now() - interval '1 hour')::int AS done_1h,
                    count(*) FILTER (WHERE status = 'FAILED' AND updated_at > now() - interval '1 hour')::int AS failed_1h
                  FROM queue_jobs GROUP BY queue_name`),
          this.q(`SELECT id, queue_name, job_name, attempts, max_attempts, error, updated_at FROM queue_jobs WHERE status = 'FAILED' ORDER BY updated_at DESC LIMIT 10`),
        ]);
        const names = new Set<string>([...(counts ?? []).map((r) => r.queue_name), ...(health ?? []).map((r) => r.queue_name)]);
        const queues = [...names].sort().map((name) => {
          const c: Record<string, number> = { WAITING: 0, ACTIVE: 0, COMPLETED: 0, FAILED: 0 };
          for (const r of (counts ?? []).filter((x) => x.queue_name === name)) c[r.status] = r.n;
          const h = (health ?? []).find((x) => x.queue_name === name);
          const oldestWaitingSeconds = h?.oldest_waiting != null ? Math.round(h.oldest_waiting) : null;
          const stuckActive = h?.stuck ?? 0;
          const completed1h = h?.done_1h ?? 0;
          const failed1h = h?.failed_1h ?? 0;
          const status: Health = stuckActive > 0 || (oldestWaitingSeconds ?? 0) > 900 ? 'CRITICAL' : (oldestWaitingSeconds ?? 0) > 300 || failed1h >= 5 ? 'DEGRADED' : 'OK';
          return { name, status, counts: c, oldestWaitingSeconds, stuckActive, completedLastHour: completed1h, failedLastHour: failed1h, failureRateLastHour: completed1h + failed1h > 0 ? Math.round((failed1h / (completed1h + failed1h)) * 1000) / 1000 : 0 };
        });
        const value = {
          available: counts !== null,
          status: (queues.some((q) => q.status === 'CRITICAL') ? 'CRITICAL' : queues.some((q) => q.status === 'DEGRADED') ? 'DEGRADED' : 'OK') as Health,
          queues,
          // job data and results are never shown: only ids, names, counts and the (scrubbed) error text
          recentFailures: (failed ?? []).map((r) => ({ id: r.id, queue: r.queue_name, job: r.job_name, attempts: r.attempts, maxAttempts: r.max_attempts, error: scrubText(r.error ?? '', 200), at: r.updated_at })),
        };
        this.snapshotsForMetrics.queues = value;
        return value;
      },
      force,
    );
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Search cluster monitoring
  // ---------------------------------------------------------------------------------------------------------------

  search(force = false) {
    return this.cached(
      'search',
      async () => {
        const published = (await this.q(`SELECT count(*)::int AS n FROM businesses WHERE status = 'PUBLISHED'`))?.[0]?.n ?? null;
        const sync = await this.q(`SELECT status::text AS status, count(*)::int AS n FROM search_sync_logs WHERE created_at > now() - interval '24 hours' GROUP BY status`);
        const syncLast24h = sync ? Object.fromEntries(sync.map((r) => [r.status, r.n])) : null;
        if (!this.typesense) {
          const v = { provider: 'postgres', status: 'OK' as const, note: 'Search runs on PostgreSQL full-text search; there is no separate search cluster to monitor.', publishedBusinesses: published, collections: [] as Array<{ name: string; documents: number }>, syncLast24h };
          this.snapshotsForMetrics.search = v;
          return v;
        }
        const c: any = this.typesense;
        const t0 = performance.now();
        const call = async (fn: () => Promise<any>) => {
          try {
            return await withTimeout(fn(), 4000, 'search cluster');
          } catch (e) {
            return { __error: String((e as Error).message).slice(0, 120) };
          }
        };
        const [health, debug, mjson, stats, colls] = await Promise.all([call(() => c.health.retrieve()), call(() => c.debug.retrieve()), call(() => c.metrics.retrieve()), call(() => c.stats.retrieve()), call(() => c.collections().retrieve())]);
        const reachable = !health.__error && health.ok !== false;
        const collections: Array<{ name: string; documents: number }> = Array.isArray(colls) ? colls.map((x: any) => ({ name: x.name, documents: Number(x.num_documents ?? 0) })) : [];
        const idx = collections.find((x) => x.name === 'businesses');
        const driftRatio = published && idx ? Math.round((Math.abs(published - idx.documents) / Math.max(published, 1)) * 10000) / 10000 : null;
        const diskRatio = mjson && !mjson.__error && Number(mjson.system_disk_total_bytes) > 0 ? Number(mjson.system_disk_used_bytes) / Number(mjson.system_disk_total_bytes) : null;
        const memRatio = mjson && !mjson.__error && Number(mjson.system_memory_total_bytes) > 0 ? Number(mjson.system_memory_used_bytes) / Number(mjson.system_memory_total_bytes) : null;
        const status: Health = !reachable ? 'CRITICAL' : (driftRatio ?? 0) > 0.05 || (diskRatio ?? 0) > 0.9 || (memRatio ?? 0) > 0.9 || (syncLast24h?.FAILED ?? 0) > 20 ? 'DEGRADED' : 'OK';
        const v = {
          provider: 'typesense',
          status: reachable ? status : ('DOWN' as any),
          reachable,
          responseMs: Math.round(performance.now() - t0),
          version: debug && !debug.__error ? (debug.version ?? null) : null,
          publishedBusinesses: published,
          collections,
          indexDrift: driftRatio === null ? null : { databasePublished: published, indexed: idx?.documents ?? 0, ratio: driftRatio },
          resources: mjson && !mjson.__error ? { diskUsedRatio: diskRatio === null ? null : Math.round(diskRatio * 1000) / 1000, memoryUsedRatio: memRatio === null ? null : Math.round(memRatio * 1000) / 1000, memoryActiveMb: mjson.typesense_memory_active_bytes ? mb(Number(mjson.typesense_memory_active_bytes)) : null } : null,
          latencyMs: stats && !stats.__error ? { avgSearch: stats.search_latency_ms ?? null, avgImport: stats.import_latency_ms ?? null, searchRequestsPerSecond: stats.search_requests_per_second ?? null, pendingWriteBatches: stats.pending_write_batches ?? null } : null,
          syncLast24h,
          errors: [health, debug, mjson, stats, colls].filter((x) => x?.__error).map((x) => x.__error),
        };
        this.snapshotsForMetrics.search = v;
        return v;
      },
      force,
    );
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Alerts
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Aggregated counts of security-relevant audit events (see security-alert-rules.ts). One grouped query, cached like every other snapshot, so
   * opening the dashboard repeatedly cannot multiply the cost. Returns null when the audit table cannot be read (reported as an alert).
   */
  securityEvents(force = false): Promise<IAuditCountRow[] | null> {
    return this.cached('security-events', async () => (await this.q(SECURITY_COUNTS_SQL, [SECURITY_ACTIONS])) as IAuditCountRow[] | null, force);
  }

  async alerts(force = false): Promise<IAlert[]> {
    const [db, queues, search] = await Promise.all([this.database(force), this.queues(force), this.search(force)]);
    const out: IAlert[] = [];
    const add = (id: string, severity: Severity, title: string, detail: string) => out.push({ id, severity, title, detail });
    const w5 = requestStats.window(5);
    const proc = this.processStats();

    if (w5.requests >= 20 && w5.errorRate5xx > 0.05) add('http_errors', 'critical', 'High server error rate', `${(w5.errorRate5xx * 100).toFixed(1)}% of ${w5.requests} requests in the last 5 minutes failed with a 5xx`);
    else if (w5.requests >= 50 && w5.errorRate5xx > 0.01) add('http_errors', 'warning', 'Elevated server error rate', `${(w5.errorRate5xx * 100).toFixed(1)}% of ${w5.requests} requests in the last 5 minutes failed with a 5xx`);
    if (w5.requests >= 20 && (w5.p95Ms ?? 0) > 5000) add('http_latency', 'critical', 'Very slow responses', `95th percentile response time is ${w5.p95Ms} ms over the last 5 minutes`);
    else if (w5.requests >= 20 && (w5.p95Ms ?? 0) > 2000) add('http_latency', 'warning', 'Slow responses', `95th percentile response time is ${w5.p95Ms} ms over the last 5 minutes`);
    if ((proc.eventLoop.p99Ms ?? 0) > 1000) add('event_loop', 'critical', 'Event loop blocked', `99th percentile event loop delay is ${proc.eventLoop.p99Ms} ms`);
    else if ((proc.eventLoop.p99Ms ?? 0) > 200) add('event_loop', 'warning', 'Event loop delay', `99th percentile event loop delay is ${proc.eventLoop.p99Ms} ms`);
    if (proc.memory.heapUsedRatio > 0.95) add('heap', 'critical', 'Memory almost exhausted', `${(proc.memory.heapUsedRatio * 100).toFixed(0)}% of the heap limit is in use`);
    else if (proc.memory.heapUsedRatio > 0.85) add('heap', 'warning', 'High memory use', `${(proc.memory.heapUsedRatio * 100).toFixed(0)}% of the heap limit is in use`);

    if (!db.reachable) add('db_down', 'critical', 'Database unreachable', 'The database did not answer a trivial query');
    else {
      if ((db.pingMs ?? 0) > 500) add('db_slow', 'warning', 'Slow database', `A trivial query took ${db.pingMs} ms`);
      if (db.pool.max && db.pool.waiting > 0 && db.pool.total >= db.pool.max) add('db_pool', db.pool.waiting > 5 ? 'critical' : 'warning', 'Database pool exhausted', `${db.pool.waiting} request(s) are waiting for one of ${db.pool.max} connections`);
      if (db.connections?.max && db.connections.total / db.connections.max > 0.8) add('db_connections', 'warning', 'Many database connections', `${db.connections.total} of ${db.connections.max} server connections are in use`);
      if ((db.connections?.idleInTransactionOldestSeconds ?? 0) > 300) add('db_idle_tx', 'warning', 'Transaction left open', `A connection has been idle inside a transaction for ${db.connections?.idleInTransactionOldestSeconds} s`);
      if ((db.locksWaiting ?? 0) > 3) add('db_locks', 'warning', 'Queries waiting on locks', `${db.locksWaiting} lock requests are waiting`);
    }
    for (const q of queues.queues) {
      if (q.stuckActive > 0) add(`queue_stuck:${q.name}`, 'critical', `Queue "${q.name}" has stuck jobs`, `${q.stuckActive} job(s) have been active for over 10 minutes`);
      if ((q.oldestWaitingSeconds ?? 0) > 900) add(`queue_backlog:${q.name}`, 'critical', `Queue "${q.name}" is not being processed`, `The oldest waiting job is ${Math.round((q.oldestWaitingSeconds ?? 0) / 60)} minutes old`);
      else if ((q.oldestWaitingSeconds ?? 0) > 300) add(`queue_backlog:${q.name}`, 'warning', `Queue "${q.name}" is backing up`, `The oldest waiting job is ${Math.round((q.oldestWaitingSeconds ?? 0) / 60)} minutes old`);
      if (q.failedLastHour >= 5) add(`queue_failures:${q.name}`, 'warning', `Queue "${q.name}" is failing jobs`, `${q.failedLastHour} job(s) failed in the last hour (${(q.failureRateLastHour * 100).toFixed(0)}% of those finished)`);
    }
    if (search.provider === 'typesense') {
      if (!(search as any).reachable) add('search_down', 'critical', 'Search cluster unreachable', 'The search cluster did not answer its health check');
      else {
        const s = search as any;
        if (s.indexDrift && s.indexDrift.ratio > 0.05) add('search_drift', 'warning', 'Search index out of step with the database', `${s.indexDrift.indexed} documents indexed, ${s.indexDrift.databasePublished} published businesses in the database`);
        if ((s.resources?.diskUsedRatio ?? 0) > 0.9) add('search_disk', 'warning', 'Search cluster disk nearly full', `${(s.resources.diskUsedRatio * 100).toFixed(0)}% used`);
        if ((s.resources?.memoryUsedRatio ?? 0) > 0.9) add('search_memory', 'warning', 'Search cluster memory nearly full', `${(s.resources.memoryUsedRatio * 100).toFixed(0)}% used`);
      }
    }
    // Security events (Phase 24): from the audit trail. A monitor that cannot read its source says so instead of reporting "all quiet".
    if (db.reachable) {
      const sec = await this.securityEvents(force);
      if (sec === null) add('security_monitoring_unavailable', 'warning', 'Security alerts cannot be evaluated', 'The audit trail could not be read, so security alert rules are not being checked');
      else for (const a of evaluateSecurityRules(sec)) add(a.id, a.severity, a.title, a.detail);
    }
    if (process.env.NODE_ENV === 'production' && !errorTracker.enabled()) add('error_tracking_off', 'info', 'Error tracking is not configured', 'Set SENTRY_DSN so unhandled errors are reported');
    return out;
  }

  statusOf(alerts: IAlert[]): Health {
    return alerts.some((a) => a.severity === 'critical') ? 'CRITICAL' : alerts.some((a) => a.severity === 'warning') ? 'DEGRADED' : 'OK';
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Overview
  // ---------------------------------------------------------------------------------------------------------------

  async overview(force = false) {
    const [database, queues, search, alerts] = await Promise.all([this.database(force), this.queues(force), this.search(force), this.alerts(force)]);
    return {
      status: this.statusOf(alerts),
      generatedAt: new Date().toISOString(),
      app: this.appInfo(),
      http: {
        inFlight: httpInFlight.get() ?? 0,
        last1m: requestStats.window(1),
        last5m: requestStats.window(5),
        last15m: requestStats.window(15),
        slowestRoutes: requestStats.topRoutes(15, 'p95', 8),
        failingRoutes: requestStats.topRoutes(15, 'errors', 5).filter((r) => r.errors5xx > 0),
        busiestRoutes: requestStats.topRoutes(15, 'count', 8),
      },
      process: this.processStats(),
      database,
      queues,
      search,
      alerts,
      errorTracking: { ...errorTracker.summary(), recent: errorTracker.recent(5) },
      tracing: tracer.summary(),
      logging: { format: process.env.LOG_FORMAT || (process.env.NODE_ENV === 'production' ? 'json' : 'pretty'), level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug') },
      protection: this.traffic ? { limited: this.traffic.stats.limited, autoBlocks: this.traffic.stats.autoBlocks, loginLockouts: this.traffic.stats.loginLockouts } : null,
    };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Alert notification (a webhook; Slack-compatible `text`)
  // ---------------------------------------------------------------------------------------------------------------

  /** Sends a message when an alert starts firing or resolves, and a reminder every 6 hours while a critical one persists. Never throws. */
  async evaluateAndNotify(): Promise<{ firing: number; notified: boolean }> {
    try {
      const alerts = (await this.alerts(true)).filter((a) => a.severity !== 'info');
      const now = Date.now();
      const current = new Set(alerts.map((a) => a.id));
      const started = alerts.filter((a) => !this.firing.has(a.id));
      const reminders = alerts.filter((a) => a.severity === 'critical' && this.firing.has(a.id) && now - this.firing.get(a.id)!.lastNotified > 6 * 3_600_000);
      // While the database is unreachable (or the audit trail cannot be read) the security rules are not evaluated at all, so an absent
      // security alert means "unknown", not "resolved". Telling the operator "resolved" in the middle of an outage was observed in Phase 31.
      const securityUnknown = current.has('db_down') || current.has('security_monitoring_unavailable');
      const resolved = [...this.firing.keys()].filter((id) => !current.has(id) && !(securityUnknown && id.startsWith('sec_')));
      for (const a of started) this.firing.set(a.id, { since: now, lastNotified: now });
      for (const a of reminders) this.firing.get(a.id)!.lastNotified = now;
      for (const id of resolved) this.firing.delete(id);
      if (!started.length && !reminders.length && !resolved.length) return { firing: alerts.length, notified: false };

      const env = this.appInfo();
      const lines = [
        ...[...started, ...reminders].map((a) => `${a.severity === 'critical' ? '🔴' : '🟠'} ${a.title}: ${a.detail}`),
        ...resolved.map((id) => `✅ Resolved: ${id}`),
      ];
      const text = `[${env.name} · ${env.environment}] ${lines.join('\n')}`;
      await this.deliver({ text, alerts: [...started, ...reminders] });
      return { firing: alerts.length, notified: true };
    } catch (err) {
      this.logger.warn(`Alert evaluation failed: ${(err as Error).message}`);
      return { firing: 0, notified: false };
    }
  }

  private async deliver(payload: { text: string; alerts: IAlert[] }) {
    if (this.alertSink) return this.alertSink(payload);
    const url = process.env.MONITORING_ALERT_WEBHOOK_URL;
    if (!url) return;
    try {
      // the address is operator-configured, but it goes through the same outbound-request guard as customer webhooks
      await safeRequest(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), timeoutMs: 5000, target: 'alert-webhook' });
    } catch (err) {
      this.logger.warn(`Alert webhook failed: ${scrubText((err as Error).message, 200)}`);
    }
  }
}

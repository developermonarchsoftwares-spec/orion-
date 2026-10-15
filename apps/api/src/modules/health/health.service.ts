import { BeforeApplicationShutdown, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { performance } from 'perf_hooks';
import type { Pool } from 'pg';
import type { Client } from 'typesense';
import { PG_POOL } from '../../database/database.constants';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../storage/storage.service';
import { TYPESENSE_CLIENT } from '../typesense/typesense.constants';
import { TypesenseService } from '../typesense/typesense.service';
import { probeRedis, redisConfig } from './redis-probe';

export type DependencyName = 'database' | 'typesense' | 'redis' | 'storage';
export type DependencyStatus = 'up' | 'down' | 'skipped';
export type FailureReason = 'unreachable' | 'timeout' | 'auth_failed' | 'connection_refused' | 'tls_error' | 'protocol_error' | 'error';

export interface IDependencyResult {
  name: DependencyName;
  status: DependencyStatus;
  latencyMs: number | null;
  /** Why it is down or skipped: a short fixed code, never raw error text (that can hold host names, user names or credentials). */
  reason?: FailureReason | 'not_configured' | 'search_provider_is_postgres';
  /** Only for administrators: versions, pool figures and the like. */
  details?: Record<string, unknown>;
}

const flag = (v: string | undefined) => ['1', 'true', 'yes', 'on'].includes(String(v ?? '').trim().toLowerCase());
const num = (v: string | undefined, d: number, min = 0) => {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n >= min ? n : d;
};

/** How long one dependency check may take before it counts as down. */
export const checkTimeoutMs = () => num(process.env.HEALTH_CHECK_TIMEOUT_MS, 2000, 50);
/** A result is reused for this long, and simultaneous callers share one check, so probe traffic cannot load the dependencies. 0 disables reuse. */
export const checkCacheMs = () => num(process.env.HEALTH_CACHE_MS, 2000, 0);
/** A wedged process (event loop blocked for longer than this) fails liveness so the orchestrator restarts it. */
export const livenessMaxLagMs = () => num(process.env.LIVENESS_MAX_LAG_MS, 5000, 100);

/**
 * Dependency checks behind the health endpoints.
 *  - Liveness never looks at a dependency: restarting this process cannot fix a database, so a database outage must not trigger restarts.
 *  - Readiness asks whether this instance should receive traffic: the database always; the search cluster when Typesense is the
 *    provider; Redis when REDIS_REQUIRED=true; storage when READINESS_REQUIRES_STORAGE=true. Anything else that is down makes the
 *    instance "degraded" (still ready). During shutdown it answers not-ready so the load balancer drains the instance first.
 */
@Injectable()
export class HealthService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(HealthService.name);
  private readonly cache = new Map<string, { at: number; value: IDependencyResult }>();
  private readonly inflight = new Map<string, Promise<IDependencyResult>>();
  private shuttingDown = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly typesenseService: TypesenseService,
    private readonly storage: StorageService,
    @Inject(PG_POOL) private readonly pool: Pool,
    @Optional() @Inject(TYPESENSE_CLIENT) private readonly typesenseClient?: Client | null,
  ) {}

  // ---------------------------------------------------------------------------------------------------------------
  // Shutdown
  // ---------------------------------------------------------------------------------------------------------------

  /** From the moment a shutdown signal arrives readiness answers 503; optionally keep serving for a while so the load balancer notices. */
  async beforeApplicationShutdown() {
    this.shuttingDown = true;
    const drain = num(process.env.HEALTH_SHUTDOWN_DRAIN_SECONDS, 0, 0);
    if (drain > 0) {
      this.logger.log(`Shutting down: not ready; draining for ${drain} s`);
      await new Promise((r) => setTimeout(r, drain * 1000));
    }
  }

  isShuttingDown() {
    return this.shuttingDown;
  }

  /** Test hook. */
  setShuttingDown(v: boolean) {
    this.shuttingDown = v;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Liveness
  // ---------------------------------------------------------------------------------------------------------------

  /** Measures how long the event loop takes to come round once. Resolves late (or never) only if the process is wedged. */
  private eventLoopLag(): Promise<number> {
    const t0 = performance.now();
    return new Promise((resolve) => setImmediate(() => resolve(Math.round((performance.now() - t0) * 10) / 10)));
  }

  async liveness() {
    const lag = await this.eventLoopLag();
    const ok = lag <= livenessMaxLagMs();
    return { ok, body: { status: ok ? 'ok' : 'unresponsive', uptime: process.uptime(), timestamp: new Date().toISOString(), eventLoopLagMs: lag } };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Dependencies
  // ---------------------------------------------------------------------------------------------------------------

  private async bounded<T>(work: () => Promise<T>): Promise<{ timedOut: boolean; value?: T; threw?: boolean }> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<{ timedOut: true }>((r) => (timer = setTimeout(() => r({ timedOut: true }), checkTimeoutMs())));
    try {
      const out = await Promise.race([work().then((value) => ({ timedOut: false as const, value })), timeout]);
      return out as any;
    } catch {
      return { timedOut: false, threw: true };
    } finally {
      clearTimeout(timer);
    }
  }

  private async measure(name: DependencyName, includeDetails: boolean): Promise<IDependencyResult> {
    const t0 = performance.now();
    const latency = () => Math.round((performance.now() - t0) * 10) / 10;
    const down = (reason: FailureReason): IDependencyResult => ({ name, status: 'down', latencyMs: latency(), reason });
    const up = (details?: Record<string, unknown>): IDependencyResult => ({ name, status: 'up', latencyMs: latency(), ...(includeDetails && details ? { details } : {}) });

    if (name === 'database') {
      const r = await this.bounded(() => this.database.ping());
      if (r.timedOut) return down('timeout');
      if (r.threw || !r.value) return down('unreachable');
      return up({ pool: { total: this.pool.totalCount, idle: this.pool.idleCount, waiting: this.pool.waitingCount, max: (this.pool as any).options?.max ?? null } });
    }
    if (name === 'typesense') {
      if (!this.typesenseClient) return { name, status: 'skipped', latencyMs: null, reason: 'search_provider_is_postgres' };
      const r = await this.bounded(() => this.typesenseService.ping());
      if (r.timedOut) return down('timeout');
      if (r.threw || !r.value) return down('unreachable');
      let details: Record<string, unknown> | undefined;
      if (includeDetails) {
        const cols = await this.bounded(() => this.typesenseService.getCollections());
        if (Array.isArray(cols.value)) details = { collections: cols.value.length };
      }
      return up(details);
    }
    if (name === 'redis') {
      const cfg = redisConfig();
      if (!cfg) return { name, status: 'skipped', latencyMs: null, reason: 'not_configured' };
      const r = await probeRedis(cfg, checkTimeoutMs());
      if (!r.ok) return down((r.reason ?? 'error') as FailureReason);
      return up({ version: r.version ?? null, mode: r.role ?? null, tls: cfg.tls, database: cfg.db });
    }
    // storage
    const r = await this.bounded(() => this.storage.checkHealth());
    if (r.timedOut) return down('timeout');
    if (r.threw || !r.value) return down('unreachable');
    return up();
  }

  /** One check, shared by simultaneous callers and reused briefly. The detailed form (administrators) is cached separately from the public one. */
  check(name: DependencyName, includeDetails = false): Promise<IDependencyResult> {
    const key = includeDetails ? `${name}:detail` : name;
    const ttl = checkCacheMs();
    const hit = this.cache.get(key);
    if (hit && ttl > 0 && Date.now() - hit.at < ttl) return Promise.resolve(hit.value);
    const running = this.inflight.get(key);
    if (running) return running;
    const p = this.measure(name, includeDetails)
      .then((value) => {
        this.cache.set(key, { at: Date.now(), value });
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  /** Which dependencies readiness insists on, right now. */
  requirements(): Record<DependencyName, boolean> {
    return {
      database: true,
      typesense: !!this.typesenseClient,
      redis: flag(process.env.REDIS_REQUIRED),
      storage: flag(process.env.READINESS_REQUIRES_STORAGE),
    };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Readiness
  // ---------------------------------------------------------------------------------------------------------------

  async readiness(includeDetails = false) {
    const timestamp = new Date().toISOString();
    if (this.shuttingDown) return { ready: false, body: { status: 'shutting_down', ready: false, timestamp, checks: {} } };
    const names: DependencyName[] = ['database', 'typesense', 'redis', 'storage'];
    const results = await Promise.all(names.map((n) => this.check(n, includeDetails)));
    const need = this.requirements();
    const checks: Record<string, IDependencyResult & { required: boolean }> = {};
    let requiredDown = false;
    let optionalDown = false;
    for (const r of results) {
      checks[r.name] = { ...r, required: need[r.name] };
      if (r.status === 'down') (need[r.name] ? (requiredDown = true) : (optionalDown = true));
    }
    const ready = !requiredDown;
    return { ready, body: { status: requiredDown ? 'unavailable' : optionalDown ? 'degraded' : 'ok', ready, timestamp, checks } };
  }

  clearCache() {
    this.cache.clear();
  }
}

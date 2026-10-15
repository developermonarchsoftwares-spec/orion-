import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { performance } from 'perf_hooks';
import { dbQueryDuration, dbQueryErrors, dbSlowQueries, metrics } from './metrics';
import { tracer } from './tracing';

/**
 * Times every database query (through the pool, and through each connection a transaction holds), records a latency histogram by
 * operation, counts slow and failed queries, and adds a child span to the trace of the request that issued it. The SQL text and its
 * parameters are never recorded: only the operation (SELECT, INSERT, ...), which cannot carry personal data.
 */
const WRAPPED = Symbol('orion.instrumented');
const log = new Logger('Database');
const KNOWN = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'BEGIN', 'COMMIT', 'ROLLBACK', 'WITH', 'CREATE', 'ALTER', 'DROP', 'SET', 'SAVEPOINT', 'RELEASE', 'LOCK', 'TRUNCATE']);

export const slowQueryMs = () => {
  const n = parseInt(process.env.DB_SLOW_QUERY_MS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 500;
};

export function operationOf(text: unknown): string {
  const w = /^\s*(?:\/\*.*?\*\/\s*)?([A-Za-z]+)/s.exec(typeof text === 'string' ? text : '')?.[1]?.toUpperCase();
  return w && KNOWN.has(w) ? w : 'OTHER';
}

function timed(original: (...args: any[]) => any) {
  const fn = function (this: unknown, ...args: any[]) {
    // callback style (what the pool itself uses to run a query on a client) is passed through: the promise call above it is timed once
    if (typeof args[args.length - 1] === 'function') return original.apply(this, args);
    const op = operationOf(typeof args[0] === 'string' ? args[0] : args[0]?.text);
    const start = performance.now();
    const span = tracer.startSpan(`db.${op.toLowerCase()}`, 'CLIENT', { 'db.system': 'postgresql', 'db.operation': op });
    const done = (err?: unknown) => {
      const ms = performance.now() - start;
      dbQueryDuration.observe({ operation: op }, ms / 1000);
      if (err) dbQueryErrors.inc({ operation: op });
      if (ms >= slowQueryMs()) {
        dbSlowQueries.inc({ operation: op });
        log.warn({ event: 'slow_query', operation: op, durationMs: Math.round(ms) });
      }
      tracer.endSpan(span, err, { 'db.duration_ms': Math.round(ms) });
    };
    let ret: any;
    try {
      ret = original.apply(this, args);
    } catch (e) {
      done(e);
      throw e;
    }
    if (ret && typeof ret.then === 'function') {
      return ret.then(
        (r: unknown) => {
          done();
          return r;
        },
        (e: unknown) => {
          done(e);
          throw e;
        },
      );
    }
    done();
    return ret;
  };
  (fn as any)[WRAPPED] = true;
  return fn;
}

export function instrumentPool<T extends Pool>(pool: T): T {
  const p = pool as any;
  if (p[WRAPPED]) return pool;
  p[WRAPPED] = true;
  p.query = timed(p.query.bind(pool));
  pool.on('connect', (client: any) => {
    if (!client[WRAPPED]) {
      client[WRAPPED] = true;
      client.query = timed(client.query.bind(client));
    }
  });
  const g = metrics.gauge('db_pool_connections', 'Database pool connections by state');
  const max = metrics.gauge('db_pool_max_connections', 'Configured size of the database pool');
  metrics.onCollect(() => {
    g.set({ state: 'total' }, pool.totalCount);
    g.set({ state: 'idle' }, pool.idleCount);
    g.set({ state: 'waiting' }, pool.waitingCount);
    max.set(undefined, (pool as any).options?.max ?? 0);
  });
  return pool;
}

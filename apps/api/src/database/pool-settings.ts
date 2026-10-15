/**
 * Server-side limits applied to every connection of the API pool.
 *
 * Without them a single slow or forgotten statement holds a pooled connection (and any row locks) until the client gives up, and
 * a few of those exhaust the pool for every other customer. The server itself ends:
 *  - a statement that runs longer than `statementTimeoutMs`,
 *  - a transaction that sits idle longer than `idleInTransactionTimeoutMs` (a crashed or stalled request holding locks),
 *  - a wait for a row or table lock longer than `lockTimeoutMs`.
 * `query_timeout` is the client-side backstop for a statement whose answer never arrives. A value of 0 switches a limit off.
 * The defaults are generous for this application (its slowest legitimate work, a bounded import batch or export, finishes in
 * seconds; a lock is normally held for milliseconds, so waiting 5 s for one means something is stuck, and every waiter holds a pooled
 * connection meanwhile: Phase 29 measured six waiters on one wallet row starving a 2-connection pool for 9 s) and can be changed with DB_STATEMENT_TIMEOUT_MS, DB_IDLE_IN_TRANSACTION_TIMEOUT_MS and DB_LOCK_TIMEOUT_MS.
 */
export interface IPoolLimits {
  statementTimeoutMs: number;
  idleInTransactionTimeoutMs: number;
  lockTimeoutMs: number;
}

export const DEFAULT_POOL_LIMITS: IPoolLimits = { statementTimeoutMs: 60_000, idleInTransactionTimeoutMs: 60_000, lockTimeoutMs: 5_000 };

const positiveOrZero = (v: unknown, fallback: number): number => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};

export function poolLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): IPoolLimits {
  return {
    statementTimeoutMs: positiveOrZero(env.DB_STATEMENT_TIMEOUT_MS, DEFAULT_POOL_LIMITS.statementTimeoutMs),
    idleInTransactionTimeoutMs: positiveOrZero(env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS, DEFAULT_POOL_LIMITS.idleInTransactionTimeoutMs),
    lockTimeoutMs: positiveOrZero(env.DB_LOCK_TIMEOUT_MS, DEFAULT_POOL_LIMITS.lockTimeoutMs),
  };
}

/** Options for `new Pool(...)`. Zero means "no limit", so the setting is simply left out. */
export function databasePoolSettings(limits: IPoolLimits = poolLimitsFromEnv()) {
  return {
    ...(limits.statementTimeoutMs > 0 ? { statement_timeout: limits.statementTimeoutMs, query_timeout: limits.statementTimeoutMs + 5_000 } : {}),
    ...(limits.idleInTransactionTimeoutMs > 0 ? { idle_in_transaction_session_timeout: limits.idleInTransactionTimeoutMs } : {}),
    ...(limits.lockTimeoutMs > 0 ? { lock_timeout: limits.lockTimeoutMs } : {}),
  };
}

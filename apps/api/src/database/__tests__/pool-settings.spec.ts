import { DEFAULT_POOL_LIMITS, databasePoolSettings, poolLimitsFromEnv } from '../pool-settings';

describe('database pool limits (Phase 27)', () => {
  it('has server-side limits by default', () => {
    const s = databasePoolSettings(poolLimitsFromEnv({} as NodeJS.ProcessEnv));
    expect(s).toMatchObject({
      statement_timeout: DEFAULT_POOL_LIMITS.statementTimeoutMs,
      idle_in_transaction_session_timeout: DEFAULT_POOL_LIMITS.idleInTransactionTimeoutMs,
      lock_timeout: DEFAULT_POOL_LIMITS.lockTimeoutMs,
    });
    expect(s.query_timeout).toBeGreaterThan(s.statement_timeout as number); // the client gives up after the server does
  });

  it('can be changed from the environment, and 0 switches a limit off', () => {
    const s = databasePoolSettings(poolLimitsFromEnv({ DB_STATEMENT_TIMEOUT_MS: '5000', DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: '0' } as unknown as NodeJS.ProcessEnv));
    expect(s.statement_timeout).toBe(5000);
    expect('idle_in_transaction_session_timeout' in s).toBe(false);
  });

  it.each(['abc', '-5', '', 'NaN', '1e999'])('an unusable value (%s) falls back to the default instead of removing the limit', (v) => {
    const s = databasePoolSettings(poolLimitsFromEnv({ DB_STATEMENT_TIMEOUT_MS: v } as unknown as NodeJS.ProcessEnv));
    expect(s.statement_timeout).toBe(DEFAULT_POOL_LIMITS.statementTimeoutMs);
  });

  it('a lock wait is bounded to a few seconds by default: every waiter holds a pooled connection (Phase 29)', () => {
    expect(DEFAULT_POOL_LIMITS.lockTimeoutMs).toBeLessThanOrEqual(10_000);
    expect(DEFAULT_POOL_LIMITS.lockTimeoutMs).toBeGreaterThanOrEqual(1_000);
  });
});

import { Injectable } from '@nestjs/common';
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { checkTimeoutMs } from '../health.service';
import { probeRedis, redisConfig } from '../redis-probe';

/** Redis, for the comprehensive `/health` report. Reported as skipped (healthy) while no Redis is configured, and failing only when one is configured and down. */
@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  async isHealthy(key = 'redis'): Promise<HealthIndicatorResult> {
    const cfg = redisConfig();
    if (!cfg) {
      // Terminus only lists a result whose status is exactly "up" or "down", so "skipped" is reported as up with a note
      return this.getStatus(key, true, { note: 'skipped_not_configured' });
    }
    const r = await probeRedis(cfg, checkTimeoutMs());
    const result = this.getStatus(key, r.ok, r.ok ? {} : { reason: r.reason });
    if (r.ok) return result;
    throw new HealthCheckError('Redis health check failed', result);
  }
}

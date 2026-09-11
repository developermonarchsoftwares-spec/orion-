import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(private readonly redisService: RedisService) {
    super();
  }

  async isHealthy(key = 'redis'): Promise<HealthIndicatorResult> {
    const isConnected = await this.redisService.ping();
    const result = this.getStatus(key, isConnected, { status: isConnected ? 'up' : 'down' });

    if (isConnected) {
      return result;
    }

    throw new HealthCheckError('Redis health check failed', result);
  }
}

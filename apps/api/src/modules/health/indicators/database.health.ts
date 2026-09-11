import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { DatabaseService } from '../../../database/database.service';

@Injectable()
export class DatabaseHealthIndicator extends HealthIndicator {
  constructor(private readonly databaseService: DatabaseService) {
    super();
  }

  async isHealthy(key = 'database'): Promise<HealthIndicatorResult> {
    const isConnected = await this.databaseService.ping();
    const result = this.getStatus(key, isConnected, { status: isConnected ? 'up' : 'down' });

    if (isConnected) {
      return result;
    }

    throw new HealthCheckError('Database health check failed', result);
  }
}

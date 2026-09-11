import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { TypesenseService } from '../../typesense/typesense.service';

@Injectable()
export class TypesenseHealthIndicator extends HealthIndicator {
  constructor(private readonly typesenseService: TypesenseService) {
    super();
  }

  async isHealthy(key = 'typesense'): Promise<HealthIndicatorResult> {
    const isConnected = await this.typesenseService.ping();
    const result = this.getStatus(key, isConnected, { status: isConnected ? 'up' : 'down' });

    if (isConnected) {
      return result;
    }

    throw new HealthCheckError('Typesense health check failed', result);
  }
}

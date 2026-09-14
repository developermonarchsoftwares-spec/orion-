import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { TypesenseService } from '../../typesense/typesense.service';

@Injectable()
export class TypesenseHealthIndicator extends HealthIndicator {
  constructor(
    private readonly typesenseService: TypesenseService,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  async isHealthy(key = 'typesense'): Promise<HealthIndicatorResult> {
    const provider = (this.configService.get<string>('SEARCH_PROVIDER') || 'postgres').toLowerCase();
    if (provider !== 'typesense') {
      return this.getStatus(key, true, { status: 'skipped_postgres_active' });
    }

    const isConnected = await this.typesenseService.ping();
    const result = this.getStatus(key, isConnected, { status: isConnected ? 'up' : 'down' });

    if (isConnected) {
      return result;
    }

    throw new HealthCheckError('Typesense health check failed', result);
  }
}

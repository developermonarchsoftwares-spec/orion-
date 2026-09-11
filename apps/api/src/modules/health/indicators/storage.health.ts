import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { StorageService } from '../../storage/storage.service';

@Injectable()
export class StorageHealthIndicator extends HealthIndicator {
  constructor(private readonly storageService: StorageService) {
    super();
  }

  async isHealthy(key = 'storage'): Promise<HealthIndicatorResult> {
    const isHealthy = await this.storageService.checkHealth();
    const result = this.getStatus(key, isHealthy, { status: isHealthy ? 'up' : 'down' });

    if (isHealthy) {
      return result;
    }

    throw new HealthCheckError('Storage health check failed', result);
  }
}

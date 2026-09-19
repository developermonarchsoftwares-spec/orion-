import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiResponse } from '@nestjs/swagger';
import {
  HealthCheckService,
  HealthCheck,
  MemoryHealthIndicator,
} from '@nestjs/terminus';
import { Public } from '../../auth/decorators';
import { DatabaseHealthIndicator } from './indicators/database.health';
import { TypesenseHealthIndicator } from './indicators/typesense.health';
import { StorageHealthIndicator } from './indicators/storage.health';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly memory: MemoryHealthIndicator,
    private readonly dbIndicator: DatabaseHealthIndicator,
    private readonly typesenseIndicator: TypesenseHealthIndicator,
    private readonly storageIndicator: StorageHealthIndicator,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Comprehensive System Health Check' })
  @ApiResponse({ status: 200, description: 'All critical backend services are operational' })
  @ApiResponse({ status: 503, description: 'One or more critical services are degraded/unreachable' })
  async check() {
    return this.health.check([
      () => this.dbIndicator.isHealthy('database'),
      () => this.typesenseIndicator.isHealthy('typesense'),
      () => this.storageIndicator.isHealthy('storage'),
      () => this.memory.checkHeap('memory_heap', 1024 * 1024 * 1024), // 1GB limit
    ]);
  }

  @Public()
  @Get('liveness')
  @ApiOperation({ summary: 'Kubernetes/Docker Liveness Probe' })
  liveness() {
    return { status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() };
  }
}

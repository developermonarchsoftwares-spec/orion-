import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { DatabaseHealthIndicator } from './indicators/database.health';
import { RedisHealthIndicator } from './indicators/redis.health';
import { StorageHealthIndicator } from './indicators/storage.health';
import { TypesenseHealthIndicator } from './indicators/typesense.health';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [HealthService, DatabaseHealthIndicator, TypesenseHealthIndicator, RedisHealthIndicator, StorageHealthIndicator],
  exports: [HealthService],
})
export class HealthModule {}

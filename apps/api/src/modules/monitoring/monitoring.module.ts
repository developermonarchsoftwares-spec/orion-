import { Global, Module } from '@nestjs/common';
import { MetricsController, MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';

/** Global so any module can read monitoring state; the cross-cutting pieces (metrics, tracing, error tracking) are plain singletons and need no import. */
@Global()
@Module({
  controllers: [MonitoringController, MetricsController],
  providers: [MonitoringService],
  exports: [MonitoringService],
})
export class MonitoringModule {}

import { Global, Module } from '@nestjs/common';
import { TransformInterceptor } from './interceptors/transform.interceptor';
import { LoggingInterceptor } from './interceptors/logging.interceptor';
import { TimeoutInterceptor } from './interceptors/timeout.interceptor';
import { RequestIdMiddleware } from './middleware/request-id.middleware';
import { AuditLogService } from './services/audit-log.service';

@Global()
@Module({
  providers: [
    TransformInterceptor,
    LoggingInterceptor,
    TimeoutInterceptor,
    RequestIdMiddleware,
    AuditLogService,
  ],
  exports: [
    TransformInterceptor,
    LoggingInterceptor,
    TimeoutInterceptor,
    RequestIdMiddleware,
    AuditLogService,
  ],
})
export class CommonModule {}

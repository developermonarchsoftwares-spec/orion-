import { Global, Module } from '@nestjs/common';
import { TransformInterceptor } from './interceptors/transform.interceptor';
import { LoggingInterceptor } from './interceptors/logging.interceptor';
import { TimeoutInterceptor } from './interceptors/timeout.interceptor';
import { RequestIdMiddleware } from './middleware/request-id.middleware';

@Global()
@Module({
  providers: [
    TransformInterceptor,
    LoggingInterceptor,
    TimeoutInterceptor,
    RequestIdMiddleware,
  ],
  exports: [
    TransformInterceptor,
    LoggingInterceptor,
    TimeoutInterceptor,
    RequestIdMiddleware,
  ],
})
export class CommonModule {}

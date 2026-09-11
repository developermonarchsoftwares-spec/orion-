import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { IApiResponse, IPaginatedResponse } from '@orion/shared';

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, IApiResponse<T> | IPaginatedResponse<unknown>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<IApiResponse<T> | IPaginatedResponse<unknown>> {
    const httpContext = context.switchToHttp();
    const response = httpContext.getResponse();
    const statusCode = response.statusCode;

    return next.handle().pipe(
      map((data) => {
        // If already formatted, return as-is
        if (data && typeof data === 'object' && 'success' in data && 'data' in data) {
          return data;
        }

        // If paginated shape
        if (data && typeof data === 'object' && 'items' in data && 'pagination' in data) {
          return {
            success: true,
            statusCode,
            message: 'Success',
            data: data.items,
            pagination: data.pagination,
            timestamp: new Date().toISOString(),
          };
        }

        // If cursor shape
        if (data && typeof data === 'object' && 'items' in data && 'cursor' in data) {
          return {
            success: true,
            statusCode,
            message: 'Success',
            data: data.items,
            cursor: data.cursor,
            timestamp: new Date().toISOString(),
          };
        }

        return {
          success: true,
          statusCode,
          message: 'Success',
          data: data ?? null,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}

import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { REQUEST_ID_HEADER } from '../constants';
import { BusinessException } from '../errors/business.exception';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = request.headers[REQUEST_ID_HEADER] || request.headers['x-request-id'];

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error occurred';
    let errorCode = 'INTERNAL_SERVER_ERROR';
    let details: unknown = undefined;

    if (exception instanceof BusinessException) {
      status = exception.getStatus();
      message = exception.message;
      errorCode = exception.errorCode;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'object' && res !== null) {
        const resObj = res as Record<string, unknown>;
        message = (resObj.message as string) || exception.message;
        errorCode = (resObj.error as string) || (resObj.errorCode as string) || 'HTTP_ERROR';
        details = resObj.details || (Array.isArray(resObj.message) ? resObj.message : undefined);
      } else {
        message = String(res);
      }
    } else if (exception instanceof Error) {
      const isProd = process.env.NODE_ENV === 'production';
      message = isProd ? 'Internal server error occurred' : exception.message;
      this.logger.error(
        `Unhandled Error [${request.method} ${request.url}] (ReqID: ${requestId}): ${exception.message}`,
        exception.stack,
      );
    }

    // In production, ensure no unhandled 500 leaks raw system/database details
    if (status >= 500 && process.env.NODE_ENV === 'production') {
      message = 'An unexpected server error occurred. Please contact support.';
      details = undefined;
    }

    const errorResponse = {
      success: false,
      statusCode: status,
      errorCode,
      message,
      details,
      path: request.url,
      method: request.method,
      requestId: requestId || undefined,
      timestamp: new Date().toISOString(),
    };

    if (status >= 500) {
      this.logger.error(
        `[500 Server Error] ${request.method} ${request.url} - ${JSON.stringify(errorResponse)}`,
      );
    }

    response.status(status).json(errorResponse);
  }
}

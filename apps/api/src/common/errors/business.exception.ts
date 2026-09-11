import { HttpException, HttpStatus } from '@nestjs/common';

export class BusinessException extends HttpException {
  public readonly errorCode: string;
  public readonly details?: unknown;

  constructor(
    message: string,
    errorCode = 'BUSINESS_ERROR',
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    details?: unknown,
  ) {
    super(
      {
        message,
        errorCode,
        details,
        statusCode: status,
      },
      status,
    );
    this.errorCode = errorCode;
    this.details = details;
  }
}

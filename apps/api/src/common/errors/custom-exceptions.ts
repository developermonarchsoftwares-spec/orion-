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

export class ResourceNotFoundException extends BusinessException {
  constructor(resource: string, identifier?: string | number) {
    super(
      identifier
        ? `${resource} with identifier '${identifier}' was not found.`
        : `${resource} was not found.`,
      'RESOURCE_NOT_FOUND',
      HttpStatus.NOT_FOUND,
    );
  }
}

export class ResourceConflictException extends BusinessException {
  constructor(message: string, details?: unknown) {
    super(message, 'RESOURCE_CONFLICT', HttpStatus.CONFLICT, details);
  }
}

export class InsufficientCreditsException extends BusinessException {
  constructor(required: number, available: number) {
    super(
      `Insufficient credits. Required: ${required}, Available: ${available}.`,
      'INSUFFICIENT_CREDITS',
      HttpStatus.PAYMENT_REQUIRED,
      { required, available },
    );
  }
}

export class UnauthorizedAccessException extends BusinessException {
  constructor(message = 'Unauthorized access.') {
    super(message, 'UNAUTHORIZED', HttpStatus.UNAUTHORIZED);
  }
}

export class ForbiddenOperationException extends BusinessException {
  constructor(message = 'You do not have permission to perform this operation.') {
    super(message, 'FORBIDDEN', HttpStatus.FORBIDDEN);
  }
}

export class ValidationFailedException extends BusinessException {
  constructor(errors: unknown) {
    super('Validation failed for one or more input parameters.', 'VALIDATION_ERROR', HttpStatus.BAD_REQUEST, errors);
  }
}

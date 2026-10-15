import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  Optional,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { REQUEST_ID_HEADER } from '../constants';
import { BusinessException } from '../errors/business.exception';
import { captureException } from '../observability/error-tracker';
import { SecuritySignalService, SignalKind } from '../services/security-signal.service';

/** Errors raised by Express middleware (body-parser) carry their own 4xx status; they must not be reported as 500. */
const isClientHttpError = (e: unknown): boolean => {
  const st = (e as any)?.statusCode ?? (e as any)?.status;
  return e instanceof Error && Number.isInteger(st) && st >= 400 && st < 500 && !(e instanceof HttpException);
};

/**
 * Text of an unexpected error that is safe to write to a log or send to the error tracker. The database driver's own message for a
 * failed statement is "Failed query: <sql> params: <every bound value>", and the bound values are customer data (e-mail addresses,
 * names, notes, password hashes, one-time codes). Only what identifies the failure is kept: the server's error code, table,
 * column and constraint.
 */
export const safeErrorText = (e: Error): string => {
  if (!/^Failed query:/i.test(e.message)) return e.message;
  const c: any = (e as any).cause ?? e;
  const parts = [c?.code && `code=${c.code}`, c?.table && `table=${c.table}`, c?.column && `column=${c.column}`, c?.constraint && `constraint=${c.constraint}`].filter(Boolean);
  return `Database statement failed${parts.length ? ` (${parts.join(', ')})` : ''}${c?.message && c !== e ? `: ${String(c.message).split('\n')[0].slice(0, 160)}` : ''}`;
};

/**
 * Database conditions that mean "busy, try again", not "the server is broken": a lock that could not be taken in time (55P03), a
 * statement cancelled by its timeout (57014), a deadlock (40P01) or serialization failure (40001), and a connection the server closed
 * because it sat idle in a transaction (25P03) or was shut down for maintenance (57P01 / 57P03). The caller gets a 503 with Retry-After
 * (a client or load balancer can retry) instead of a 500, which says "bug" and is not retried.
 */
const TRANSIENT_DB_CODES = new Set(['55P03', '57014', '40P01', '40001', '25P03', '57P01', '57P02', '57P03', '53300', '53400']);
/** Connection-level failures carry no SQLSTATE of their own (a refused or reset socket, a pool that could not get a connection in time). */
const CONNECTION_TEXT = /not currently accepting connections|Connection terminated|timeout exceeded when trying to connect|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE|database system is (starting up|shutting down|in recovery mode)|remaining connection slots|too many (clients|connections)/i;
export const transientDbCode = (e: unknown): string | undefined => {
  const err = e as any;
  const code = err?.cause?.code ?? err?.code;
  if (typeof code === 'string' && (TRANSIENT_DB_CODES.has(code) || /^08/.test(code))) return code;
  if (typeof code === 'string' && /^E(CONNREFUSED|CONNRESET|TIMEDOUT|PIPE)$/.test(code)) return code;
  const text = `${err?.message ?? ''} ${err?.cause?.message ?? ''}`;
  return CONNECTION_TEXT.test(text) ? 'CONNECTION' : undefined;
};

const devLike = () => process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(@Optional() private readonly signals?: SecuritySignalService) {}

  /** Which abuse signal, if any, a refusal counts towards (Phase 13). One place, so no endpoint can forget to report. */
  private signalFor(status: number, errorCode: string, path: string): SignalKind | null {
    if (errorCode === 'INVALID_CREDENTIALS' || errorCode === 'INVALID_MFA_CODE' || errorCode === 'INVALID_MFA_TOKEN') return 'AUTH_FAILURE';
    if (errorCode === 'UNSAFE_TARGET_URL') return 'SSRF_REJECTED';
    if (errorCode === 'EXPORT_DAILY_LIMIT' || errorCode === 'EXPORT_IN_PROGRESS') return 'EXPORT_REFUSED';
    if (status === HttpStatus.TOO_MANY_REQUESTS) return 'RATE_LIMITED';
    if (status === HttpStatus.FORBIDDEN) return 'AUTHZ_DENIED';
    if (status === HttpStatus.UNAUTHORIZED) return 'UNAUTHENTICATED';
    if (status >= 400 && status < 500 && path.includes('/unlock')) return 'UNLOCK_REFUSED';
    if (status === HttpStatus.NOT_FOUND && /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(path)) return 'OBJECT_PROBING';
    return null;
  }

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
        // a plain-string response (the rate limiter's, for one) carries no error code and, for the limiter, a class name as its text
        errorCode = 'HTTP_ERROR';
      }
      if (status === HttpStatus.TOO_MANY_REQUESTS) {
        errorCode = 'RATE_LIMITED';
        message = 'Too many requests. Please wait a moment and try again.';
      }
      // the JSON parser's own wording quotes the start of the client's input and names the engine's internals: say it plainly instead
      if (status === HttpStatus.BAD_REQUEST && typeof message === 'string' && /valid JSON|JSON at position|Unexpected (token|end of JSON)/i.test(message)) {
        errorCode = 'BAD_REQUEST';
        message = 'The request body is not valid JSON';
      }
    } else if (isClientHttpError(exception)) {
      // body-parser / http-errors (e.g. 413 body too large, 400 malformed JSON): a client error, not a server fault
      status = (exception as any).statusCode ?? (exception as any).status;
      message = status === 413 ? 'The request body is too large' : status === 415 ? 'Unsupported content type' : 'The request could not be read';
      errorCode = status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST';
    } else if (exception instanceof Error && transientDbCode(exception)) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      errorCode = 'DATABASE_BUSY';
      message = 'The service is busy right now. Please try again in a moment.';
      response.setHeader('Retry-After', '2');
      this.logger.warn(`Database busy [${request.method} ${request.url.split('?')[0]}] (ReqID: ${requestId}): ${transientDbCode(exception)}`);
    } else if (exception instanceof Error) {
      // Raw error text (SQL, paths, internals) is shown only in explicit development / test runs. Anything else, including an
      // unset NODE_ENV, gets the generic message, so a misconfigured deployment cannot leak internals to customers.
      message = devLike() ? exception.message : 'Internal server error occurred';
      // the query string is left out of the log (it can hold search text or identifiers), and so are a failed statement's bound values
      this.logger.error(
        `Unhandled Error [${request.method} ${request.url.split('?')[0]}] (ReqID: ${requestId}): ${safeErrorText(exception)}`,
        exception.stack?.replace(exception.message, safeErrorText(exception)),
      );
    }

    // Bugs and failed upstreams go to the error tracker; expected refusals do not: client errors (4xx), and a service that is deliberately
    // unavailable (503, e.g. "payments not configured") would only be noise. Headers and the body are scrubbed / left out by the tracker.
    if (status >= 500 && !(exception instanceof HttpException && status === HttpStatus.SERVICE_UNAVAILABLE)) {
      captureException(exception instanceof Error && safeErrorText(exception) !== exception.message ? Object.assign(new Error(safeErrorText(exception)), { stack: exception.stack?.replace(exception.message, safeErrorText(exception)) }) : exception, {
        source: 'http',
        level: exception instanceof HttpException || errorCode === 'DATABASE_BUSY' ? 'warning' : 'error',
        request: { method: request.method, url: request.originalUrl || request.url, headers: request.headers as Record<string, unknown> },
        userId: (request as any).user?.sub,
        tags: { status: String(status), errorCode },
      });
    }

    // Count refusals towards the abuse tripwires (never affects the response; one audit entry only when a threshold is crossed)
    if (this.signals && status >= 400 && status < 500) {
      const kind = this.signalFor(status, errorCode, String(request.path ?? request.url ?? ''));
      if (kind) this.signals.hit(kind, { userId: (request as any).user?.sub ?? null, ip: request.ip ?? null });
    }

    // In production, ensure no unhandled 500 leaks raw system/database details
    if (status >= 500 && !devLike() && errorCode !== 'DATABASE_BUSY') {
      message = 'An unexpected server error occurred. Please contact support.';
      details = undefined;
    }

    const errorResponse = {
      success: false,
      statusCode: status,
      errorCode,
      message,
      details,
      path: request.url.split('?')[0], // never echo the query string (it can hold search text or ids)
      method: request.method,
      requestId: requestId || undefined,
      timestamp: new Date().toISOString(),
    };

    if (status >= 500) {
      this.logger.error(
        `[500 Server Error] ${request.method} ${request.url.split('?')[0]} - ${JSON.stringify(errorResponse)}`,
      );
    }

    response.status(status).json(errorResponse);
  }
}

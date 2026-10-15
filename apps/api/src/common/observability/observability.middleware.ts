import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { REQUEST_ID_HEADER } from '../constants';
import { httpDuration, httpInFlight, httpRequests } from './metrics';
import { requestStats } from './rolling-stats';
import { scrubUrl } from './scrub';
import { currentContext, formatTraceparent, tracer } from './tracing';

const NOISY = /^\/?(?:api\/v1\/)?(health|metrics|monitoring\/overview)(\/|$)/i;

export const slowRequestMs = () => {
  const n = parseInt(process.env.SLOW_REQUEST_MS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 1000;
};

/** Written to the trace context so every log line and error report made while handling the request carries the user's id. */
export function bindUser(userId: string | undefined) {
  const c = currentContext();
  if (c && userId) c.userId = userId;
}

/**
 * Per request: continue (or start) the trace and run the request inside it, answer with `traceparent` / `x-trace-id` headers, and when the
 * response has been sent record the metrics, the rolling statistics, the server span and one structured access-log entry (a warning
 * for a slow request, an error for a 5xx). Runs for every route, including the ones refused by the protection middleware.
 */
@Injectable()
export class ObservabilityMiddleware implements NestMiddleware {
  private readonly log = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const started = process.hrtime.bigint();
    const { ctx, span } = tracer.startRequest(req.headers, `${req.method} ${(req.originalUrl || req.url || '').split('?')[0]}`);
    ctx.requestId = (req.headers[REQUEST_ID_HEADER] as string) || undefined;
    res.setHeader('traceparent', formatTraceparent(ctx.traceId, span.spanId, ctx.sampled));
    res.setHeader('x-trace-id', ctx.traceId);
    httpInFlight.inc();

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      httpInFlight.dec();
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      const status = res.statusCode;
      // the matched route pattern (`/api/v1/exports/:id/download`), never the raw URL: bounded label values, no ids or tokens in metrics
      const route = (req as any).route?.path ? `${req.baseUrl || ''}${(req as any).route.path}` : 'unmatched';
      const method = req.method;
      httpRequests.inc({ method, route, status_class: `${Math.floor(status / 100)}xx` });
      httpDuration.observe({ method, route }, durationMs / 1000);
      requestStats.record(`${method} ${route}`, status, durationMs);

      span.name = `${method} ${route}`;
      const userId = ctx.userId ?? (req as any).user?.sub;
      tracer.endSpan(span, status >= 500 ? `HTTP ${status}` : undefined, { 'http.method': method, 'http.route': route, 'http.status_code': status, ...(userId ? { 'enduser.id': String(userId) } : {}) });

      if (process.env.NODE_ENV === 'test' && process.env.ACCESS_LOG !== 'true') return;
      const path = scrubUrl(req.originalUrl || req.url).path;
      const slow = durationMs >= slowRequestMs();
      const entry = {
        event: 'http_request',
        method,
        route,
        path,
        status,
        durationMs: Math.round(durationMs),
        bytes: Number(res.getHeader('content-length')) || undefined,
        ip: req.ip,
        ...(slow ? { slow: true } : {}),
        message: `${method} ${route} ${status} ${Math.round(durationMs)}ms`,
      };
      if (status >= 500) this.log.error(entry);
      else if (slow) this.log.warn(entry);
      else if (NOISY.test(path)) this.log.debug(entry);
      else this.log.log(entry);
    };
    res.on('finish', finish);
    res.on('close', finish);

    tracer.run(ctx, () => next());
  }
}

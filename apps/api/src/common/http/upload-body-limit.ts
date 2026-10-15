import type { INestApplication } from '@nestjs/common';
import { json, NextFunction, Request, Response } from 'express';

/**
 * Body limit of the admin upload routes only (rows as JSON, or one CSV file as text) (Phase 6.13). The upload accepts at most 5 000 rows and 10 million characters of
 * cell and column text (see services/upload-validation.ts); as JSON, with quotes, separators and multi-byte characters, that needs
 * well above Express's default 100 kB, so these two routes get 20 MB. Every other route keeps the default limit: the global JSON
 * limit is NOT raised. The parser is mounted before the framework's default one, which skips a request that is already parsed.
 *
 * The body is read before the auth guard runs, so the large limit is offered only to requests that carry a Bearer token; anything
 * else falls through to the default limit. (A token is only checked later by the guard, so this narrows, not removes, exposure.)
 */
export const UPLOAD_BODY_LIMIT = '20mb';
export const UPLOAD_ROUTES = ['submit', 'preview', 'csv/submit', 'csv/preview'] as const;

export function applyUploadBodyLimit(app: INestApplication, apiPrefix: string): void {
  const base = `/${(apiPrefix || '').replace(/^\/+|\/+$/g, '')}/admin/import`.replace(/^\/\//, '/');
  const large = json({ limit: UPLOAD_BODY_LIMIT });
  const guarded = (req: Request, res: Response, next: NextFunction) => {
    const hasToken = /^Bearer\s+\S+/i.test(String(req.headers.authorization ?? ''));
    return req.method === 'POST' && hasToken ? large(req, res, next) : next();
  };
  for (const route of UPLOAD_ROUTES) app.use(`${base}/${route}`, guarded);
  // Phase 8A: the People export import takes one file as text (at most 10,000 rows, the keyed-run limit), so it gets the same
  // route-scoped, token-gated limit. No other route is affected.
  app.use(`/${(apiPrefix || '').replace(/^\/+|\/+$/g, '')}/admin/people/import`.replace(/^\/\//, '/'), guarded);
}

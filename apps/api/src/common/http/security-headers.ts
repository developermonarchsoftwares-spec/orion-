import { createHash } from 'crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import helmet from 'helmet';

/** The API is JSON; it needs none of these browser capabilities, so none is granted. */
export const API_PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()';

/**
 * Content-Security-Policy for the API (Phase 14). The API answers JSON, so by default it may load, run and embed NOTHING: a JSON response
 * that is ever rendered as a page (a content-type confusion, an error page) can run no script and fetch no resource. The previous
 * policy allowed scripts from any https origin and inline script; that is gone.
 */
export const API_CSP = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** The interactive API explorer (never mounted in production unless SWAGGER_ENABLED=true) needs its own inline script and styles. */
export const SWAGGER_CSP =
  "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: validator.swagger.io; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'";

const sha256 = (s: string) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;

/**
 * Policy for one of the few HTML pages the API itself serves (the monitoring dashboard, the invoice view). Scripts are allowed by the hash of
 * each inline `<script>` body, so only that exact code runs and a script injected into the page would not; inline styles stay allowed (the
 * pages style elements with attributes), which cannot execute code. No external resource of any kind is allowed, and the page can only
 * talk to its own origin.
 */
export function htmlPageCsp(html: string): string {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((m) => sha256(m[1]));
  return [
    "default-src 'none'",
    `script-src ${scripts.length ? scripts.join(' ') : "'none'"}`,
    "style-src 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * Headers Helmet does not set (Helmet's own CSP is switched off in main.ts so there is exactly one source for this header). Mounted next to Helmet.
 *  - Content-Security-Policy: strict by default, relaxed only for the API explorer path outside production; an HTML route replaces it with
 *    `htmlPageCsp(...)` for its own page.
 *  - Permissions-Policy: denies powerful browser features to anything this API serves (e.g. the monitoring dashboard page).
 *  - Cache-Control: no-store on any request that carries credentials, so a shared proxy or a browser cache never keeps one customer's
 *    wallet, exports or profile for another. Public, credential-free responses (package list, search) keep their normal caching.
 *    A route that sets its own Cache-Control is left alone.
 */
export function apiSecurityHeaders(req: Request, res: Response, next: NextFunction): void {
  const path = String(req.path ?? req.url ?? '');
  const explorer = process.env.NODE_ENV !== 'production' || process.env.SWAGGER_ENABLED === 'true';
  res.setHeader('Content-Security-Policy', explorer && /^\/docs(-json|-yaml|\/|$)/.test(path) ? SWAGGER_CSP : API_CSP);
  res.setHeader('Permissions-Policy', API_PERMISSIONS_POLICY);
  if (req.headers.authorization && !res.getHeader('Cache-Control')) res.setHeader('Cache-Control', 'no-store');
  next();
}

/**
 * Helmet options for the API. The Content-Security-Policy is deliberately OFF here: apiSecurityHeaders sets it, so the header has exactly one
 * source. HSTS is sent only in production, for one year, without includeSubDomains or preload (both are hard to undo and need every subdomain
 * of the deployment domain to be HTTPS-only).
 */
export function apiHelmetOptions(production = process.env.NODE_ENV === 'production') {
  return {
    crossOriginEmbedderPolicy: false,
    frameguard: { action: 'deny' as const },
    contentSecurityPolicy: false as const,
    strictTransportSecurity: production ? { maxAge: 31_536_000, includeSubDomains: false, preload: false } : (false as const),
  };
}

/** The middleware chain main.ts mounts (and the tests exercise): Helmet, then the headers Helmet does not set. */
export function securityMiddleware(production = process.env.NODE_ENV === 'production'): RequestHandler[] {
  return [helmet(apiHelmetOptions(production)) as RequestHandler, apiSecurityHeaders as RequestHandler];
}

/** CORS options: exact origins only, credentials allowed only because the origin list is explicit. */
export function apiCorsOptions(origins: string[]) {
  return {
    origin: origins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id', 'x-refresh-token', 'x-api-key'],
  };
}

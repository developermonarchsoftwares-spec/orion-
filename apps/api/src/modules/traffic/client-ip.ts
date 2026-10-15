import type { Request } from 'express';
import { normalizeIp, parseIp } from './cidr.util';

/**
 * The address a request is attributed to, for limits, rules, blocks and sign-in lockout (one definition, used everywhere).
 *
 * By default it is `req.ip`, which behind a reverse proxy is the client address from X-Forwarded-For (see `trust proxy` in main.ts).
 * When every customer reaches the API through one or a few servers (for example a web gateway that forwards requests), `req.ip` is that
 * server, and address limits would treat all customers as a single client. Set TRAFFIC_TRUSTED_IP_HEADER to the header that proxy sets
 * to the real client address (for example `x-real-ip` or `cf-connecting-ip`) and it is used instead.
 *
 * Only set it when the API is reachable ONLY through that proxy: anyone who can reach the API directly could otherwise put any address in
 * the header. An unusable value falls back to `req.ip`.
 */
export function clientIpOf(req: Pick<Request, 'ip' | 'headers' | 'socket'>): string {
  const name = (process.env.TRAFFIC_TRUSTED_IP_HEADER ?? '').trim().toLowerCase();
  if (name) {
    const raw = req.headers?.[name];
    const first = String(Array.isArray(raw) ? raw[0] : (raw ?? ''))
      .split(',')[0]
      .trim();
    if (first && parseIp(first)) return normalizeIp(first);
  }
  return normalizeIp(req.ip || req.socket?.remoteAddress) || 'unknown';
}

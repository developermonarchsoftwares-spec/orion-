import { HttpStatus, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { BusinessException } from '../../common/errors/business.exception';
import { clientIpOf } from './client-ip';
import { CaptchaService } from './captcha.service';
import { trafficConfig } from './traffic.config';
import { TrafficLimitsService } from './traffic-limits.service';
import { bindUser } from '../../common/observability/observability.middleware';
import { TrafficStateService } from './traffic-state.service';

/** Command-line scanners and exploit tools. Ordinary HTTP libraries (curl, python-requests, axios) are NOT here: integrations use them. */
const ATTACK_TOOL_UA = /(sqlmap|nikto|nmap|masscan|zgrab|gobuster|dirbuster|\bdirb\b|wfuzz|\bffuf\b|acunetix|nessus|openvas|havij|w3af|metasploit|\bhydra\b|nuclei|whatweb|wpscan|burpcollaborator)/i;
/** Paths only a scanner asks for on this API. A hit is answered with an ordinary 404 and counted as abuse. */
const PROBE_PATH = /(\.(env|git|svn|hg|htaccess|htpasswd|ds_store|bak|sql|old|swp|pem|key)(\/|$|\.)|(^|\/)(wp-admin|wp-login|wp-content|wp-includes|xmlrpc\.php|phpmyadmin|pma|cgi-bin|actuator|\.aws|id_rsa|etc\/passwd|boot\.ini)(\/|$|\.)|\.\.[\/\\]|%2e%2e|%00)/i;
const HONEYPOT_ROUTES = new Set(['auth/register', 'auth/login', 'auth/forgot-password', 'auth/reset-password']);
const CAPTCHA_ALWAYS = new Set(['auth/register', 'auth/forgot-password']);
const RATE_EXEMPT = [/^health(\/|$)/, /^payments\/webhook$/];
const ADMIN_PATH = /(^|\/)admin(\/|$)/;

const prefixOf = () => `/${(process.env.API_PREFIX || '/api/v1').replace(/^\/+|\/+$/g, '')}`;

/**
 * Pre-controller protection, in this order: address deny rules, admin-route address allow-list, active blocks, bot and scanner
 * detection, address burst / hourly limits, user blocks and plan-based limits (the verified user is attached by the authentication
 * middleware that runs just before this one), honeypot, and CAPTCHA. Anything refused answers with a JSON error that has a stable
 * `errorCode`, and, where waiting helps, a Retry-After header. Disabled as a whole by TRAFFIC_CONTROL_ENABLED=false.
 */
@Injectable()
export class TrafficMiddleware implements NestMiddleware {
  constructor(
    private readonly state: TrafficStateService,
    private readonly limits: TrafficLimitsService,
    private readonly captcha: CaptchaService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    try {
      await this.handle(req, res);
      next();
    } catch (err) {
      next(err);
    }
  }

  private retry(res: Response, seconds: number) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil(seconds))));
  }

  private async handle(req: Request, res: Response) {
    bindUser((req as any).user?.sub); // before anything can refuse the request, so even a 429 is attributed in logs and traces
    const cfg = trafficConfig();
    if (!cfg.enabled) return;
    await this.state.ensureFresh();

    const ip = clientIpOf(req);
    const prefix = prefixOf();
    const full = (req.originalUrl || req.url || '').split('?')[0];
    const route = (full.toLowerCase().startsWith(prefix) ? full.slice(prefix.length) : full).replace(/^\/+|\/+$/g, '').toLowerCase();
    const method = req.method.toUpperCase();

    // ---- address rules ----
    const verdict = this.state.ipVerdict(ip);
    if (verdict.denied) {
      this.limits.note('denied');
      throw new BusinessException('Access from your address is not allowed', 'IP_BLOCKED', HttpStatus.FORBIDDEN);
    }
    if ((ADMIN_PATH.test(route) || (route.startsWith('traffic/') && route !== 'traffic/my-limits')) && !this.state.adminIpAllowed(ip)) {
      this.limits.note('denied');
      throw new BusinessException('The admin area is not available from your address', 'ADMIN_IP_RESTRICTED', HttpStatus.FORBIDDEN);
    }
    if (method === 'OPTIONS') return; // CORS preflight carries no data and no credentials
    const trusted = verdict.trusted;
    const exempt = trusted || RATE_EXEMPT.some((r) => r.test(route));

    // ---- active blocks ----
    // A block never applies to the health probes or the payment webhook: both carry no customer data (the webhook is signature-checked), and
    // when many clients share one address (a proxy, a NAT, the platform's own probe) a block caused by one of them would otherwise take the
    // whole service out of rotation, or drop payment notifications. Measured in Phase 31: an automatically blocked address got HTTP 429 on
    // every health probe.
    if (!trusted && !RATE_EXEMPT.some((r) => r.test(route))) {
      const b = this.state.activeBlock('IP', ip);
      if (b) {
        this.limits.note('blockedRequests');
        this.retry(res, (b.expiresAt.getTime() - Date.now()) / 1000);
        throw new BusinessException('Too many suspicious requests from your address. Please try again later.', 'TEMPORARILY_BLOCKED', HttpStatus.TOO_MANY_REQUESTS, { retryAfterSeconds: Math.max(1, Math.ceil((b.expiresAt.getTime() - Date.now()) / 1000)) });
      }
    }

    // ---- bots and scanners ----
    if (!trusted) {
      const ua = String(req.headers['user-agent'] ?? '');
      if (ATTACK_TOOL_UA.test(ua) || cfg.extraBlockedUserAgents.some((r) => r.test(ua))) {
        this.limits.note('botBlocked');
        await this.strike(ip, 5, 'attack-tool user agent');
        throw new BusinessException('Automated access is not allowed', 'BOT_BLOCKED', HttpStatus.FORBIDDEN);
      }
      if ((req.originalUrl || req.url || '').length > cfg.maxUrlLength) {
        await this.strike(ip, 2, 'oversized URL');
        throw new BusinessException('The request URL is too long', 'URL_TOO_LONG', HttpStatus.URI_TOO_LONG);
      }
      if (PROBE_PATH.test(req.originalUrl || req.url || '')) {
        this.limits.note('scannerProbes');
        await this.strike(ip, 3, 'scanner probe');
        throw new BusinessException('Not found', 'NOT_FOUND', HttpStatus.NOT_FOUND); // an ordinary 404: do not help the scanner
      }
    }

    // ---- address rate limits ----
    if (!exempt) {
      const r = this.limits.checkIp(ip);
      if (!r.ok) {
        await this.strike(ip, 1, `rate limit exceeded (${r.limit})`);
        this.retry(res, r.retryAfterSeconds);
        throw new BusinessException('Too many requests. Please slow down.', 'RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS, { limit: r.limit, retryAfterSeconds: r.retryAfterSeconds });
      }
      // a client that keeps asking for things that do not exist is probing
      res.on('finish', () => {
        if (res.statusCode === 404 && !this.limits.notFound.hit(ip, cfg.abuse.notFoundPerMinute).allowed) void this.strike(ip, 2, 'excessive 404 responses');
      });
    }

    // ---- the signed-in user ----
    const user = (req as any).user as { sub?: string; role?: string } | undefined;
    if (user?.sub && !trusted) {
      const ub = this.state.activeBlock('USER', user.sub);
      if (ub) {
        this.limits.note('blockedRequests');
        this.retry(res, (ub.expiresAt.getTime() - Date.now()) / 1000);
        throw new BusinessException('Your account is temporarily restricted. Please try again later.', 'TEMPORARILY_BLOCKED', HttpStatus.TOO_MANY_REQUESTS, { retryAfterSeconds: Math.max(1, Math.ceil((ub.expiresAt.getTime() - Date.now()) / 1000)) });
      }
      const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
      if (!exempt && !isAdmin) await this.userLimits(user.sub, ip, res);
    }

    // ---- honeypot and CAPTCHA (sign-up / sign-in / reset forms) ----
    if (method === 'POST' && !trusted) {
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (HONEYPOT_ROUTES.has(route) && typeof body.website === 'string' && body.website.trim() !== '') {
        this.limits.note('honeypot');
        await this.strike(ip, 5, 'honeypot field filled');
        throw new BusinessException('The request could not be processed', 'INVALID_REQUEST', HttpStatus.BAD_REQUEST);
      }
      if (this.captcha.enabled()) {
        const email = typeof body.email === 'string' ? body.email : undefined;
        const needed = CAPTCHA_ALWAYS.has(route) || (route === 'auth/login' && this.limits.recentLoginFailures(email, ip) >= cfg.login.captchaAfterFailures);
        if (needed) {
          const res2 = await this.captcha.verify(req.headers['x-captcha-token'] as string | undefined, ip);
          if (!res2.ok) {
            this.limits.note('captchaFailed');
            if (res2.reason === 'invalid') await this.strike(ip, 1, 'failed CAPTCHA');
            throw new BusinessException(res2.reason === 'missing' ? 'Please complete the human check' : res2.reason === 'unavailable' ? 'The human check is unavailable. Please try again shortly.' : 'The human check failed. Please try again.', res2.reason === 'missing' ? 'CAPTCHA_REQUIRED' : 'CAPTCHA_FAILED', res2.reason === 'unavailable' ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.FORBIDDEN, { provider: this.captcha.providerName() });
          }
        }
      }
    }
  }

  private async userLimits(userId: string, ip: string, res: Response) {
    const limits = await this.limits.limitsFor(userId);
    const r = this.limits.checkUser(userId, limits);
    if (r.minute) {
      // the IETF draft names (not X-RateLimit-*, which the coarse global throttler already writes for the address-level limit)
      res.setHeader('RateLimit-Limit', String(r.minute.limit));
      res.setHeader('RateLimit-Remaining', String(r.minute.remaining));
      res.setHeader('RateLimit-Reset', String(r.minute.retryAfterSeconds));
    }
    if (!r.ok) {
      await this.strikeUser(userId, r.limit as string);
      this.retry(res, r.retryAfterSeconds ?? 1);
      throw new BusinessException(r.limit === 'user_day' ? 'Your daily request allowance is used up.' : 'Too many requests. Please slow down.', 'RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS, { limit: r.limit, retryAfterSeconds: r.retryAfterSeconds, plan: limits.tier });
    }
    // requests in flight at once: expensive endpoints must not be fired in parallel without end
    if (!this.limits.acquire(userId, limits.maxConcurrent)) {
      this.retry(res, 1);
      throw new BusinessException('Too many requests are already in progress.', 'RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS, { limit: 'concurrency', retryAfterSeconds: 1 });
    }
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        this.limits.release(userId);
      }
    };
    res.on('finish', release);
    res.on('close', release);
  }

  private async strike(ip: string, points: number, reason: string) {
    const blocked = await this.state.strike('IP', ip, points, reason);
    if (blocked) this.limits.note('autoBlocks');
  }

  private async strikeUser(userId: string, limit: string) {
    // only a burst or minute overrun counts as abuse; running through a daily allowance is just heavy use
    if (limit === 'user_day') return;
    const blocked = await this.state.strike('USER', userId, 1, `rate limit exceeded (${limit})`);
    if (blocked) this.limits.note('autoBlocks');
  }
}

import { HttpStatus, Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import { BusinessException } from '../../common/errors/business.exception';
import { normalizeIp } from './cidr.util';
import { trafficConfig } from './traffic.config';
import { TrafficStateService } from './traffic-state.service';
import { IHitResult, WindowCounter } from './window-counter';

export type LimitName = 'ip_burst' | 'ip_hour' | 'user_burst' | 'user_minute' | 'user_day' | 'concurrency';

export interface IUserLimits {
  perMinute: number;
  perDay: number;
  burstPerSecond: number;
  maxConcurrent: number;
  tier: string;
  source: 'plan' | 'override';
}

export interface IUserCheck {
  ok: boolean;
  limit?: LimitName;
  retryAfterSeconds?: number;
  /** The per-minute window, for the X-RateLimit-* response headers. */
  minute?: IHitResult;
}

/**
 * Request counting and limits (per process) plus login-failure tracking. Counters are in memory: with several API instances the
 * effective limit is the configured limit times the number of instances. Blocks, which are shared through the database, are the
 * cross-instance protection (see TrafficStateService).
 */
@Injectable()
export class TrafficLimitsService implements OnModuleInit, OnModuleDestroy {
  private readonly ipBurst = new WindowCounter(1_000);
  private readonly ipHour = new WindowCounter(3_600_000);
  private readonly userBurst = new WindowCounter(1_000);
  private readonly userMinute = new WindowCounter(60_000);
  private readonly userDay = new WindowCounter(86_400_000);
  readonly notFound = new WindowCounter(60_000);
  private readonly accountFailures = new WindowCounter(trafficConfig().login.accountWindowMs);
  private readonly ipFailures = new WindowCounter(trafficConfig().login.accountWindowMs);
  private readonly inFlight = new Map<string, number>();
  private timer?: NodeJS.Timeout;

  /** Counts since this process started, for monitoring. */
  readonly stats = {
    since: new Date().toISOString(),
    limited: { ip_burst: 0, ip_hour: 0, user_burst: 0, user_minute: 0, user_day: 0, concurrency: 0 } as Record<LimitName, number>,
    denied: 0,
    blockedRequests: 0,
    botBlocked: 0,
    scannerProbes: 0,
    honeypot: 0,
    captchaFailed: 0,
    autoBlocks: 0,
    loginLockouts: 0,
  };
  private readonly offenders = new Map<string, number>();

  constructor(@Optional() private readonly state?: TrafficStateService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => this.prune(), 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private prune() {
    for (const c of [this.ipBurst, this.ipHour, this.userBurst, this.userMinute, this.userDay, this.notFound, this.accountFailures, this.ipFailures]) c.prune();
    if (this.offenders.size > 5000) this.offenders.clear();
  }

  note(kind: keyof Omit<typeof this.stats, 'since' | 'limited'>) {
    this.stats[kind]++;
  }

  private offend(key: string) {
    this.offenders.set(key, (this.offenders.get(key) ?? 0) + 1);
  }

  /** The most frequently limited addresses and users since start (for the admin overview). */
  topOffenders(n = 10) {
    return [...this.offenders.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([subject, limited]) => ({ subject, limited }));
  }

  // ---------------------------------------------------------------------------------------------------------------
  // IP-level limits: a short burst cap and an hourly cap (the global per-minute throttler stays in place beneath these)
  // ---------------------------------------------------------------------------------------------------------------

  checkIp(ip: string): { ok: true } | { ok: false; limit: LimitName; retryAfterSeconds: number } {
    const cfg = trafficConfig().ip;
    const burst = this.ipBurst.hit(ip, cfg.burstPerSecond);
    if (!burst.allowed) return this.refuse('ip_burst', ip, burst.retryAfterSeconds);
    const hour = this.ipHour.hit(ip, cfg.perHour);
    if (!hour.allowed) return this.refuse('ip_hour', ip, hour.retryAfterSeconds);
    return { ok: true };
  }

  private refuse(limit: LimitName, subject: string, retryAfterSeconds: number) {
    this.stats.limited[limit]++;
    this.offend(subject);
    return { ok: false as const, limit, retryAfterSeconds };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // User limits: plan-based per-minute and per-day allowance, a per-second burst cap, and a cap on requests in flight
  // ---------------------------------------------------------------------------------------------------------------

  async limitsFor(userId: string): Promise<IUserLimits> {
    const cfg = trafficConfig().user;
    const tier = (await this.state?.tierOf(userId)) ?? 'free';
    const mult = cfg.multipliers[tier] ?? 1;
    const ov = (await this.state?.overrideOf(userId)) ?? { perMinute: null, perDay: null };
    return {
      perMinute: ov.perMinute ?? cfg.perMinute * mult,
      perDay: ov.perDay ?? cfg.perDay * mult,
      burstPerSecond: cfg.burstPerSecond * Math.min(mult, 4),
      maxConcurrent: cfg.maxConcurrent,
      tier,
      source: ov.perMinute !== null || ov.perDay !== null ? 'override' : 'plan',
    };
  }

  checkUser(userId: string, limits: IUserLimits): IUserCheck {
    const burst = this.userBurst.hit(userId, limits.burstPerSecond);
    if (!burst.allowed) return this.refuse('user_burst', userId, burst.retryAfterSeconds);
    const minute = this.userMinute.hit(userId, limits.perMinute);
    if (!minute.allowed) return { ...this.refuse('user_minute', userId, minute.retryAfterSeconds), minute };
    const day = this.userDay.hit(userId, limits.perDay);
    if (!day.allowed) return { ...this.refuse('user_day', userId, day.retryAfterSeconds), minute };
    return { ok: true, minute };
  }

  /** Reserves one in-flight slot. Pair every `true` with a `release`. */
  acquire(userId: string, max: number): boolean {
    const n = this.inFlight.get(userId) ?? 0;
    if (n >= max) {
      this.stats.limited.concurrency++;
      this.offend(userId);
      return false;
    }
    this.inFlight.set(userId, n + 1);
    return true;
  }

  release(userId: string) {
    const n = (this.inFlight.get(userId) ?? 1) - 1;
    if (n <= 0) this.inFlight.delete(userId);
    else this.inFlight.set(userId, n);
  }

  async usage(userId: string) {
    const limits = await this.limitsFor(userId);
    return { limits, usedLastMinute: this.userMinute.peek(userId), usedLastDay: this.userDay.peek(userId), inFlight: this.inFlight.get(userId) ?? 0 };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Sign-in protection (credential stuffing): per-account lockout and per-address strikes
  // ---------------------------------------------------------------------------------------------------------------

  /** A one-way key: the e-mail is never stored in a block. The same key is used whether or not the account exists, so lockout reveals nothing. */
  accountKey(email: string): string {
    return createHash('sha256').update(`acct:${String(email).trim().toLowerCase()}`).digest('hex').slice(0, 32);
  }

  /** Throws 429 ACCOUNT_TEMPORARILY_LOCKED while a lock is active for this e-mail. */
  assertLoginAllowed(email: string) {
    if (!trafficConfig().enabled || !this.state) return;
    const b = this.state.activeBlock('ACCOUNT', this.accountKey(email));
    if (b) {
      const retry = Math.max(1, Math.ceil((b.expiresAt.getTime() - Date.now()) / 1000));
      throw new BusinessException('Too many failed sign-in attempts. Please try again later.', 'ACCOUNT_TEMPORARILY_LOCKED', HttpStatus.TOO_MANY_REQUESTS, { retryAfterSeconds: retry });
    }
  }

  async recordLoginFailure(email: string, rawIp?: string) {
    const cfg = trafficConfig();
    if (!cfg.enabled || !this.state) return;
    const ip = normalizeIp(rawIp) || 'unknown';
    const key = this.accountKey(email);
    const r = this.accountFailures.hit(key, cfg.login.accountFailures);
    this.ipFailures.hit(ip, 1_000_000);
    if (!r.allowed || r.remaining === 0) {
      this.accountFailures.reset(key);
      if (!this.state.activeBlock('ACCOUNT', key)) {
        this.stats.loginLockouts++;
        await this.state.createBlock({ type: 'ACCOUNT', subject: key, reason: `${cfg.login.accountFailures} failed sign-ins`, minutes: cfg.login.lockMinutes, source: 'AUTO' });
      }
    }
    // an address that keeps failing against many accounts is blocked by the strike engine
    if (!this.state.ipVerdict(ip).trusted) {
      const blocked = await this.state.strike('IP', ip, 1, 'repeated failed sign-ins');
      if (blocked) this.stats.autoBlocks++;
    }
  }

  recordLoginSuccess(email: string) {
    if (trafficConfig().enabled) this.accountFailures.reset(this.accountKey(email));
  }

  /** Recent failures for this account or address, used to decide when a CAPTCHA is required at sign-in. */
  recentLoginFailures(email: string | undefined, rawIp: string): number {
    const byAccount = email ? this.accountFailures.peek(this.accountKey(email)) : 0;
    return Math.max(byAccount, this.ipFailures.peek(normalizeIp(rawIp) || 'unknown'));
  }
}

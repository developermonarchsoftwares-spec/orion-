/**
 * Traffic-control settings, read from the environment on every call (cheap), so a test or an operator change takes effect without a
 * restart of the code path. Defaults are deliberately generous: they stop scripts and scrapers, not people using the product.
 */
export const TIERS = ['free', 'starter', 'growth', 'agency', 'enterprise'] as const;

export interface ITrafficConfig {
  /** Master switch. On everywhere except NODE_ENV=test, unless TRAFFIC_CONTROL_ENABLED says otherwise. */
  enabled: boolean;
  ip: { burstPerSecond: number; perHour: number };
  user: { perMinute: number; perDay: number; burstPerSecond: number; maxConcurrent: number; multipliers: Record<string, number> };
  abuse: { strikeThreshold: number; strikeWindowMs: number; blockMinutes: number[]; notFoundPerMinute: number };
  login: { accountFailures: number; accountWindowMs: number; lockMinutes: number; captchaAfterFailures: number };
  captcha: { provider: 'turnstile' | 'hcaptcha' | 'recaptcha' | null; secret: string; failOpen: boolean };
  extraBlockedUserAgents: RegExp[];
  maxUrlLength: number;
}

const int = (v: string | undefined, d: number, min = 1) => {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n >= min ? n : d;
};

export function trafficConfig(env: NodeJS.ProcessEnv = process.env): ITrafficConfig {
  const flag = (env.TRAFFIC_CONTROL_ENABLED ?? '').trim().toLowerCase();
  const enabled = flag ? ['1', 'true', 'yes'].includes(flag) : env.NODE_ENV !== 'test';
  const provider = (env.CAPTCHA_PROVIDER ?? '').trim().toLowerCase();
  const extra: RegExp[] = [];
  for (const p of String(env.BLOCKED_USER_AGENTS ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    try {
      extra.push(new RegExp(p, 'i'));
    } catch {
      /* an invalid pattern is ignored rather than breaking every request */
    }
  }
  return {
    enabled,
    ip: { burstPerSecond: int(env.RATE_LIMIT_IP_BURST_PER_SECOND, 25), perHour: int(env.RATE_LIMIT_IP_PER_HOUR, 3000) },
    user: {
      perMinute: int(env.RATE_LIMIT_USER_PER_MINUTE, 120),
      perDay: int(env.RATE_LIMIT_USER_PER_DAY, 5000),
      burstPerSecond: int(env.RATE_LIMIT_USER_BURST_PER_SECOND, 20),
      maxConcurrent: int(env.RATE_LIMIT_USER_MAX_CONCURRENT, 10),
      // a plan buys a proportionally larger allowance; override per user from the admin API
      multipliers: { free: 1, starter: 2, growth: 4, agency: 8, enterprise: 16 },
    },
    abuse: {
      strikeThreshold: int(env.ABUSE_STRIKE_THRESHOLD, 10),
      strikeWindowMs: int(env.ABUSE_STRIKE_WINDOW_SECONDS, 600) * 1000,
      // each repeat offence within 24 hours moves one step along this list
      blockMinutes: [5, 30, 120, 1440],
      notFoundPerMinute: int(env.ABUSE_404_PER_MINUTE, 30),
    },
    login: {
      accountFailures: int(env.LOGIN_LOCK_AFTER_FAILURES, 8),
      accountWindowMs: int(env.LOGIN_LOCK_WINDOW_MINUTES, 15) * 60_000,
      lockMinutes: int(env.LOGIN_LOCK_MINUTES, 15),
      captchaAfterFailures: int(env.LOGIN_CAPTCHA_AFTER_FAILURES, 3),
    },
    captcha: {
      provider: provider === 'turnstile' || provider === 'hcaptcha' || provider === 'recaptcha' ? provider : null,
      secret: (env.CAPTCHA_SECRET_KEY ?? '').trim(),
      failOpen: ['1', 'true', 'yes'].includes((env.CAPTCHA_FAIL_OPEN ?? '').trim().toLowerCase()),
    },
    extraBlockedUserAgents: extra,
    maxUrlLength: 4000,
  };
}

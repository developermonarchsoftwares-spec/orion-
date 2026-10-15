import { Injectable, Logger } from '@nestjs/common';
import { trafficConfig } from './traffic.config';

/** The three supported providers share one verification shape: POST form fields secret + response (+ remoteip), JSON answer with `success`. */
export const CAPTCHA_VERIFY_URLS = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  hcaptcha: 'https://api.hcaptcha.com/siteverify',
  recaptcha: 'https://www.google.com/recaptcha/api/siteverify',
} as const;

export interface ICaptchaResult {
  ok: boolean;
  /** `missing`, `invalid`, or `unavailable` (the provider could not be reached). */
  reason?: 'missing' | 'invalid' | 'unavailable';
}

/**
 * Human-verification at the points bots abuse: sign-up and password reset always, sign-in only after repeated failures. Active only when
 * CAPTCHA_PROVIDER (turnstile | hcaptcha | recaptcha) and CAPTCHA_SECRET_KEY are set; otherwise nothing is required. The browser obtains a
 * token from the provider's widget and sends it in the `X-Captcha-Token` header. Tokens are single-use at the provider.
 * If the provider cannot be reached, the request is refused unless CAPTCHA_FAIL_OPEN=true.
 *
 * Not verified against a live provider account here: the verification call follows each provider's documented siteverify API.
 */
@Injectable()
export class CaptchaService {
  private readonly logger = new Logger(CaptchaService.name);
  /** Replaceable in tests. */
  fetchImpl: typeof fetch = (...args) => fetch(...args);

  enabled(): boolean {
    const c = trafficConfig().captcha;
    return !!c.provider && !!c.secret;
  }

  providerName(): string | null {
    return this.enabled() ? trafficConfig().captcha.provider : null;
  }

  async verify(token: string | undefined, remoteIp: string): Promise<ICaptchaResult> {
    const cfg = trafficConfig().captcha;
    if (!cfg.provider || !cfg.secret) return { ok: true };
    const t = String(token ?? '').trim();
    if (!t || t.length > 4096) return { ok: false, reason: 'missing' };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await this.fetchImpl(CAPTCHA_VERIFY_URLS[cfg.provider], {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret: cfg.secret, response: t, remoteip: remoteIp }).toString(),
        signal: ctrl.signal,
        redirect: 'error',
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) return cfg.failOpen ? { ok: true } : { ok: false, reason: 'unavailable' };
      return json?.success === true ? { ok: true } : { ok: false, reason: 'invalid' };
    } catch (err) {
      this.logger.warn(`CAPTCHA provider unreachable: ${(err as Error).message}`);
      return cfg.failOpen ? { ok: true } : { ok: false, reason: 'unavailable' };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Browser-side helpers for the sign-up e-mail code screen. No Node APIs here: this file ships in the client bundle. Nothing in it decides
 * whether a code is valid; that is only ever decided by the server (`/auth/verify-otp`), whatever the browser holds.
 */

export const OTP_LENGTH = 6;

/** `a***e@g***l.com`. Display only. */
export function maskEmailForDisplay(email: string): string {
  const [local = '', domain = ''] = email.trim().split('@');
  const dot = domain.lastIndexOf('.');
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  const m = (s: string) => (s.length <= 1 ? `${s}***` : `${s[0]}***${s.length > 2 ? s[s.length - 1] : ''}`);
  return `${m(local)}@${m(host)}${tld}`;
}

/** Keeps digits only and at most six of them (typed, pasted with spaces or a dash, or autofilled). */
export function sanitizeOtpInput(raw: string): string {
  return String(raw ?? '').replace(/\D/g, '').slice(0, OTP_LENGTH);
}

export const isCompleteOtp = (value: string) => /^\d{6}$/.test(value);

export type OtpFailureKind = 'invalid' | 'expired' | 'locked' | 'cooldown' | 'limit' | 'delivery' | 'required' | 'network' | 'other';

export interface OtpFailure {
  kind: OtpFailureKind;
  message: string;
  attemptsRemaining?: number;
  retryAfterSeconds?: number;
}

/** Turns an error thrown by the API client into one of the screen's states, with wording that reveals nothing about accounts. */
export function describeOtpError(err: any): OtpFailure {
  const body = err?.details ?? {};
  const code: string | undefined = body?.errorCode ?? err?.code;
  const extra = body?.details ?? {};
  switch (code) {
    case 'OTP_INVALID':
      return { kind: 'invalid', message: typeof extra.attemptsRemaining === 'number' ? `That code is not correct. ${extra.attemptsRemaining} ${extra.attemptsRemaining === 1 ? 'try' : 'tries'} left.` : 'That code is not valid. Request a new one.', attemptsRemaining: extra.attemptsRemaining };
    case 'OTP_EXPIRED':
      return { kind: 'expired', message: 'This code has expired. Request a new one.' };
    case 'OTP_ATTEMPTS_EXCEEDED':
      return { kind: 'locked', message: 'Too many incorrect attempts. Request a new code.' };
    case 'OTP_RESEND_COOLDOWN':
      return { kind: 'cooldown', message: err?.message || 'Please wait before requesting another code.', retryAfterSeconds: Number(extra.retryAfterSeconds) || 60 };
    case 'OTP_DAILY_LIMIT':
    case 'OTP_RATE_LIMITED':
    case 'RATE_LIMITED':
      return { kind: 'limit', message: err?.message || 'Too many requests. Please try again later.' };
    case 'EMAIL_DELIVERY_FAILED':
      return { kind: 'delivery', message: 'We could not send the code right now. Please try again in a moment.' };
    case 'EMAIL_OTP_REQUIRED':
      return { kind: 'required', message: 'Your email verification expired. Please verify again.' };
    case 'INVALID_EMAIL':
      return { kind: 'other', message: 'Please enter a valid email address.' };
  }
  if (err?.statusCode === 429) return { kind: 'limit', message: err?.message || 'Too many requests. Please try again later.' };
  if (err instanceof TypeError || /failed to fetch|network/i.test(String(err?.message))) return { kind: 'network', message: 'Network problem. Check your connection and try again.' };
  return { kind: 'other', message: err?.message || 'Something went wrong. Please try again.' };
}

/** "Resend code in 42s" / "Resend code". */
export function resendLabel(secondsLeft: number): string {
  return secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : 'Resend code';
}

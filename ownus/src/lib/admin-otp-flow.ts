/**
 * Client-side rules for the administrator e-mail code (OTP) sign-in. The server decides everything that matters (the code is hashed,
 * valid for 5 minutes, locked after 5 wrong tries, and one e-mail per 45 seconds); this module only keeps the page from getting stuck:
 *  - the pending sign-in survives a refresh (sessionStorage, until the code expires), so a code that was already sent can still be entered;
 *  - "a code was just sent" (429 on send) moves to the code step instead of an error screen;
 *  - the resend button opens when the server would accept it.
 */
export const OTP_TTL_SECONDS = 300;
export const RESEND_AFTER_SECONDS = 45;
export const PENDING_KEY = 'orion_admin_otp_pending';

export interface IPendingOtp {
  email: string;
  /** epoch ms when the code stops being valid */
  expiresAt: number;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function savePending(storage: StorageLike | null, email: string, now = Date.now(), ttlSeconds = OTP_TTL_SECONDS): void {
  try {
    storage?.setItem(PENDING_KEY, JSON.stringify({ email: email.trim().toLowerCase(), expiresAt: now + ttlSeconds * 1000 } satisfies IPendingOtp));
  } catch {
    /* storage unavailable: the page just forgets on refresh */
  }
}

export function loadPending(storage: StorageLike | null, now = Date.now()): (IPendingOtp & { secondsLeft: number }) | null {
  try {
    const raw = storage?.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as IPendingOtp;
    if (typeof p?.email !== 'string' || typeof p?.expiresAt !== 'number') return null;
    const secondsLeft = Math.floor((p.expiresAt - now) / 1000);
    if (secondsLeft <= 0) {
      storage?.removeItem(PENDING_KEY);
      return null;
    }
    return { ...p, secondsLeft };
  } catch {
    return null;
  }
}

export function clearPending(storage: StorageLike | null): void {
  try {
    storage?.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

export type SendOutcome =
  | { kind: 'sent'; notice: string }
  | { kind: 'already-sent'; notice: string }
  | { kind: 'error'; error: string };

/** What the page does with the answer to "send me a code". */
export function interpretSendResponse(status: number, body: any): SendOutcome {
  const message = typeof body?.message === 'string' ? body.message : '';
  if (status >= 200 && status < 300 && body?.success !== false) {
    return { kind: 'sent', notice: 'If this address belongs to an active administrator account, a 6-digit code is on its way. Check your inbox and spam folder.' };
  }
  if (status === 429) {
    // the server refuses a second e-mail within RESEND_AFTER_SECONDS: the first code is still valid
    return { kind: 'already-sent', notice: 'A code was sent a moment ago. Enter that code below, or wait a few seconds and resend.' };
  }
  return { kind: 'error', error: message || 'Unable to send the verification code. Please try again.' };
}

export type VerifyFailure = 'locked' | 'wrong' | 'other';

/** Distinguishes a wrong code from a locked one so the page can offer a new code at once. */
export function interpretVerifyFailure(status: number, message?: string): { reason: VerifyFailure; error: string } {
  if (status === 429) return { reason: 'locked', error: 'Too many wrong attempts. Request a new code to continue.' };
  if (status === 400) return { reason: 'wrong', error: message || 'Invalid or expired verification code.' };
  return { reason: 'other', error: message || 'Could not verify the code. Please try again.' };
}

/** Seconds until "Resend code" opens, given how long ago the last code was sent. */
export function resendWaitSeconds(secondsSinceSent: number): number {
  return Math.max(0, RESEND_AFTER_SECONDS - Math.max(0, secondsSinceSent));
}

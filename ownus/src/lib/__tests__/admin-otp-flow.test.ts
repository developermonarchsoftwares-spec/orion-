import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  OTP_TTL_SECONDS,
  PENDING_KEY,
  RESEND_AFTER_SECONDS,
  clearPending,
  interpretSendResponse,
  interpretVerifyFailure,
  loadPending,
  resendWaitSeconds,
  savePending,
} from '../admin-otp-flow.ts';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), raw: m };
};

describe('pending admin sign-in survives a refresh', () => {
  it('returns the e-mail and the time left for a code that was just sent', () => {
    const s = memory();
    savePending(s, '  Admin@MonarchSoftwares.com ', 1_000_000);
    const p = loadPending(s, 1_000_000 + 100_000);
    assert.equal(p?.email, 'admin@monarchsoftwares.com');
    assert.equal(p?.secondsLeft, OTP_TTL_SECONDS - 100);
  });

  it('forgets a code once it has expired, and removes the stale entry', () => {
    const s = memory();
    savePending(s, 'a@monarchsoftwares.com', 0);
    assert.equal(loadPending(s, OTP_TTL_SECONDS * 1000 + 1), null);
    assert.equal(s.raw.has(PENDING_KEY), false);
  });

  it('ignores corrupted or foreign storage content and works without storage', () => {
    const s = memory();
    s.setItem(PENDING_KEY, '{not json');
    assert.equal(loadPending(s), null);
    s.setItem(PENDING_KEY, JSON.stringify({ email: 5, expiresAt: 'x' }));
    assert.equal(loadPending(s), null);
    assert.doesNotThrow(() => savePending(null, 'a@b.c'));
    assert.equal(loadPending(null), null);
    assert.doesNotThrow(() => clearPending(null));
  });

  it('clearPending forgets the sign-in', () => {
    const s = memory();
    savePending(s, 'a@monarchsoftwares.com');
    clearPending(s);
    assert.equal(loadPending(s), null);
  });
});

describe('what the page does with the answer to "send me a code"', () => {
  it('a success moves to the code step', () => {
    assert.equal(interpretSendResponse(200, { success: true }).kind, 'sent');
  });

  it('a 429 ("a code was just sent") moves to the code step instead of an error: the first code is still valid', () => {
    const o = interpretSendResponse(429, { success: false, message: 'A verification code was just sent. Please wait a moment before requesting another.' });
    assert.equal(o.kind, 'already-sent');
  });

  it('a 403, 503 or an unreadable answer is an error with a readable message', () => {
    const forbidden = interpretSendResponse(403, { message: 'Access Denied: Only @monarchsoftwares.com email addresses are authorized.' });
    assert.deepEqual(forbidden, { kind: 'error', error: 'Access Denied: Only @monarchsoftwares.com email addresses are authorized.' });
    const mailDown = interpretSendResponse(503, { message: 'Email delivery failed: domain not verified' });
    assert.equal(mailDown.kind === 'error' && mailDown.error, 'Email delivery failed: domain not verified');
    const blank = interpretSendResponse(500, {});
    assert.equal(blank.kind === 'error' && blank.error.length > 0, true);
  });

  it('a 200 whose body says success:false is not treated as sent', () => {
    assert.equal(interpretSendResponse(200, { success: false, message: 'nope' }).kind, 'error');
  });
});

describe('verify failures', () => {
  it('a locked code (429) offers a new one at once; a wrong code (400) just says so', () => {
    assert.equal(interpretVerifyFailure(429).reason, 'locked');
    assert.deepEqual(interpretVerifyFailure(400, 'Invalid or expired verification code.'), { reason: 'wrong', error: 'Invalid or expired verification code.' });
    assert.equal(interpretVerifyFailure(500).reason, 'other');
  });
});

describe('resend timing matches the server (one e-mail per 45 seconds)', () => {
  it('counts down and never goes negative', () => {
    assert.equal(resendWaitSeconds(0), RESEND_AFTER_SECONDS);
    assert.equal(resendWaitSeconds(30), RESEND_AFTER_SECONDS - 30);
    assert.equal(resendWaitSeconds(500), 0);
    assert.equal(resendWaitSeconds(-5), RESEND_AFTER_SECONDS);
  });
});

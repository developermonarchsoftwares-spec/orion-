import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeOtpError, isCompleteOtp, maskEmailForDisplay, resendLabel, sanitizeOtpInput } from '../otp-flow.ts';

describe('sign-up code screen helpers', () => {
  it('keeps digits only, at most six, whatever was pasted or typed', () => {
    assert.equal(sanitizeOtpInput('123 456'), '123456');
    assert.equal(sanitizeOtpInput('12-34-56'), '123456');
    assert.equal(sanitizeOtpInput('1234567890'), '123456');
    assert.equal(sanitizeOtpInput('abc'), '');
    assert.equal(sanitizeOtpInput(undefined as any), '');
    assert.equal(isCompleteOtp('123456'), true);
    assert.equal(isCompleteOtp('12345'), false);
    assert.equal(isCompleteOtp('12345a'), false);
  });

  it('masks the address for display', () => {
    assert.equal(maskEmailForDisplay('ada@example.com'), 'a***a@e***e.com');
    assert.ok(!maskEmailForDisplay('someone.long@company.co.in').includes('someone'));
  });

  it('turns each server answer into a distinct screen state, with no account hints', () => {
    const e = (errorCode: string, extra: any = {}, statusCode = 400) => ({ statusCode, message: 'm', details: { errorCode, details: extra } });
    const wrong = describeOtpError(e('OTP_INVALID', { attemptsRemaining: 3 }));
    assert.equal(wrong.kind, 'invalid');
    assert.match(wrong.message, /3 tries left/);
    assert.match(describeOtpError(e('OTP_INVALID', { attemptsRemaining: 1 })).message, /1 try left/);
    assert.equal(describeOtpError(e('OTP_INVALID')).kind, 'invalid');
    assert.equal(describeOtpError(e('OTP_EXPIRED')).kind, 'expired');
    assert.equal(describeOtpError(e('OTP_ATTEMPTS_EXCEEDED', {}, 429)).kind, 'locked');
    const cooldown = describeOtpError(e('OTP_RESEND_COOLDOWN', { retryAfterSeconds: 42 }, 429));
    assert.equal(cooldown.kind, 'cooldown');
    assert.equal(cooldown.retryAfterSeconds, 42);
    assert.equal(describeOtpError(e('OTP_DAILY_LIMIT', {}, 429)).kind, 'limit');
    assert.equal(describeOtpError(e('EMAIL_DELIVERY_FAILED', {}, 503)).kind, 'delivery');
    assert.equal(describeOtpError(e('EMAIL_OTP_REQUIRED', {}, 403)).kind, 'required');
    assert.equal(describeOtpError({ statusCode: 429, message: 'slow down' }).kind, 'limit');
    assert.equal(describeOtpError(new TypeError('Failed to fetch')).kind, 'network');
    assert.equal(describeOtpError(new Error('boom')).kind, 'other');
  });

  it('the resend label counts down and then offers the action', () => {
    assert.equal(resendLabel(42), 'Resend code in 42s');
    assert.equal(resendLabel(0), 'Resend code');
  });
});

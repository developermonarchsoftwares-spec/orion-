import * as crypto from 'crypto';

/**
 * S-21: admin OTP at-rest protection.
 *
 * Admin one-time codes are never persisted in clear text. Only an HMAC-SHA256 of the code is stored in
 * `admin_otps.otp`, keyed by a secret derived from JWT_ACCESS_SECRET (or an explicit ADMIN_OTP_SECRET), and
 * submitted codes are compared in constant time. A leaked `admin_otps` row therefore cannot be replayed as a
 * login code. This mirrors the gateway's OTP handling (ownus/src/app/api/v1/[...path]/route.ts) so the Vercel
 * and self-hosted deployment paths behave identically.
 */
export function adminOtpSecret(env: NodeJS.ProcessEnv = process.env): string {
  const base = (env.ADMIN_OTP_SECRET || env.JWT_ACCESS_SECRET || '').trim();
  // Purpose-bind the derived key so an OTP hash can never be reused as any other HMAC in the system.
  return crypto.createHmac('sha256', base || 'orion-admin-otp').update('orion:admin-otp').digest('hex');
}

/** HMAC-SHA256 of `${email}:${otp}`, returned as lowercase hex. Deterministic for a given secret. */
export function hashOtp(email: string, otp: string, env: NodeJS.ProcessEnv = process.env): string {
  return crypto
    .createHmac('sha256', adminOtpSecret(env))
    .update(`${email.toLowerCase().trim()}:${String(otp).trim()}`)
    .digest('hex');
}

/** Constant-time comparison of two hex strings; never throws. */
export function timingSafeHexEqual(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(String(a), 'utf8');
    const bb = Buffer.from(String(b), 'utf8');
    return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

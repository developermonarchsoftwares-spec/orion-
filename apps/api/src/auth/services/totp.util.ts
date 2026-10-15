import * as crypto from 'crypto';

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s step), the profile every authenticator app supports. */
const STEP_SECONDS = 30;
const DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function totpCode(secretBase32: string, atMs = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / STEP_SECONDS);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', base32Decode(secretBase32)).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Returns the TOTP counter (30 s step number) the code matches, or null. Accepts the current step and one step either
 * side (clock drift). Constant-time comparison. The caller stores the matched step to refuse a replay of the same code.
 */
export function findTotpStep(secretBase32: string, code: string, atMs = Date.now(), window = 1): number | null {
  const submitted = Buffer.from(String(code).replace(/\s+/g, ''));
  let matched: number | null = null;
  const current = Math.floor(atMs / 1000 / STEP_SECONDS);
  for (let w = -window; w <= window; w++) {
    const expected = Buffer.from(totpCode(secretBase32, atMs + w * STEP_SECONDS * 1000));
    if (expected.length === submitted.length && crypto.timingSafeEqual(expected, submitted)) matched = current + w;
  }
  return matched;
}

export function verifyTotp(secretBase32: string, code: string, atMs = Date.now(), window = 1): boolean {
  return findTotpStep(secretBase32, code, atMs, window) !== null;
}

export function otpauthUrl(secretBase32: string, accountEmail: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

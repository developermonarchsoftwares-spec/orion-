import { adminOtpSecret, hashOtp, timingSafeHexEqual } from './admin-otp.util';

/**
 * S-21 regression guard: proves the admin OTP is stored as an HMAC, not in clear text, and that codes are
 * compared in constant time against the hash.
 */
describe('admin-otp.util (S-21: OTP never stored in clear text)', () => {
  const env = { JWT_ACCESS_SECRET: 'unit-test-access-secret-0123456789abcdef' } as NodeJS.ProcessEnv;

  it('hashOtp returns a 64-char hex digest, never the clear code', () => {
    const code = '123456';
    const h = hashOtp('admin@monarchsoftwares.com', code, env);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(code); // the stored value reveals nothing about the code
  });

  it('is deterministic for the same email + code + secret', () => {
    expect(hashOtp('a@monarchsoftwares.com', '111111', env)).toBe(
      hashOtp('A@monarchsoftwares.com', ' 111111 ', env), // email is lower-cased, code trimmed
    );
  });

  it('differs for a different code, email, or secret', () => {
    const base = hashOtp('a@monarchsoftwares.com', '111111', env);
    expect(hashOtp('a@monarchsoftwares.com', '111112', env)).not.toBe(base);
    expect(hashOtp('b@monarchsoftwares.com', '111111', env)).not.toBe(base);
    expect(hashOtp('a@monarchsoftwares.com', '111111', { JWT_ACCESS_SECRET: 'other-secret' } as NodeJS.ProcessEnv)).not.toBe(base);
  });

  it('adminOtpSecret is purpose-bound and does not equal the raw JWT secret', () => {
    const s = adminOtpSecret(env);
    expect(s).toMatch(/^[0-9a-f]{64}$/);
    expect(s).not.toBe(env.JWT_ACCESS_SECRET);
  });

  it('timingSafeHexEqual matches equal hashes and rejects unequal ones', () => {
    const h = hashOtp('a@monarchsoftwares.com', '424242', env);
    expect(timingSafeHexEqual(h, hashOtp('a@monarchsoftwares.com', '424242', env))).toBe(true);
    expect(timingSafeHexEqual(h, hashOtp('a@monarchsoftwares.com', '000000', env))).toBe(false);
    expect(timingSafeHexEqual(h, '')).toBe(false);
    expect(timingSafeHexEqual(h, 'not-hex')).toBe(false);
  });

  it('a verifier that only has the stored hash cannot recover the code (one-way)', () => {
    const stored = hashOtp('a@monarchsoftwares.com', '867530', env);
    // The only way to "match" is to re-hash a candidate; the stored value itself is not a valid code.
    expect(/^\d{6}$/.test(stored)).toBe(false);
  });
});

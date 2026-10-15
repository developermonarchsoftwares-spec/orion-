import {
  generateOtp,
  hashClientAddress,
  hashEmailOtp,
  hashProof,
  maskEmail,
  newProof,
  normalizeEmail,
  normalizeOtp,
  parseProof,
  registrationOtpRequired,
  safeEqualHex,
} from '../email-otp.util';

const ENV = { JWT_ACCESS_SECRET: 'known-answer-secret-not-a-real-one' } as NodeJS.ProcessEnv;

describe('sign-up e-mail code helpers', () => {
  it('known-answer vectors: the API and the web gateway must produce these exact values (the gateway test pins the same ones)', () => {
    expect(hashEmailOtp('user@example.com', 'REGISTER', '123456', ENV)).toBe('a5693aa3b1e342b78ee6eb108b4c207795554197d8d6971904e6fcd2bfb49d1d');
    expect(hashProof('proof-secret-value')).toBe('2920973f72027b062d6768a08d153feb4cf549e6047001751ba1dbc9cb394781');
    expect(hashClientAddress('203.0.113.7', ENV)).toBe('f13739026d3df149673d91213d001e88');
  });

  it('a hash is bound to the address, the purpose and the secret', () => {
    const base = hashEmailOtp('a@x.com', 'REGISTER', '111111', ENV);
    expect(hashEmailOtp('b@x.com', 'REGISTER', '111111', ENV)).not.toBe(base);
    expect(hashEmailOtp('a@x.com', 'LOGIN', '111111', ENV)).not.toBe(base);
    expect(hashEmailOtp('a@x.com', 'REGISTER', '111112', ENV)).not.toBe(base);
    expect(hashEmailOtp('a@x.com', 'REGISTER', '111111', { JWT_ACCESS_SECRET: 'another-secret' } as any)).not.toBe(base);
    expect(hashEmailOtp('a@x.com', 'REGISTER', '111111', { ...ENV, EMAIL_OTP_SECRET: 'dedicated' } as any)).not.toBe(base);
  });

  it('codes are six digits, zero-padded, and spread over the whole range', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 4000; i++) {
      const c = generateOtp();
      expect(c).toMatch(/^\d{6}$/);
      seen.add(c);
    }
    expect(seen.size).toBeGreaterThan(3900); // 4000 draws from 1,000,000: collisions are rare, a stuck generator would show
    const leadingZero = [...seen].some((c) => c.startsWith('0'));
    expect(leadingZero).toBe(true);
  });

  it('normalises addresses and refuses malformed ones', () => {
    expect(normalizeEmail('  Ada.Lovelace@Example.COM ')).toBe('ada.lovelace@example.com');
    for (const bad of ['', 'a@b', 'a b@x.com', 'a@@x.com', 'x'.repeat(250) + '@x.com', null, undefined, 5, {}]) expect(normalizeEmail(bad as any)).toBeNull();
  });

  it('accepts a pasted code with spaces or a dash and nothing else', () => {
    expect(normalizeOtp('123 456')).toBe('123456');
    expect(normalizeOtp('123-456')).toBe('123456');
    expect(normalizeOtp(123456)).toBe('123456');
    for (const bad of ['12345', '1234567', 'abcdef', '12 34 5a', '', null, undefined, {}]) expect(normalizeOtp(bad as any)).toBeNull();
  });

  it('proofs: a token round-trips to the stored hash, and malformed or oversized tokens are refused', () => {
    const id = '11111111-2222-4333-8444-555555555555';
    const p = newProof(id);
    expect(parseProof(p.token)).toEqual({ id, hash: p.hash });
    expect(newProof(id).token).not.toBe(p.token);
    for (const bad of [undefined, '', 'nodot', `${id}.short`, `not-a-uuid.${'A'.repeat(43)}`, `${id}.${'A'.repeat(300)}`, `${id}.${'!'.repeat(43)}`]) expect(parseProof(bad as any)).toBeNull();
  });

  it('compares hashes in constant time and never throws', () => {
    expect(safeEqualHex('ab', 'ab')).toBe(true);
    expect(safeEqualHex('ab', 'ac')).toBe(false);
    expect(safeEqualHex('ab', 'abc')).toBe(false);
    expect(safeEqualHex(undefined as any, null as any)).toBe(false);
  });

  it('masks an address for display without revealing it', () => {
    expect(maskEmail('ada@example.com')).toBe('a***a@e***e.com');
    expect(maskEmail('a@b.io')).toBe('a***@b***.io');
    expect(maskEmail('someone.long@company.co.in')).not.toContain('someone');
  });

  it('PRODUCTION cannot switch the requirement off; elsewhere only an explicit false does', () => {
    expect(registrationOtpRequired({ NODE_ENV: 'production', REQUIRE_REGISTRATION_OTP: 'false' } as any)).toBe(true);
    expect(registrationOtpRequired({ NODE_ENV: 'production', REQUIRE_REGISTRATION_OTP: '0' } as any)).toBe(true);
    expect(registrationOtpRequired({ NODE_ENV: 'production' } as any)).toBe(true);
    expect(registrationOtpRequired({ NODE_ENV: 'development' } as any)).toBe(true);
    expect(registrationOtpRequired({} as any)).toBe(true);
    expect(registrationOtpRequired({ NODE_ENV: 'development', REQUIRE_REGISTRATION_OTP: 'false' } as any)).toBe(false);
    expect(registrationOtpRequired({ NODE_ENV: 'test', REQUIRE_REGISTRATION_OTP: 'no' } as any)).toBe(false);
  });
});

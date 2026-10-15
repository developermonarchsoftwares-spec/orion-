import { isPersonalKey, isSecretKey, redactDeep, redactHeaders, REDACTED, REDACTED_PERSONAL } from '../redact';
import { StructuredLogger } from '../structured-logger';

/** Synthetic values only (reserved example domains, invented tokens). */
const JWT = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJ0ZXN0LXVzZXIifQ', 'c2lnbmF0dXJlLXRlc3Q'].join('.');

describe('structured redaction (Phase 13)', () => {
  describe('keys are judged by meaning, not by an exact list', () => {
    it.each([
      'password', 'newPassword', 'currentPassword', 'passwordHash', 'password_hash', 'refresh_token', 'refreshToken', 'accessToken', 'x-api-key', 'apiKey',
      'API_KEY', 'clientSecret', 'client_secret', 'stripeWebhookSecret', 'webhook_secret', 'Authorization', 'cookie', 'set-cookie', 'sessionCookie', 'otp',
      'otpCode', 'mfaToken', 'twoFactorSecret', 'recoveryCode', 'privateKey', 'encryptionKey', 'signingKey', 'x-razorpay-signature', 'signature', 'cvv',
      'cardNumber', 'pan', 'aadhaar', 'databaseUrl', 'connectionString', 'captchaToken', 'jwt', 'bearerToken', 'sealedSecret',
    ])('treats %s as a secret', (k) => {
      expect(isSecretKey(k)).toBe(true);
    });

    it.each(['company', 'companyName', 'panel', 'expansion', 'requestId', 'traceId', 'sessionId', 'familyId', 'expiresAt', 'author', 'status', 'dataset', 'rowCount', 'userId', 'ipAddress'])(
      'does not treat %s as a secret',
      (k) => {
        expect(isSecretKey(k)).toBe(false);
      },
    );

    it.each(['email', 'workEmail', 'contact_email', 'phone', 'phoneNumber', 'mobile', 'linkedinUrl', 'addressLine1', 'fullName', 'firstName', 'displayName'])('treats %s as personal', (k) => {
      expect(isPersonalKey(k)).toBe(true);
    });

    it.each(['isEmailVerified', 'emailKind', 'hasEmail', 'ipAddress', 'emailDigest', 'dataset', 'role'])('does not treat %s as personal', (k) => {
      expect(isPersonalKey(k)).toBe(false);
    });
  });

  describe('redactDeep', () => {
    it('hides secrets and personal data in nested objects and arrays, keeps the diagnostic fields', () => {
      const out = redactDeep({
        event: 'login',
        status: 401,
        attempts: 3,
        ok: false,
        request: { headers: { authorization: 'Bearer abcdefghijklmnop', 'x-request-id': 'req-1' }, body: { email: 'jane.test@example.com', password: 'Sup3rSecret!', otpAttempts: 2 } },
        users: [{ id: 'u1', refreshToken: 'rt-0123456789', profile: { phone: '+91 9000000001', company: 'Acme Ltd' } }],
        mfaRequired: true,
      }) as any;
      expect(out.event).toBe('login');
      expect(out.status).toBe(401);
      expect(out.attempts).toBe(3);
      expect(out.ok).toBe(false);
      expect(out.request.headers.authorization).toBe(REDACTED);
      expect(out.request.headers['x-request-id']).toBe('req-1');
      expect(out.request.body.email).toBe(REDACTED_PERSONAL);
      expect(out.request.body.password).toBe(REDACTED);
      expect(out.request.body.otpAttempts).toBe(2); // a count under a secret-looking key is kept
      expect(out.users[0].id).toBe('u1');
      expect(out.users[0].refreshToken).toBe(REDACTED);
      expect(out.users[0].profile.phone).toBe(REDACTED_PERSONAL);
      expect(out.users[0].profile.company).toBe('Acme Ltd');
      expect(out.mfaRequired).toBe(true);
      const json = JSON.stringify(out);
      for (const raw of ['jane.test@example.com', 'Sup3rSecret!', 'abcdefghijklmnop', 'rt-0123456789', '9000000001']) expect(json).not.toContain(raw);
    });

    it('scrubs secrets that sit in values under harmless keys', () => {
      const out = redactDeep({
        note: `failed with ${JWT} for jane.test@example.com`,
        detail: 'connect postgresql://orion:hunter2@db.example.com:5432/orion failed',
        text: 'Authorization: Bearer abcdefghijklmnop',
        list: ['token=abcd1234efgh', 'card 4111111111111111'],
      }) as any;
      const json = JSON.stringify(out);
      for (const raw of [JWT, 'jane.test@example.com', 'hunter2', 'abcdefghijklmnop', 'abcd1234efgh', '4111111111111111']) expect(json).not.toContain(raw);
      expect(out.detail).toContain('[connection-string]');
    });

    it('handles cycles, binary data, errors, dates, bigint and odd values without throwing', () => {
      const a: any = { name: 'a' };
      a.self = a;
      const out = redactDeep({ a, buf: Buffer.from('secret-bytes'), err: new Error('boom user jane.test@example.com'), when: new Date('2026-10-12T00:00:00Z'), big: BigInt(5), fn: () => 1, nan: Number.NaN }) as any;
      expect(out.a.self).toBe('[circular]');
      expect(out.buf).toMatch(/^\[binary \d+ bytes\]$/);
      expect(out.err.message).not.toContain('jane.test@example.com');
      expect(out.when).toBe('2026-10-12T00:00:00.000Z');
      expect(out.big).toBe('5');
      expect(out.fn).toBe('[unsupported]');
      expect(out.nan).toBe('NaN');
    });

    it('bounds depth, key count, array length and string length', () => {
      let deep: any = { v: 'leaf' };
      for (let i = 0; i < 20; i++) deep = { n: deep };
      expect(JSON.stringify(redactDeep(deep))).toContain('[truncated]');
      const many: Record<string, number> = {};
      for (let i = 0; i < 200; i++) many[`k${i}`] = i;
      expect(Object.keys(redactDeep(many) as object).length).toBeLessThanOrEqual(61);
      expect((redactDeep(Array.from({ length: 500 }, (_, i) => i)) as unknown[]).length).toBe(51);
      expect(String(redactDeep('x'.repeat(5000))).length).toBeLessThan(600);
    });

    it('keeps plain identifier values (a timestamp inside a request id is not a card number) but still scrubs an identifier that carries an address', () => {
      const out = redactDeep({ requestId: 'rid-1791778721967-login', traceId: '0123456789abcdef0123456789abcdef', entityId: 'jane.test@example.com', note: 'rid-1791778721967' }) as any;
      expect(out.requestId).toBe('rid-1791778721967-login');
      expect(out.traceId).toBe('0123456789abcdef0123456789abcdef');
      expect(out.entityId).toBe('[email]');
      expect(out.note).toBe('rid-[number]'); // outside an identifier key, long digit runs are still hidden
    });

    it('does not change the object it is given', () => {
      const input = { password: 'p', nested: { email: 'a@b.co' } };
      redactDeep(input);
      expect(input).toEqual({ password: 'p', nested: { email: 'a@b.co' } });
    });

    it('keeps null and empty values as they are', () => {
      expect(redactDeep({ password: null, email: '', token: undefined })).toEqual({ password: null, email: '' });
    });
  });

  describe('redactHeaders', () => {
    it('drops credential headers by meaning and client-address headers, scrubs the rest', () => {
      const h = redactHeaders({ Authorization: 'Bearer abcdefghijklmnop', Cookie: 'sid=1', 'X-Api-Key': 'k', 'X-Webhook-Signature': 'sig', 'X-Forwarded-For': '203.0.113.9', 'User-Agent': 'jest', 'X-Request-Id': 'r-1', Referer: 'https://x.example/?token=abcd1234efgh' });
      expect(Object.keys(h).sort()).toEqual(['referer', 'user-agent', 'x-request-id']);
      expect(JSON.stringify(h)).not.toContain('abcd1234efgh');
    });
  });

  describe('structured logger', () => {
    const capture = () => {
      const lines: string[] = [];
      const logger = new StructuredLogger({ format: 'json', level: 'debug', sink: (l) => void lines.push(l) });
      return { lines, logger };
    };

    it('redacts secrets inside NESTED fields of a logged object (they used to pass through)', () => {
      const { lines, logger } = capture();
      logger.log({ event: 'webhook_failed', request: { headers: { authorization: 'Bearer abcdefghijklmnop' }, body: { password: 'Sup3rSecret!', email: 'jane.test@example.com' } }, count: 2 }, 'Test');
      const line = JSON.parse(lines[0]);
      expect(line.event).toBe('webhook_failed');
      expect(line.count).toBe(2);
      expect(line.request.body.password).toBe(REDACTED);
      for (const raw of ['abcdefghijklmnop', 'Sup3rSecret!', 'jane.test@example.com']) expect(lines[0]).not.toContain(raw);
    });

    it('still scrubs the message, the stack and string fields', () => {
      const { lines, logger } = capture();
      logger.error(`failed for jane.test@example.com with ${JWT}`, 'Error: x\n    at foo (bar.ts:1:1)', 'Test');
      expect(lines[0]).not.toContain('jane.test@example.com');
      expect(lines[0]).not.toContain(JWT);
    });
  });
});

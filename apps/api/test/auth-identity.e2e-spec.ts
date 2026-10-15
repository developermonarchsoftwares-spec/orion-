import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import { INestApplication } from '@nestjs/common';
import { TestAppHelper } from './helpers/test-app.helper';
import { MailService, IMail } from '../src/auth/mail/mail.service';
import { totpCode } from '../src/auth/services/totp.util';
import { AuthService } from '../src/auth/services/auth.service';
import * as schema from '../src/database/schema';
import { eq } from 'drizzle-orm';
import { ThrottlerStorage } from '@nestjs/throttler';

describe('Authentication & identity: reset, verification, MFA, sessions, refresh lifecycle', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  const sent: IMail[] = [];
  const email = 'identity.tester@orion-test.io';
  const password = 'SecurePassword123!';
  const api = () => request(app.getHttpServer());
  const tokenFromMail = (subject: string) => {
    const m = [...sent].reverse().find((x) => x.subject === subject);
    const t = m && /token=([^\s]+)/.exec(m.text);
    return t ? decodeURIComponent(t[1]) : undefined;
  };
  const unwrap = (res: any) => res.body.data || res.body;
  const login = (pw = password) => api().post('/api/v1/auth/login').send({ email, password: pw });

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();
    app.get(MailService).transport = { send: async (m) => void sent.push(m) };
    await testApp.cleanupUsers([email]);
    const reg = await api().post('/api/v1/auth/register').send({ email, password, firstName: 'Id', lastName: 'Tester' });
    expect(reg.status).toBe(201);
  });

  // The per-route @Throttle limits (login 10/min, reset 5/min, ...) are production values and are not raised by
  // THROTTLE_LIMIT; this spec makes many calls, so the in-memory counters are cleared between tests.
  beforeEach(() => {
    (app.get(ThrottlerStorage) as any).storage.clear();
  });

  afterAll(async () => {
    await testApp.cleanupUsers([email]);
    await testApp.close();
  });

  describe('forgot / reset password', () => {
    it('answers identically for unknown and known e-mail, and never returns the token', async () => {
      const known = await api().post('/api/v1/auth/forgot-password').send({ email });
      const unknown = await api().post('/api/v1/auth/forgot-password').send({ email: 'nobody@orion-test.io' });
      expect(known.status).toBe(200);
      expect(unknown.status).toBe(200);
      expect(JSON.stringify(unwrap(known))).toBe(JSON.stringify(unwrap(unknown)));
      expect(JSON.stringify(known.body)).not.toMatch(/token/i);
      expect(sent.filter((m) => m.to === 'nobody@orion-test.io')).toHaveLength(0);
      expect(tokenFromMail('Reset your password')).toBeDefined();
    });

    it('resets once, rejects reuse, and signs out every existing session', async () => {
      const before = unwrap(await login());
      const token = tokenFromMail('Reset your password')!;
      const newPassword = 'BrandNewPassword456!';

      expect((await api().post('/api/v1/auth/reset-password').send({ token, newPassword })).status).toBe(200);
      expect((await api().post('/api/v1/auth/reset-password').send({ token, newPassword: 'AnotherOne789!' })).status).toBe(400);

      expect((await api().post('/api/v1/auth/refresh').send({ refreshToken: before.tokens.refreshToken })).status).toBe(401);
      expect((await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${before.tokens.accessToken}`)).status).toBe(401);
      expect((await login()).status).toBe(401);
      expect((await login(newPassword)).status).toBe(200);
      expect(sent.some((m) => m.subject === 'Your password was changed')).toBe(true);
    });

    it('a newer reset link replaces the older one', async () => {
      await api().post('/api/v1/auth/forgot-password').send({ email });
      const first = tokenFromMail('Reset your password')!;
      await api().post('/api/v1/auth/forgot-password').send({ email });
      const second = tokenFromMail('Reset your password')!;
      expect(first).not.toBe(second);
      expect((await api().post('/api/v1/auth/reset-password').send({ token: first, newPassword: 'Whatever12345!' })).status).toBe(400);
      expect((await api().post('/api/v1/auth/reset-password').send({ token: second, newPassword: password })).status).toBe(200);
    });

    it('rejects a garbage token and an access token', async () => {
      const access = unwrap(await login()).tokens.accessToken;
      expect((await api().post('/api/v1/auth/reset-password').send({ token: 'garbage', newPassword: 'Whatever12345!' })).status).toBe(400);
      expect((await api().post('/api/v1/auth/reset-password').send({ token: access, newPassword: 'Whatever12345!' })).status).toBe(400);
    });
  });

  describe('email verification', () => {
    const vEmail = 'identity.verify@orion-test.io';
    beforeAll(async () => {
      await testApp.cleanupUsers([vEmail]);
      process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
    });
    afterAll(async () => {
      delete process.env.REQUIRE_EMAIL_VERIFICATION;
      await testApp.cleanupUsers([vEmail]);
    });

    it('requires verification when enabled, resends, and verifies once', async () => {
      const reg = await api().post('/api/v1/auth/register').send({ email: vEmail, password, firstName: 'V', lastName: 'T' });
      expect(reg.status).toBe(201);
      expect(unwrap(reg).user.isEmailVerified).toBe(false);
      expect(tokenFromMail('Verify your e-mail address')).toBeDefined();

      const blocked = await api().post('/api/v1/auth/login').send({ email: vEmail, password });
      expect(blocked.status).toBe(403);
      expect(JSON.stringify(blocked.body)).toContain('EMAIL_NOT_VERIFIED');

      sent.length = 0;
      await api().post('/api/v1/auth/resend-verification').send({ email: vEmail });
      const token = tokenFromMail('Verify your e-mail address')!;
      expect(token).toBeDefined();

      expect((await api().post('/api/v1/auth/verify-email').send({ token })).status).toBe(200);
      expect((await api().post('/api/v1/auth/verify-email').send({ token })).status).toBe(400);
      expect((await api().post('/api/v1/auth/login').send({ email: vEmail, password })).status).toBe(200);
    });

    it('resend answers the same for unknown accounts and sends nothing', async () => {
      sent.length = 0;
      const r = await api().post('/api/v1/auth/resend-verification').send({ email: 'ghost@orion-test.io' });
      expect(r.status).toBe(200);
      expect(sent).toHaveLength(0);
    });
  });

  describe('MFA (TOTP) and recovery codes', () => {
    let bearer: string;
    let secret: string;
    let recovery: string[];
    // Each accepted code must be a later 30 s step than the last (replay guard), so the clock is advanced per code.
    let skew = 0;
    const realNow = Date.now.bind(Date);
    const nextCode = () => {
      skew += 30_000;
      return totpCode(secret, realNow() + skew);
    };

    beforeAll(() => {
      jest.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
    });
    afterAll(() => jest.restoreAllMocks());

    it('enrols: setup -> wrong code refused -> enable returns recovery codes', async () => {
      bearer = `Bearer ${unwrap(await login()).tokens.accessToken}`;
      const setup = unwrap(await api().post('/api/v1/auth/mfa/setup').set('Authorization', bearer));
      secret = setup.secret;
      expect(setup.otpauthUrl).toContain('otpauth://totp/');

      expect((await api().post('/api/v1/auth/mfa/enable').set('Authorization', bearer).send({ code: '000000' })).status).toBe(401);

      const ok = await api().post('/api/v1/auth/mfa/enable').set('Authorization', bearer).send({ code: nextCode() });
      expect(ok.status).toBe(200);
      recovery = unwrap(ok).recoveryCodes;
      expect(recovery).toHaveLength(10);

      // the seed is stored sealed, never in the clear
      const row = (await testApp.db.select().from(schema.users).where(eq(schema.users.email, email)))[0];
      expect(row.twoFactorEnabled).toBe(true);
      expect(row.twoFactorSecret).not.toContain(secret);
    });

    it('login now returns a challenge instead of tokens', async () => {
      const res = await login();
      expect(res.status).toBe(200);
      expect(unwrap(res).mfaRequired).toBe(true);
      expect(unwrap(res).tokens).toBeUndefined();
    });

    it('completes with a TOTP code; the same code cannot be replayed', async () => {
      const code = nextCode();
      const ok = await api().post('/api/v1/auth/mfa/login').send({ mfaToken: unwrap(await login()).mfaToken, code });
      expect(ok.status).toBe(200);
      expect(unwrap(ok).tokens.accessToken).toBeDefined();

      const mfaToken = unwrap(await login()).mfaToken;
      expect((await api().post('/api/v1/auth/mfa/login').send({ mfaToken, code })).status).toBe(401);
      expect((await api().post('/api/v1/auth/mfa/login').send({ mfaToken, code: '123456' })).status).toBe(401);
    });

    it('rejects a bad mfaToken and an access token in its place', async () => {
      expect((await api().post('/api/v1/auth/mfa/login').send({ mfaToken: 'not-a-token', code: '123456' })).status).toBe(401);
      const access = bearer.slice(7);
      expect((await api().post('/api/v1/auth/mfa/login').send({ mfaToken: access, code: nextCode() })).status).toBe(401);
    });

    it('account recovery: a recovery code works exactly once', async () => {
      const code = recovery[0];
      const first = await api().post('/api/v1/auth/mfa/login').send({ mfaToken: unwrap(await login()).mfaToken, recoveryCode: code });
      expect(first.status).toBe(200);
      const second = await api().post('/api/v1/auth/mfa/login').send({ mfaToken: unwrap(await login()).mfaToken, recoveryCode: code });
      expect(second.status).toBe(401);
      expect(sent.some((m) => m.subject === 'A recovery code was used to sign in')).toBe(true);
    });

    it('regenerating recovery codes invalidates the old set', async () => {
      const access = unwrap(await api().post('/api/v1/auth/mfa/login').send({ mfaToken: unwrap(await login()).mfaToken, recoveryCode: recovery[1] })).tokens.accessToken;
      const regen = await api().post('/api/v1/auth/mfa/recovery-codes').set('Authorization', `Bearer ${access}`).send({ code: nextCode() });
      expect(regen.status).toBe(200);
      expect(unwrap(regen).recoveryCodes).toHaveLength(10);
      const old = await api().post('/api/v1/auth/mfa/login').send({ mfaToken: unwrap(await login()).mfaToken, recoveryCode: recovery[2] });
      expect(old.status).toBe(401);
    });

    it('disabling MFA needs the password and a code, then login is single-step again', async () => {
      const access = unwrap(await api().post('/api/v1/auth/mfa/login').send({ mfaToken: unwrap(await login()).mfaToken, code: nextCode() })).tokens.accessToken;
      const auth = { Authorization: `Bearer ${access}` };
      expect((await api().post('/api/v1/auth/mfa/disable').set(auth).send({ password: 'wrong-password', code: nextCode() })).status).toBe(401);
      expect((await api().post('/api/v1/auth/mfa/disable').set(auth).send({ password })).status).toBe(401);
      expect((await api().post('/api/v1/auth/mfa/disable').set(auth).send({ password, code: nextCode() })).status).toBe(200);

      const res = await login();
      expect(unwrap(res).mfaRequired).toBeUndefined();
      expect(unwrap(res).tokens.accessToken).toBeDefined();
      const row = (await testApp.db.select().from(schema.users).where(eq(schema.users.email, email)))[0];
      expect(row.twoFactorSecret).toBeNull();
    });
  });

  describe('sessions across devices and refresh-token lifecycle', () => {
    it('lists sessions, revokes one, then revokes all immediately', async () => {
      const a = unwrap(await login()).tokens;
      const auth = { Authorization: `Bearer ${a.accessToken}` };
      const list = unwrap(await api().get('/api/v1/auth/sessions').set(auth));
      expect(list.length).toBe(1);

      expect((await api().delete('/api/v1/auth/sessions/00000000-0000-0000-0000-000000000000').set(auth)).status).toBe(404);
      expect((await api().delete(`/api/v1/auth/sessions/${list[0].id}`).set(auth)).status).toBe(200);
      expect((await api().post('/api/v1/auth/refresh').send({ refreshToken: a.refreshToken })).status).toBe(401);

      const b = unwrap(await login()).tokens;
      const authB = { Authorization: `Bearer ${b.accessToken}` };
      expect((await api().post('/api/v1/auth/sessions/revoke-all').set(authB)).status).toBe(200);
      expect((await api().get('/api/v1/auth/me').set(authB)).status).toBe(401);
      expect((await api().post('/api/v1/auth/refresh').send({ refreshToken: b.refreshToken })).status).toBe(401);
    });

    it("cannot revoke another user's session", async () => {
      const other = 'identity.other@orion-test.io';
      await testApp.cleanupUsers([other]);
      const o = unwrap(await api().post('/api/v1/auth/register').send({ email: other, password, firstName: 'O', lastName: 'T' })).tokens;
      const mine = unwrap(await login()).tokens;
      const theirs = unwrap(await api().get('/api/v1/auth/sessions').set('Authorization', `Bearer ${o.accessToken}`));
      const r = await api().delete(`/api/v1/auth/sessions/${theirs[0].id}`).set('Authorization', `Bearer ${mine.accessToken}`);
      expect(r.status).toBe(404);
      expect((await api().post('/api/v1/auth/refresh').send({ refreshToken: o.refreshToken })).status).toBe(200);
      await testApp.cleanupUsers([other]);
    });

    it('rotates refresh tokens and revokes the whole family on replay', async () => {
      const t0 = unwrap(await login()).tokens;
      const t1 = unwrap(await api().post('/api/v1/auth/refresh').send({ refreshToken: t0.refreshToken }));
      expect(t1.refreshToken).not.toBe(t0.refreshToken);

      expect((await api().post('/api/v1/auth/refresh').send({ refreshToken: t0.refreshToken })).status).toBe(401);
      // the replay revoked the family, including the legitimately rotated token
      expect((await api().post('/api/v1/auth/refresh').send({ refreshToken: t1.refreshToken })).status).toBe(401);
    });

    it('records why a token was revoked', async () => {
      const t = unwrap(await login()).tokens;
      await api().post('/api/v1/auth/refresh').send({ refreshToken: t.refreshToken });
      const rows = await testApp.db.select().from(schema.refreshTokens);
      expect(rows.some((r) => r.revokedReason === 'ROTATED' && r.revokedAt)).toBe(true);
      expect(rows.some((r) => r.revokedReason === 'REUSE_DETECTED')).toBe(true);
    });

    it('purges expired and long-revoked tokens', async () => {
      const t = unwrap(await login()).tokens;
      await testApp.db.update(schema.refreshTokens).set({ expiresAt: new Date(Date.now() - 1000) });
      expect(await app.get(AuthService).purgeStaleTokens()).toBeGreaterThan(0);
      expect((await api().post('/api/v1/auth/refresh').send({ refreshToken: t.refreshToken })).status).toBe(401);
    });
  });
});

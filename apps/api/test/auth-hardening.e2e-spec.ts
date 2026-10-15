import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import * as jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { TestAppHelper } from './helpers/test-app.helper';
import { TEST_SECRETS } from './helpers/test-secrets';
import * as schema from '../src/database/schema';
import { AdminAuthController, fixedOtpAllowed } from '../src/auth/admin-auth.controller';
import { hashOtp } from '../src/auth/admin-otp.util';
import { AuthService } from '../src/auth/services/auth.service';
import { totpCode } from '../src/auth/services/totp.util';

/**
 * Phase 4 authentication hardening: token validation, session invalidation, uniform login answers, single-use and race-safe
 * one-time codes, and the guards that keep test-only shortcuts out of production.
 */
describe('Authentication hardening (tokens, sessions, OTP, enumeration)', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const unwrap = (res: any) => res.body.data || res.body;
  const password = 'SecurePassword123!';
  const email = 'hardening.user@orion-test.io';
  const adminEmail = 'hardening.admin@monarchsoftwares.com';
  const emails = [email, adminEmail, 'hardening.social@orion-test.io', 'hardening.suspended@orion-test.io', 'hardening.mfa@orion-test.io'];

  const register = async (e: string) => {
    const res = await api().post('/api/v1/auth/register').send({ email: e, password, firstName: 'Hard', lastName: 'Ening' });
    expect(res.status).toBe(201);
    return unwrap(res);
  };
  const login = (e: string, pw = password) => api().post('/api/v1/auth/login').send({ email: e, password: pw });
  const me = (token: string) => api().get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();
    await testApp.cleanupUsers(emails);
  });
  beforeEach(() => (app.get(ThrottlerStorage) as any).storage.clear());
  afterAll(async () => {
    await testApp.cleanupUsers(emails);
    await testApp.close();
  });

  describe('token validation', () => {
    let userId: string;
    const claims = () => ({ sub: userId, email, role: 'USER', status: 'ACTIVE' });
    const sign = (opts: jwt.SignOptions, secret: string = TEST_SECRETS.jwtAccess, payload: object = claims()) =>
      jwt.sign(payload, secret, { issuer: 'orion-api', audience: 'orion-client', ...opts });

    beforeAll(async () => {
      userId = (await register(email)).user.id;
    });

    it('accepts a valid access token (control)', async () => {
      const token = unwrap(await login(email)).tokens.accessToken;
      expect((await me(token)).status).toBe(200);
    });

    it('rejects an expired token', async () => {
      expect((await me(sign({ algorithm: 'HS256', expiresIn: -60 }))).status).toBe(401);
    });

    it('rejects a token signed with a different secret', async () => {
      expect((await me(sign({ algorithm: 'HS256', expiresIn: 600 }, 'a-completely-different-signing-secret-0123456789'))).status).toBe(401);
    });

    it('rejects a refresh-secret token, wrong issuer and wrong audience', async () => {
      expect((await me(sign({ algorithm: 'HS256', expiresIn: 600 }, TEST_SECRETS.jwtRefresh))).status).toBe(401);
      expect((await me(sign({ algorithm: 'HS256', expiresIn: 600, issuer: 'someone-else' }))).status).toBe(401);
      expect((await me(sign({ algorithm: 'HS256', expiresIn: 600, audience: 'someone-else' }))).status).toBe(401);
    });

    it('rejects an unsigned token (alg none) and an algorithm outside the allowlist (HS512) even with the right secret', async () => {
      const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const now = Math.floor(Date.now() / 1000);
      const unsigned = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...claims(), iss: 'orion-api', aud: 'orion-client', iat: now, exp: now + 600 })}.`;
      expect((await me(unsigned)).status).toBe(401);
      expect((await me(sign({ algorithm: 'HS512', expiresIn: 600 }))).status).toBe(401);
    });

    it('rejects malformed tokens and malformed Authorization headers', async () => {
      for (const bad of ['', 'abc', 'a.b', 'a.b.c', '....', 'Bearer']) {
        expect((await me(bad)).status).toBe(401);
      }
      expect((await api().get('/api/v1/auth/me').set('Authorization', 'Basic dXNlcjpwYXNz')).status).toBe(401);
    });

    it('a purpose token (password reset) is not an access token', async () => {
      const typed = sign({ algorithm: 'HS256', expiresIn: 600 }, TEST_SECRETS.jwtAccess, { ...claims(), typ: 'password-reset' });
      expect((await me(typed)).status).toBe(401);
    });

    it('unauthenticated callers cannot reach protected endpoints', async () => {
      for (const path of ['/api/v1/auth/me', '/api/v1/auth/sessions', '/api/v1/auth/mfa/status', '/api/v1/user/profile', '/api/v1/credit/wallet']) {
        expect((await api().get(path)).status).toBe(401);
      }
      expect((await api().post('/api/v1/auth/logout')).status).toBe(401);
    });
  });

  describe('sessions', () => {
    it('a superseded session (single-device login) is rejected on protected endpoints and on refresh', async () => {
      const first = unwrap(await login(email)).tokens;
      expect((await me(first.accessToken)).status).toBe(200);
      const second = unwrap(await login(email)).tokens;
      const stale = await me(first.accessToken);
      expect(stale.status).toBe(401);
      expect(JSON.stringify(stale.body)).toContain('logged in on another device');
      expect((await api().post('/api/v1/auth/refresh').send({ refreshToken: first.refreshToken })).status).toBe(401);
      expect((await me(second.accessToken)).status).toBe(200);
    });

    it('logout ends the session: the access token stops working at once, and so does the refresh token', async () => {
      const tokens = unwrap(await login(email)).tokens;
      expect((await me(tokens.accessToken)).status).toBe(200);
      const out = await api().post('/api/v1/auth/logout').set('Authorization', `Bearer ${tokens.accessToken}`).send({ refreshToken: tokens.refreshToken });
      expect(out.status).toBe(200);
      expect((await me(tokens.accessToken)).status).toBe(401);
      expect((await api().post('/api/v1/auth/refresh').send({ refreshToken: tokens.refreshToken })).status).toBe(401);
    });

    it('session ids are unguessable and unique per login', async () => {
      const ids = new Set<string>();
      for (let i = 0; i < 4; i++) {
        unwrap(await login(email));
        const row = (await testApp.db.select().from(schema.users).where(eq(schema.users.email, email)))[0];
        const sid = (row.metadata as any).activeSessionId as string;
        expect(sid).toMatch(/^sess_[0-9a-f]{32}$/);
        ids.add(sid);
      }
      expect(ids.size).toBe(4);
    });

    it('login responses never carry password hashes, TOTP seeds or signing secrets', async () => {
      const body = JSON.stringify((await login(email)).body);
      for (const forbidden of ['passwordHash', 'password_hash', 'twoFactorSecret', TEST_SECRETS.jwtAccess, TEST_SECRETS.jwtRefresh]) {
        expect(body).not.toContain(forbidden);
      }
    });
  });

  describe('login answers do not reveal accounts', () => {
    const shape = (res: any) => ({ status: res.status, code: res.body?.errorCode ?? res.body?.code ?? res.body?.error?.code, message: res.body?.message ?? res.body?.error?.message });

    it('unknown e-mail, wrong password, social-only account and suspended account (wrong password) all look the same', async () => {
      await register('hardening.social@orion-test.io');
      await testApp.db.update(schema.users).set({ passwordHash: null }).where(eq(schema.users.email, 'hardening.social@orion-test.io'));
      await register('hardening.suspended@orion-test.io');
      await testApp.db.update(schema.users).set({ status: 'SUSPENDED' }).where(eq(schema.users.email, 'hardening.suspended@orion-test.io'));

      const answers = [
        await login('nobody.here@orion-test.io', 'whatever-123'),
        await login(email, 'WrongPassword!1'),
        await login('hardening.social@orion-test.io', 'whatever-123'),
        await login('hardening.suspended@orion-test.io', 'WrongPassword!1'),
      ].map(shape);
      for (const a of answers) {
        expect(a.status).toBe(401);
        expect(a).toEqual(answers[0]);
      }
    });

    it('a suspended account is told its state only after proving the password, and still gets no tokens', async () => {
      const res = await login('hardening.suspended@orion-test.io');
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain('accessToken');
    });
  });

  describe('admin one-time codes', () => {
    let controller: AdminAuthController;
    const req = { ip: '203.0.113.9', headers: { 'user-agent': 'jest' } } as any;
    const seed = async (code: string, extra: Partial<typeof schema.adminOtps.$inferInsert> = {}) => {
      await testApp.db.delete(schema.adminOtps).where(eq(schema.adminOtps.email, adminEmail));
      await testApp.db.insert(schema.adminOtps).values({
        email: adminEmail,
        otp: hashOtp(adminEmail, code),
        attempts: 0,
        maxAttempts: 5,
        expiresAt: new Date(Date.now() + 5 * 60_000),
        ...extra,
      });
    };
    const verify = (otp: string) => controller.verifyOtp({ email: adminEmail, otp }, req).then(
      (r) => ({ ok: true as const, r }),
      (e) => ({ ok: false as const, status: e.getStatus?.() ?? 500 }),
    );

    beforeAll(async () => {
      await testApp.provisionAdmin(adminEmail, 'SUPER_ADMIN');
      controller = app.get(AdminAuthController);
    });

    it('a correct code works exactly once (replay is refused)', async () => {
      await seed('654321');
      expect((await verify('654321')).ok).toBe(true);
      const again = await verify('654321');
      expect(again.ok).toBe(false);
      expect((again as any).status).toBe(400);
    });

    it('an expired code is refused', async () => {
      await seed('654321', { expiresAt: new Date(Date.now() - 1000) });
      const r = await verify('654321');
      expect(r.ok).toBe(false);
      expect((r as any).status).toBe(400);
    });

    it('five wrong guesses lock the code; even the right code is then refused', async () => {
      await seed('654321');
      for (let i = 0; i < 5; i++) expect(((await verify('000000')) as any).status).toBe(400);
      const locked = await verify('654321');
      expect(locked.ok).toBe(false);
      expect((locked as any).status).toBe(429);
    });

    it('parallel guesses cannot exceed the attempt limit', async () => {
      await seed('654321');
      const results = await Promise.all(Array.from({ length: 20 }, () => verify('000000')));
      const evaluated = results.filter((r: any) => r.status === 400).length;
      const locked = results.filter((r: any) => r.status === 429).length;
      expect(evaluated).toBe(5); // exactly maxAttempts guesses were ever compared
      expect(locked).toBe(15);
      expect(((await verify('654321')) as any).status).toBe(429);
    });

    it('parallel redemptions of one correct code mint exactly one session', async () => {
      await seed('654321');
      const results = await Promise.all(Array.from({ length: 10 }, () => verify('654321')));
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      // every other request is refused: 400 (code already redeemed) or 429 (it also spent one of the 5 attempts the code allows)
      const refused = results.filter((r: any) => !r.ok) as Array<{ status: number }>;
      expect(refused).toHaveLength(9);
      for (const r of refused) expect([400, 429]).toContain(r.status);
    });

    it('resending is rate limited per account, so a stranger cannot keep replacing the real code', async () => {
      await testApp.db.delete(schema.adminOtps).where(eq(schema.adminOtps.email, adminEmail));
      const first = await api().post('/api/v1/admin/auth/send-otp').send({ email: adminEmail });
      expect(first.status).toBe(200);
      const second = await api().post('/api/v1/admin/auth/send-otp').send({ email: adminEmail });
      expect(second.status).toBe(429);
    });

    it('the fixed test code and the preview are available only for NODE_ENV=test with a local database', () => {
      const local = 'postgresql://localhost:5432/orion_db';
      const saved = { NODE_ENV: process.env.NODE_ENV, DATABASE_URL: process.env.DATABASE_URL };
      const set = (nodeEnv: string | undefined, db: string | undefined) => {
        if (nodeEnv === undefined) delete process.env.NODE_ENV;
        else (process.env as Record<string, string>).NODE_ENV = nodeEnv;
        if (db === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = db;
      };
      try {
        set('test', local);
        expect(fixedOtpAllowed()).toBe(true);
        for (const env of ['production', 'development', 'staging', undefined]) {
          set(env, local);
          expect(fixedOtpAllowed()).toBe(false);
        }
        set('test', 'postgresql://db.example.org:5432/orion');
        expect(fixedOtpAllowed()).toBe(false);
        set('test', undefined);
        expect(fixedOtpAllowed()).toBe(false);
      } finally {
        set(saved.NODE_ENV, saved.DATABASE_URL);
      }
    });
  });

  describe('MFA codes under concurrency', () => {
    const mfaEmail = 'hardening.mfa@orion-test.io';
    let secret: string;

    beforeAll(async () => {
      const bearer = `Bearer ${(await register(mfaEmail)).tokens.accessToken}`;
      secret = unwrap(await api().post('/api/v1/auth/mfa/setup').set('Authorization', bearer)).secret;
      const code = totpCode(secret, Date.now());
      expect((await api().post('/api/v1/auth/mfa/enable').set('Authorization', bearer).send({ code })).status).toBe(200);
    });

    it('one TOTP code cannot complete two logins at the same time', async () => {
      // the enrolment above consumed the current time-step, so use the next one
      const code = totpCode(secret, Date.now() + 30_000);
      const realNow = Date.now.bind(Date);
      const spy = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + 30_000);
      try {
        const auth = app.get(AuthService);
        const challenges = await Promise.all(
          Array.from({ length: 6 }, async () => ((await auth.login({ email: mfaEmail, password } as any)) as any).mfaToken as string),
        );
        const outcomes = await Promise.all(
          challenges.map((mfaToken) => auth.completeMfaLogin({ mfaToken, code }).then(() => 'ok', () => 'refused')),
        );
        expect(outcomes.filter((o) => o === 'ok')).toHaveLength(1);
      } finally {
        spy.mockRestore();
      }
    });

    it('guessing second-factor codes counts toward the account lockout; once locked, even a correct code is refused', async () => {
      const keys = ['TRAFFIC_CONTROL_ENABLED', 'LOGIN_LOCK_AFTER_FAILURES', 'LOGIN_CAPTCHA_AFTER_FAILURES'];
      const previous = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
      Object.assign(process.env, { TRAFFIC_CONTROL_ENABLED: 'true', LOGIN_LOCK_AFTER_FAILURES: '3', LOGIN_CAPTCHA_AFTER_FAILURES: '1000000' });
      const realNow = Date.now.bind(Date);
      const spy = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + 90_000); // a time-step later than every code used so far
      try {
        const auth = app.get(AuthService);
        const mfaToken = ((await auth.login({ email: mfaEmail, password } as any)) as any).mfaToken as string;
        for (let i = 0; i < 3; i++) {
          await expect(auth.completeMfaLogin({ mfaToken, code: '000000' })).rejects.toMatchObject({ response: expect.anything() });
        }
        const correct = totpCode(secret, Date.now());
        await expect(auth.completeMfaLogin({ mfaToken, code: correct })).rejects.toMatchObject({ status: 429 });
      } finally {
        spy.mockRestore();
        await testApp.db.delete(schema.trafficBlocks);
        for (const k of keys) {
          if (previous[k] === undefined) delete process.env[k];
          else process.env[k] = previous[k];
        }
      }
    });
  });
});

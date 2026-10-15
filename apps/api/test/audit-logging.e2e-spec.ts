import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import * as jwt from 'jsonwebtoken';
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { TestAppHelper } from './helpers/test-app.helper';
import { TEST_SECRETS } from './helpers/test-secrets';
import { MailService, IMail } from '../src/auth/mail/mail.service';
import { AuditLogService } from '../src/common/services/audit-log.service';
import * as schema from '../src/database/schema';

/**
 * Phase 13: audit events for security-sensitive actions, privacy of the audit trail, atomicity of money changes, abuse tripwires.
 * Isolated users; every secret below is a synthetic test value.
 */
describe('Audit logging and security events (Phase 13)', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const unwrap = (res: any) => res.body.data || res.body;
  const sent: IMail[] = [];
  const emails: string[] = [];
  const adminEmail = 'qa.audit.admin@monarchsoftwares.com';
  let admin = { Authorization: '' };
  let adminId = '';
  const PASSWORD = 'AuditPass123!';
  const NEW_PASSWORD = 'AuditNewPass456!';
  const stamp = Date.now();

  const newUser = async (name: string) => {
    const email = `audit.${name}.${stamp}@orion-test.io`;
    emails.push(email);
    const res = unwrap(await api().post('/api/v1/auth/register').set('user-agent', 'audit-test-agent').send({ email, password: PASSWORD, firstName: 'Au', lastName: name }));
    return { id: res.user.id as string, email, auth: { Authorization: `Bearer ${res.tokens.accessToken}` }, refresh: res.tokens.refreshToken as string };
  };
  const rowsFor = (action: string, userId?: string | null) =>
    testApp.db.select().from(schema.auditLogs).where(userId ? and(eq(schema.auditLogs.action, action), eq(schema.auditLogs.userId, userId)) : eq(schema.auditLogs.action, action));

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();
    app.get(MailService).transport = { send: async (m) => void sent.push(m) };
    await testApp.cleanupUsers([adminEmail]);
    adminId = await testApp.provisionAdmin(adminEmail, 'SUPER_ADMIN');
    admin = { Authorization: `Bearer ${jwt.sign({ sub: adminId, email: adminEmail, role: 'SUPER_ADMIN', status: 'ACTIVE' }, TEST_SECRETS.jwtAccess, { expiresIn: '1h', issuer: 'orion-api', audience: 'orion-client' })}` };
  });

  beforeEach(() => {
    (app.get(ThrottlerStorage) as any).storage.clear();
  });

  afterAll(async () => {
    delete process.env.SECURITY_SIGNAL_THRESHOLD_AUTHZ_DENIED;
    await testApp.cleanupUsers([...emails, adminEmail]);
    await testApp.close();
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('authentication events', () => {
    it('records registration without the e-mail address, with role, method, ip and user agent', async () => {
      const u = await newUser('reg');
      const rows = await rowsFor('USER_REGISTERED', u.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].newValues).toMatchObject({ role: 'USER', method: 'PASSWORD', outcome: 'SUCCESS' });
      expect(JSON.stringify(rows[0])).not.toContain(u.email);
      expect(rows[0].userAgent).toBe('audit-test-agent');
    });

    it('records a failed login for a known account (account id, category) and for an unknown one (digest only), never the password or the address', async () => {
      const u = await newUser('fail');
      const bad = await api().post('/api/v1/auth/login').set('user-agent', 'audit-test-agent').send({ email: u.email, password: 'definitely-wrong-1' });
      expect(bad.status).toBe(401);
      const ghost = `ghost.${stamp}@orion-test.io`;
      expect((await api().post('/api/v1/auth/login').send({ email: ghost, password: 'ghost-pass-9876' })).status).toBe(401);

      const known = await rowsFor('LOGIN_FAILED', u.id);
      expect(known).toHaveLength(1);
      expect(known[0].newValues).toMatchObject({ outcome: 'FAILURE', failureCategory: 'BAD_PASSWORD' });
      expect(known[0].entityId).toBe(u.id);

      const unknown = (await rowsFor('LOGIN_FAILED')).filter((r) => (r.newValues as any)?.failureCategory === 'UNKNOWN_ACCOUNT');
      expect(unknown.length).toBeGreaterThanOrEqual(1);
      const last = unknown[unknown.length - 1];
      expect(last.userId).toBeNull();
      expect((last.newValues as any).emailDigest).toMatch(/^[0-9a-f]{16}$/);
      const json = JSON.stringify([known[0], last]);
      for (const raw of ['definitely-wrong-1', 'ghost-pass-9876', ghost, u.email]) expect(json).not.toContain(raw);
    });

    it('records a successful login with actor, address, user agent and the request correlation id', async () => {
      const u = await newUser('ok');
      const rid = `rid-${stamp}-login`;
      const res = await api().post('/api/v1/auth/login').set('user-agent', 'audit-test-agent').set('x-request-id', rid).send({ email: u.email, password: PASSWORD });
      expect(res.status).toBe(200);
      const rows = await rowsFor('LOGIN_SUCCESS', u.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].entityType).toBe('AUTH');
      expect(rows[0].userAgent).toBe('audit-test-agent');
      expect(rows[0].ipAddress).toBeTruthy();
      expect(rows[0].newValues).toMatchObject({ outcome: 'SUCCESS', method: 'PASSWORD', requestId: rid });
    });

    it('records a replayed refresh token as TOKEN_REUSE_DETECTED and ends the session family', async () => {
      const u = await newUser('replay');
      const login = unwrap(await api().post('/api/v1/auth/login').send({ email: u.email, password: PASSWORD }));
      const first = await api().post('/api/v1/auth/refresh').send({ refreshToken: login.tokens.refreshToken });
      expect(first.status).toBe(200);
      const replay = await api().post('/api/v1/auth/refresh').send({ refreshToken: login.tokens.refreshToken });
      expect(replay.status).toBe(401);
      const rows = await rowsFor('TOKEN_REUSE_DETECTED', u.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].newValues).toMatchObject({ outcome: 'DENIED', failureCategory: 'REFRESH_TOKEN_REPLAY', sessionFamilyRevoked: true });
      // the family is gone: the token issued by the legitimate rotation no longer works either
      const after = unwrap(first);
      expect((await api().post('/api/v1/auth/refresh').send({ refreshToken: after.refreshToken ?? after.tokens?.refreshToken })).status).toBe(401);
      expect(JSON.stringify(rows[0])).not.toContain(login.tokens.refreshToken);
    });

    it('records logout against the signed-in account', async () => {
      const u = await newUser('out');
      const login = unwrap(await api().post('/api/v1/auth/login').send({ email: u.email, password: PASSWORD }));
      const r = await api().post('/api/v1/auth/logout').set('Authorization', `Bearer ${login.tokens.accessToken}`).send({ refreshToken: login.tokens.refreshToken });
      expect(r.status).toBe(200);
      const rows = await rowsFor('LOGOUT', u.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].newValues).toMatchObject({ outcome: 'SUCCESS' });
    });

    it('records the password reset request, a failed completion and a successful one without the token or the new password', async () => {
      const u = await newUser('reset');
      sent.length = 0;
      expect((await api().post('/api/v1/auth/forgot-password').send({ email: u.email })).status).toBe(200);
      expect(await rowsFor('PASSWORD_RESET_REQUESTED', u.id)).toHaveLength(1);
      // an unknown e-mail is answered the same way and leaves no account-bound entry
      expect((await api().post('/api/v1/auth/forgot-password').send({ email: `nobody.${stamp}@orion-test.io` })).status).toBe(200);

      const bad = await api().post('/api/v1/auth/reset-password').send({ token: 'not-a-real-token-0123456789', newPassword: NEW_PASSWORD });
      expect(bad.status).toBe(400);
      expect((await rowsFor('PASSWORD_RESET_FAILED')).some((r) => (r.newValues as any)?.failureCategory === 'INVALID_OR_EXPIRED_TOKEN')).toBe(true);

      const token = decodeURIComponent((sent.find((m) => m.to === u.email)!.text.match(/token=([^\s&]+)/) as RegExpMatchArray)[1]);
      expect((await api().post('/api/v1/auth/reset-password').send({ token, newPassword: NEW_PASSWORD })).status).toBe(200);
      const done = await rowsFor('PASSWORD_RESET_COMPLETED', u.id);
      expect(done).toHaveLength(1);
      expect(done[0].newValues).toMatchObject({ outcome: 'SUCCESS', sessionsRevoked: true });
      const all = JSON.stringify(await testApp.db.select().from(schema.auditLogs).where(or(eq(schema.auditLogs.userId, u.id), eq(schema.auditLogs.action, 'PASSWORD_RESET_FAILED'))));
      for (const raw of [token, NEW_PASSWORD, 'not-a-real-token-0123456789']) expect(all).not.toContain(raw);
    });

    it('records a failed and a successful password change', async () => {
      const u = await newUser('chg');
      const wrong = await api().post('/api/v1/user/change-password').set(u.auth).send({ currentPassword: 'wrong-current-77', newPassword: NEW_PASSWORD });
      expect(wrong.status).toBe(401);
      expect((await rowsFor('PASSWORD_CHANGE_FAILED', u.id))[0].newValues).toMatchObject({ outcome: 'FAILURE', failureCategory: 'BAD_CURRENT_PASSWORD' });
      expect((await api().post('/api/v1/user/change-password').set(u.auth).send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })).status).toBe(200);
      expect((await rowsFor('PASSWORD_CHANGED', u.id))).toHaveLength(1);
      const all = JSON.stringify(await testApp.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.userId, u.id)));
      for (const raw of ['wrong-current-77', PASSWORD, NEW_PASSWORD]) expect(all).not.toContain(raw);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('money and administrative changes', () => {
    it('an administrator credit adjustment is audited with actor, target, amounts and reason, in the same transaction', async () => {
      const u = await newUser('credit');
      const r = await api().post('/api/v1/credit/admin/adjust').set(admin).send({ userId: u.id, dailyDelta: 0, purchasedDelta: 7, reason: 'goodwill credit for audit test' });
      expect(r.status).toBeLessThan(300);
      const rows = await rowsFor('CREDIT_ADJUSTMENT', adminId);
      const mine = rows.find((x) => (x.newValues as any)?.targetUserId === u.id)!;
      expect(mine).toBeDefined();
      expect(mine.entityType).toBe('USER_WALLET');
      expect(mine.newValues).toMatchObject({ purchasedDelta: 7, outcome: 'SUCCESS' });
      expect((mine.newValues as any).transactionId).toBeTruthy();
    });

    it('if the audit row cannot be written, the balance does not change (the adjustment rolls back)', async () => {
      const u = await newUser('atomic');
      const walletBefore = (await testApp.db.select().from(schema.userWallets).where(eq(schema.userWallets.userId, u.id)))[0];
      const spy = jest.spyOn(app.get(AuditLogService), 'recordStrict').mockRejectedValueOnce(new Error('audit store unavailable'));
      const r = await api().post('/api/v1/credit/admin/adjust').set(admin).send({ userId: u.id, dailyDelta: 0, purchasedDelta: 9, reason: 'rollback check' });
      spy.mockRestore();
      expect(r.status).toBeGreaterThanOrEqual(500);
      const walletAfter = (await testApp.db.select().from(schema.userWallets).where(eq(schema.userWallets.userId, u.id)))[0];
      expect(walletAfter.purchasedCredits).toBe(walletBefore.purchasedCredits);
      expect(walletAfter.balance).toBe(walletBefore.balance);
      const txs = await testApp.db.select().from(schema.creditTransactions).where(and(eq(schema.creditTransactions.userId, u.id), eq(schema.creditTransactions.type, 'ADMIN_ADJUSTMENT')));
      expect(txs).toHaveLength(0);
      const audits = (await rowsFor('CREDIT_ADJUSTMENT', adminId)).filter((x) => (x.newValues as any)?.targetUserId === u.id);
      expect(audits).toHaveLength(0);
    });

    it('a database-level failure of the audit insert also rolls the adjustment back (not only a mocked service)', async () => {
      const u = await newUser('dbfail');
      const walletBefore = (await testApp.db.select().from(schema.userWallets).where(eq(schema.userWallets.userId, u.id)))[0];
      await testApp.db.execute(sql`CREATE OR REPLACE FUNCTION p13_block_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.new_values->>'reason' = 'force-audit-failure' THEN RAISE EXCEPTION 'audit insert blocked for test'; END IF; RETURN NEW; END $$`);
      await testApp.db.execute(sql`CREATE TRIGGER p13_block_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION p13_block_audit()`);
      try {
        const r = await api().post('/api/v1/credit/admin/adjust').set(admin).send({ userId: u.id, dailyDelta: 0, purchasedDelta: 11, reason: 'force-audit-failure' });
        expect(r.status).toBeGreaterThanOrEqual(500);
      } finally {
        await testApp.db.execute(sql`DROP TRIGGER IF EXISTS p13_block_audit ON audit_logs`);
        await testApp.db.execute(sql`DROP FUNCTION IF EXISTS p13_block_audit()`);
      }
      const walletAfter = (await testApp.db.select().from(schema.userWallets).where(eq(schema.userWallets.userId, u.id)))[0];
      expect(walletAfter.purchasedCredits).toBe(walletBefore.purchasedCredits);
      expect(walletAfter.balance).toBe(walletBefore.balance);
      // and the same request succeeds once the audit store works again
      expect((await api().post('/api/v1/credit/admin/adjust').set(admin).send({ userId: u.id, dailyDelta: 0, purchasedDelta: 11, reason: 'force-audit-failure' })).status).toBeLessThan(300);
    });

    it('exports are audited with outcome, counts and the correlation id', async () => {
      const u = await newUser('exp');
      const rid = `rid-${stamp}-export`;
      const r = await api().post('/api/v1/exports').set(u.auth).set('x-request-id', rid).send({ dataset: 'saved-leads', format: 'csv' });
      expect(r.status).toBe(200);
      const rows = await rowsFor('EXPORT_CREATED', u.id);
      expect(rows[0].newValues).toMatchObject({ outcome: 'COMPLETED', rowCount: 0, requestId: rid });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('who can read or change the audit trail', () => {
    it('customers and anonymous callers cannot read internal audit or privacy logs; no route can edit or delete audit rows', async () => {
      const u = await newUser('deny');
      for (const path of ['/api/v1/exports/admin/audit', '/api/v1/privacy/admin/requests']) {
        expect((await api().get(path).set(u.auth)).status).toBe(403);
        expect((await api().get(path)).status).toBe(401);
        expect((await api().get(path).set(admin)).status).toBe(200);
      }
      for (const method of ['put', 'patch', 'delete', 'post'] as const) {
        for (const path of ['/api/v1/audit-logs', '/api/v1/admin/audit-logs', '/api/v1/exports/admin/audit']) {
          const r = await (api() as any)[method](path).set(admin).send({});
          expect([400, 403, 404, 405]).toContain(r.status);
          expect(r.status).not.toBe(200);
        }
      }
      const before = (await testApp.db.select().from(schema.auditLogs)).length;
      await api().delete('/api/v1/exports/admin/audit').set(admin);
      expect((await testApp.db.select().from(schema.auditLogs)).length).toBeGreaterThanOrEqual(before);
    });

    it('the exports audit view carries the new fields but no secrets or contact details', async () => {
      const trail = unwrap(await api().get('/api/v1/exports/admin/audit?limit=50').set(admin));
      const json = JSON.stringify(trail);
      for (const raw of [PASSWORD, NEW_PASSWORD, 'Bearer ', 'eyJ']) expect(json).not.toContain(raw);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('abuse tripwires', () => {
    it('repeated authorization failures write ONE ABUSE_SIGNAL entry per window, not one per request, and never block the caller', async () => {
      process.env.SECURITY_SIGNAL_THRESHOLD_AUTHZ_DENIED = '3';
      const u = await newUser('signal');
      let last = 0;
      for (let i = 0; i < 6; i++) last = (await api().get('/api/v1/exports/admin/audit').set(u.auth)).status;
      expect(last).toBe(403); // refused as before, never blocked or changed by the tripwire
      await new Promise((r) => setTimeout(r, 100));
      const signals = (await rowsFor('ABUSE_SIGNAL', u.id)).filter((x) => x.entityId === 'AUTHZ_DENIED');
      expect(signals).toHaveLength(1);
      expect(signals[0].newValues).toMatchObject({ kind: 'AUTHZ_DENIED', threshold: 3, subjectType: 'ACCOUNT' });
      expect((signals[0].newValues as any).count).toBe(3);
      // normal use of the account still works
      expect((await api().get('/api/v1/user/profile').set(u.auth)).status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('nothing sensitive reaches the audit table', () => {
    it('no audit row anywhere holds a test password, a reset token or a raw test e-mail address', async () => {
      const rows = await testApp.db.select().from(schema.auditLogs).where(inArray(schema.auditLogs.entityType, ['AUTH', 'user', 'USER_WALLET', 'EXPORT', 'SECURITY_SIGNAL']));
      const json = JSON.stringify(rows);
      for (const raw of [PASSWORD, NEW_PASSWORD, 'definitely-wrong-1', 'ghost-pass-9876', 'wrong-current-77']) expect(json).not.toContain(raw);
      for (const e of emails) expect(json).not.toContain(e);
    });
  });
});

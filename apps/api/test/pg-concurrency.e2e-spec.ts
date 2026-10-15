import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import * as path from 'path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { PG_POOL, DRIZZLE_DATABASE } from '../src/database/database.constants';
import { databasePoolSettings } from '../src/database/pool-settings';
import { assertLocalDatabaseAllowed, isDisposableOrionDatabase } from '../src/database/db-guard';
import * as schema from '../src/database/schema';
import { TestAppHelper } from './helpers/test-app.helper';
import { TEST_SECRETS } from './helpers/test-secrets';
import { MailService } from '../src/auth/mail/mail.service';
import { CreditService } from '../src/modules/credit/credit.service';
import { GoogleOAuthProvider } from '../src/modules/oauth/providers/google.provider';
import { MicrosoftOAuthProvider } from '../src/modules/oauth/providers/microsoft.provider';
import { MockGoogleOAuthProvider, MockMicrosoftOAuthProvider } from './mocks/mock-oauth-providers';

/**
 * Real PostgreSQL concurrency (opt-in). The hermetic suites run on PGlite, which has ONE connection and runs whole transactions one
 * after another, so they cannot show whether a row lock or advisory lock is doing its job (removing every lock leaves them green).
 * This spec runs the same application code against a real local PostgreSQL server with a pool of real connections, so transactions
 * genuinely overlap.
 *
 * It runs only when CONCURRENCY_DATABASE_URL names an EMPTY, DISPOSABLE database on the local server (orion_scratch*, orion_test*,
 * orion_verify*). It refuses `orion_db`, any other name, and any remote host. Migrations are applied to it by this spec.
 */
const URL_ENV = process.env.CONCURRENCY_DATABASE_URL;
const enabled = Boolean(URL_ENV);

(enabled ? describe : describe.skip)('Real PostgreSQL: concurrent credit spending, unlocks, payments and refunds', () => {
  let pool: Pool;
  let app: INestApplication;
  let helper: TestAppHelper;
  const api = () => request(app.getHttpServer());
  const unwrap = (res: any) => res.body.data || res.body;
  const hmac = (secret: string, text: string) => crypto.createHmac('sha256', secret).update(text).digest('hex');
  const sign = (orderId: string, paymentId: string) => hmac(TEST_SECRETS.razorpayKeySecret, `${orderId}|${paymentId}`);
  const stamp = Date.now();
  let seq = 0;
  const today = () => new Date().toISOString().slice(0, 10);
  const emails: string[] = [];
  const slugs: string[] = [];
  const admin = { Authorization: '' };
  let db: any;

  const newUser = async (tag: string) => {
    const email = `pg.${tag}.${stamp}.${++seq}@orion-test.io`;
    emails.push(email);
    const res = unwrap(await api().post('/api/v1/auth/register').send({ email, password: 'ConcurrencyPass123!', firstName: 'Pg', lastName: tag }));
    return { id: res.user.id as string, auth: { Authorization: `Bearer ${res.tokens.accessToken}` } };
  };
  const walletRow = async (userId: string) => (await db.select().from(schema.userWallets).where(eq(schema.userWallets.userId, userId)))[0];
  const ledger = (userId: string) => db.select().from(schema.creditTransactions).where(eq(schema.creditTransactions.userId, userId));
  const setWallet = async (userId: string, daily: number, purchased: number) => {
    await db.update(schema.userWallets).set({ dailyCredits: daily, purchasedCredits: purchased, balance: daily + purchased, lastDailyCreditDate: today(), lifetimeUsed: 0 }).where(eq(schema.userWallets.userId, userId));
    await db.delete(schema.creditTransactions).where(eq(schema.creditTransactions.userId, userId));
    const w = await walletRow(userId);
    if (daily + purchased > 0) {
      await db.insert(schema.creditTransactions).values({
        walletId: w.id, userId, amount: daily + purchased, balanceAfter: daily + purchased, balanceType: 'MIXED',
        dailyBalanceAfter: daily, purchasedBalanceAfter: purchased, type: 'ADMIN_ADJUSTMENT', description: 'test fixture',
      });
    }
  };
  const assertConsistent = async (userId: string) => {
    const w = await walletRow(userId);
    const rows = await ledger(userId);
    expect(w.dailyCredits).toBeGreaterThanOrEqual(0);
    expect(w.purchasedCredits).toBeGreaterThanOrEqual(0);
    expect(w.balance).toBe(w.dailyCredits + w.purchasedCredits);
    expect(rows.reduce((n: number, r: any) => n + r.amount, 0)).toBe(w.balance);
  };
  const business = async (n: string) => {
    const slug = `pgc-${n}-${stamp}-${++seq}`;
    slugs.push(slug);
    return helper.createTestBusiness({ slug, name: `Pg ${n}`, contactEmail: `${slug}@lead.example`, contactPhone: '+91 9000000003' });
  };
  const unlock = (u: { auth: any }, businessId: string) => api().post('/api/v1/unlock/business').set(u.auth).send({ businessId });
  const orderFor = async (u: { auth: any }) => {
    const p = (unwrap(await api().get('/api/v1/credit/packages')) as any[]).find((x) => x.slug === 'starter');
    const order = unwrap(await api().post('/api/v1/payments/create-order').set(u.auth).send({ packageId: p.id, billingCycle: 'monthly' }));
    return { p, order };
  };
  const verify = (u: { auth: any }, p: any, orderId: string, paymentId: string) =>
    api().post('/api/v1/payments/verify').set(u.auth).send({ razorpayOrderId: orderId, razorpayPaymentId: paymentId, razorpaySignature: sign(orderId, paymentId), packageId: p.id, billingCycle: 'monthly' });

  beforeAll(async () => {
    // Refuse anything that is not a disposable Orion database on the local server, before opening a single connection.
    const target = assertLocalDatabaseAllowed(URL_ENV);
    if (!target.local || !isDisposableOrionDatabase(target.database)) {
      throw new Error(`Refusing to run: ${target.database} is not a disposable local scratch database (orion_scratch*, orion_test*, orion_verify*).`);
    }
    pool = new Pool({ connectionString: URL_ENV, max: 20 });
    const existing = await pool.query(`SELECT to_regclass('public.users') AS t`);
    if (existing.rows[0].t) throw new Error('Refusing to run: the scratch database already has Orion tables; use a new empty database.');
    await migrate(drizzle(pool), { migrationsFolder: path.resolve(__dirname, '../src/database/migrations') });
    db = drizzle(pool, { schema });

    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PG_POOL).useValue(pool)
      .overrideProvider(DRIZZLE_DATABASE).useValue(db)
      .overrideProvider(GoogleOAuthProvider).useClass(MockGoogleOAuthProvider)
      .overrideProvider(MicrosoftOAuthProvider).useClass(MockMicrosoftOAuthProvider)
      .compile();
    app = module.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    app.get(MailService).transport = { send: async () => undefined };

    helper = new TestAppHelper();
    (helper as any).db = db;
    const adminEmail = `pg.admin.${stamp}@monarchsoftwares.com`;
    emails.push(adminEmail);
    const adminId = await helper.provisionAdmin(adminEmail, 'SUPER_ADMIN');
    admin.Authorization = `Bearer ${jwt.sign({ sub: adminId, email: adminEmail, role: 'SUPER_ADMIN', status: 'ACTIVE' }, TEST_SECRETS.jwtAccess, { expiresIn: '1h', issuer: 'orion-api', audience: 'orion-client' })}`;
  }, 120_000);
  beforeEach(() => (app.get(ThrottlerStorage) as any).storage.clear());
  afterAll(async () => {
    if (!app) return;
    await helper.cleanupBusinesses(slugs);
    await helper.cleanupUsers(emails);
    await app.close();
    await pool.end().catch(() => undefined);
  });

  it('is genuinely concurrent: the pool holds many connections and transactions overlap', async () => {
    const started = Date.now();
    const runs = await Promise.all(Array.from({ length: 8 }, () => pool.query('SELECT pg_sleep(0.3), pg_backend_pid() AS pid').then((r) => r.rows[0].pid)));
    expect(new Set(runs).size).toBeGreaterThan(1); // different server processes
    expect(Date.now() - started).toBeLessThan(1500); // 8 x 0.3 s ran in parallel, not back to back
  });

  it('parallel unlocks of the SAME business charge exactly once', async () => {
    const u = await newUser('same');
    await setWallet(u.id, 0, 5);
    const biz = await business('same');
    const results = await Promise.all(Array.from({ length: 12 }, () => unlock(u, biz.id)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => unwrap(r).alreadyUnlocked === false)).toHaveLength(1);
    expect(await db.select().from(schema.leadUnlocks).where(eq(schema.leadUnlocks.userId, u.id))).toHaveLength(1);
    expect((await ledger(u.id)).filter((r: any) => r.type === 'UNLOCK_LEAD')).toHaveLength(1);
    const w = await walletRow(u.id);
    expect([w.balance, w.lifetimeUsed]).toEqual([4, 1]);
    await assertConsistent(u.id);
  });

  it('parallel unlocks of DIFFERENT businesses never spend more than the wallet holds', async () => {
    const u = await newUser('near');
    await setWallet(u.id, 1, 2);
    const bizs = await Promise.all(Array.from({ length: 10 }, (_, i) => business(`near${i}`)));
    const results = await Promise.all(bizs.map((b) => unlock(u, b.id)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
    expect(results.filter((r) => r.status === 402)).toHaveLength(7);
    expect(await db.select().from(schema.leadUnlocks).where(eq(schema.leadUnlocks.userId, u.id))).toHaveLength(3);
    const w = await walletRow(u.id);
    expect([w.dailyCredits, w.purchasedCredits, w.balance, w.lifetimeUsed]).toEqual([0, 0, 0, 3]);
    await assertConsistent(u.id);
  });

  it('parallel deductions near the balance: exactly the affordable number succeed', async () => {
    const u = await newUser('deduct');
    await setWallet(u.id, 2, 3);
    const credits = app.get(CreditService);
    const results = await Promise.all(Array.from({ length: 16 }, () => credits.deductCredits(u.id, 1, 'parallel').then(() => 'ok', (e: any) => e.errorCode)));
    expect(results.filter((r) => r === 'ok')).toHaveLength(5);
    expect(results.filter((r) => r === 'INSUFFICIENT_CREDITS')).toHaveLength(11);
    const w = await walletRow(u.id);
    expect([w.dailyCredits, w.purchasedCredits, w.balance]).toEqual([0, 0, 0]);
    await assertConsistent(u.id);
  });

  it('the same payment verified in parallel is credited once, with one ledger row and one invoice', async () => {
    const u = await newUser('payrace');
    const { p, order } = await orderFor(u);
    const before = (await walletRow(u.id)).purchasedCredits;
    const paymentId = `pay_pgc_${stamp}_${++seq}`;
    const results = await Promise.all(Array.from({ length: 12 }, () => verify(u, p, order.orderId, paymentId)));
    expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect((await walletRow(u.id)).purchasedCredits).toBe(before + p.credits);
    expect((await ledger(u.id)).filter((r: any) => r.referenceId === paymentId)).toHaveLength(1);
    expect(await db.select().from(schema.invoices).where(eq(schema.invoices.paymentId, paymentId))).toHaveLength(1);
    await assertConsistent(u.id);
  });

  it('parallel refund requests for one payment reverse the credits once and write one refund row', async () => {
    const u = await newUser('refundrace');
    const { p, order } = await orderFor(u);
    const paymentId = `pay_pgc_${stamp}_${++seq}`;
    expect([200, 201]).toContain((await verify(u, p, order.orderId, paymentId)).status);
    const results = await Promise.all(Array.from({ length: 8 }, () => api().post('/api/v1/billing/admin/refunds').set(admin).send({ paymentId, reason: 'parallel refund test' })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(7);
    expect(await db.select().from(schema.refunds).where(eq(schema.refunds.paymentId, paymentId))).toHaveLength(1);
    expect((await ledger(u.id)).filter((r: any) => r.type === 'REFUND')).toHaveLength(1);
    expect((await walletRow(u.id)).purchasedCredits).toBe(0);
    await assertConsistent(u.id);
  });

  it('a purchase and a spend racing on one wallet leave the ledger and balance consistent', async () => {
    const u = await newUser('mixed');
    await setWallet(u.id, 0, 2);
    const credits = app.get(CreditService);
    const { p, order } = await orderFor(u);
    const paymentId = `pay_pgc_${stamp}_${++seq}`;
    const [pay, ...spends] = await Promise.all([
      verify(u, p, order.orderId, paymentId),
      ...Array.from({ length: 6 }, () => credits.deductCredits(u.id, 1, 'spend').then(() => 'ok', (e: any) => e.errorCode)),
    ]);
    expect([200, 201]).toContain((pay as any).status);
    const spent = (spends as string[]).filter((s) => s === 'ok').length;
    expect(spent).toBeGreaterThanOrEqual(2); // at least the 2 credits that were there before the purchase
    expect(spent).toBeLessThanOrEqual(6);
    const w = await walletRow(u.id);
    expect(w.balance).toBe(2 + p.credits - spent);
    await assertConsistent(u.id);
  });

  // ---- Phase 27 ----

  it('the same company saved in parallel by one customer leaves exactly one saved lead', async () => {
    const u = await newUser('savedrace');
    const biz = await business('savedrace');
    const results = await Promise.all(Array.from({ length: 12 }, () => api().post('/api/v1/saved-leads').set(u.auth).send({ businessId: biz.id })));
    expect(results.every((r) => r.status < 300)).toBe(true);
    expect(await db.select().from(schema.savedLeads).where(eq(schema.savedLeads.userId, u.id))).toHaveLength(1);
  });

  it('the first wallet read of a customer without a wallet, made in parallel, creates one wallet and never fails', async () => {
    const u = await newUser('walletrace');
    await db.delete(schema.creditTransactions).where(eq(schema.creditTransactions.userId, u.id));
    await db.delete(schema.userWallets).where(eq(schema.userWallets.userId, u.id));
    const credits = app.get(CreditService);
    const out = await Promise.all(Array.from({ length: 10 }, () => credits.getWallet(u.id).then(() => 'ok', (e: any) => e?.code ?? e?.cause?.code ?? String(e?.message))));
    expect(out.filter((x) => x !== 'ok')).toEqual([]);
    expect(await db.select().from(schema.userWallets).where(eq(schema.userWallets.userId, u.id))).toHaveLength(1);
  });

  it('a runaway statement is stopped by the statement timeout, and a transaction left idle is closed by the server', async () => {
    const guarded = new Pool({ connectionString: URL_ENV, max: 2, ...databasePoolSettings({ statementTimeoutMs: 1000, idleInTransactionTimeoutMs: 1500, lockTimeoutMs: 1000 }) });
    guarded.on('error', () => undefined); // the server closing an idle connection is the expected outcome here
    try {
      const t0 = Date.now();
      await expect(guarded.query('SELECT pg_sleep(10)')).rejects.toMatchObject({ code: '57014' });
      expect(Date.now() - t0).toBeLessThan(5000);
      const c = await guarded.connect();
      c.on('error', () => undefined);
      await c.query('BEGIN');
      await new Promise((r) => setTimeout(r, 2500));
      await expect(c.query('SELECT 1')).rejects.toBeDefined();
      c.release(true);
      // the one deliberate exception: the People import run lock keeps a transaction open for the whole run and lifts the limits locally
      const holder = await guarded.connect();
      holder.on('error', () => undefined);
      await holder.query('BEGIN');
      await holder.query('SET LOCAL idle_in_transaction_session_timeout = 0');
      await holder.query('SET LOCAL statement_timeout = 0');
      await new Promise((r) => setTimeout(r, 2500));
      await expect(holder.query('SELECT 1')).resolves.toBeDefined();
      await holder.query('COMMIT');
      holder.release();
    } finally {
      await guarded.end().catch(() => undefined);
    }
  }, 30_000);
});

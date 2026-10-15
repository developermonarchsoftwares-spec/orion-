import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage } from '@nestjs/throttler';
import { and, eq, sql } from 'drizzle-orm';
import { TestAppHelper } from './helpers/test-app.helper';
import { TEST_SECRETS } from './helpers/test-secrets';
import { MailService } from '../src/auth/mail/mail.service';
import { CreditService } from '../src/modules/credit/credit.service';
import { RazorpayService } from '../src/modules/payment/razorpay.service';
import * as schema from '../src/database/schema';

/**
 * Phase 6: credit integrity, lead unlocks, payments, refunds, pricing configuration. Concurrency tests fire genuinely parallel
 * requests and then check the FINAL DATABASE STATE (wallet, ledger, unlock rows, invoices, refunds), not only the HTTP answers.
 */
describe('Financial integrity: credits, unlocks, payments, refunds, pricing', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const unwrap = (res: any) => res.body.data || res.body;
  const hmac = (secret: string, text: string) => crypto.createHmac('sha256', secret).update(text).digest('hex');
  const sign = (orderId: string, paymentId: string) => hmac(TEST_SECRETS.razorpayKeySecret, `${orderId}|${paymentId}`);
  const stamp = Date.now();
  let seq = 0;
  const payId = () => `pay_fin_${stamp}_${++seq}`;
  const today = () => new Date().toISOString().slice(0, 10);

  const emails: string[] = [];
  const slugs: string[] = [];
  const adminEmail = 'qa.finance.admin@monarchsoftwares.com';
  const admin = { Authorization: '' };

  const newUser = async (tag: string) => {
    const email = `fin.${tag}.${stamp}.${++seq}@orion-test.io`;
    emails.push(email);
    const res = unwrap(await api().post('/api/v1/auth/register').send({ email, password: 'FinancePass123!', firstName: 'Fin', lastName: tag }));
    return { id: res.user.id as string, email, auth: { Authorization: `Bearer ${res.tokens.accessToken}` } };
  };
  const walletRow = async (userId: string) => (await testApp.db.select().from(schema.userWallets).where(eq(schema.userWallets.userId, userId)))[0];
  const ledger = (userId: string) => testApp.db.select().from(schema.creditTransactions).where(eq(schema.creditTransactions.userId, userId));
  /** Gives the user exactly this wallet (today's date, so no daily rollover changes it during the test) and a matching ledger anchor. */
  const setWallet = async (userId: string, daily: number, purchased: number) => {
    await testApp.db
      .update(schema.userWallets)
      .set({ dailyCredits: daily, purchasedCredits: purchased, balance: daily + purchased, lastDailyCreditDate: today(), lifetimeUsed: 0 })
      .where(eq(schema.userWallets.userId, userId));
    await testApp.db.delete(schema.creditTransactions).where(eq(schema.creditTransactions.userId, userId));
    const w = await walletRow(userId);
    if (daily + purchased > 0) {
      await testApp.db.insert(schema.creditTransactions).values({
        walletId: w.id, userId, amount: daily + purchased, balanceAfter: daily + purchased, balanceType: 'MIXED',
        dailyBalanceAfter: daily, purchasedBalanceAfter: purchased, type: 'ADMIN_ADJUSTMENT', description: 'test fixture',
      });
    }
  };
  /** The invariants every wallet must satisfy after any sequence of operations. */
  const assertConsistent = async (userId: string) => {
    const w = await walletRow(userId);
    const rows = await ledger(userId);
    expect(w.dailyCredits).toBeGreaterThanOrEqual(0);
    expect(w.purchasedCredits).toBeGreaterThanOrEqual(0);
    expect(w.balance).toBe(w.dailyCredits + w.purchasedCredits);
    expect(rows.reduce((n, r) => n + r.amount, 0)).toBe(w.balance); // the ledger accounts for every credit
    const last = [...rows].sort((a, b) => +a.createdAt - +b.createdAt).pop();
    if (last) expect(last.balanceAfter).toBe(w.balance);
  };
  const business = async (n: string) => {
    const slug = `fin-${n}-${stamp}-${++seq}`;
    slugs.push(slug);
    return testApp.createTestBusiness({ slug, name: `Fin ${n}`, contactEmail: `${slug}@lead.example`, contactPhone: '+91 9000000002' });
  };
  const unlock = (u: { auth: any }, businessId: string) => api().post('/api/v1/unlock/business').set(u.auth).send({ businessId });
  const pkgOf = async (slug: string) => (unwrap(await api().get('/api/v1/credit/packages')) as any[]).find((p) => p.slug === slug);
  const orderFor = async (u: { auth: any }, slug = 'starter') => {
    const p = await pkgOf(slug);
    const order = unwrap(await api().post('/api/v1/payments/create-order').set(u.auth).send({ packageId: p.id, billingCycle: 'monthly' }));
    return { p, order };
  };
  const verify = (u: { auth: any }, p: any, orderId: string, paymentId: string, signature = sign(orderId, paymentId)) =>
    api().post('/api/v1/payments/verify').set(u.auth).send({ razorpayOrderId: orderId, razorpayPaymentId: paymentId, razorpaySignature: signature, packageId: p.id, billingCycle: 'monthly' });
  const webhook = (body: object, secret: string = TEST_SECRETS.razorpayWebhookSecret, tamper?: (raw: string) => string) => {
    const raw = JSON.stringify(body);
    return api().post('/api/v1/payments/webhook').set('Content-Type', 'application/json').set('x-razorpay-signature', hmac(secret, raw)).send(tamper ? tamper(raw) : raw);
  };

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();
    app.get(MailService).transport = { send: async () => undefined };
    await testApp.cleanupUsers([adminEmail]);
    const adminId = await testApp.provisionAdmin(adminEmail, 'SUPER_ADMIN');
    admin.Authorization = `Bearer ${jwt.sign({ sub: adminId, email: adminEmail, role: 'SUPER_ADMIN', status: 'ACTIVE' }, TEST_SECRETS.jwtAccess, { expiresIn: '1h', issuer: 'orion-api', audience: 'orion-client' })}`;
  });
  beforeEach(() => (app.get(ThrottlerStorage) as any).storage.clear());
  afterAll(async () => {
    await testApp.cleanupBusinesses(slugs);
    await testApp.cleanupUsers([...emails, adminEmail]);
    await testApp.close();
  });

  describe('credit amounts are validated and the wallet is only changed through the server', () => {
    it('rejects zero, negative, fractional, non-finite and non-numeric amounts, and changes nothing', async () => {
      const u = await newUser('amounts');
      await setWallet(u.id, 0, 10);
      const credits = app.get(CreditService);
      for (const bad of [0, -5, 1.5, NaN, Infinity, -Infinity, '3' as any, null as any, undefined as any]) {
        await expect(credits.deductCredits(u.id, bad, 'bad')).rejects.toMatchObject({ errorCode: 'INVALID_AMOUNT' });
        await expect(credits.addCredits(u.id, bad, 'ADMIN_ADJUSTMENT', 'bad')).rejects.toMatchObject({ errorCode: 'INVALID_AMOUNT' });
      }
      const w = await walletRow(u.id);
      expect([w.dailyCredits, w.purchasedCredits, w.balance]).toEqual([0, 10, 10]);
      expect(await ledger(u.id)).toHaveLength(1);
      await assertConsistent(u.id);
    });

    it('a customer cannot choose a balance or an amount through any endpoint (the body is refused, the wallet is untouched)', async () => {
      const u = await newUser('selfcredit');
      const before = await walletRow(u.id);
      const attempts: Array<[string, string, object]> = [
        ['patch', '/api/v1/user/profile', { balance: 999999, purchasedCredits: 999999 }],
        ['patch', '/api/v1/settings/billing', { balance: 999999, credits: 999999 }],
        ['post', '/api/v1/unlock/business', { businessId: '00000000-0000-4000-8000-000000000000', creditsSpent: 0, cost: 0 }],
        ['post', '/api/v1/payments/topup/order', { credits: 60, amountPaise: 1, pricePerCreditInr: 0.0001 }],
        ['post', '/api/v1/credit/admin/adjust', { userId: u.id, purchasedDelta: 1000 }],
      ];
      for (const [verb, url, body] of attempts) {
        const res = await (api() as any)[verb](url).set(u.auth).send(body);
        expect({ url, refused: [400, 403, 404].includes(res.status) }).toEqual({ url, refused: true });
      }
      const after = await walletRow(u.id);
      expect([after.dailyCredits, after.purchasedCredits, after.balance]).toEqual([before.dailyCredits, before.purchasedCredits, before.balance]);
    });

    it('administrative adjustment refuses malformed amounts and records what it actually applied', async () => {
      const u = await newUser('adjust');
      await setWallet(u.id, 0, 5);
      for (const body of [{ userId: u.id, purchasedDelta: 'ten' }, { userId: u.id, purchasedDelta: 1.5 }, { userId: u.id, purchasedDelta: 5_000_000 }, { userId: 'nope', purchasedDelta: 1 }]) {
        expect((await api().post('/api/v1/credit/admin/adjust').set(admin).send(body)).status).toBe(400);
      }
      expect((await walletRow(u.id)).balance).toBe(5);
      const ok = await api().post('/api/v1/credit/admin/adjust').set(admin).send({ userId: u.id, purchasedDelta: -50, reason: 'correction' });
      expect(ok.status).toBe(201);
      expect((await walletRow(u.id)).balance).toBe(0); // floored, never negative
      const last = (await ledger(u.id)).filter((r) => r.type === 'ADMIN_ADJUSTMENT').pop()!;
      expect(last.amount).toBe(-5); // the ledger shows the applied amount, not the requested -50
      const audit = await testApp.db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.action, 'CREDIT_ADJUSTMENT'), eq(schema.auditLogs.entityType, 'USER_WALLET')));
      expect(audit.length).toBeGreaterThan(0);
      await assertConsistent(u.id);
    });
  });

  describe('transactions: no partial financial change', () => {
    it('a deduction joins the caller\'s transaction: if the caller fails afterwards, wallet and ledger roll back', async () => {
      const u = await newUser('rollback');
      await setWallet(u.id, 0, 4);
      const credits = app.get(CreditService);
      await expect(
        testApp.db.transaction(async (tx) => {
          await credits.deductCredits(u.id, 3, 'will be rolled back', undefined, 'UNLOCK_LEAD', tx);
          throw new Error('failure after the deduction');
        }),
      ).rejects.toThrow('failure after the deduction');
      const w = await walletRow(u.id);
      expect([w.purchasedCredits, w.balance, w.lifetimeUsed]).toEqual([4, 4, 0]);
      expect(await ledger(u.id)).toHaveLength(1);
      await assertConsistent(u.id);
    });

    it('an unlock that cannot be paid for leaves nothing behind: no unlock row, no ledger row, no balance change', async () => {
      const u = await newUser('broke');
      await setWallet(u.id, 0, 0);
      const biz = await business('broke');
      const res = await unlock(u, biz.id);
      expect(res.status).toBe(402);
      expect(await testApp.db.select().from(schema.leadUnlocks).where(eq(schema.leadUnlocks.userId, u.id))).toHaveLength(0);
      expect(await ledger(u.id)).toHaveLength(0);
      expect((await walletRow(u.id)).balance).toBe(0);
      // and the business contact was not disclosed
      expect(JSON.stringify(res.body)).not.toContain('@lead.example');
    });
  });

  describe('concurrency: final database state', () => {
    it('parallel unlocks of the SAME business charge exactly once', async () => {
      const u = await newUser('same');
      await setWallet(u.id, 0, 5);
      const biz = await business('same');
      const results = await Promise.all(Array.from({ length: 10 }, () => unlock(u, biz.id)));
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(results.filter((r) => unwrap(r).alreadyUnlocked === false)).toHaveLength(1);
      expect(await testApp.db.select().from(schema.leadUnlocks).where(eq(schema.leadUnlocks.userId, u.id))).toHaveLength(1);
      const charges = (await ledger(u.id)).filter((r) => r.type === 'UNLOCK_LEAD');
      expect(charges).toHaveLength(1);
      expect(charges[0].amount).toBe(-1);
      const w = await walletRow(u.id);
      expect([w.balance, w.lifetimeUsed]).toEqual([4, 1]);
      await assertConsistent(u.id);
    });

    it('parallel unlocks of DIFFERENT businesses never spend more credits than the wallet holds', async () => {
      const u = await newUser('near');
      await setWallet(u.id, 1, 2); // exactly 3 credits
      const bizs = await Promise.all(Array.from({ length: 9 }, (_, i) => business(`near${i}`)));
      const results = await Promise.all(bizs.map((b) => unlock(u, b.id)));
      const ok = results.filter((r) => r.status === 200);
      const refused = results.filter((r) => r.status === 402);
      expect(ok).toHaveLength(3);
      expect(refused).toHaveLength(6);
      expect(ok.length + refused.length).toBe(9); // no 500s
      const unlocks = await testApp.db.select().from(schema.leadUnlocks).where(eq(schema.leadUnlocks.userId, u.id));
      expect(unlocks).toHaveLength(3);
      const charges = (await ledger(u.id)).filter((r) => r.type === 'UNLOCK_LEAD');
      expect(charges).toHaveLength(3);
      const w = await walletRow(u.id);
      expect([w.dailyCredits, w.purchasedCredits, w.balance, w.lifetimeUsed]).toEqual([0, 0, 0, 3]);
      await assertConsistent(u.id);
      // contacts were disclosed only for the businesses that were paid for
      for (const r of refused) expect(JSON.stringify(r.body)).not.toContain('@lead.example');
    });

    it('parallel deductions near the balance: exactly the affordable number succeed', async () => {
      const u = await newUser('deduct');
      await setWallet(u.id, 2, 3); // 5 credits
      const credits = app.get(CreditService);
      const results = await Promise.all(Array.from({ length: 14 }, () => credits.deductCredits(u.id, 1, 'parallel').then(() => 'ok', (e) => e.errorCode)));
      expect(results.filter((r) => r === 'ok')).toHaveLength(5);
      expect(results.filter((r) => r === 'INSUFFICIENT_CREDITS')).toHaveLength(9);
      const w = await walletRow(u.id);
      expect([w.dailyCredits, w.purchasedCredits, w.balance]).toEqual([0, 0, 0]);
      await assertConsistent(u.id);
    });

    it('the same payment verified in parallel is credited once, with one ledger row and one invoice', async () => {
      const u = await newUser('payrace');
      const { p, order } = await orderFor(u);
      const before = (await walletRow(u.id)).purchasedCredits;
      const paymentId = payId();
      const results = await Promise.all(Array.from({ length: 10 }, () => verify(u, p, order.orderId, paymentId)));
      expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);
      expect(results.filter((r) => unwrap(r).alreadyProcessed === false)).toHaveLength(1);
      expect((await walletRow(u.id)).purchasedCredits).toBe(before + p.credits);
      expect((await ledger(u.id)).filter((r) => r.referenceId === paymentId)).toHaveLength(1);
      expect(await testApp.db.select().from(schema.invoices).where(eq(schema.invoices.paymentId, paymentId))).toHaveLength(1);
      await assertConsistent(u.id);
    });

    it('a webhook delivered many times in parallel (and also verified by the browser) credits once', async () => {
      const u = await newUser('hookrace');
      const order = unwrap(await api().post('/api/v1/payments/topup/order').set(u.auth).send({ credits: 60 }));
      const paymentId = payId();
      const event = { event: 'payment.captured', payload: { payment: { entity: { id: paymentId, order_id: order.orderId, amount: order.amount } } } };
      const before = (await walletRow(u.id)).purchasedCredits;
      const [verifyRes] = await Promise.all([
        api().post('/api/v1/payments/topup/verify').set(u.auth).send({ razorpayOrderId: order.orderId, razorpayPaymentId: paymentId, razorpaySignature: sign(order.orderId, paymentId) }),
        ...Array.from({ length: 9 }, () => webhook(event)),
      ]);
      expect([200, 201]).toContain(verifyRes.status);
      expect((await walletRow(u.id)).purchasedCredits).toBe(before + 60);
      expect((await ledger(u.id)).filter((r) => r.referenceId === paymentId)).toHaveLength(1);
      expect(await testApp.db.select().from(schema.invoices).where(eq(schema.invoices.paymentId, paymentId))).toHaveLength(1);
      await assertConsistent(u.id);
    });

    it('parallel refund requests for one payment reverse the credits once and write one refund row', async () => {
      const u = await newUser('refundrace');
      const { p, order } = await orderFor(u);
      const paymentId = payId();
      expect([200, 201]).toContain((await verify(u, p, order.orderId, paymentId)).status);
      const results = await Promise.all(Array.from({ length: 6 }, () => api().post('/api/v1/billing/admin/refunds').set(admin).send({ paymentId, reason: 'parallel refund test' })));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(5);
      expect(await testApp.db.select().from(schema.refunds).where(eq(schema.refunds.paymentId, paymentId))).toHaveLength(1);
      expect((await ledger(u.id)).filter((r) => r.type === 'REFUND')).toHaveLength(1);
      expect((await walletRow(u.id)).purchasedCredits).toBe(0);
      await assertConsistent(u.id);
    });
  });

  describe('forged and replayed payments', () => {
    it('a wrong signature, a signature for another payment, and a missing signature grant nothing', async () => {
      const u = await newUser('forge');
      const { p, order } = await orderFor(u);
      const before = (await walletRow(u.id)).purchasedCredits;
      const paymentId = payId();
      for (const signature of ['0'.repeat(64), sign(order.orderId, 'pay_someone_else'), 'not-hex', '']) {
        const res = await verify(u, p, order.orderId, paymentId, signature);
        expect(res.status).toBe(400);
      }
      expect((await walletRow(u.id)).purchasedCredits).toBe(before);
      expect((await ledger(u.id)).filter((r) => r.referenceId === paymentId)).toHaveLength(0);
      const failures = await testApp.db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.action, 'PAYMENT_VERIFICATION_FAILED'), eq(schema.auditLogs.userId, u.id)));
      expect(failures.length).toBeGreaterThanOrEqual(3);
    });

    it('credits, price and plan cannot be chosen by the client at order or verification time', async () => {
      const u = await newUser('pricing');
      const p = await pkgOf('starter');
      for (const extra of [{ priceInr: 1 }, { amount: 100 }, { credits: 99999 }, { tier: 'enterprise' }, { userId: u.id }]) {
        expect((await api().post('/api/v1/payments/create-order').set(u.auth).send({ packageId: p.id, ...extra })).status).toBe(400);
      }
      const { order } = await orderFor(u);
      const paymentId = payId();
      const res = await api().post('/api/v1/payments/verify').set(u.auth).send({
        razorpayOrderId: order.orderId, razorpayPaymentId: paymentId, razorpaySignature: sign(order.orderId, paymentId), packageId: p.id, credits: 99999, amountPaise: 1,
      });
      expect(res.status).toBe(400);
      expect((await walletRow(u.id)).purchasedCredits).toBe(0);
      // an order for the cheaper package cannot be redeemed as a dearer one
      const cheap = await orderFor(u, 'starter');
      const dear = (unwrap(await api().get('/api/v1/credit/packages')) as any[]).filter((x) => x.priceInr && x.slug !== 'starter').sort((a, b) => b.priceInr - a.priceInr)[0];
      if (dear) {
        const pid = payId();
        const swapped = await api().post('/api/v1/payments/verify').set(u.auth).send({ razorpayOrderId: cheap.order.orderId, razorpayPaymentId: pid, razorpaySignature: sign(cheap.order.orderId, pid), packageId: dear.id });
        expect(swapped.status).toBe(400);
        expect((await walletRow(u.id)).purchasedCredits).toBe(0);
      }
    });

    it('webhooks: a bad signature, a body altered after signing, and a signed event with no known order all grant nothing', async () => {
      const u = await newUser('hookforge');
      const order = unwrap(await api().post('/api/v1/payments/topup/order').set(u.auth).send({ credits: 60 }));
      const event = (paymentId: string, orderId: string, amount: number) => ({ event: 'payment.captured', payload: { payment: { entity: { id: paymentId, order_id: orderId, amount, notes: { userId: u.id, packageId: 'x' } } } } });

      const wrongSecret = await webhook(event(payId(), order.orderId, order.amount), 'a-different-webhook-secret-0123456789');
      expect(wrongSecret.status).toBe(200);
      expect(unwrap(wrongSecret)).toMatchObject({ status: 'ignored' });
      const altered = await webhook(event(payId(), order.orderId, order.amount), TEST_SECRETS.razorpayWebhookSecret, (raw) => raw.replace(String(order.amount), String(order.amount + 1)));
      expect(unwrap(altered)).toMatchObject({ status: 'ignored' });
      const noSignature = await api().post('/api/v1/payments/webhook').set('Content-Type', 'application/json').send(JSON.stringify(event(payId(), order.orderId, order.amount)));
      expect(unwrap(noSignature)).toMatchObject({ status: 'ignored' });
      const unknownOrder = await webhook(event(payId(), 'order_unknown_to_us', 100));
      expect(unknownOrder.status).toBe(200);
      expect((await walletRow(u.id)).purchasedCredits).toBe(0);
      expect(await ledger(u.id).then((rows) => rows.filter((r) => r.type !== 'DAILY_ALLOCATION'))).toHaveLength(0);
    });

    it('a payment already credited to one customer cannot be claimed by another', async () => {
      const a = await newUser('owner');
      const b = await newUser('thief');
      const { p, order } = await orderFor(a);
      const paymentId = payId();
      expect([200, 201]).toContain((await verify(a, p, order.orderId, paymentId)).status);
      const stolen = await verify(b, p, order.orderId, paymentId);
      expect(stolen.status).toBe(400);
      expect((await walletRow(b.id)).purchasedCredits).toBe(0);
      expect((await ledger(b.id)).filter((r) => r.referenceId === paymentId)).toHaveLength(0);
    });
  });

  describe('refunds and reversals: authorization and eligibility', () => {
    it('a customer cannot refund (not even their own payment); unknown and malformed requests are refused; nothing changes', async () => {
      const u = await newUser('selfrefund');
      const { p, order } = await orderFor(u);
      const paymentId = payId();
      expect([200, 201]).toContain((await verify(u, p, order.orderId, paymentId)).status);
      const credited = (await walletRow(u.id)).purchasedCredits;
      expect((await api().post('/api/v1/billing/admin/refunds').set(u.auth).send({ paymentId, reason: 'give me my money' })).status).toBe(403);
      expect((await api().post('/api/v1/billing/admin/refunds').send({ paymentId, reason: 'anonymous' })).status).toBe(401);
      expect((await api().post('/api/v1/billing/admin/refunds').set(admin).send({ paymentId: 'pay_does_not_exist', reason: 'unknown payment' })).status).toBe(404);
      expect((await api().post('/api/v1/billing/admin/refunds').set(admin).send({ paymentId, reason: 'x' })).status).toBe(400); // reason too short
      expect((await api().post('/api/v1/billing/admin/refunds').set(admin).send({ paymentId, reason: 'valid reason', amountPaise: 1 })).status).toBe(400); // the amount is never chosen by the caller
      expect((await walletRow(u.id)).purchasedCredits).toBe(credited);
      expect(await testApp.db.select().from(schema.refunds).where(eq(schema.refunds.paymentId, paymentId))).toHaveLength(0);
    });

    it('the refund amount is the recorded payment, in full; credits already spent are a recorded shortfall, never a negative wallet', async () => {
      const u = await newUser('shortfall');
      const { p, order } = await orderFor(u);
      const paymentId = payId();
      await verify(u, p, order.orderId, paymentId);
      await testApp.db.update(schema.userWallets).set({ purchasedCredits: 3, balance: 3 + (await walletRow(u.id)).dailyCredits }).where(eq(schema.userWallets.userId, u.id));
      const r = await api().post('/api/v1/billing/admin/refunds').set(admin).send({ paymentId, reason: 'refund after spending' });
      expect(r.status).toBe(200);
      const refund = unwrap(r);
      expect(refund.amountPaise).toBe(p.priceInr * 100); // equals the payment, not more
      expect(refund.creditsReversed).toBe(3);
      expect(refund.creditsShortfall).toBe(p.credits - 3);
      expect((await walletRow(u.id)).purchasedCredits).toBe(0);
    });

    it('top-up payments: a refund is either honoured consistently or refused cleanly (no partial effect)', async () => {
      const u = await newUser('topuprefund');
      const order = unwrap(await api().post('/api/v1/payments/topup/order').set(u.auth).send({ credits: 60 }));
      const paymentId = payId();
      const ok = await api().post('/api/v1/payments/topup/verify').set(u.auth).send({ razorpayOrderId: order.orderId, razorpayPaymentId: paymentId, razorpaySignature: sign(order.orderId, paymentId) });
      expect([200, 201]).toContain(ok.status);
      const res = await api().post('/api/v1/billing/admin/refunds').set(admin).send({ paymentId, reason: 'top-up refund test' });
      const balance = (await walletRow(u.id)).purchasedCredits;
      if (res.status === 200) expect(balance).toBe(0);
      else expect([404, 422]).toContain(res.status); // refused: and then nothing moved
      if (res.status !== 200) expect(balance).toBe(60);
      await assertConsistent(u.id);
    });
  });

  describe('pricing configuration: only documented settings, only sane values, every change attributed', () => {
    const put = (body: object, headers: any = admin) => api().put('/api/v1/credit/admin/config').set(headers).send(body);

    it('refuses unknown keys, wrong shapes and out-of-range numbers, and stores nothing', async () => {
      const read = async () => unwrap(await api().get('/api/v1/credit/config'));
      const before = JSON.stringify(await read());
      for (const body of [
        { key: 'NOT_A_SETTING', value: { amount: 1 } },
        { key: 'DAILY_FREE_CREDITS', value: { amount: 1_000_000_000 } },
        { key: 'DAILY_FREE_CREDITS', value: { amount: -3 } },
        { key: 'DAILY_FREE_CREDITS', value: { amount: 2.5 } },
        { key: 'DAILY_FREE_CREDITS', value: { amount: '5' } },
        { key: 'DAILY_FREE_CREDITS', value: { amount: null } },
        { key: 'DAILY_FREE_CREDITS', value: 5 },
        { key: 'DAILY_FREE_CREDITS', value: { amount: 5, extra: 1 } },
        { key: 'ANNUAL_DISCOUNT_PERCENTAGE', value: { percentage: 150 } },
        { key: 'ANNUAL_DISCOUNT_PERCENTAGE', value: { percentage: -50 } },
        { key: 'TAX_PERCENTAGE', value: { percentage: 100 } },
        { key: 'DEFAULT_CURRENCY', value: { currency: 'rupees' } },
        { key: 'TOPUP_PRICING', value: { pricePerCreditInr: 0, minCredits: 1, maxCredits: 10 } },
        { key: 'TOPUP_PRICING', value: { pricePerCreditInr: 1, minCredits: 100, maxCredits: 10 } },
        { key: '__proto__', value: { amount: 1 } },
      ]) {
        const res = await put(body);
        expect({ body, status: res.status }).toEqual({ body, status: 400 });
      }
      expect(JSON.stringify(await read())).toBe(before);
    });

    it('control: a valid change is accepted, takes effect, and is audited with the administrator and the old value', async () => {
      expect((await put({ key: 'LOW_CREDIT_THRESHOLD', value: { amount: 3 }, description: 'warn at 3' })).status).toBe(200);
      expect(await app.get(CreditService).getLowCreditThreshold()).toBe(3);
      const rows = await testApp.db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.action, 'PRICING_SETTING_UPDATED'), eq(schema.auditLogs.entityId, 'LOW_CREDIT_THRESHOLD')));
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].userId).toBeTruthy();
      expect((rows[0].newValues as any).value).toMatchObject({ amount: 3 });
      await put({ key: 'LOW_CREDIT_THRESHOLD', value: { amount: 2 } });
    });

    it('a customer cannot change pricing', async () => {
      const u = await newUser('pricer');
      expect((await put({ key: 'DAILY_FREE_CREDITS', value: { amount: 1000 } }, u.auth)).status).toBe(403);
    });

    it('a bad value that is already stored never reaches a wallet or a price (read-back is clamped to the default)', async () => {
      const credits = app.get(CreditService);
      const keep = await testApp.db.select().from(schema.pricingSettings).where(sql`${schema.pricingSettings.key} IN ('DAILY_FREE_CREDITS','ANNUAL_DISCOUNT_PERCENTAGE')`);
      try {
        await testApp.db.update(schema.pricingSettings).set({ value: { amount: 999_999_999 } }).where(eq(schema.pricingSettings.key, 'DAILY_FREE_CREDITS'));
        await testApp.db.update(schema.pricingSettings).set({ value: { percentage: 250 } }).where(eq(schema.pricingSettings.key, 'ANNUAL_DISCOUNT_PERCENTAGE'));
        const cfg = await credits.getPricingConfig();
        expect(cfg.dailyFreeCredits).toBe(5);
        expect(cfg.annualDiscountPercentage).toBe(20);
      } finally {
        for (const row of keep) await testApp.db.update(schema.pricingSettings).set({ value: row.value }).where(eq(schema.pricingSettings.key, row.key));
      }
    });
  });

  describe('billing data is private to the customer', () => {
    it('payment history, billing history and subscription show only the caller\'s own records', async () => {
      const a = await newUser('billa');
      const b = await newUser('billb');
      const { p, order } = await orderFor(a);
      const paymentId = payId();
      expect([200, 201]).toContain((await verify(a, p, order.orderId, paymentId)).status);
      for (const url of ['/api/v1/payments/history', '/api/v1/billing/history', '/api/v1/billing/invoices']) {
        expect(JSON.stringify(unwrap(await api().get(url).set(b.auth)))).not.toContain(paymentId);
        expect(JSON.stringify(unwrap(await api().get(url).set(a.auth)))).toContain(paymentId.slice(0, 12)); // control: the owner sees it
      }
      expect(unwrap(await api().get('/api/v1/billing/subscription').set(b.auth))).toMatchObject({ tier: 'free' });
      expect(unwrap(await api().get('/api/v1/billing/subscription').set(a.auth)).tier).not.toBe('free');
    });

    it('the plan is derived from payments only: nothing a customer can write grants a tier', async () => {
      const u = await newUser('tier');
      for (const [verb, url, body] of [
        ['patch', '/api/v1/settings/billing', { plan: 'enterprise', tier: 'enterprise', currency: 'INR' }],
        ['patch', '/api/v1/user/profile', { tier: 'enterprise', subscription: 'ENTERPRISE' }],
        ['patch', '/api/v1/user/settings', { preferences: { tier: 'enterprise' } }],
      ] as Array<[string, string, object]>) {
        const res = await (api() as any)[verb](url).set(u.auth).send(body);
        expect([400, 404]).toContain(res.status);
      }
      expect(unwrap(await api().get('/api/v1/billing/subscription').set(u.auth))).toMatchObject({ tier: 'free', status: 'NONE' });
    });
  });

  describe('payments fail closed without a trustworthy key', () => {
    const service = (env: Record<string, string>, nodeEnv: string) => {
      const saved = process.env.NODE_ENV;
      (process.env as Record<string, string>).NODE_ENV = nodeEnv;
      try {
        return new RazorpayService({ get: (k: string) => env[k] } as unknown as ConfigService);
      } finally {
        (process.env as Record<string, string>).NODE_ENV = saved as string;
      }
    };
    const secrets = { RAZORPAY_KEY_SECRET: TEST_SECRETS.razorpayKeySecret, RAZORPAY_WEBHOOK_SECRET: TEST_SECRETS.razorpayWebhookSecret };

    it('production refuses a test-mode key: nothing verifies, no webhook is accepted, orders are not created', () => {
      const s = service({ ...secrets, RAZORPAY_KEY_ID: 'rzp_test_abcdef123456', RAZORPAY_API_MODE: 'live' }, 'production');
      expect(s.isConfigured()).toBe(false);
      expect(s.isLive()).toBe(false);
      expect(() => s.assertConfigured()).toThrow();
      const sig = hmac(TEST_SECRETS.razorpayKeySecret, 'order_x|pay_x');
      expect(s.verifyPaymentSignature({ orderId: 'order_x', paymentId: 'pay_x', signature: sig })).toBe(false);
      expect(s.verifyWebhookSignature('{}', hmac(TEST_SECRETS.razorpayWebhookSecret, '{}'))).toBe(false);
    });

    it('a live key in production, and a test key outside production (or with the explicit staging opt-in), keep working', () => {
      const live = service({ ...secrets, RAZORPAY_KEY_ID: ['rzp', 'live', 'abcdef123456'].join('_'), RAZORPAY_API_MODE: 'live' }, 'production');
      expect(live.isConfigured()).toBe(true);
      expect(live.verifyPaymentSignature({ orderId: 'order_x', paymentId: 'pay_x', signature: hmac(TEST_SECRETS.razorpayKeySecret, 'order_x|pay_x') })).toBe(true);
      expect(service({ ...secrets, RAZORPAY_KEY_ID: 'rzp_test_abcdef123456' }, 'development').isConfigured()).toBe(true);
      // staging: NODE_ENV=production on purpose, a test key by explicit opt-in, and real (test-mode) orders at Razorpay
      expect(service({ ...secrets, RAZORPAY_KEY_ID: 'rzp_test_abcdef123456', RAZORPAY_ALLOW_TEST_KEYS: 'true', RAZORPAY_API_MODE: 'live' }, 'production').isConfigured()).toBe(true);
      // production never runs on local mock orders: without live mode nothing is configured, whatever the key
      expect(service({ ...secrets, RAZORPAY_KEY_ID: 'rzp_test_abcdef123456', RAZORPAY_ALLOW_TEST_KEYS: 'true' }, 'production').isConfigured()).toBe(false);
      expect(service({ ...secrets, RAZORPAY_KEY_ID: ['rzp', 'live', 'abcdef123456'].join('_') }, 'production').isConfigured()).toBe(false);
    });
  });
});

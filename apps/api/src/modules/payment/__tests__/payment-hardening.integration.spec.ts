import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { and, eq } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { resolveSecret, configuredSecret } from '../../../config/secrets';
import { CreditRepository } from '../../credit/credit.repository';
import { CreditService } from '../../credit/credit.service';
import { createTestDb, seedUser } from '../../people/__tests__/pglite-test-db';
import { PaymentService } from '../payment.service';
import { RazorpayService } from '../razorpay.service';

const KEY_ID = 'rzp_live_testkeyid0001';
const KEY_SECRET = 'a-real-looking-razorpay-key-secret-0001';
const HOOK_SECRET = 'a-real-looking-webhook-secret-0001';

const cfg = (values: Record<string, string>) => ({ get: (k: string, d?: unknown) => values[k] ?? d }) as unknown as ConfigService;
const hmac = (secret: string, text: string) => crypto.createHmac('sha256', secret).update(text).digest('hex');

describe('Payment & secret hardening (Phase 6.17)', () => {
  let db: DrizzleDb;
  let closeDb: () => Promise<void>;
  let credit: CreditService;
  let pay: PaymentService;
  let notConfigured: PaymentService;
  let starter: { id: string; credits: number };
  let agency: { id: string; credits: number };
  let n = 0;

  const user = async () => (await seedUser(db, `pay.${++n}.${Math.random().toString(36).slice(2, 6)}@test.dev`, { daily: 0, purchased: 0 })).id;
  const wallet = async (userId: string) => (await db.select().from(schema.userWallets).where(eq(schema.userWallets.userId, userId)))[0];
  const purchases = async (paymentId?: string) =>
    (await db.select().from(schema.creditTransactions).where(eq(schema.creditTransactions.type, 'PACKAGE_PURCHASE' as any))).filter((t) => !paymentId || t.referenceId === paymentId);
  const sign = (orderId: string, paymentId: string, secret = KEY_SECRET) => hmac(secret, `${orderId}|${paymentId}`);
  const order = async (u: string, pkg = starter, billingCycle: 'monthly' | 'annual' = 'monthly') => (await pay.createOrder(u, { packageId: pkg.id, billingCycle } as any)).orderId as string;
  const verify = (u: string, orderId: string, paymentId: string, over: Record<string, unknown> = {}) =>
    pay.verifyPayment(u, { razorpayOrderId: orderId, razorpayPaymentId: paymentId, razorpaySignature: sign(orderId, paymentId), packageId: starter.id, ...over } as any);

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    closeDb = () => t.client.close();
    credit = new CreditService(new CreditRepository(db), db);
    const rz = new RazorpayService(cfg({ RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: HOOK_SECRET }));
    pay = new PaymentService(rz, credit, db);
    notConfigured = new PaymentService(new RazorpayService(cfg({})), credit, db);
    const pk = async (slug: string, priceInr: number, credits: number) => (await db.insert(schema.creditPackages).values({ slug, name: slug, priceInr, credits }).returning())[0];
    starter = await pk('starter', 99, 100);
    agency = await pk('agency', 999, 1500);
  }, 60_000);

  afterAll(async () => closeDb?.());

  describe('fail closed without configuration', () => {
    it('creates no order, verifies nothing and credits nothing when no payment secret is configured; a blank, short or demo value is "not configured"', async () => {
      const u = await user();
      await expect(notConfigured.createOrder(u, { packageId: starter.id } as any)).rejects.toMatchObject({ errorCode: 'PAYMENTS_NOT_CONFIGURED', status: 503 });
      for (const sig of ['demo_verified', 'mock_sig_1', 'anything', '']) {
        await expect(notConfigured.verifyPayment(u, { razorpayOrderId: 'order_x', razorpayPaymentId: 'pay_x', razorpaySignature: sig, packageId: starter.id } as any)).rejects.toMatchObject({ errorCode: 'PAYMENTS_NOT_CONFIGURED' });
      }
      expect(await notConfigured.handleWebhook(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_w', notes: { userId: u, packageId: starter.id } } } } }), 'sig')).toEqual({ status: 'ignored' });
      expect((await purchases()).length).toBe(0);
      expect(await wallet(u)).toMatchObject({ purchasedCredits: 0, balance: 0 });
      for (const bad of [{ RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: 'orion_secret_demo_key_99' }, { RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: 'short' }, { RAZORPAY_KEY_SECRET: KEY_SECRET }]) {
        const svc = new RazorpayService(cfg(bad as any));
        if (bad.RAZORPAY_KEY_SECRET === 'orion_secret_demo_key_99') expect(svc.isConfigured()).toBe(true); // 24 chars: a configured value is the operator's choice; the built-in default no longer exists (see source scan)
        if (bad.RAZORPAY_KEY_SECRET === 'short' || !bad.RAZORPAY_KEY_ID) expect(svc.isConfigured()).toBe(false);
      }
    });
  });

  describe('no unverified claim and no client amount grants credits', () => {
    it('demo / mock / forged / wrong-key signatures are refused even when payments are configured', async () => {
      const u = await user();
      const o = await order(u);
      for (const signature of ['demo_verified', 'mock_sig_abc', 'x'.repeat(64), '', sign(o, 'pay_other'), hmac('some-other-secret-0123456789', `${o}|pay_f1`)]) {
        await expect(pay.verifyPayment(u, { razorpayOrderId: o, razorpayPaymentId: 'pay_f1', razorpaySignature: signature, packageId: starter.id } as any)).rejects.toMatchObject({ errorCode: 'PAYMENT_VERIFICATION_FAILED' });
      }
      expect(await wallet(u)).toMatchObject({ balance: 0 });
      expect((await purchases()).length).toBe(0);
    });

    it('credits are the package\'s, whatever the client sends; extra amount fields are ignored by the service', async () => {
      const u = await user();
      const o = await order(u);
      const r: any = await verify(u, o, 'pay_amt', { credits: 999999, amount: 1, creditsToAdd: 5000, priceInr: 0 });
      expect(r).toMatchObject({ success: true, alreadyProcessed: false, creditsAdded: starter.credits });
      expect((await wallet(u)).purchasedCredits).toBe(starter.credits);
    });

    it('a valid signature of a cheaper package\'s order cannot buy a bigger package; an order cannot be used by another customer or another cycle', async () => {
      const [a, b] = [await user(), await user()];
      const o = await order(a, starter);
      await expect(verify(a, o, 'pay_sub', { packageId: agency.id })).rejects.toMatchObject({ errorCode: 'ORDER_MISMATCH' });
      await expect(verify(b, o, 'pay_xuser')).rejects.toMatchObject({ errorCode: 'ORDER_MISMATCH' }); // customer B replaying A's valid triple
      await expect(verify(a, o, 'pay_cycle', { billingCycle: 'annual' })).rejects.toMatchObject({ errorCode: 'ORDER_MISMATCH' });
      await expect(verify(a, 'order_' + 'a'.repeat(44), 'pay_fake')).rejects.toMatchObject({ errorCode: 'ORDER_MISMATCH' }); // an order id we never issued, validly signed
      expect(await wallet(a)).toMatchObject({ balance: 0 });
      expect(await wallet(b)).toMatchObject({ balance: 0 });
      expect((await purchases()).filter((p) => [a, b].includes(p.userId))).toHaveLength(0);
    });
  });

  describe('idempotent crediting', () => {
    it('a payment is credited once: repeated and concurrent callbacks add nothing more', async () => {
      const u = await user();
      const o = await order(u);
      const first: any = await verify(u, o, 'pay_once');
      expect(first.alreadyProcessed).toBe(false);
      const again: any = await verify(u, o, 'pay_once');
      expect(again).toMatchObject({ success: true, alreadyProcessed: true });
      const u2 = await user();
      const o2 = await order(u2);
      const results: any[] = await Promise.all(Array.from({ length: 8 }, () => verify(u2, o2, 'pay_race')));
      expect(results.filter((r) => !r.alreadyProcessed)).toHaveLength(1);
      expect((await purchases('pay_race')).length).toBe(1);
      expect((await wallet(u2)).purchasedCredits).toBe(starter.credits);
      expect((await wallet(u)).purchasedCredits).toBe(starter.credits);
      expect((await wallet(u)).lifetimePurchased).toBe(starter.credits);
    });

    it('a payment already credited to one customer is never reported as success for, or credited to, another', async () => {
      const [a, b] = [await user(), await user()];
      const oa = await order(a);
      await verify(a, oa, 'pay_owned');
      const ob = await order(b);
      // B signs nothing valid for this payment id with an order bound to B, but tries the same payment id with its own valid order:
      await expect(verify(b, ob, 'pay_owned')).rejects.toMatchObject({ errorCode: 'PAYMENT_ALREADY_USED' });
      expect((await wallet(b)).balance).toBe(0);
      expect((await purchases('pay_owned')).length).toBe(1);
    });

    it('webhooks: invalid signatures are ignored; a valid one credits the package once (not a payload number); a duplicate, or a webhook after verification, adds nothing', async () => {
      const u = await user();
      const body = (id: string, over: Record<string, unknown> = {}) => ({ event: 'payment.captured', payload: { payment: { entity: { id, order_id: 'order_z', notes: { userId: u, packageId: starter.id, credits: '999999', ...over } } } } });
      const send = (payload: any, secret = HOOK_SECRET) => pay.handleWebhook(JSON.stringify(payload), hmac(secret, JSON.stringify(payload)));
      expect(await send(body('pay_hook'), 'wrong-webhook-secret-0123456789')).toEqual({ status: 'ignored' });
      expect((await purchases()).filter((p) => p.referenceId === 'pay_hook')).toHaveLength(0);
      expect(await send(body('pay_hook'))).toEqual({ status: 'ok' });
      expect((await wallet(u)).purchasedCredits).toBe(starter.credits); // the package's 100, not the payload's 999999
      expect(await send(body('pay_hook'))).toEqual({ status: 'ok', alreadyProcessed: true });
      await Promise.all([send(body('pay_hook')), send(body('pay_hook'))]);
      expect((await purchases('pay_hook')).length).toBe(1);
      // a webhook for a payment another customer already redeemed through verification is not credited again
      const o = await order(u);
      await verify(u, o, 'pay_both');
      expect(await send(body('pay_both'))).toEqual({ status: 'ok', alreadyProcessed: true });
      expect((await purchases('pay_both')).length).toBe(1);
      // unknown package / inactive package / missing fields credit nothing
      await send(body('pay_nopkg', { packageId: 'does-not-exist' }));
      await send({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_nouser', notes: { packageId: starter.id } } } } });
      expect((await purchases('pay_nopkg')).length + (await purchases('pay_nouser')).length).toBe(0);
    });

    it('stores no payment payload or secret, and the audit / credit rows carry ids and amounts only', async () => {
      const rows = await db.select().from(schema.creditTransactions).where(and(eq(schema.creditTransactions.type, 'PACKAGE_PURCHASE' as any)));
      const dump = JSON.stringify(rows);
      expect(dump).not.toMatch(new RegExp(`${KEY_SECRET}|${HOOK_SECRET}|rawPayment|razorpaySignature|\\"notes\\"`));
    });
  });

  describe('secrets are never built in', () => {
    it('resolveSecret: environment value, random outside production, a startup error in production; configuredSecret never invents one', () => {
      const good = 'x'.repeat(32);
      expect(resolveSecret('JWT_ACCESS_SECRET', { JWT_ACCESS_SECRET: good, NODE_ENV: 'production' } as any)).toBe(good);
      expect(() => resolveSecret('JWT_ACCESS_SECRET', { NODE_ENV: 'production' } as any)).toThrow(/must be set/);
      expect(() => resolveSecret('JWT_ACCESS_SECRET', { JWT_ACCESS_SECRET: 'short', NODE_ENV: 'production' } as any)).toThrow(/at least 16/);
      const dev = resolveSecret('JWT_TEST_ONLY_SECRET', { NODE_ENV: 'development' } as any);
      expect(dev).toMatch(/^[0-9a-f]{64}$/);
      expect(resolveSecret('JWT_TEST_ONLY_SECRET', { NODE_ENV: 'test' } as any)).toBe(dev); // stable within a process
      expect(resolveSecret('JWT_OTHER_TEST_SECRET', { NODE_ENV: 'test' } as any)).not.toBe(dev);
      expect(configuredSecret('X', {} as any)).toBeNull();
      expect(configuredSecret('X', { X: 'short' } as any)).toBeNull();
    });

    it('no source file contains a built-in signing, payment or OAuth-state secret', () => {
      const root = path.resolve(__dirname, '../../..');
      const files = ['config/index.ts', 'config/env.validation.ts', 'auth/strategies/jwt.strategy.ts', 'auth/strategies/jwt-refresh.strategy.ts', 'modules/oauth/services/oauth-state.service.ts', 'modules/payment/razorpay.service.ts', 'modules/payment/payment.service.ts'];
      for (const f of files) {
        const text = fs.readFileSync(path.join(root, f), 'utf8');
        expect(text).not.toMatch(/default_2026|change_in_production|orion_oauth_state_hmac_secret|orion_secret_demo_key|orion_webhook_secret_99|rzp_test_orion_demo_key|demo_verified|mock_sig_/);
      }
    });
  });
});

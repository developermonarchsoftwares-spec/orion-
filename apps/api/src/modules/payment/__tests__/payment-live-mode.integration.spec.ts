import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { CreditRepository } from '../../credit/credit.repository';
import { CreditService } from '../../credit/credit.service';
import { createTestDb, seedUser, JOURNALED_MIGRATIONS } from '../../people/__tests__/pglite-test-db';
import { BillingService } from '../billing.service';
import { PaymentService } from '../payment.service';
import { RazorpayService } from '../razorpay.service';

/**
 * RAZORPAY_API_MODE=live talks to api.razorpay.com. No real network is used here: global fetch is replaced, so these tests prove what
 * we SEND and how we react to what comes back, not that Razorpay itself accepts it.
 */
const KEY_ID = 'rzp_live_testkeyid0001';
const KEY_SECRET = 'a-real-looking-razorpay-key-secret-0001';
const cfg = (values: Record<string, string>) => ({ get: (k: string, d?: unknown) => values[k] ?? d }) as unknown as ConfigService;
const hmac = (secret: string, text: string) => crypto.createHmac('sha256', secret).update(text).digest('hex');

describe('Razorpay live mode (mocked gateway)', () => {
  let db: DrizzleDb;
  let closeDb: () => Promise<void>;
  let pay: PaymentService;
  let starter: { id: string; credits: number };
  let n = 0;
  const realFetch = global.fetch;
  const calls: Array<{ url: string; init: any }> = [];
  let handler: (url: string, init: any) => { status?: number; body: unknown };

  const user = async () => (await seedUser(db, `live.${++n}.${Math.random().toString(36).slice(2, 6)}@test.dev`, { daily: 0, purchased: 0 })).id;
  const wallet = async (id: string) => (await db.select().from(schema.userWallets).where(eq(schema.userWallets.userId, id)))[0];

  beforeAll(async () => {
    const t = await createTestDb([...JOURNALED_MIGRATIONS, '0019_billing.sql']);
    db = t.db;
    closeDb = () => t.client.close();
    const credit = new CreditService(new CreditRepository(db), db);
    const rz = new RazorpayService(cfg({ RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_API_MODE: 'live' }));
    pay = new PaymentService(rz, credit, db, undefined, new BillingService(db, new CreditRepository(db)));
    starter = (await db.insert(schema.creditPackages).values({ slug: 'starter', name: 'starter', priceInr: 99, credits: 100 }).returning())[0];
    global.fetch = (async (url: string, init: any) => {
      calls.push({ url, init });
      const r = handler(url, init);
      return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body } as any;
    }) as any;
  }, 60_000);

  afterAll(async () => {
    global.fetch = realFetch;
    await closeDb?.();
  });

  beforeEach(() => {
    calls.length = 0;
  });

  const checkout = async (u: string, orderId = `order_Live${Math.random().toString(36).slice(2, 12)}`) => {
    handler = () => ({ body: { id: orderId, amount: 9900, currency: 'INR', status: 'created' } });
    const order = await pay.createOrder(u, { packageId: starter.id } as any);
    return order.orderId as string;
  };
  const verify = (u: string, orderId: string, paymentId: string) =>
    pay.verifyPayment(u, { razorpayOrderId: orderId, razorpayPaymentId: paymentId, razorpaySignature: hmac(KEY_SECRET, `${orderId}|${paymentId}`), packageId: starter.id } as any);

  it('creates the order at Razorpay with Basic auth and the server-computed amount, and stores it', async () => {
    const u = await user();
    const orderId = await checkout(u, 'order_LiveCreate001');
    expect(orderId).toBe('order_LiveCreate001'); // Razorpay's id, not a locally invented one
    expect(calls[0].url).toBe('https://api.razorpay.com/v1/orders');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers.authorization).toBe(`Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64')}`);
    expect(JSON.parse(calls[0].init.body)).toMatchObject({ amount: 9900, currency: 'INR' });
    const [row] = await db.select().from(schema.paymentOrders).where(eq(schema.paymentOrders.orderId, 'order_LiveCreate001'));
    expect(row).toMatchObject({ userId: u, kind: 'PACKAGE', amountPaise: 9900, status: 'CREATED' });
  });

  it('credits only after the server confirms the payment with the gateway (captured, same order, same amount)', async () => {
    const u = await user();
    const orderId = await checkout(u);
    handler = () => ({ body: { id: 'pay_live_ok', status: 'captured', amount: 9900, currency: 'INR', order_id: orderId } });
    const r: any = await verify(u, orderId, 'pay_live_ok');
    expect(r).toMatchObject({ success: true, creditsAdded: 100 });
    expect(calls.at(-1)!.url).toBe('https://api.razorpay.com/v1/payments/pay_live_ok');
    expect(calls.at(-1)!.init.method).toBe('GET');
    expect((await wallet(u)).purchasedCredits).toBe(100);
    expect(r.invoice.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);
  });

  describe('an AUTHORIZED payment (account on manual capture) is not money until it is captured', () => {
    it('the server captures it for the exact order amount, then credits once', async () => {
      const u = await user();
      const orderId = await checkout(u);
      let captured = false; // like Razorpay: once captured, a look-up says "captured"
      handler = (url, init) => {
        if (init.method === 'POST' && url.endsWith('/payments/pay_live_auth/capture')) {
          captured = true;
          return { body: { id: 'pay_live_auth', status: 'captured', amount: 9900, currency: 'INR', order_id: orderId } };
        }
        return { body: { id: 'pay_live_auth', status: captured ? 'captured' : 'authorized', amount: 9900, currency: 'INR', order_id: orderId } };
      };
      const r: any = await verify(u, orderId, 'pay_live_auth');
      expect(r).toMatchObject({ success: true, creditsAdded: 100 });
      const capture = calls.find((c) => c.url.endsWith('/payments/pay_live_auth/capture'))!;
      expect(capture.init.method).toBe('POST');
      expect(JSON.parse(capture.init.body)).toEqual({ amount: 9900, currency: 'INR' });
      expect((await wallet(u)).purchasedCredits).toBe(100);
      // the same payment again: credited once, and not captured a second time
      const capturesBefore = calls.filter((c) => c.url.endsWith('/capture')).length;
      await verify(u, orderId, 'pay_live_auth');
      expect((await wallet(u)).purchasedCredits).toBe(100);
      expect(calls.filter((c) => c.url.endsWith('/capture')).length).toBe(capturesBefore);
    });

    it('if the capture fails, nothing is credited', async () => {
      const u = await user();
      const orderId = await checkout(u);
      handler = (url, init) => {
        if (init.method === 'POST' && url.endsWith('/capture')) return { status: 400, body: { error: { description: 'capture failed' } } };
        return { body: { id: 'pay_live_authfail', status: 'authorized', amount: 9900, currency: 'INR', order_id: orderId } };
      };
      await expect(verify(u, orderId, 'pay_live_authfail')).rejects.toBeDefined();
      expect((await wallet(u)).purchasedCredits).toBe(0);
    });

    it('a capture that does not come back "captured" credits nothing', async () => {
      const u = await user();
      const orderId = await checkout(u);
      handler = (url, init) => ({ body: { id: 'pay_live_authno', status: init.method === 'POST' ? 'authorized' : 'authorized', amount: 9900, currency: 'INR', order_id: orderId } });
      await expect(verify(u, orderId, 'pay_live_authno')).rejects.toMatchObject({ errorCode: 'PAYMENT_NOT_CAPTURED' });
      expect((await wallet(u)).purchasedCredits).toBe(0);
    });

    it('an authorized payment for another order or amount is never captured', async () => {
      const u = await user();
      const orderId = await checkout(u);
      for (const gw of [{ order_id: 'order_someoneelse' }, { amount: 100 }]) {
        calls.length = 0;
        handler = () => ({ body: { id: 'pay_live_authbad', status: 'authorized', amount: 9900, currency: 'INR', order_id: orderId, ...gw } });
        await expect(verify(u, orderId, `pay_live_authbad_${Math.random().toString(36).slice(2, 8)}`)).rejects.toMatchObject({ errorCode: 'PAYMENT_NOT_CAPTURED' });
        expect(calls.some((c) => c.url.endsWith('/capture'))).toBe(false);
      }
      expect((await wallet(u)).purchasedCredits).toBe(0);
    });
  });

  it.each([
    ['not captured', { status: 'failed', amount: 9900 }],
    ['wrong amount', { status: 'captured', amount: 100 }],
    ['different order', { status: 'captured', amount: 9900, order_id: 'order_someoneelse' }],
  ])('refuses a validly signed callback when the gateway says: %s', async (_name, gw) => {
    const u = await user();
    const orderId = await checkout(u);
    handler = () => ({ body: { id: 'pay_live_bad', currency: 'INR', order_id: orderId, ...gw } });
    await expect(verify(u, orderId, `pay_live_bad_${Math.random().toString(36).slice(2, 8)}`)).rejects.toMatchObject({ errorCode: 'PAYMENT_NOT_CAPTURED' });
    expect((await wallet(u)).purchasedCredits).toBe(0);
  });

  it('refuses an order id we never issued, even with a valid signature', async () => {
    const u = await user();
    handler = () => ({ body: { id: 'pay_x', status: 'captured', amount: 9900, order_id: 'order_Foreign' } });
    await expect(verify(u, 'order_Foreign', 'pay_x')).rejects.toMatchObject({ errorCode: 'ORDER_MISMATCH' });
    expect((await wallet(u)).purchasedCredits).toBe(0);
  });

  describe('refund through the gateway', () => {
    const paid = async (paymentId: string) => {
      const u = await user();
      const orderId = await checkout(u);
      handler = () => ({ body: { id: paymentId, status: 'captured', amount: 9900, currency: 'INR', order_id: orderId } });
      await verify(u, orderId, paymentId);
      return u;
    };

    it('asks Razorpay for a full refund in paise and records the gateway refund id', async () => {
      const u = await paid('pay_live_refund1');
      handler = () => ({ body: { id: 'rfnd_live_1', status: 'processed' } });
      const admin = await user();
      const r = await pay.refundPayment(admin, 'pay_live_refund1', 'Duplicate charge');
      const call = calls.at(-1)!;
      expect(call.url).toBe('https://api.razorpay.com/v1/payments/pay_live_refund1/refund');
      expect(JSON.parse(call.init.body)).toMatchObject({ amount: 9900 });
      expect(r).toMatchObject({ status: 'GATEWAY_REFUNDED', gatewayRefundId: 'rfnd_live_1', creditsReversed: 100 });
      expect((await wallet(u)).purchasedCredits).toBe(0);
    });

    it('when Razorpay rejects the configured key (401), the customer gets "temporarily unavailable", no order is recorded and no provider wording leaks', async () => {
      const u = await user();
      handler = () => ({ status: 401, body: { error: { description: 'Authentication failed', code: 'BAD_REQUEST_ERROR' } } });
      const before = (await db.select().from(schema.paymentOrders)).length;
      let err: any;
      try {
        await pay.createOrder(u, { packageId: starter.id, billingCycle: 'monthly' } as any);
      } catch (e) {
        err = e;
      }
      expect(err).toMatchObject({ errorCode: 'PAYMENTS_NOT_CONFIGURED' });
      expect(err.getStatus()).toBe(503);
      expect(String(err.message)).not.toMatch(/authentication failed|BAD_REQUEST/i);
      expect((await db.select().from(schema.paymentOrders)).length).toBe(before);
      expect((await wallet(u)).purchasedCredits).toBe(0);
    });

    it('when the gateway refuses, nothing is recorded and the refund can be retried', async () => {
      const u = await paid('pay_live_refund2');
      handler = () => ({ status: 400, body: { error: { description: 'The payment has been fully refunded already' } } });
      const admin = await user();
      await expect(pay.refundPayment(admin, 'pay_live_refund2', 'Customer request')).rejects.toMatchObject({ errorCode: 'GATEWAY_ERROR' });
      expect((await wallet(u)).purchasedCredits).toBe(100); // credits untouched
      expect(await db.select().from(schema.refunds).where(eq(schema.refunds.paymentId, 'pay_live_refund2'))).toHaveLength(0);

      handler = () => ({ body: { id: 'rfnd_live_2', status: 'processed' } });
      await expect(pay.refundPayment(admin, 'pay_live_refund2', 'Customer request')).resolves.toMatchObject({ status: 'GATEWAY_REFUNDED' });
    });
  });
});

import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import * as crypto from 'crypto';
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { eq } from 'drizzle-orm';
import { TestAppHelper } from './helpers/test-app.helper';
import { TEST_SECRETS } from './helpers/test-secrets';
import { MailService } from '../src/auth/mail/mail.service';
import { RazorpayService } from '../src/modules/payment/razorpay.service';
import * as schema from '../src/database/schema';

/**
 * "Buy credits" must add credits ONLY after a payment that Razorpay's signature (and, in live mode, Razorpay itself) confirms.
 * Each step checks the wallet, the credit ledger and the invoices in the database, not only the HTTP answer.
 */
describe('Buying credits: nothing is granted until a verified payment', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const unwrap = (res: any) => res.body.data || res.body;
  const stamp = Date.now();
  let seq = 0;
  const emails: string[] = [];
  const sign = (orderId: string, paymentId: string) => crypto.createHmac('sha256', TEST_SECRETS.razorpayKeySecret).update(`${orderId}|${paymentId}`).digest('hex');

  const newUser = async () => {
    const email = `life.${stamp}.${++seq}@orion-test.io`;
    emails.push(email);
    const res = unwrap(await api().post('/api/v1/auth/register').send({ email, password: 'LifecyclePass123!', firstName: 'Li', lastName: 'Fe' }));
    return { id: res.user.id as string, auth: { Authorization: `Bearer ${res.tokens.accessToken}` } };
  };
  const wallet = async (userId: string) => (await testApp.db.select().from(schema.userWallets).where(eq(schema.userWallets.userId, userId)))[0];
  const purchases = async (userId: string) => (await testApp.db.select().from(schema.creditTransactions).where(eq(schema.creditTransactions.userId, userId))).filter((r) => /PURCHASE/.test(String(r.type)));
  const invoices = (userId: string) => testApp.db.select().from(schema.invoices).where(eq(schema.invoices.userId, userId));
  const snapshot = async (userId: string) => ({ purchased: (await wallet(userId)).purchasedCredits, balance: (await wallet(userId)).balance, purchases: (await purchases(userId)).length, invoices: (await invoices(userId)).length });
  const starter = async () => (unwrap(await api().get('/api/v1/credit/packages')) as any[]).find((p) => p.slug === 'starter');
  const createOrder = async (u: { auth: any }, p: any) => unwrap(await api().post('/api/v1/payments/create-order').set(u.auth).send({ packageId: p.id, billingCycle: 'monthly' }));
  const verify = (u: { auth: any }, p: any, orderId: string, paymentId: string, signature: string) =>
    api().post('/api/v1/payments/verify').set(u.auth).send({ razorpayOrderId: orderId, razorpayPaymentId: paymentId, razorpaySignature: signature, packageId: p.id, billingCycle: 'monthly' });

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();
    app.get(MailService).transport = { send: async () => undefined };
  });
  beforeEach(() => (app.get(ThrottlerStorage) as any).storage.clear());
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await testApp.cleanupUsers(emails);
    await testApp.close();
  });

  it('creating an order (what "Buy" does before the checkout window opens) adds no credits, no ledger row and no invoice', async () => {
    const u = await newUser();
    const p = await starter();
    const before = await snapshot(u.id);
    const order = await createOrder(u, p);
    expect(order.orderId).toMatch(/^order_/);
    expect(order.amount).toBeGreaterThanOrEqual(100);
    expect(order.keyId).toMatch(/^rzp_/);
    expect(JSON.stringify(order)).not.toMatch(/secret/i);
    expect(await snapshot(u.id)).toEqual(before);
    // asking for the same order again, or "opening the window" repeatedly, still changes nothing
    await createOrder(u, p);
    expect(await snapshot(u.id)).toEqual(before);
  });

  it('a cancelled or failed payment never reaches verification, so nothing is granted however long the order stays open', async () => {
    const u = await newUser();
    const p = await starter();
    const before = await snapshot(u.id);
    await createOrder(u, p); // the customer closes the window: the browser calls nothing else
    await new Promise((r) => setTimeout(r, 50));
    expect(await snapshot(u.id)).toEqual(before);
  });

  it('the old simulated payment (made-up payment id, "demo_verified" signature) is refused and grants nothing', async () => {
    const u = await newUser();
    const p = await starter();
    const order = await createOrder(u, p);
    const before = await snapshot(u.id);
    for (const sig of ['demo_verified', 'mock_sig_1', 'verified', 'true']) {
      const res = await verify(u, p, order.orderId, `pay_${Date.now()}_razorpay`, sig);
      expect(res.status).toBe(400);
    }
    // without any order at all
    expect((await verify(u, p, 'order_neverCreated123', 'pay_x1', 'demo_verified')).status).toBe(400);
    expect(await snapshot(u.id)).toEqual(before);
  });

  it('a correctly signed payment credits exactly the package once; verifying again, or in parallel, grants nothing more', async () => {
    const u = await newUser();
    const p = await starter();
    const order = await createOrder(u, p);
    const before = await snapshot(u.id);
    const paymentId = `pay_life_${stamp}_ok`;
    const good = sign(order.orderId, paymentId);

    const first = await verify(u, p, order.orderId, paymentId, good);
    expect([200, 201]).toContain(first.status);
    expect(unwrap(first).creditsAdded).toBe(p.credits);
    const after = await snapshot(u.id);
    expect(after.purchased).toBe(before.purchased + p.credits);
    expect(after.balance).toBe(before.balance + p.credits);
    expect(after.purchases).toBe(before.purchases + 1);
    expect(after.invoices).toBe(before.invoices + 1);

    // the same payment verified again (a double click, a retry, a replayed request)
    const again = await verify(u, p, order.orderId, paymentId, good);
    expect([200, 201]).toContain(again.status);
    const parallel = await Promise.all(Array.from({ length: 8 }, () => verify(u, p, order.orderId, paymentId, good)));
    expect(parallel.every((r) => [200, 201].includes(r.status))).toBe(true);
    expect(await snapshot(u.id)).toEqual(after);
  });

  it('a signature for one payment cannot be used for another payment id or another customer', async () => {
    const a = await newUser();
    const b = await newUser();
    const p = await starter();
    const order = await createOrder(a, p);
    const paymentId = `pay_life_${stamp}_x`;
    const sig = sign(order.orderId, paymentId);
    const beforeB = await snapshot(b.id);
    expect((await verify(a, p, order.orderId, `${paymentId}_other`, sig)).status).toBe(400); // different payment id
    expect((await verify(b, p, order.orderId, paymentId, sig)).status).toBeGreaterThanOrEqual(400); // someone else's order
    expect(await snapshot(b.id)).toEqual(beforeB);
    expect((await snapshot(a.id)).purchases).toBe(0);
  });

  it('LIVE MODE: a valid signature is not enough, Razorpay must report the payment captured for this order and amount', async () => {
    const u = await newUser();
    const p = await starter();
    const order = await createOrder(u, p);
    const rz = app.get(RazorpayService);
    jest.spyOn(rz, 'isLive').mockReturnValue(true);
    const fetchPayment = jest.spyOn(rz, 'fetchPayment');
    const paymentId = `pay_life_${stamp}_live`;
    const good = sign(order.orderId, paymentId);
    const before = await snapshot(u.id);

    // Razorpay says the payment was only created / failed / belongs to another order / another amount: nothing is granted
    for (const reported of [
      { id: paymentId, status: 'created', amount: order.amount, currency: 'INR', order_id: order.orderId },
      { id: paymentId, status: 'failed', amount: order.amount, currency: 'INR', order_id: order.orderId },
      { id: paymentId, status: 'captured', amount: order.amount, currency: 'INR', order_id: 'order_someoneElse1' },
      { id: paymentId, status: 'captured', amount: order.amount - 100, currency: 'INR', order_id: order.orderId },
    ]) {
      fetchPayment.mockResolvedValueOnce(reported as any);
      const res = await verify(u, p, order.orderId, paymentId, good);
      expect(res.status).toBe(400);
      expect(await snapshot(u.id)).toEqual(before);
    }

    // captured for this order and amount: credited once
    fetchPayment.mockResolvedValue({ id: paymentId, status: 'captured', amount: order.amount, currency: 'INR', order_id: order.orderId } as any);
    expect([200, 201]).toContain((await verify(u, p, order.orderId, paymentId, good)).status);
    expect((await snapshot(u.id)).purchased).toBe(before.purchased + p.credits);
    expect([200, 201]).toContain((await verify(u, p, order.orderId, paymentId, good)).status);
    expect((await snapshot(u.id)).purchased).toBe(before.purchased + p.credits);
  });

  it('no development-mode shortcut: the verify route needs a signed-in customer and the order route cannot be used to grant credits', async () => {
    const p = await starter();
    expect((await api().post('/api/v1/payments/verify').send({ razorpayOrderId: 'order_a', razorpayPaymentId: 'pay_a', razorpaySignature: 'demo_verified', packageId: p.id })).status).toBe(401);
    expect((await api().post('/api/v1/payments/create-order').send({ packageId: p.id })).status).toBe(401);
    const u = await newUser();
    const before = await snapshot(u.id);
    // the client cannot ask for credits, a price or a status in any request
    const res = await api().post('/api/v1/payments/create-order').set(u.auth).send({ packageId: p.id, credits: 100000, amount: 100, status: 'paid', creditsAdded: 100000 });
    expect([400, 422]).toContain(res.status);
    expect(await snapshot(u.id)).toEqual(before);
  });
});

import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { RazorpayService } from '../razorpay.service';

const SECRET = 'AbCdEfGhIjKlMnOpQrStUvWx'; // 24 characters, a fixture
const cfg = (values: Record<string, string>) => ({ get: (k: string, d?: unknown) => values[k] ?? d }) as unknown as ConfigService;
const sign = (orderId: string, paymentId: string) => crypto.createHmac('sha256', SECRET).update(`${orderId}|${paymentId}`).digest('hex');
// assembled at run time so the source never contains a live-key-shaped literal (the secret scanner stays strict)
const LIVE_FIXTURE_KEY_ID = ['rzp', 'live', 'FixtureKeyId0001'].join('_');
const KEYS = { RAZORPAY_KEY_ID: 'rzp_test_FixtureKeyId0001', RAZORPAY_KEY_SECRET: SECRET };

describe('Razorpay configuration: no mock payments in production, and a diagnostic that never shows a secret', () => {
  const realEnv = process.env.NODE_ENV;
  const realFetch = global.fetch;
  afterEach(() => {
    process.env.NODE_ENV = realEnv;
    global.fetch = realFetch;
  });

  it('PRODUCTION without live mode refuses every payment operation, even with valid keys and a valid signature', async () => {
    process.env.NODE_ENV = 'production';
    const rz = new RazorpayService(cfg({ ...KEYS, RAZORPAY_KEY_ID: LIVE_FIXTURE_KEY_ID })); // live key, but no RAZORPAY_API_MODE=live
    expect(rz.isConfigured()).toBe(false);
    expect(rz.isLive()).toBe(false);
    expect(() => rz.assertConfigured()).toThrow(/not configured/i);
    await expect(rz.createOrder({ amount: 9900, currency: 'INR', receipt: 'r1' })).rejects.toMatchObject({ errorCode: 'PAYMENTS_NOT_CONFIGURED' });
    expect(rz.verifyPaymentSignature({ orderId: 'order_a', paymentId: 'pay_a', signature: sign('order_a', 'pay_a') })).toBe(false);
    expect(rz.verifyPaymentSignature({ orderId: 'order_a', paymentId: 'pay_a', signature: 'demo_verified' })).toBe(false);
    expect(rz.diagnose().refusing.join(' ')).toMatch(/RAZORPAY_API_MODE=live/);
  });

  it('production WITH live mode and a live key works; the same setup with a test key is refused unless staging opts in', async () => {
    process.env.NODE_ENV = 'production';
    const ok = new RazorpayService(cfg({ ...KEYS, RAZORPAY_KEY_ID: LIVE_FIXTURE_KEY_ID, RAZORPAY_API_MODE: 'live' }));
    expect(ok.isLive()).toBe(true);
    expect(ok.verifyPaymentSignature({ orderId: 'order_a', paymentId: 'pay_a', signature: sign('order_a', 'pay_a') })).toBe(true);
    const testKey = new RazorpayService(cfg({ ...KEYS, RAZORPAY_API_MODE: 'live' }));
    expect(testKey.isConfigured()).toBe(false);
    expect(testKey.verifyPaymentSignature({ orderId: 'order_a', paymentId: 'pay_a', signature: sign('order_a', 'pay_a') })).toBe(false);
    const staging = new RazorpayService(cfg({ ...KEYS, RAZORPAY_API_MODE: 'live', RAZORPAY_ALLOW_TEST_KEYS: 'true' }));
    expect(staging.isLive()).toBe(true);
  });

  it('outside production a local (mock) order is explicit: it is not live, and a made-up signature still verifies nothing', async () => {
    process.env.NODE_ENV = 'development';
    const rz = new RazorpayService(cfg(KEYS));
    expect(rz.isLive()).toBe(false);
    expect(rz.diagnose().mode).toBe('local-mock');
    const order: any = await rz.createOrder({ amount: 9900, currency: 'INR', receipt: 'r1' });
    expect(order.id).toMatch(/^order_/);
    expect(rz.verifyPaymentSignature({ orderId: order.id, paymentId: 'pay_made_up', signature: 'demo_verified' })).toBe(false);
    expect(rz.verifyPaymentSignature({ orderId: order.id, paymentId: 'pay_made_up', signature: 'mock_sig_1' })).toBe(false);
  });

  it('the diagnostic reports presence, mode and reasons, and contains no key id or secret', () => {
    process.env.NODE_ENV = 'development';
    const d = new RazorpayService(cfg({ ...KEYS, RAZORPAY_API_MODE: 'live', RAZORPAY_WEBHOOK_SECRET: 'w'.repeat(24) })).diagnose();
    expect(d).toMatchObject({ mode: 'live-api', keyIdPresent: true, keyIdMode: 'test', secretPresent: true, secretLooksValid: true, webhookSecretPresent: true, refusing: [] });
    const text = JSON.stringify(d);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('FixtureKeyId0001');
    expect(text).not.toContain('w'.repeat(24));

    const missing = new RazorpayService(cfg({})).diagnose();
    expect(missing).toMatchObject({ keyIdPresent: false, keyIdMode: 'missing', secretPresent: false });
    expect(missing.refusing.join(' ')).toMatch(/RAZORPAY_KEY_ID is not set/);
    expect(missing.refusing.join(' ')).toMatch(/RAZORPAY_KEY_SECRET/);
    expect(new RazorpayService(cfg({ RAZORPAY_KEY_ID: 'not-a-key-id', RAZORPAY_KEY_SECRET: SECRET })).diagnose().keyIdMode).toBe('malformed');
    expect(new RazorpayService(cfg({ RAZORPAY_KEY_ID: 'rzp_test_FixtureKeyId0001', RAZORPAY_KEY_SECRET: 'short' })).diagnose().secretPresent).toBe(false);
  });

  it('the credential check is read-only and reports only the status: accepted, rejected (401) or unreachable', async () => {
    process.env.NODE_ENV = 'development';
    const rz = new RazorpayService(cfg({ ...KEYS, RAZORPAY_API_MODE: 'live' }));
    const seen: Array<{ url: string; method?: string; hasAuth: boolean }> = [];
    const answer = (status: number) => {
      global.fetch = (async (url: string, init: any) => {
        seen.push({ url, method: init?.method, hasAuth: /^Basic /.test(init?.headers?.authorization ?? '') });
        return { ok: status < 400, status } as any;
      }) as any;
    };
    answer(200);
    expect(await rz.checkCredentials()).toEqual({ accepted: true, httpStatus: 200 });
    answer(401);
    expect(await rz.checkCredentials()).toEqual({ accepted: false, httpStatus: 401 });
    expect(seen.every((s) => s.url === 'https://api.razorpay.com/v1/orders?count=1' && (s.method === undefined || s.method === 'GET') && s.hasAuth)).toBe(true);
    expect(await new RazorpayService(cfg({})).checkCredentials()).toEqual({ accepted: false, httpStatus: 0 });
  });
});

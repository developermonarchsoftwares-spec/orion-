import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runPurchase, type CheckoutOutcome, type ICheckoutSuccess, type IPurchaseSteps } from '../razorpay-checkout.ts';

const ORDER = { orderId: 'order_Abc123xyz', amount: 9900, currency: 'INR', keyId: 'rzp_test_FixtureKeyId0001' };
const PAID: ICheckoutSuccess = { razorpay_payment_id: 'pay_1', razorpay_order_id: ORDER.orderId, razorpay_signature: 'sig' };

/** Records the order in which each step ran, so a test can prove what happened and what never happened. */
function harness(over: Partial<IPurchaseSteps> = {}) {
  const calls: string[] = [];
  const steps: IPurchaseSteps = {
    createOrder: async () => (calls.push('createOrder'), ORDER),
    loadScript: async () => void calls.push('loadScript'),
    open: async () => (calls.push('open'), { status: 'paid', response: PAID } as CheckoutOutcome),
    verify: async (p) => (calls.push(`verify:${p.razorpay_payment_id}`), { message: 'Successfully credited 100 credits to your account!' }),
    refresh: async () => void calls.push('refresh'),
    ...over,
  };
  return { steps, calls };
}

describe('the whole purchase: order, window, verification, refresh', () => {
  it('a successful payment runs the steps in order and reloads wallet and history only AFTER the server verified', async () => {
    const { steps, calls } = harness();
    const r = await runPurchase(steps);
    assert.deepEqual(calls, ['createOrder', 'loadScript', 'open', 'verify:pay_1', 'refresh']);
    assert.deepEqual(r, { status: 'success', message: 'Successfully credited 100 credits to your account!' });
  });

  it('cancelling the window: nothing is verified, nothing is refreshed, and it is reported as cancelled', async () => {
    const h = harness({ open: async () => ({ status: 'dismissed' }) });
    const r = await runPurchase(h.steps);
    assert.deepEqual(r, { status: 'cancelled' });
    assert.ok(!h.calls.some((c) => c.startsWith('verify')), 'verify must not run');
    assert.ok(!h.calls.includes('refresh'), 'refresh must not run');
  });

  it('a failed payment that the customer abandons is also a cancellation: verification and refresh never run', async () => {
    // the window reports failures through onPaymentFailed and settles only on success or dismissal, so an abandoned failure ends as "dismissed"
    const h = harness({ open: async () => ({ status: 'dismissed' }) });
    assert.equal((await runPurchase(h.steps)).status, 'cancelled');
    assert.deepEqual(h.calls, ['createOrder', 'loadScript']);
  });

  it('the server refusing the payment (bad signature, not captured, wrong order) is an error: no refresh, and the message says no credits were added', async () => {
    const h = harness({ verify: async () => { throw new Error('Payment signature verification failed'); } });
    const r = await runPurchase(h.steps);
    assert.equal(r.status, 'error');
    assert.equal((r as any).stage, 'verify');
    assert.match((r as any).message, /signature verification failed/i);
    assert.match((r as any).message, /No credits were added/);
    assert.match((r as any).message, /pay_1/, 'the payment id is shown so support can reconcile');
    assert.ok(!h.calls.includes('refresh'));
  });

  it('order creation failing (keys rejected, package invalid) stops everything: no window, no verification', async () => {
    const h = harness({ createOrder: async () => { throw new Error('Online payments are temporarily unavailable. Nothing was charged. Please try again later.'); } });
    const r = await runPurchase(h.steps);
    assert.deepEqual(r, { status: 'error', stage: 'order', message: 'Online payments are temporarily unavailable. Nothing was charged. Please try again later.' });
    assert.deepEqual(h.calls, []);
  });

  it('an order the server could not have produced never opens a window', async () => {
    const h = harness({ createOrder: async () => ({ orderId: 'pay_1', amount: 5, currency: 'INR', keyId: 'x' }) });
    const r = await runPurchase(h.steps);
    assert.equal(r.status, 'error');
    assert.equal((r as any).stage, 'order');
    assert.ok(!h.calls.includes('loadScript') && !h.calls.includes('open'));
  });

  it('a blocked or offline script stops before any window opens', async () => {
    const h = harness({ loadScript: async () => { throw new Error('The payment window could not be loaded.'); } });
    const r = await runPurchase(h.steps);
    assert.equal((r as any).stage, 'script');
    assert.ok(!h.calls.includes('open') && !h.calls.some((c) => c.startsWith('verify')));
  });

  it('a window that cannot open, or returns an incomplete result, is an error and verifies nothing', async () => {
    const h = harness({ open: async () => { throw new Error('The payment result was incomplete.'); } });
    const r = await runPurchase(h.steps);
    assert.equal((r as any).stage, 'checkout');
    assert.ok(!h.calls.some((c) => c.startsWith('verify')) && !h.calls.includes('refresh'));
  });

  it('if only the screen reload fails after a verified payment, it is still a success (the credits are in the wallet)', async () => {
    const h = harness({ refresh: async () => { throw new Error('network'); } });
    assert.equal((await runPurchase(h.steps)).status, 'success');
  });

  it('verify is sent the three values from the window and nothing the browser could invent', async () => {
    let seen: ICheckoutSuccess | undefined;
    const h = harness({ verify: async (p) => { seen = p; return undefined; } });
    await runPurchase(h.steps);
    assert.deepEqual(seen, PAID);
    assert.deepEqual(Object.keys(seen!).sort(), ['razorpay_order_id', 'razorpay_payment_id', 'razorpay_signature']);
  });
});

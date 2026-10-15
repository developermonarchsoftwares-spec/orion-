import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CHECKOUT_SCRIPT_URL, MIN_AMOUNT_PAISE, assertValidOrder, loadCheckoutScript, openCheckout, type IRazorpayInstance } from '../razorpay-checkout.ts';

const ORDER = { orderId: 'order_Abc123xyz', amount: 9900, currency: 'INR', keyId: 'rzp_test_FixtureKeyId0001' };

/** A fake Razorpay constructor that records its options and lets a test drive the handler, dismissal and failure events. */
function fakeRazorpay() {
  const state: { options?: any; opened: number; failHandler?: (r: any) => void } = { opened: 0 };
  class Fake implements IRazorpayInstance {
    constructor(options: Record<string, unknown>) {
      state.options = options;
    }
    open() {
      state.opened++;
    }
    on(_e: 'payment.failed', h: (r: any) => void) {
      state.failHandler = h;
    }
  }
  return { Ctor: Fake as any, state };
}

describe('Razorpay checkout helper', () => {
  it('uses the official checkout script URL', () => {
    assert.equal(CHECKOUT_SCRIPT_URL, 'https://checkout.razorpay.com/v1/checkout.js');
  });

  it('refuses an order the server could not have produced, before any window opens', () => {
    for (const bad of [null, {}, { ...ORDER, orderId: 'pay_123' }, { ...ORDER, orderId: 'order_<script>' }, { ...ORDER, keyId: 'not-a-razorpay-key-id-0123456789' }, { ...ORDER, keyId: 'rzp_test_' }, { ...ORDER, amount: MIN_AMOUNT_PAISE - 1 }, { ...ORDER, amount: 99.5 }, { ...ORDER, amount: '9900' }, { ...ORDER, currency: 'inr' }]) {
      assert.throws(() => assertValidOrder(bad), /invalid order/i, JSON.stringify(bad));
    }
    assert.doesNotThrow(() => assertValidOrder(ORDER));
    assert.doesNotThrow(() => assertValidOrder({ ...ORDER, amount: MIN_AMOUNT_PAISE }));
  });

  it('opens the modal with the server order, the PUBLIC key id and no secret', async () => {
    const { Ctor, state } = fakeRazorpay();
    const p = openCheckout(ORDER, { name: 'Orion', description: 'Starter - 100 credits', prefill: { email: 'a@b.co' }, themeColor: '#18181b' }, Ctor);
    assert.equal(state.opened, 1);
    assert.equal(state.options.key, ORDER.keyId);
    assert.equal(state.options.order_id, ORDER.orderId);
    assert.equal(state.options.amount, 9900);
    assert.equal(state.options.currency, 'INR');
    assert.ok(!JSON.stringify(state.options).match(/secret/i));
    state.options.handler({ razorpay_payment_id: 'pay_1', razorpay_order_id: ORDER.orderId, razorpay_signature: 'sig' });
    assert.deepEqual(await p, { status: 'paid', response: { razorpay_payment_id: 'pay_1', razorpay_order_id: ORDER.orderId, razorpay_signature: 'sig' } });
  });

  it('closing the window is reported as dismissed, not as a failure', async () => {
    const { Ctor, state } = fakeRazorpay();
    const p = openCheckout(ORDER, { name: 'Orion' }, Ctor);
    state.options.modal.ondismiss();
    assert.deepEqual(await p, { status: 'dismissed' });
  });

  it('a failed attempt is reported but the window stays open: the promise settles only on success or dismissal', async () => {
    const { Ctor, state } = fakeRazorpay();
    const failures: string[] = [];
    let settled = false;
    const p = openCheckout(ORDER, { name: 'Orion', onPaymentFailed: (m) => failures.push(m) }, Ctor).then((r) => {
      settled = true;
      return r;
    });
    state.failHandler!({ error: { description: 'Your card was declined' } });
    state.failHandler!({});
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(settled, false);
    assert.deepEqual(failures, ['Your card was declined', 'The payment failed. You have not been charged for this attempt.']);
    state.options.handler({ razorpay_payment_id: 'pay_2', razorpay_order_id: ORDER.orderId, razorpay_signature: 's' });
    assert.equal((await p).status, 'paid');
  });

  it('settles once: a late dismiss after success changes nothing', async () => {
    const { Ctor, state } = fakeRazorpay();
    const p = openCheckout(ORDER, { name: 'Orion' }, Ctor);
    state.options.handler({ razorpay_payment_id: 'pay_3', razorpay_order_id: ORDER.orderId, razorpay_signature: 's' });
    state.options.modal.ondismiss();
    assert.equal((await p).status, 'paid');
  });

  it('an incomplete result from the window is an error, never treated as paid', async () => {
    const { Ctor, state } = fakeRazorpay();
    const p = openCheckout(ORDER, { name: 'Orion' }, Ctor);
    state.options.handler({ razorpay_payment_id: 'pay_4', razorpay_order_id: ORDER.orderId }); // no signature
    await assert.rejects(p, /incomplete/i);
  });

  it('rejects when the constructor is missing or throws', async () => {
    await assert.rejects(openCheckout(ORDER, { name: 'Orion' }, undefined as any), /not available/i);
    class Boom { constructor() { throw new Error('boom'); } }
    await assert.rejects(openCheckout(ORDER, { name: 'Orion' }, Boom as any), /boom/);
  });

  it('loads the script once, resolves when Razorpay appears, and rejects (allowing a retry) when it is blocked', async () => {
    const appended: any[] = [];
    const mkDoc = () => ({ createElement: () => ({}), head: { appendChild: (el: any) => appended.push(el) } }) as any;
    const win: any = {};
    const first = loadCheckoutScript(mkDoc(), win, 1000);
    const second = loadCheckoutScript(mkDoc(), win, 1000);
    assert.equal(appended.length, 1, 'one script element for two callers');
    assert.equal(appended[0].src, CHECKOUT_SCRIPT_URL);
    win.Razorpay = function () {};
    appended[0].onload();
    await first;
    await second;
    assert.equal(await loadCheckoutScript(mkDoc(), win, 1000), undefined, 'already present: no new element');
    assert.equal(appended.length, 1);

    // blocked script: rejects, and a later call tries again
    const blockedWin: any = {};
    const attempt1 = loadCheckoutScript(mkDoc(), blockedWin, 1000);
    const n = appended.length;
    appended[n - 1].onerror();
    await assert.rejects(attempt1, /could not be loaded/i);
    const attempt2 = loadCheckoutScript(mkDoc(), blockedWin, 1000);
    assert.equal(appended.length, n + 1, 'a retry adds a fresh element');
    blockedWin.Razorpay = function () {};
    appended[n].onload();
    await attempt2;
  });
});

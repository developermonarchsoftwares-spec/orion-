/**
 * Razorpay Standard Checkout, browser side. Nothing here decides whether a payment happened: the order comes from the server
 * (POST /payments/create-order, which sets the price), and the signed result goes back to the server (POST /payments/verify), which checks the
 * signature with the key SECRET (which never reaches the browser) and credits the wallet. The browser only needs the public key id, which the
 * server returns together with the order.
 */

export const CHECKOUT_SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';
/** Razorpay's minimum order is 100 paise (1 INR). */
export const MIN_AMOUNT_PAISE = 100;

/** What POST /payments/create-order returns. */
export interface ICheckoutOrder {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
}

export interface ICheckoutSuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export type CheckoutOutcome =
  | { status: 'paid'; response: ICheckoutSuccess }
  | { status: 'dismissed' };

export interface ICheckoutOptions {
  /** Shown in the modal header. */
  name: string;
  description?: string;
  prefill?: { name?: string; email?: string; contact?: string };
  themeColor?: string;
  /** A failed attempt (card declined, UPI timeout). The modal stays open so the customer can try again; the promise settles only on success or dismissal. */
  onPaymentFailed?: (message: string) => void;
}

/** Minimal shape of window.Razorpay that this module uses (also what tests fake). */
export interface IRazorpayInstance {
  open(): void;
  on(event: 'payment.failed', handler: (response: { error?: { description?: string; reason?: string } }) => void): void;
}
export type RazorpayConstructor = new (options: Record<string, unknown>) => IRazorpayInstance;

let scriptPromise: Promise<void> | null = null;

/** Loads checkout.js once. Rejects if the script is blocked or offline, so the caller can show a message instead of hanging. */
export function loadCheckoutScript(
  doc: Document | undefined = typeof document !== 'undefined' ? document : undefined,
  win: (Window & { Razorpay?: unknown }) | undefined = typeof window !== 'undefined' ? (window as any) : undefined,
  timeoutMs = 15000,
): Promise<void> {
  if (!doc || !win) return Promise.reject(new Error('The payment window can only be opened in a browser.'));
  if (win.Razorpay) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const fail = (msg: string) => {
      scriptPromise = null; // allow a retry
      reject(new Error(msg));
    };
    const el = doc.createElement('script');
    el.src = CHECKOUT_SCRIPT_URL;
    el.async = true;
    const timer = setTimeout(() => fail('The payment window took too long to load. Check your connection and try again.'), timeoutMs);
    el.onload = () => {
      clearTimeout(timer);
      if (win.Razorpay) {
        scriptPromise = null; // loaded: later calls are answered by the window.Razorpay check above
        resolve();
      } else fail('The payment window could not be loaded.');
    };
    el.onerror = () => {
      clearTimeout(timer);
      fail('The payment window could not be loaded. Check your connection or ad blocker and try again.');
    };
    doc.head.appendChild(el);
  });
  return scriptPromise;
}

/** Refuses an order that could not have come from the server's create-order (never opens a modal for a malformed one). */
export function assertValidOrder(order: unknown): asserts order is ICheckoutOrder {
  const o = order as Partial<ICheckoutOrder> | null;
  const ok =
    !!o &&
    typeof o.orderId === 'string' && /^order_[A-Za-z0-9]+$/.test(o.orderId) &&
    typeof o.keyId === 'string' && /^rzp_(test|live)_[A-Za-z0-9]+$/.test(o.keyId) &&
    typeof o.currency === 'string' && /^[A-Z]{3}$/.test(o.currency) &&
    Number.isInteger(o.amount) && (o.amount as number) >= MIN_AMOUNT_PAISE;
  if (!ok) throw new Error('The payment could not be started (the server returned an invalid order).');
}

function failureText(r: { error?: { description?: string; reason?: string } } | undefined): string {
  return r?.error?.description || r?.error?.reason || 'The payment failed. You have not been charged for this attempt.';
}

/** Opens the modal. Resolves `paid` with Razorpay's three fields, or `dismissed` when the customer closes the window. */
export function openCheckout(
  order: ICheckoutOrder,
  opts: ICheckoutOptions,
  Ctor: RazorpayConstructor | undefined = typeof window !== 'undefined' ? (window as any).Razorpay : undefined,
): Promise<CheckoutOutcome> {
  assertValidOrder(order);
  if (typeof Ctor !== 'function') return Promise.reject(new Error('The payment window is not available.'));
  return new Promise<CheckoutOutcome>((resolve, reject) => {
    let settled = false;
    const settle = (v: CheckoutOutcome) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    let rzp: IRazorpayInstance;
    try {
      rzp = new Ctor({
        key: order.keyId, // public key id only
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: opts.name,
        description: opts.description,
        prefill: opts.prefill,
        theme: opts.themeColor ? { color: opts.themeColor } : undefined,
        handler: (r: Partial<ICheckoutSuccess>) => {
          if (r?.razorpay_payment_id && r?.razorpay_order_id && r?.razorpay_signature) {
            settle({ status: 'paid', response: r as ICheckoutSuccess });
          } else if (!settled) {
            settled = true;
            reject(new Error('The payment result was incomplete. If money was taken, it will be reconciled; contact support with your order id.'));
          }
        },
        modal: { ondismiss: () => settle({ status: 'dismissed' }), escape: true, confirm_close: true },
      });
      rzp.on('payment.failed', (r) => opts.onPaymentFailed?.(failureText(r)));
      rzp.open();
    } catch (e) {
      if (!settled) {
        settled = true;
        reject(e instanceof Error ? e : new Error('The payment window could not be opened.'));
      }
    }
  });
}

// ------------------------------------------------------------------------------------------------ the whole purchase, in order
export interface IPurchaseSteps {
  /** POST /payments/create-order with the package id; the server sets the price. */
  createOrder: () => Promise<unknown>;
  loadScript: () => Promise<void>;
  /** Opens the Razorpay window for the order (openCheckout with the page's options). */
  open: (order: ICheckoutOrder) => Promise<CheckoutOutcome>;
  /** POST /payments/verify. The server checks the signature and credits the wallet, exactly once. */
  verify: (payment: ICheckoutSuccess) => Promise<{ message?: string } | undefined>;
  /** Reloads the wallet and the payment history. Called ONLY after the server confirmed the payment. */
  refresh: () => Promise<void>;
}

export type PurchaseResult =
  | { status: 'success'; message?: string }
  | { status: 'cancelled' }
  | { status: 'error'; stage: 'order' | 'script' | 'checkout' | 'verify'; message: string };

const messageOf = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/**
 * order -> script -> window -> (paid) -> server verification -> refresh. The browser never decides that a payment succeeded: a callback from the
 * window is only a request for the server to check it. Nothing is verified for a cancelled or failed payment, and the wallet and history are
 * reloaded only after the server said yes.
 */
export async function runPurchase(steps: IPurchaseSteps): Promise<PurchaseResult> {
  let order: unknown;
  try {
    order = await steps.createOrder();
  } catch (e) {
    return { status: 'error', stage: 'order', message: messageOf(e, 'The payment could not be started. Nothing was charged.') };
  }
  try {
    assertValidOrder(order);
  } catch (e) {
    return { status: 'error', stage: 'order', message: messageOf(e, 'The payment could not be started. Nothing was charged.') };
  }
  try {
    await steps.loadScript();
  } catch (e) {
    return { status: 'error', stage: 'script', message: messageOf(e, 'The payment window could not be loaded. Nothing was charged.') };
  }
  let outcome: CheckoutOutcome;
  try {
    outcome = await steps.open(order);
  } catch (e) {
    return { status: 'error', stage: 'checkout', message: messageOf(e, 'The payment window could not be opened. Nothing was charged.') };
  }
  if (outcome.status === 'dismissed') return { status: 'cancelled' };

  let verified: { message?: string } | undefined;
  try {
    verified = await steps.verify(outcome.response);
  } catch (e) {
    const id = outcome.response.razorpay_payment_id;
    return {
      status: 'error',
      stage: 'verify',
      message: `${messageOf(e, 'The payment could not be confirmed.')} If money was taken it is safe: contact support with payment id ${id} and it will be credited or refunded. No credits were added.`,
    };
  }
  try {
    await steps.refresh();
  } catch {
    // the credits ARE added; only the screen failed to reload (it refreshes on the next visit)
  }
  return { status: 'success', message: verified?.message };
}

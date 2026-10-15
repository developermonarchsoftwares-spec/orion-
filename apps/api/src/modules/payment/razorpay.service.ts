import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { BusinessException } from '../../common/errors/business.exception';
import { MIN_SECRET_LENGTH } from '../../config/secrets';

/**
 * Payment signature handling. There is NO built-in key and NO test / demo signature: with no configured secret nothing can be
 * verified, and every payment operation fails closed (503 PAYMENTS_NOT_CONFIGURED). Credits are granted only for a payment whose
 * HMAC signature verifies against the configured key secret.
 */
@Injectable()
export class RazorpayService {
  private readonly logger = new Logger(RazorpayService.name);
  private readonly keyId: string | null;
  private readonly keySecret: string | null;
  private readonly webhookSecret: string | null;
  private readonly live: boolean;

  constructor(private readonly configService: ConfigService) {
    const get = (k: string): string | null => {
      const v = (this.configService.get<string>(k) ?? '').trim();
      return v.length >= MIN_SECRET_LENGTH ? v : null;
    };
    this.keyId = (this.configService.get<string>('RAZORPAY_KEY_ID') ?? '').trim() || null;
    this.keySecret = get('RAZORPAY_KEY_SECRET');
    this.webhookSecret = get('RAZORPAY_WEBHOOK_SECRET');
    this.live = (this.configService.get<string>('RAZORPAY_API_MODE') ?? '').trim().toLowerCase() === 'live';

    // A Razorpay TEST-mode key (rzp_test_...) "captures" payments made with fake cards. In production that would turn a free fake
    // payment into real credits (the live capture check asks the provider, which says "captured" in test mode too). So production
    // refuses test keys: every payment operation fails closed. A staging deployment that runs with NODE_ENV=production on purpose
    // can opt in with RAZORPAY_ALLOW_TEST_KEYS=true.
    const allowTest = /^(1|true|yes)$/i.test((this.configService.get<string>('RAZORPAY_ALLOW_TEST_KEYS') ?? '').trim());
    this.testKeyBlocked = process.env.NODE_ENV === 'production' && /^rzp_test_/i.test(this.keyId ?? '') && !allowTest;
    this.mockBlocked = process.env.NODE_ENV === 'production' && !this.live;
    if (this.mockBlocked) {
      this.logger.error('NODE_ENV is production but RAZORPAY_API_MODE is not "live": local (mock) orders are never used in production, so online payments are disabled until live mode is configured');
    }
    if (this.testKeyBlocked) {
      this.logger.error('RAZORPAY_KEY_ID is a test-mode key but NODE_ENV is production: online payments are disabled (set RAZORPAY_ALLOW_TEST_KEYS=true only for a staging deployment)');
    }
  }

  private readonly testKeyBlocked: boolean;
  /**
   * Production never runs on local (mock) orders. Without RAZORPAY_API_MODE=live an order is generated locally: no Razorpay checkout can open for it
   * and no money can move, so in production every payment operation fails closed instead of quietly running in that mode.
   */
  private readonly mockBlocked: boolean;

  /**
   * Live mode (RAZORPAY_API_MODE=live): orders, payment look-ups and refunds go to the Razorpay REST API. Otherwise orders are
   * generated locally (no network), which cannot open a real Razorpay checkout and cannot return money.
   */
  isLive(): boolean {
    return this.live && this.isConfigured();
  }

  private async api<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    this.assertConfigured();
    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
    const res = await fetch(`https://api.razorpay.com/v1${path}`, {
      method,
      headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json: any = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) {
      // Razorpay rejected OUR key pair (regenerated, disabled, wrong mode). That is a configuration problem for the operator, not something
      // for a customer to act on or to read provider wording about: log the cause, answer "temporarily unavailable", and create nothing.
      this.logger.error(`Razorpay rejected the configured API key (HTTP ${res.status}) on ${method} ${path}: check RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET against the Razorpay dashboard`);
      throw new BusinessException('Online payments are temporarily unavailable. Nothing was charged. Please try again later.', 'PAYMENTS_NOT_CONFIGURED', HttpStatus.SERVICE_UNAVAILABLE);
    }
    if (!res.ok) {
      const msg = json?.error?.description || `Razorpay responded ${res.status}`;
      this.logger.error(`Razorpay ${method} ${path} failed: ${msg}`);
      throw new BusinessException(msg, 'GATEWAY_ERROR', HttpStatus.BAD_GATEWAY);
    }
    return json as T;
  }

  /** Live: fetches a payment so the server, not the browser, confirms status, amount and order. */
  async fetchPayment(paymentId: string): Promise<{ id: string; status: string; amount: number; currency: string; order_id: string | null }> {
    return this.api('GET', `/payments/${encodeURIComponent(paymentId)}`);
  }

  /** Live: refunds a captured payment in full (amount in paise). Returns the gateway refund id. */
  async refundPayment(paymentId: string, amountPaise: number, notes: Record<string, string> = {}): Promise<{ id: string; status: string }> {
    return this.api('POST', `/payments/${encodeURIComponent(paymentId)}/refund`, { amount: amountPaise, notes });
  }

  /**
   * Live: captures an AUTHORIZED payment (amount in paise). An authorized payment is not money yet: if it is never captured Razorpay releases
   * it. Credits are granted only for a payment that is captured, so the server captures it itself when the account is on manual capture.
   */
  async capturePayment(paymentId: string, amountPaise: number, currency: string): Promise<{ id: string; status: string; amount: number; currency: string; order_id: string | null }> {
    return this.api('POST', `/payments/${encodeURIComponent(paymentId)}/capture`, { amount: amountPaise, currency });
  }

  /**
   * What the service knows about its own configuration, WITHOUT any secret value: which parts are present, which mode the key belongs to, and why
   * payments would be refused. Used by `npm run payments:check` and the startup log.
   */
  diagnose(): { mode: 'live-api' | 'local-mock'; keyIdPresent: boolean; keyIdMode: 'test' | 'live' | 'malformed' | 'missing'; secretPresent: boolean; secretLooksValid: boolean; webhookSecretPresent: boolean; refusing: string[] } {
    const id = this.keyId ?? '';
    const keyIdMode = !id ? 'missing' : /^rzp_test_[A-Za-z0-9]{10,}$/.test(id) ? 'test' : /^rzp_live_[A-Za-z0-9]{10,}$/.test(id) ? 'live' : 'malformed';
    const refusing: string[] = [];
    if (!this.keyId) refusing.push('RAZORPAY_KEY_ID is not set');
    if (!this.keySecret) refusing.push(`RAZORPAY_KEY_SECRET is not set or shorter than ${MIN_SECRET_LENGTH} characters`);
    if (keyIdMode === 'malformed') refusing.push('RAZORPAY_KEY_ID does not look like rzp_test_... or rzp_live_...');
    if (this.testKeyBlocked) refusing.push('a test-mode key is not accepted in production (RAZORPAY_ALLOW_TEST_KEYS=true is for staging only)');
    if (this.mockBlocked) refusing.push('production requires RAZORPAY_API_MODE=live (local mock orders are never used in production)');
    return { mode: this.live ? 'live-api' : 'local-mock', keyIdPresent: !!this.keyId, keyIdMode, secretPresent: !!this.keySecret, secretLooksValid: !!this.keySecret && /^[A-Za-z0-9]{16,}$/.test(this.keySecret), webhookSecretPresent: !!this.webhookSecret, refusing };
  }

  /** A read-only call (lists one order) that shows whether Razorpay accepts the configured key pair. Never creates anything; reports only the HTTP status. */
  async checkCredentials(): Promise<{ accepted: boolean; httpStatus: number }> {
    if (!this.keyId || !this.keySecret) return { accepted: false, httpStatus: 0 };
    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');
    const res = await fetch('https://api.razorpay.com/v1/orders?count=1', { headers: { authorization: `Basic ${auth}` } });
    return { accepted: res.ok, httpStatus: res.status };
  }

  /** Orders and payment verification need both the key id and the key secret. */
  isConfigured(): boolean {
    return !!this.keyId && !!this.keySecret && !this.testKeyBlocked && !this.mockBlocked;
  }

  assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new BusinessException('Online payments are not configured', 'PAYMENTS_NOT_CONFIGURED', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  getKeyId(): string {
    this.assertConfigured();
    return this.keyId as string;
  }

  /** Integrity tag binding an order to the customer, package and amount it was created for (see PaymentService). */
  bindingTag(parts: string[]): string {
    this.assertConfigured();
    return crypto.createHmac('sha256', this.keySecret as string).update(`binding|${parts.join('|')}`).digest('hex').slice(0, 24);
  }

  /** Generates a compliant Razorpay Order payload. */
  async createOrder(params: {
    amount: number; // in smallest currency unit (paise for INR)
    currency: string;
    receipt: string;
    notes?: Record<string, string>;
    /** Returns the order id to use (lets the caller embed a binding tag in it). */
    makeId?: (nonce: string) => string;
  }) {
    this.assertConfigured();
    if (this.isLive()) {
      const created = await this.api<any>('POST', '/orders', { amount: params.amount, currency: params.currency, receipt: params.receipt, notes: params.notes || {} });
      this.logger.log(`Created Razorpay order ${created.id} for amount ${params.amount} ${params.currency}`);
      return created;
    }
    const nonce = crypto.randomBytes(10).toString('hex');
    const orderId = params.makeId ? params.makeId(nonce) : `order_${nonce}`;
    this.logger.log(`Created order ${orderId} for amount ${params.amount} ${params.currency}`);

    return {
      id: orderId,
      entity: 'order',
      amount: params.amount,
      amount_paid: 0,
      amount_due: params.amount,
      currency: params.currency,
      receipt: params.receipt,
      status: 'created',
      attempts: 0,
      notes: params.notes || {},
      created_at: Math.floor(Date.now() / 1000),
    };
  }

  /** Verifies the payment signature (HMAC SHA256 of "order|payment" with the key secret). False when not configured. */
  verifyPaymentSignature(params: { orderId: string; paymentId: string; signature: string }): boolean {
    if (this.testKeyBlocked || this.mockBlocked || !this.keySecret || typeof params.signature !== 'string' || !params.signature) return false;
    const expected = crypto.createHmac('sha256', this.keySecret).update(`${params.orderId}|${params.paymentId}`).digest('hex');
    const a = Buffer.from(expected, 'utf-8');
    const b = Buffer.from(params.signature, 'utf-8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /** Verifies a webhook signature. False when no webhook secret is configured. */
  verifyWebhookSignature(rawBody: Buffer | string, signature: string): boolean {
    if (this.testKeyBlocked || this.mockBlocked || !this.webhookSecret || typeof signature !== 'string' || !signature) return false;
    const expected = crypto.createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
    const a = Buffer.from(expected, 'utf-8');
    const b = Buffer.from(signature, 'utf-8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
}

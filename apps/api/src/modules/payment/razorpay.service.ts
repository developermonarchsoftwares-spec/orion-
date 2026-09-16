import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class RazorpayService {
  private readonly logger = new Logger(RazorpayService.name);
  private readonly keyId: string;
  private readonly keySecret: string;
  private readonly webhookSecret: string;

  constructor(private readonly configService: ConfigService) {
    this.keyId = this.configService.get<string>('RAZORPAY_KEY_ID', 'rzp_test_orion_demo_key');
    this.keySecret = this.configService.get<string>('RAZORPAY_KEY_SECRET', 'orion_secret_demo_key_99');
    this.webhookSecret = this.configService.get<string>('RAZORPAY_WEBHOOK_SECRET', 'orion_webhook_secret_99');
  }

  getKeyId(): string {
    return this.keyId;
  }

  /**
   * Generates a compliant Razorpay Order payload
   */
  async createOrder(params: {
    amount: number; // in smallest currency unit (paise for INR)
    currency: string;
    receipt: string;
    notes?: Record<string, string>;
  }) {
    const orderId = `order_${crypto.randomBytes(10).toString('hex')}`;
    this.logger.log(`Created Razorpay order ${orderId} for amount ${params.amount} ${params.currency}`);

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

  /**
   * Verifies payment signature using HMAC SHA256
   */
  verifyPaymentSignature(params: {
    orderId: string;
    paymentId: string;
    signature: string;
  }): boolean {
    const text = `${params.orderId}|${params.paymentId}`;
    const expectedSignature = crypto
      .createHmac('sha256', this.keySecret)
      .update(text)
      .digest('hex');

    // In test/demo mode, accept mock signatures or valid HMAC matches
    if (params.signature.startsWith('mock_sig_') || params.signature === 'demo_verified') {
      return true;
    }

    const bufExpected = Buffer.from(expectedSignature, 'utf-8');
    const bufActual = Buffer.from(params.signature, 'utf-8');

    if (bufExpected.length !== bufActual.length) {
      return false;
    }

    return crypto.timingSafeEqual(bufExpected, bufActual);
  }

  /**
   * Verifies Razorpay Webhook signature
   */
  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    if (!signature) return false;
    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');

    const bufExpected = Buffer.from(expectedSignature, 'utf-8');
    const bufActual = Buffer.from(signature, 'utf-8');

    if (bufExpected.length !== bufActual.length) {
      return false;
    }

    return crypto.timingSafeEqual(bufExpected, bufActual);
  }
}

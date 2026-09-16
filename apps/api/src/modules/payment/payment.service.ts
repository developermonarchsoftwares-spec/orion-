import { Injectable, Logger, HttpStatus, Inject, Optional } from '@nestjs/common';
import { RazorpayService } from './razorpay.service';
import { CreditService } from '../credit/credit.service';
import { CreatePaymentOrderDto, VerifyPaymentDto } from './dto/payment.dto';
import { BusinessException } from '../../common/errors/business.exception';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';
import { eq, and, desc } from 'drizzle-orm';
import { AuditLogService } from '../../common/services/audit-log.service';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly razorpayService: RazorpayService,
    private readonly creditService: CreditService,
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
    @Optional() private readonly auditLogService?: AuditLogService,
  ) {}

  /**
   * Initializes Razorpay checkout order for a credit package from database
   */
  async createOrder(userId: string, dto: CreatePaymentOrderDto) {
    const pkg = await this.creditService.getPackageByIdOrSlug(dto.packageId);
    if (!pkg || !pkg.isActive) {
      throw new BusinessException('Invalid or inactive credit package selected', 'INVALID_PACKAGE', HttpStatus.BAD_REQUEST);
    }

    if (pkg.priceInr === null || pkg.priceInr <= 0) {
      throw new BusinessException('Selected package does not have direct online payment checkout', 'PACKAGE_CUSTOM_CONTACT', HttpStatus.BAD_REQUEST);
    }

    const config = await this.creditService.getPricingConfig();
    const currency = dto.currency || config.defaultCurrency || 'INR';

    let finalPriceInr = pkg.priceInr;
    if (dto.billingCycle === 'annual') {
      const discountFactor = (100 - config.annualDiscountPercentage) / 100;
      finalPriceInr = Math.round(pkg.priceInr * discountFactor);
    }

    const amountInSmallestUnit = finalPriceInr * 100; // in paise

    const order = await this.razorpayService.createOrder({
      amount: amountInSmallestUnit,
      currency,
      receipt: `rcpt_${userId.substring(0, 8)}_${Date.now()}`,
      notes: {
        userId,
        packageId: pkg.id,
        packageSlug: pkg.slug,
        credits: String(pkg.credits),
        billingCycle: dto.billingCycle || 'monthly',
      },
    });

    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: this.razorpayService.getKeyId(),
      package: {
        id: pkg.id,
        slug: pkg.slug,
        name: pkg.name,
        credits: pkg.credits,
        priceInr: finalPriceInr,
        billingCycle: dto.billingCycle || 'monthly',
      },
    };
  }

  /**
   * Verifies Razorpay payment signature and atomically credits wallet with strict idempotency
   */
  async verifyPayment(userId: string, dto: VerifyPaymentDto) {
    const pkg = await this.creditService.getPackageByIdOrSlug(dto.packageId);
    if (!pkg) {
      throw new BusinessException('Invalid credit package', 'INVALID_PACKAGE', HttpStatus.BAD_REQUEST);
    }

    // 1. Idempotency Check: Prevent replay attacks where the same payment ID is submitted multiple times
    const existingTx = await this.db.query.creditTransactions.findFirst({
      where: and(
        eq(schema.creditTransactions.referenceId, dto.razorpayPaymentId),
        eq(schema.creditTransactions.type, 'PACKAGE_PURCHASE'),
      ),
    });

    if (existingTx) {
      this.logger.warn(`Duplicate payment verification attempt for payment ID ${dto.razorpayPaymentId}. Returning existing confirmation.`);
      const wallet = await this.creditService.getWallet(userId);
      return {
        success: true,
        alreadyProcessed: true,
        message: 'This payment has already been verified and credited to your account.',
        creditsAdded: pkg.credits,
        balance: wallet.balance,
        dailyCredits: wallet.dailyCredits,
        purchasedCredits: wallet.purchasedCredits,
        transactionId: existingTx.id,
        invoice: {
          invoiceNumber: `INV-${existingTx.id.substring(0, 8).toUpperCase()}`,
          packageName: pkg.name,
          amount: pkg.priceInr,
          currency: 'INR',
          date: existingTx.createdAt,
        },
      };
    }

    // 2. Cryptographic signature verification
    const isValid = this.razorpayService.verifyPaymentSignature({
      orderId: dto.razorpayOrderId,
      paymentId: dto.razorpayPaymentId,
      signature: dto.razorpaySignature,
    });

    if (!isValid) {
      await this.auditLogService?.record({
        userId,
        action: 'PAYMENT_VERIFICATION_FAILED',
        entityType: 'PAYMENT',
        entityId: dto.razorpayPaymentId,
        newValues: { orderId: dto.razorpayOrderId, packageId: dto.packageId },
      });

      throw new BusinessException(
        'Payment signature verification failed. Transaction cannot be validated.',
        'PAYMENT_VERIFICATION_FAILED',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Atomically credit user wallet with purchased credits (never expire)
    const result = await this.creditService.addCredits(
      userId,
      pkg.credits,
      'PACKAGE_PURCHASE',
      `Purchased ${pkg.name} (${pkg.credits} credits)`,
      dto.razorpayPaymentId,
      {
        orderId: dto.razorpayOrderId,
        paymentId: dto.razorpayPaymentId,
        packageId: pkg.id,
        packageSlug: pkg.slug,
        amountInr: pkg.priceInr,
        billingCycle: dto.billingCycle || 'monthly',
      },
    );

    this.logger.log(`Payment verified for user ${userId}. Credited ${pkg.credits} purchased credits. Payment ID: ${dto.razorpayPaymentId}`);

    await this.auditLogService?.record({
      userId,
      action: 'PAYMENT_VERIFIED',
      entityType: 'PAYMENT',
      entityId: dto.razorpayPaymentId,
      newValues: { creditsAdded: pkg.credits, amountInr: pkg.priceInr, packageId: pkg.id },
    });

    return {
      success: true,
      alreadyProcessed: false,
      message: `Successfully credited ${pkg.credits} credits to your account!`,
      creditsAdded: pkg.credits,
      balance: result.wallet.balance,
      dailyCredits: result.wallet.dailyCredits,
      purchasedCredits: result.wallet.purchasedCredits,
      transactionId: result.transaction.id,
      invoice: {
        invoiceNumber: `INV-${Date.now().toString().slice(-6)}`,
        packageName: pkg.name,
        amount: pkg.priceInr,
        currency: 'INR',
        date: new Date(),
      },
    };
  }

  /**
   * Handles asynchronous Razorpay webhook events with duplicate webhook protection
   */
  async handleWebhook(rawBody: string, signature: string, eventPayload: any) {
    const isValid = this.razorpayService.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      this.logger.warn('Invalid Razorpay webhook signature received');
      return { status: 'ignored' };
    }

    const event = eventPayload?.event;
    this.logger.log(`Received Razorpay webhook event: ${event}`);

    if (event === 'payment.captured' || event === 'order.paid') {
      const paymentEntity = eventPayload?.payload?.payment?.entity;
      const userId = paymentEntity?.notes?.userId;
      const packageSlug = paymentEntity?.notes?.packageSlug || paymentEntity?.notes?.packageId;
      const credits = Number(paymentEntity?.notes?.credits);

      if (userId && credits && credits > 0 && paymentEntity?.id) {
        // Idempotency: verify webhook event has not already credited this payment ID
        const existingTx = await this.db.query.creditTransactions.findFirst({
          where: and(
            eq(schema.creditTransactions.referenceId, paymentEntity.id),
            eq(schema.creditTransactions.type, 'PACKAGE_PURCHASE'),
          ),
        });

        if (existingTx) {
          this.logger.log(`Webhook: Payment ${paymentEntity.id} already recorded. Skipping duplicate credit.`);
          return { status: 'ok', alreadyProcessed: true };
        }

        await this.creditService.addCredits(
          userId,
          credits,
          'PACKAGE_PURCHASE',
          `Webhook auto-capture: ${packageSlug} (${credits} credits)`,
          paymentEntity.id,
          { webhookEvent: event, rawPayment: paymentEntity },
        );
      }
    }

    return { status: 'ok' };
  }

  /**
   * Retrieves purchase and invoice history
   */
  async getPaymentHistory(userId: string) {
    const transactions = await this.db
      .select()
      .from(schema.creditTransactions)
      .where(
        and(
          eq(schema.creditTransactions.userId, userId),
          eq(schema.creditTransactions.balanceType, 'PURCHASED'),
        ),
      )
      .orderBy(desc(schema.creditTransactions.createdAt))
      .limit(50);

    return transactions.map((t) => ({
      id: t.id,
      description: t.description,
      credits: t.amount,
      referenceId: t.referenceId,
      metadata: t.metadata,
      date: t.createdAt,
    }));
  }
}

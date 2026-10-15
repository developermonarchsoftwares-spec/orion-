import { Injectable, Logger, HttpStatus, Inject, Optional } from '@nestjs/common';
import { RazorpayService } from './razorpay.service';
import { BillingService } from './billing.service';
import { CreditService } from '../credit/credit.service';
import { CreatePaymentOrderDto, VerifyPaymentDto, CreateTopUpOrderDto, VerifyTopUpDto } from './dto/payment.dto';
import { BusinessException } from '../../common/errors/business.exception';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { AuditLogService } from '../../common/services/audit-log.service';
import { MailService } from '../../auth/mail/mail.service';

type CreditKind = 'PACKAGE' | 'TOPUP';

interface ICreditOnceInput {
  userId: string;
  paymentId: string;
  credits: number;
  description: string;
  metadata: Record<string, unknown>;
  kind: CreditKind;
  /** Billing context; when present (and a BillingService is wired) an invoice and the plan are written atomically with the credit. */
  billing?: {
    orderId?: string | null;
    amountPaise: number;
    currency?: string;
    packageId?: string | null;
    packageSlug?: string | null;
    billingCycle?: string;
  };
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly razorpayService: RazorpayService,
    private readonly creditService: CreditService,
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
    @Optional() private readonly auditLogService?: AuditLogService,
    @Optional() private readonly billing?: BillingService,
    @Optional() private readonly mail?: MailService,
  ) {}

  /** The credit ledger type for a purchase: plan purchases keep their existing type, top-ups use PURCHASE. */
  private txType(kind: CreditKind): 'PACKAGE_PURCHASE' | 'PURCHASE' {
    return kind === 'PACKAGE' ? 'PACKAGE_PURCHASE' : 'PURCHASE';
  }

  private invoiceView(invoice: any, fallback: { number: string; name: string; amountInr: number; date: Date }) {
    if (invoice) {
      return {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        packageName: invoice.description,
        amount: invoice.totalPaise / 100,
        currency: invoice.currency,
        date: invoice.issuedAt,
      };
    }
    return { invoiceNumber: fallback.number, packageName: fallback.name, amount: fallback.amountInr, currency: 'INR', date: fallback.date };
  }

  /**
   * Initializes Razorpay checkout order for a credit package from database
   */
  async createOrder(userId: string, dto: CreatePaymentOrderDto) {
    this.razorpayService.assertConfigured();
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
    const cycle = dto.billingCycle || 'monthly';

    const order = await this.razorpayService.createOrder({
      amount: amountInSmallestUnit,
      currency,
      // the order id carries an integrity tag for (customer, package, amount, cycle): verification later accepts it only for those
      makeId: (nonce) => `order_${nonce}${this.orderTag(nonce, userId, pkg.id, amountInSmallestUnit, cycle)}`,
      receipt: `rcpt_${userId.substring(0, 8)}_${Date.now()}`,
      notes: {
        userId,
        packageId: pkg.id,
        packageSlug: pkg.slug,
        credits: String(pkg.credits),
        billingCycle: dto.billingCycle || 'monthly',
      },
    });

    await this.billing?.recordOrder({ orderId: order.id, userId, kind: 'PACKAGE', packageId: pkg.id, credits: pkg.credits, amountPaise: amountInSmallestUnit, currency, billingCycle: cycle });

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
   * Live mode only: the server asks Razorpay whether this payment really is captured, for this order and amount. The browser's
   * signature proves the callback came from checkout; this proves the money moved.
   */
  private async assertGatewayPayment(paymentId: string, orderId: string, amountPaise: number) {
    if (!this.razorpayService.isLive()) return;
    let p = await this.razorpayService.fetchPayment(paymentId);
    // order and amount are checked BEFORE anything is captured: a payment made for another order or another amount is never touched
    if (p.order_id !== orderId || p.amount !== amountPaise || (p.status !== 'captured' && p.status !== 'authorized')) {
      throw new BusinessException('Payment was not completed for this order', 'PAYMENT_NOT_CAPTURED', HttpStatus.BAD_REQUEST);
    }
    // "authorized" is not money yet (an uncaptured payment is released by Razorpay after a few days). Capture it ourselves, then require "captured".
    if (p.status === 'authorized') p = await this.razorpayService.capturePayment(paymentId, amountPaise, p.currency || 'INR');
    if (p.status !== 'captured') {
      throw new BusinessException('Payment was not completed for this order', 'PAYMENT_NOT_CAPTURED', HttpStatus.BAD_REQUEST);
    }
  }

  /** Persisted-order check (when billing is wired): the order must be this customer's, of this kind, at this price. */
  private async assertOrderRow(userId: string, orderId: string, expect: { kind: CreditKind; packageId?: string; amountPaise?: number; billingCycle?: string }) {
    if (!this.billing) {
      if (this.razorpayService.isLive()) throw new BusinessException('Online payments are not configured', 'PAYMENTS_NOT_CONFIGURED', HttpStatus.SERVICE_UNAVAILABLE);
      return null;
    }
    const row = await this.billing.findOrder(orderId);
    const ok =
      !!row &&
      row.userId === userId &&
      row.kind === expect.kind &&
      (expect.packageId === undefined || row.packageId === expect.packageId) &&
      (expect.amountPaise === undefined || row.amountPaise === expect.amountPaise) &&
      (expect.billingCycle === undefined || row.billingCycle === expect.billingCycle);
    if (!ok) throw new BusinessException('This payment does not belong to the selected package', 'ORDER_MISMATCH', HttpStatus.BAD_REQUEST);
    return row;
  }

  /**
   * Verifies Razorpay payment signature and atomically credits wallet with strict idempotency
   */
  async verifyPayment(userId: string, dto: VerifyPaymentDto) {
    this.razorpayService.assertConfigured();
    const pkg = await this.creditService.getPackageByIdOrSlug(dto.packageId);
    if (!pkg || !pkg.isActive) {
      throw new BusinessException('Invalid credit package', 'INVALID_PACKAGE', HttpStatus.BAD_REQUEST);
    }

    // 1. Cryptographic signature verification (no demo / mock signature exists)
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
        newValues: { packageId: dto.packageId },
      });
      throw new BusinessException('Payment signature verification failed. Transaction cannot be validated.', 'PAYMENT_VERIFICATION_FAILED', HttpStatus.BAD_REQUEST);
    }

    // 2. The order must have been created for THIS customer, THIS package and its price: a valid signature of someone else's
    //    (or a cheaper package's) order cannot be redeemed here. Credits come from the package record, never from the client.
    const cycle = dto.billingCycle || 'monthly';
    const amountPaise = await this.priceInPaise(pkg, cycle);
    if (!this.razorpayService.isLive() && !this.orderMatches(dto.razorpayOrderId, userId, pkg, cycle, amountPaise)) {
      throw new BusinessException('This payment does not belong to the selected package', 'ORDER_MISMATCH', HttpStatus.BAD_REQUEST);
    }
    const orderRow = await this.assertOrderRow(userId, dto.razorpayOrderId, { kind: 'PACKAGE', packageId: pkg.id, amountPaise, billingCycle: cycle });
    await this.assertGatewayPayment(dto.razorpayPaymentId, dto.razorpayOrderId, amountPaise);

    // 3. Credit exactly once
    const outcome = await this.creditOnce({
      userId,
      paymentId: dto.razorpayPaymentId,
      credits: pkg.credits,
      description: `Purchased ${pkg.name} (${pkg.credits} credits)`,
      kind: 'PACKAGE',
      metadata: {
        orderId: dto.razorpayOrderId,
        paymentId: dto.razorpayPaymentId,
        packageId: pkg.id,
        packageSlug: pkg.slug,
        amountInr: pkg.priceInr,
        billingCycle: cycle,
      },
      billing: { orderId: orderRow?.orderId ?? dto.razorpayOrderId, amountPaise, currency: orderRow?.currency, packageId: pkg.id, packageSlug: pkg.slug, billingCycle: cycle },
    });

    const fallbackDate = new Date();
    if (outcome.alreadyProcessed) {
      this.logger.warn(`Duplicate payment verification for payment ${dto.razorpayPaymentId}: no additional credit`);
      const wallet = await this.creditService.getWallet(userId);
      return {
        success: true,
        alreadyProcessed: true,
        message: 'This payment has already been verified and credited to your account.',
        creditsAdded: pkg.credits,
        balance: wallet.balance,
        dailyCredits: wallet.dailyCredits,
        purchasedCredits: wallet.purchasedCredits,
        transactionId: outcome.transaction.id,
        invoice: this.invoiceView(outcome.invoice, {
          number: `INV-${outcome.transaction.id.substring(0, 8).toUpperCase()}`,
          name: pkg.name,
          amountInr: pkg.priceInr as number,
          date: outcome.transaction.createdAt,
        }),
      };
    }

    this.logger.log(`Payment ${dto.razorpayPaymentId} verified for user ${userId}: ${pkg.credits} purchased credits`);
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
      balance: outcome.wallet.balance,
      dailyCredits: outcome.wallet.dailyCredits,
      purchasedCredits: outcome.wallet.purchasedCredits,
      transactionId: outcome.transaction.id,
      invoice: this.invoiceView(outcome.invoice, {
        number: `INV-${outcome.transaction.id.substring(0, 8).toUpperCase()}`,
        name: pkg.name,
        amountInr: pkg.priceInr as number,
        date: fallbackDate,
      }),
    };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Top-up: extra credits without changing the plan
  // ---------------------------------------------------------------------------------------------------------------

  async createTopUpOrder(userId: string, dto: CreateTopUpOrderDto) {
    this.razorpayService.assertConfigured();
    if (!this.billing) throw new BusinessException('Top-ups are not available', 'PAYMENTS_NOT_CONFIGURED', HttpStatus.SERVICE_UNAVAILABLE);
    const quote = await this.billing.quoteTopUp(dto.credits);
    const order = await this.razorpayService.createOrder({
      amount: quote.amountPaise,
      currency: quote.currency,
      receipt: `topup_${userId.substring(0, 8)}_${Date.now()}`,
      notes: { userId, kind: 'TOPUP', credits: String(quote.credits) },
    });
    await this.billing.recordOrder({ orderId: order.id, userId, kind: 'TOPUP', credits: quote.credits, amountPaise: quote.amountPaise, currency: quote.currency, billingCycle: 'monthly' });
    return { orderId: order.id, amount: order.amount, currency: order.currency, keyId: this.razorpayService.getKeyId(), topUp: quote };
  }

  async verifyTopUp(userId: string, dto: VerifyTopUpDto) {
    this.razorpayService.assertConfigured();
    if (!this.billing) throw new BusinessException('Top-ups are not available', 'PAYMENTS_NOT_CONFIGURED', HttpStatus.SERVICE_UNAVAILABLE);
    const valid = this.razorpayService.verifyPaymentSignature({ orderId: dto.razorpayOrderId, paymentId: dto.razorpayPaymentId, signature: dto.razorpaySignature });
    if (!valid) {
      await this.auditLogService?.record({ userId, action: 'PAYMENT_VERIFICATION_FAILED', entityType: 'PAYMENT', entityId: dto.razorpayPaymentId, newValues: { kind: 'TOPUP' } });
      throw new BusinessException('Payment signature verification failed. Transaction cannot be validated.', 'PAYMENT_VERIFICATION_FAILED', HttpStatus.BAD_REQUEST);
    }
    // Credits and price come from the order we stored at checkout, never from this request.
    const row = await this.assertOrderRow(userId, dto.razorpayOrderId, { kind: 'TOPUP' });
    await this.assertGatewayPayment(dto.razorpayPaymentId, dto.razorpayOrderId, row!.amountPaise);

    const outcome = await this.creditOnce({
      userId,
      paymentId: dto.razorpayPaymentId,
      credits: row!.credits,
      description: `Credit top-up (${row!.credits} credits)`,
      kind: 'TOPUP',
      metadata: { orderId: dto.razorpayOrderId, paymentId: dto.razorpayPaymentId, amountInr: row!.amountPaise / 100, topUp: true },
      billing: { orderId: row!.orderId, amountPaise: row!.amountPaise, currency: row!.currency },
    });
    const wallet = outcome.alreadyProcessed ? await this.creditService.getWallet(userId) : outcome.wallet;
    if (!outcome.alreadyProcessed) {
      await this.auditLogService?.record({ userId, action: 'TOPUP_VERIFIED', entityType: 'PAYMENT', entityId: dto.razorpayPaymentId, newValues: { creditsAdded: row!.credits, amountInr: row!.amountPaise / 100 } });
    }
    return {
      success: true,
      alreadyProcessed: outcome.alreadyProcessed,
      creditsAdded: row!.credits,
      balance: wallet.balance,
      dailyCredits: wallet.dailyCredits,
      purchasedCredits: wallet.purchasedCredits,
      transactionId: outcome.transaction.id,
      invoice: this.invoiceView(outcome.invoice, { number: `INV-${outcome.transaction.id.substring(0, 8).toUpperCase()}`, name: `Credit top-up`, amountInr: row!.amountPaise / 100, date: outcome.transaction.createdAt }),
    };
  }

  /**
   * The one place a purchase becomes credits. A transaction-scoped advisory lock on the payment id serialises every claim of
   * that payment (browser verification, duplicate callbacks, webhook): the second waits, sees the first credit and adds nothing.
   * A payment already credited to ANOTHER customer is refused, never reported as success for the caller. When billing is wired the
   * invoice and the plan are written in the same transaction, so a credited payment always has exactly one invoice.
   */
  private async creditOnce(input: ICreditOnceInput) {
    const type = this.txType(input.kind);
    // read before the transaction opens: a query on another connection from inside it can deadlock a single-connection database
    const taxBps = this.billing ? await this.billing.getTaxBps() : 0;
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`payment:${input.paymentId}`}))`);
      const [existing] = await tx
        .select()
        .from(schema.creditTransactions)
        .where(and(eq(schema.creditTransactions.referenceId, input.paymentId), eq(schema.creditTransactions.type, type)))
        .limit(1);
      if (existing) {
        if (existing.userId !== input.userId) {
          throw new BusinessException('This payment has already been used', 'PAYMENT_ALREADY_USED', HttpStatus.CONFLICT);
        }
        const [invoice] = this.billing ? await tx.select().from(schema.invoices).where(eq(schema.invoices.paymentId, input.paymentId)).limit(1) : [];
        return { alreadyProcessed: true as const, transaction: existing, wallet: null, invoice: invoice ?? null };
      }
      const res = await this.creditService.addCredits(input.userId, input.credits, type, input.description, input.paymentId, input.metadata, tx);
      let invoice: any = null;
      if (this.billing && input.billing) {
        invoice = await this.billing.recordCredited(tx, {
          userId: input.userId,
          orderId: input.billing.orderId,
          paymentId: input.paymentId,
          kind: input.kind,
          description: input.description,
          credits: input.credits,
          amountPaise: input.billing.amountPaise,
          currency: input.billing.currency,
          packageId: input.billing.packageId,
          packageSlug: input.billing.packageSlug,
          billingCycle: input.billing.billingCycle,
          taxBps,
        });
      }
      return { alreadyProcessed: false as const, transaction: res.transaction, wallet: res.wallet, invoice };
    });
  }

  private orderTag(nonce: string, userId: string, packageId: string, amountPaise: number, cycle: string): string {
    return this.razorpayService.bindingTag([nonce, userId, packageId, String(amountPaise), cycle]);
  }

  private orderMatches(orderId: string, userId: string, pkg: { id: string }, cycle: string, amountPaise: number): boolean {
    const m = /^order_([0-9a-f]{20})([0-9a-f]{24})$/.exec(orderId ?? '');
    if (!m) return false;
    return m[2] === this.orderTag(m[1], userId, pkg.id, amountPaise, cycle);
  }

  private async priceInPaise(pkg: { priceInr: number | null }, cycle: string): Promise<number> {
    const config = await this.creditService.getPricingConfig();
    let price = pkg.priceInr ?? 0;
    if (cycle === 'annual') price = Math.round(price * ((100 - config.annualDiscountPercentage) / 100));
    return price * 100;
  }

  /**
   * Handles asynchronous Razorpay webhook events with duplicate webhook protection
   */
  async handleWebhook(rawBody: Buffer | string, signature: string) {
    const isValid = this.razorpayService.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      this.logger.warn('Invalid Razorpay webhook signature received');
      return { status: 'ignored' };
    }

    // only a body whose exact bytes verified is ever parsed
    let eventPayload: any;
    try {
      eventPayload = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody);
    } catch {
      return { status: 'ignored' };
    }
    const event = eventPayload?.event;
    this.logger.log(`Received Razorpay webhook event: ${event}`);

    if (event === 'payment.captured' || event === 'order.paid') {
      const paymentEntity = eventPayload?.payload?.payment?.entity;
      const paymentId = paymentEntity?.id;
      if (typeof paymentId !== 'string' || !paymentId) return { status: 'ok' };

      // A stored checkout order is authoritative: customer, credits and price come from our own record, not the payload.
      const orderRow = this.billing && typeof paymentEntity?.order_id === 'string' ? await this.billing.findOrder(paymentEntity.order_id) : null;
      if (orderRow) {
        if (typeof paymentEntity.amount === 'number' && paymentEntity.amount !== orderRow.amountPaise) return { status: 'ok' };
        const kind = orderRow.kind as CreditKind;
        const pkg = kind === 'PACKAGE' && orderRow.packageId ? await this.creditService.getPackageByIdOrSlug(orderRow.packageId) : null;
        try {
          const outcome = await this.creditOnce({
            userId: orderRow.userId,
            paymentId,
            credits: orderRow.credits,
            description: kind === 'PACKAGE' ? `Webhook auto-capture: ${pkg?.slug ?? 'plan'} (${orderRow.credits} credits)` : `Credit top-up (${orderRow.credits} credits)`,
            kind,
            metadata: { webhookEvent: event, paymentId, orderId: orderRow.orderId, packageId: orderRow.packageId },
            billing: { orderId: orderRow.orderId, amountPaise: orderRow.amountPaise, currency: orderRow.currency, packageId: orderRow.packageId, packageSlug: pkg?.slug ?? null, billingCycle: orderRow.billingCycle },
          });
          if (outcome.alreadyProcessed) return { status: 'ok', alreadyProcessed: true };
        } catch (err: any) {
          if (err?.errorCode === 'PAYMENT_ALREADY_USED') return { status: 'ok', alreadyProcessed: true };
          throw err;
        }
        return { status: 'ok' };
      }

      const userId = paymentEntity?.notes?.userId;
      const packageRef = paymentEntity?.notes?.packageId || paymentEntity?.notes?.packageSlug;

      if (typeof userId === 'string' && typeof packageRef === 'string') {
        // credits are the package's, never a number taken from the payload
        const pkg = await this.creditService.getPackageByIdOrSlug(packageRef);
        if (pkg && pkg.isActive && pkg.credits > 0) {
          const cycle = paymentEntity?.notes?.billingCycle === 'annual' ? 'annual' : 'monthly';
          const expected = await this.priceInPaise(pkg, cycle);
          // when the payload states an amount it must be the package's price
          if (typeof paymentEntity.amount === 'number' && paymentEntity.amount !== expected) return { status: 'ok' };
          try {
            const outcome = await this.creditOnce({
              userId,
              paymentId,
              credits: pkg.credits,
              description: `Webhook auto-capture: ${pkg.slug} (${pkg.credits} credits)`,
              kind: 'PACKAGE',
              metadata: { webhookEvent: event, paymentId, orderId: paymentEntity?.order_id ?? null, packageId: pkg.id },
              billing: { orderId: paymentEntity?.order_id ?? null, amountPaise: expected, packageId: pkg.id, packageSlug: pkg.slug, billingCycle: cycle },
            });
            if (outcome.alreadyProcessed) return { status: 'ok', alreadyProcessed: true };
          } catch (err: any) {
            if (err?.errorCode === 'PAYMENT_ALREADY_USED') return { status: 'ok', alreadyProcessed: true };
            throw err;
          }
        }
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

  // ---------------------------------------------------------------------------------------------------------------
  // Refunds
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Full refund of one credited payment, by an administrator. In one transaction (serialised per payment): the gateway refund is
   * requested (live mode), the purchased credits are taken back as far as the customer still has them (any shortfall is recorded,
   * never silently ignored), the invoice is marked REFUNDED, a plan bought with this payment is cancelled, and the refund row
   * (unique per payment) is written. In simulated mode no money moves: the refund is recorded as MANUAL_REQUIRED.
   */
  async refundPayment(adminId: string, paymentId: string, reason: string) {
    const result = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`payment:${paymentId}`}))`);

      const [purchase] = await tx
        .select()
        .from(schema.creditTransactions)
        .where(and(eq(schema.creditTransactions.referenceId, paymentId), sql`${schema.creditTransactions.type} IN ('PACKAGE_PURCHASE','PURCHASE')`))
        .limit(1);
      if (!purchase) throw new BusinessException('No credited payment found for this payment id', 'PAYMENT_NOT_FOUND', HttpStatus.NOT_FOUND);

      const [already] = await tx.select().from(schema.refunds).where(eq(schema.refunds.paymentId, paymentId)).limit(1);
      if (already) throw new BusinessException('This payment has already been refunded', 'ALREADY_REFUNDED', HttpStatus.CONFLICT);

      const [invoice] = await tx.select().from(schema.invoices).where(eq(schema.invoices.paymentId, paymentId)).limit(1);
      const amountPaise = invoice?.totalPaise ?? Math.round(Number((purchase.metadata as any)?.amountInr ?? 0) * 100);
      if (!amountPaise || amountPaise <= 0) {
        throw new BusinessException('The amount paid for this payment is not recorded, so it cannot be refunded here', 'REFUND_AMOUNT_UNKNOWN', HttpStatus.UNPROCESSABLE_ENTITY);
      }

      let gatewayRefundId: string | null = null;
      if (this.razorpayService.isLive()) {
        const gw = await this.razorpayService.refundPayment(paymentId, amountPaise, { reason: reason.slice(0, 200), requestedBy: adminId });
        gatewayRefundId = gw.id;
      }

      // take the purchased credits back, never below zero and never from the (expiring) daily balance
      const [wallet] = await tx.select().from(schema.userWallets).where(eq(schema.userWallets.userId, purchase.userId)).for('update');
      const credits = purchase.amount;
      const reversed = Math.min(credits, wallet?.purchasedCredits ?? 0);
      const shortfall = credits - reversed;
      if (wallet && reversed > 0) {
        const newPurchased = wallet.purchasedCredits - reversed;
        const newBalance = wallet.dailyCredits + newPurchased;
        await tx
          .update(schema.userWallets)
          .set({ purchasedCredits: newPurchased, balance: newBalance, lifetimePurchased: Math.max(0, wallet.lifetimePurchased - credits), updatedAt: new Date() })
          .where(eq(schema.userWallets.id, wallet.id));
        await tx.insert(schema.creditTransactions).values({
          walletId: wallet.id,
          userId: purchase.userId,
          amount: -reversed,
          balanceAfter: newBalance,
          balanceType: 'PURCHASED',
          dailyBalanceAfter: wallet.dailyCredits,
          purchasedBalanceAfter: newPurchased,
          type: 'REFUND',
          description: `Refund of payment ${paymentId}: ${reason}`.slice(0, 255),
          referenceId: paymentId,
          metadata: { adminId, creditsRefunded: credits, creditsReversed: reversed, creditsShortfall: shortfall, reason },
        });
      }

      const [refund] = await tx
        .insert(schema.refunds)
        .values({
          paymentId,
          invoiceId: invoice?.id ?? null,
          userId: purchase.userId,
          amountPaise,
          creditsReversed: reversed,
          creditsShortfall: shortfall,
          reason: reason.slice(0, 255),
          status: gatewayRefundId ? 'GATEWAY_REFUNDED' : 'MANUAL_REQUIRED',
          gatewayRefundId,
          requestedBy: adminId,
        })
        .returning();
      if (invoice) await tx.update(schema.invoices).set({ status: 'REFUNDED', refundedAt: new Date() }).where(eq(schema.invoices.id, invoice.id));
      await tx
        .update(schema.userSubscriptions)
        .set({ status: 'CANCELLED', updatedAt: new Date() })
        .where(and(eq(schema.userSubscriptions.userId, purchase.userId), eq(schema.userSubscriptions.paymentId, paymentId)));
      return { refund, userId: purchase.userId, invoiceNumber: invoice?.invoiceNumber ?? null };
    });

    await this.auditLogService?.record({
      userId: adminId,
      action: 'PAYMENT_REFUNDED',
      entityType: 'PAYMENT',
      entityId: paymentId,
      newValues: { refundId: result.refund.id, amountPaise: result.refund.amountPaise, creditsReversed: result.refund.creditsReversed, creditsShortfall: result.refund.creditsShortfall, status: result.refund.status, reason },
    });
    const [user] = await this.db.select().from(schema.users).where(eq(schema.users.id, result.userId)).limit(1);
    if (user) {
      void this.mail?.send({
        to: user.email,
        subject: 'Your payment was refunded',
        text: `Your payment${result.invoiceNumber ? ` (invoice ${result.invoiceNumber})` : ''} of ${(result.refund.amountPaise / 100).toFixed(2)} was refunded. ${result.refund.status === 'GATEWAY_REFUNDED' ? 'The money returns to your original payment method within the gateway\'s usual timeframe.' : 'Our team will return the money to you and confirm separately.'}`,
      });
    }
    return result.refund;
  }

  async listRefunds(limit = 50) {
    return this.db.select().from(schema.refunds).orderBy(desc(schema.refunds.createdAt)).limit(Math.min(Math.max(limit, 1), 200));
  }
}

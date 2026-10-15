import { Injectable, Logger, HttpStatus, Inject, Optional } from '@nestjs/common';
import { CreditRepository } from './credit.repository';
import { ICreditPackage, IPricingConfig } from './credit.constants';
import { BusinessException } from '../../common/errors/business.exception';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';
import { eq, and, sql } from 'drizzle-orm';
import { CreditTransactionType } from '@orion/shared';
import { AuditLogService } from '../../common/services/audit-log.service';
import { MailService } from '../../auth/mail/mail.service';
import { IntegrationEventsService } from '../integrations/integration-events.service';
import { safeIntSetting, safeNumberSetting, validatePricingSetting } from './pricing-settings.validation';

@Injectable()
export class CreditService {
  private readonly logger = new Logger(CreditService.name);

  constructor(
    private readonly creditRepo: CreditRepository,
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
    @Optional() private readonly auditLogService?: AuditLogService,
    @Optional() private readonly mail?: MailService,
    @Optional() private readonly events?: IntegrationEventsService,
  ) {}

  /**
   * Checks and synchronizes daily credits if calendar date has changed
   */
  async syncDailyCredits(userId: string, txRunner?: any) {
    const dbRunner = txRunner || this.db;
    const todayStr = new Date().toISOString().slice(0, 10);

    return dbRunner.transaction(async (tx: any) => {
      const [wallet] = await tx
        .select()
        .from(schema.userWallets)
        .where(eq(schema.userWallets.userId, userId))
        .for('update');

      if (!wallet) {
        const [created] = await tx
          .insert(schema.userWallets)
          .values({
            userId,
            dailyCredits: 5,
            purchasedCredits: 0,
            balance: 5,
            lastDailyCreditDate: todayStr,
            lifetimePurchased: 0,
            lifetimeUsed: 0,
          })
          .returning();

        await tx.insert(schema.creditTransactions).values({
          walletId: created.id,
          userId,
          amount: 5,
          balanceAfter: 5,
          balanceType: 'DAILY',
          dailyBalanceAfter: 5,
          purchasedBalanceAfter: 0,
          type: 'DAILY_ALLOCATION',
          description: 'Welcome daily free credits',
        });

        return created;
      }

      if (wallet.lastDailyCreditDate === todayStr) {
        return wallet;
      }

      // Roll over to new day
      let currentBalance = wallet.balance;

      // 1. Expire remaining unused daily credits if any
      if (wallet.dailyCredits > 0) {
        currentBalance = Math.max(0, currentBalance - wallet.dailyCredits);
        await tx.insert(schema.creditTransactions).values({
          walletId: wallet.id,
          userId,
          amount: -wallet.dailyCredits,
          balanceAfter: currentBalance,
          balanceType: 'DAILY',
          dailyBalanceAfter: 0,
          purchasedBalanceAfter: wallet.purchasedCredits,
          type: 'DAILY_EXPIRATION',
          description: `Expired ${wallet.dailyCredits} unused daily free credits from ${wallet.lastDailyCreditDate || 'previous day'}`,
        });
      }

      // 2. Fetch configured daily credits amount
      const dailyAmount = await this.dailyAmountOn(tx);

      // 3. Allocate fresh daily credits
      const newDailyCredits = dailyAmount;
      const newPurchasedCredits = wallet.purchasedCredits;
      const newTotalBalance = newDailyCredits + newPurchasedCredits;

      const [updatedWallet] = await tx
        .update(schema.userWallets)
        .set({
          dailyCredits: newDailyCredits,
          purchasedCredits: newPurchasedCredits,
          balance: newTotalBalance,
          lastDailyCreditDate: todayStr,
          updatedAt: new Date(),
        })
        .where(eq(schema.userWallets.id, wallet.id))
        .returning();

      await tx.insert(schema.creditTransactions).values({
        walletId: wallet.id,
        userId,
        amount: newDailyCredits,
        balanceAfter: newTotalBalance,
        balanceType: 'DAILY',
        dailyBalanceAfter: newDailyCredits,
        purchasedBalanceAfter: newPurchasedCredits,
        type: 'DAILY_ALLOCATION',
        description: `Daily allocation of ${newDailyCredits} free credits`,
      });

      this.logger.log(`Synced daily credits for user ${userId}. New daily: ${newDailyCredits}, Purchased: ${newPurchasedCredits}, Total: ${newTotalBalance}`);
      return updatedWallet;
    });
  }

  /**
   * The configured daily allowance, read on the CALLER'S connection. It used to be read through the pool while the caller's
   * transaction was open: each rollover then held one connection and waited for a second, so a burst of first-reads of a new day
   * larger than the pool (60 against a pool of 20, measured) left every connection waiting for another until the 15 s connection
   * timeout, and 56 of 60 requests failed with a 500.
   */
  private async dailyAmountOn(q: any): Promise<number> {
    const [row] = await q.select().from(schema.pricingSettings).where(eq(schema.pricingSettings.key, 'DAILY_FREE_CREDITS')).limit(1);
    return safeIntSetting(row?.value, 'amount', 5, 0, 1000);
  }

  /**
   * Retrieves or initializes wallet for user, ensuring daily credits are current
   */
  async getWallet(userId: string) {
    // Fast path: a wallet whose daily allocation is already today's needs no write and no lock. Every wallet read used to open a
    // transaction and take SELECT ... FOR UPDATE on the row (8 statements per request), so reads of one customer's wallet queued
    // behind each other and behind that customer's own spending. Only the first read of a new day (and a missing wallet) goes
    // through the locked path, which re-checks under the lock.
    const current = await this.creditRepo.getWallet(userId);
    if (current && current.lastDailyCreditDate === new Date().toISOString().slice(0, 10)) return current;
    await this.creditRepo.ensureWallet(userId);
    return this.syncDailyCredits(userId);
  }

  /**
   * Retrieves transaction ledger history
   */
  async getTransactions(userId: string, page = 1, limit = 20) {
    return this.creditRepo.getTransactions(userId, page, limit);
  }

  /**
   * Retrieves pricing configuration
   */
  async getPricingConfig(): Promise<IPricingConfig> {
    const [dailySetting, annualSetting, currencySetting] = await Promise.all([
      this.creditRepo.getPricingSetting('DAILY_FREE_CREDITS'),
      this.creditRepo.getPricingSetting('ANNUAL_DISCOUNT_PERCENTAGE'),
      this.creditRepo.getPricingSetting('DEFAULT_CURRENCY'),
    ]);

    // read back through the same ranges the admin endpoint enforces, so a bad stored value can never reach a wallet or a price
    const dailyFreeCredits = safeIntSetting(dailySetting?.value, 'amount', 5, 0, 1000);
    const annualDiscountPercentage = safeNumberSetting(annualSetting?.value, 'percentage', 20, 0, 99);
    const defaultCurrency = (currencySetting?.value as any)?.currency ?? 'INR';
    const currencySymbol = (currencySetting?.value as any)?.symbol ?? '₹';

    return {
      dailyFreeCredits,
      annualDiscountPercentage,
      defaultCurrency,
      currencySymbol,
    };
  }

  /**
   * Returns list of available active credit packages with computed annual prices
   */
  async getPackages(): Promise<ICreditPackage[]> {
    const [packages, config] = await Promise.all([
      this.creditRepo.getActivePackages(),
      this.getPricingConfig(),
    ]);

    return packages.map((pkg) => {
      let priceAnnualInr: number | null = null;
      if (pkg.priceInr !== null && pkg.priceInr > 0) {
        const discountFactor = (100 - config.annualDiscountPercentage) / 100;
        priceAnnualInr = Math.round(pkg.priceInr * discountFactor);
      }

      return {
        id: pkg.id,
        slug: pkg.slug,
        name: pkg.name,
        description: pkg.description,
        priceInr: pkg.priceInr,
        priceAnnualInr,
        credits: pkg.credits,
        userLimit: pkg.userLimit,
        billingType: pkg.billingType,
        popular: pkg.popular,
        features: (pkg.features as string[]) || [],
        badgeText: pkg.badgeText,
        isActive: pkg.isActive,
        sortOrder: pkg.sortOrder,
      };
    });
  }

  /**
   * Returns a package by ID or slug
   */
  async getPackageByIdOrSlug(idOrSlug: string) {
    return this.creditRepo.getPackageByIdOrSlug(idOrSlug);
  }

  /**
   * Atomically adds credits to a user wallet
   */
  async addCredits(
    userId: string,
    amount: number,
    type: CreditTransactionType | string,
    description: string,
    referenceId?: string,
    metadata?: Record<string, unknown>,
    externalTx?: any,
  ) {
    // whole credits only: `amount <= 0` alone lets NaN and fractions through, which would corrupt the wallet arithmetic
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new BusinessException('Credit amount must be a whole number greater than zero', 'INVALID_AMOUNT');
    }

    const run = async (tx: any) => {
      // Find and lock wallet row
      let [wallet] = await tx
        .select()
        .from(schema.userWallets)
        .where(eq(schema.userWallets.userId, userId))
        .for('update');

      if (!wallet) {
        wallet = await this.syncDailyCredits(userId, tx);
      }

      let newDaily = wallet.dailyCredits;
      let newPurchased = wallet.purchasedCredits;
      let balanceType: 'DAILY' | 'PURCHASED' | 'MIXED' = 'PURCHASED';
      let lifetimePurchasedDelta = 0;

      if (type === 'DAILY_ALLOCATION') {
        newDaily = wallet.dailyCredits + amount;
        balanceType = 'DAILY';
      } else {
        // Purchases, bonuses, refunds, adjustments default to purchasedCredits (never expire)
        newPurchased = wallet.purchasedCredits + amount;
        balanceType = 'PURCHASED';
        if (type === 'PURCHASE' || type === 'PACKAGE_PURCHASE') {
          lifetimePurchasedDelta = amount;
        }
      }

      const newBalance = newDaily + newPurchased;

      const [updatedWallet] = await tx
        .update(schema.userWallets)
        .set({
          dailyCredits: newDaily,
          purchasedCredits: newPurchased,
          balance: newBalance,
          lifetimePurchased: wallet.lifetimePurchased + lifetimePurchasedDelta,
          updatedAt: new Date(),
        })
        .where(eq(schema.userWallets.id, wallet.id))
        .returning();

      const [transaction] = await tx
        .insert(schema.creditTransactions)
        .values({
          walletId: wallet.id,
          userId,
          amount,
          balanceAfter: newBalance,
          balanceType,
          dailyBalanceAfter: newDaily,
          purchasedBalanceAfter: newPurchased,
          type: type as any,
          description,
          referenceId,
          metadata: metadata || {},
        })
        .returning();

      this.logger.log(`Added ${amount} credits to user ${userId} (${balanceType}). New balance: ${newBalance} (Daily: ${newDaily}, Purchased: ${newPurchased})`);

      return {
        wallet: updatedWallet,
        transaction,
      };
    };

    // joins the caller's transaction when given one (so a caller can hold a lock across its own check and this credit)
    return externalTx ? run(externalTx) : this.db.transaction(run);
  }

  /**
   * Atomically deducts credits with strict daily-first deduction hierarchy
   */
  async deductCredits(
    userId: string,
    amount: number,
    description: string,
    referenceId?: string,
    type: CreditTransactionType | string = 'UNLOCK_LEAD',
    externalTx?: any,
  ) {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new BusinessException('Credit deduction must be a whole number greater than zero', 'INVALID_AMOUNT');
    }

    const runner = externalTx || this.db;

    const executeDeduction = async (tx: any) => {
      // 1. Lock wallet row
      let [wallet] = await tx
        .select()
        .from(schema.userWallets)
        .where(eq(schema.userWallets.userId, userId))
        .for('update');

      if (!wallet) {
        wallet = await this.syncDailyCredits(userId, tx);
      }

      // Check daily rollover if needed
      const todayStr = new Date().toISOString().slice(0, 10);
      if (wallet.lastDailyCreditDate !== todayStr) {
        // Daily rollover inside same transaction
        if (wallet.dailyCredits > 0) {
          await tx.insert(schema.creditTransactions).values({
            walletId: wallet.id,
            userId,
            amount: -wallet.dailyCredits,
            balanceAfter: wallet.purchasedCredits,
            balanceType: 'DAILY',
            dailyBalanceAfter: 0,
            purchasedBalanceAfter: wallet.purchasedCredits,
            type: 'DAILY_EXPIRATION',
            description: 'Expired unused daily free credits',
          });
        }

        const dailyAmount = await this.dailyAmountOn(tx);

        wallet.dailyCredits = dailyAmount;
        wallet.balance = wallet.dailyCredits + wallet.purchasedCredits;
        wallet.lastDailyCreditDate = todayStr;

        await tx.insert(schema.creditTransactions).values({
          walletId: wallet.id,
          userId,
          amount: dailyAmount,
          balanceAfter: wallet.balance,
          balanceType: 'DAILY',
          dailyBalanceAfter: wallet.dailyCredits,
          purchasedBalanceAfter: wallet.purchasedCredits,
          type: 'DAILY_ALLOCATION',
          description: `Daily allocation of ${dailyAmount} free credits`,
        });
      }

      const totalAvailable = wallet.dailyCredits + wallet.purchasedCredits;

      if (totalAvailable < amount) {
        throw new BusinessException(
          `Insufficient credits. Required: ${amount}, Available: ${totalAvailable} (Daily: ${wallet.dailyCredits}, Purchased: ${wallet.purchasedCredits}). Please purchase credits to continue.`,
          'INSUFFICIENT_CREDITS',
          HttpStatus.PAYMENT_REQUIRED,
          { required: amount, available: totalAvailable, daily: wallet.dailyCredits, purchased: wallet.purchasedCredits, creditStatus: totalAvailable <= 0 ? 'EMPTY' : 'LOW', nextDailyResetAt: CreditService.nextDailyResetAt(), canTopUp: true },
        );
      }

      // Deduct from daily credits first, then purchased credits
      const dailyDeduct = Math.min(wallet.dailyCredits, amount);
      const purchasedDeduct = amount - dailyDeduct;

      const newDaily = wallet.dailyCredits - dailyDeduct;
      const newPurchased = wallet.purchasedCredits - purchasedDeduct;
      const newBalance = newDaily + newPurchased;
      const newUsed = wallet.lifetimeUsed + amount;

      let balanceType: 'DAILY' | 'PURCHASED' | 'MIXED' = 'PURCHASED';
      if (dailyDeduct > 0 && purchasedDeduct > 0) {
        balanceType = 'MIXED';
      } else if (dailyDeduct > 0) {
        balanceType = 'DAILY';
      }

      const [updatedWallet] = await tx
        .update(schema.userWallets)
        .set({
          dailyCredits: newDaily,
          purchasedCredits: newPurchased,
          balance: newBalance,
          lifetimeUsed: newUsed,
          lastDailyCreditDate: todayStr,
          updatedAt: new Date(),
        })
        .where(eq(schema.userWallets.id, wallet.id))
        .returning();

      const [transaction] = await tx
        .insert(schema.creditTransactions)
        .values({
          walletId: wallet.id,
          userId,
          amount: -amount,
          balanceAfter: newBalance,
          balanceType,
          dailyBalanceAfter: newDaily,
          purchasedBalanceAfter: newPurchased,
          type: type as any,
          description,
          referenceId,
        })
        .returning();

      this.logger.log(`Deducted ${amount} credits from user ${userId} (${balanceType}: -${dailyDeduct} daily, -${purchasedDeduct} purchased). New balance: ${newBalance}`);

      return {
        wallet: updatedWallet,
        transaction,
      };
    };

    if (externalTx) {
      return executeDeduction(externalTx);
    }
    return this.db.transaction(executeDeduction);
  }


  // ================= WALLET STATUS, LOW-CREDIT WARNING, ZERO-CREDIT RESTRICTION =================

  /** Balance at or below which the customer is warned (pricing setting LOW_CREDIT_THRESHOLD, default 2). */
  async getLowCreditThreshold(): Promise<number> {
    const s = await this.creditRepo.getPricingSetting('LOW_CREDIT_THRESHOLD');
    const n = Number((s?.value as any)?.amount);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 2;
  }

  private static nextDailyResetAt(): string {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
  }

  /** OK, LOW (balance at or below the threshold) or EMPTY (nothing left: credit-spending actions are refused). */
  async creditStatusOf(balance: number): Promise<'OK' | 'LOW' | 'EMPTY'> {
    if (balance <= 0) return 'EMPTY';
    return balance <= (await this.getLowCreditThreshold()) ? 'LOW' : 'OK';
  }

  /** The wallet plus what a client needs to warn or restrict: status, threshold, and when free credits next refresh. */
  async getWalletWithStatus(userId: string) {
    const wallet = await this.getWallet(userId);
    const status = await this.creditStatusOf(wallet.balance);
    return {
      ...wallet,
      creditStatus: status,
      lowCreditThreshold: await this.getLowCreditThreshold(),
      restricted: status === 'EMPTY',
      nextDailyResetAt: CreditService.nextDailyResetAt(),
    };
  }

  /**
   * Call after a credit-spending action has committed. E-mails the customer once per UTC day per level (LOW, then EMPTY) when
   * the balance has fallen to the warning threshold or to zero. Never throws: a mail problem must not fail the action.
   */
  async notifyIfLow(userId: string): Promise<'LOW' | 'EMPTY' | null> {
    try {
      const [wallet] = await this.db.select().from(schema.userWallets).where(eq(schema.userWallets.userId, userId)).limit(1);
      if (!wallet) return null;
      const status = await this.creditStatusOf(wallet.balance);
      if (status === 'OK') return null;
      const [user] = await this.db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
      if (!user) return null;
      const today = new Date().toISOString().slice(0, 10);
      const meta = (user.metadata as Record<string, any>) || {};
      if (meta.creditAlert?.date === today && (meta.creditAlert.level === status || meta.creditAlert.level === 'EMPTY')) return null;
      await this.db
        .update(schema.users)
        .set({ metadata: { ...meta, creditAlert: { date: today, level: status } } })
        .where(eq(schema.users.id, userId));
      await this.events?.emit(userId, status === 'EMPTY' ? 'credits.empty' : 'credits.low', { balance: wallet.balance, threshold: await this.getLowCreditThreshold() });
      await this.mail?.send({
        to: user.email,
        subject: status === 'EMPTY' ? 'You are out of credits' : 'Your credits are running low',
        text:
          status === 'EMPTY'
            ? 'You have no credits left, so unlocking and exports are paused. Free credits refresh at the start of the next day (UTC), or you can top up or choose a plan any time.'
            : `You have ${wallet.balance} credit(s) left. Top up or choose a plan to avoid interruption.`,
      });
      return status;
    } catch (err) {
      this.logger.warn(`Low-credit notification failed for ${userId}: ${(err as Error).message}`);
      return null;
    }
  }

  // ================= ADMIN MANAGEMENT =================

  async getAllPackages() {
    return this.creditRepo.getAllPackages();
  }

  /** What an audit entry keeps of a package: the fields that decide what a customer pays and receives. */
  private packageFacts(p: any) {
    return p ? { slug: p.slug, name: p.name, credits: p.credits, priceInr: p.priceInr, isActive: p.isActive } : undefined;
  }

  async createPackage(dto: any, adminId?: string) {
    const created = await this.creditRepo.createPackage(dto);
    // Phase 25: a package decides what customers pay, so each change is attributed to the administrator who made it
    await this.auditLogService?.record({ userId: adminId, action: 'CREDIT_PACKAGE_CREATED', entityType: 'CREDIT_PACKAGE', entityId: created.id, newValues: this.packageFacts(created) });
    return created;
  }

  async updatePackage(id: string, dto: any, adminId?: string) {
    const before = await this.creditRepo.getPackageByIdOrSlug(id);
    if (!before) throw new BusinessException('Package not found', 'NOT_FOUND', HttpStatus.NOT_FOUND);
    const updated = await this.creditRepo.updatePackage(id, dto);
    await this.auditLogService?.record({ userId: adminId, action: 'CREDIT_PACKAGE_UPDATED', entityType: 'CREDIT_PACKAGE', entityId: id, oldValues: this.packageFacts(before), newValues: this.packageFacts(updated) });
    return updated;
  }

  async deletePackage(id: string, adminId?: string) {
    const before = await this.creditRepo.getPackageByIdOrSlug(id);
    if (!before) throw new BusinessException('Package not found', 'NOT_FOUND', HttpStatus.NOT_FOUND);
    const deleted = await this.creditRepo.deletePackage(id);
    await this.auditLogService?.record({ userId: adminId, action: 'CREDIT_PACKAGE_DELETED', entityType: 'CREDIT_PACKAGE', entityId: id, oldValues: this.packageFacts(before) });
    return deleted;
  }

  async updatePricingSetting(key: string, value: any, description?: string, adminId?: string) {
    const checked = validatePricingSetting(key, value); // 400 for an unknown key, a wrong shape or an out-of-range number
    const text = typeof description === 'string' ? description.slice(0, 255) : undefined;
    const before = await this.creditRepo.getPricingSetting(key);
    const saved = await this.creditRepo.upsertPricingSetting(key, checked, text);
    // pricing changes move money (checkout price, free credits, tax), so each one is attributed to the administrator who made it
    await this.auditLogService?.record({
      userId: adminId,
      action: 'PRICING_SETTING_UPDATED',
      entityType: 'PRICING_SETTING',
      entityId: key,
      oldValues: before ? { value: before.value } : undefined,
      newValues: { value: checked },
    });
    return saved;
  }

  async adjustUserCredits(
    userId: string,
    dailyDelta: number,
    purchasedDelta: number,
    reason: string,
    adminId: string,
  ) {
    const result = await this.db.transaction(async (tx) => {
      // Phase 25: the target must be a live account. Without this an unknown id reached the wallet insert and failed on the foreign key
      // as an HTTP 500, and an erased account (an anonymised shell kept for the financial records) could be given credits.
      const [target] = await tx.select({ id: schema.users.id, deletedAt: schema.users.deletedAt }).from(schema.users).where(eq(schema.users.id, userId));
      if (!target || target.deletedAt) throw new BusinessException('Account not found', 'NOT_FOUND', HttpStatus.NOT_FOUND);

      let [wallet] = await tx
        .select()
        .from(schema.userWallets)
        .where(eq(schema.userWallets.userId, userId))
        .for('update');

      if (!wallet) {
        wallet = await this.syncDailyCredits(userId, tx);
      }

      const newDaily = Math.max(0, wallet.dailyCredits + dailyDelta);
      const newPurchased = Math.max(0, wallet.purchasedCredits + purchasedDelta);
      const newBalance = newDaily + newPurchased;
      // balances never go below zero, so the ledger records what was actually applied, not what was asked for
      const totalDelta = newDaily - wallet.dailyCredits + (newPurchased - wallet.purchasedCredits);

      const [updatedWallet] = await tx
        .update(schema.userWallets)
        .set({
          dailyCredits: newDaily,
          purchasedCredits: newPurchased,
          balance: newBalance,
          updatedAt: new Date(),
        })
        .where(eq(schema.userWallets.id, wallet.id))
        .returning();

      const [transaction] = await tx
        .insert(schema.creditTransactions)
        .values({
          walletId: wallet.id,
          userId,
          amount: totalDelta,
          balanceAfter: newBalance,
          balanceType: dailyDelta !== 0 && purchasedDelta !== 0 ? 'MIXED' : dailyDelta !== 0 ? 'DAILY' : 'PURCHASED',
          dailyBalanceAfter: newDaily,
          purchasedBalanceAfter: newPurchased,
          type: 'ADMIN_ADJUSTMENT',
          description: `Admin adjustment by ${adminId}: ${reason}`,
          metadata: { adminId, dailyDelta, purchasedDelta, reason },
        })
        .returning();

      // Phase 13: an administrator's change to somebody's balance is recorded IN THE SAME TRANSACTION. If the audit row cannot be written the
      // adjustment is rolled back, so a balance can never change without a record of who changed it.
      await this.auditLogService?.recordStrict(
        {
          userId: adminId,
          action: 'CREDIT_ADJUSTMENT',
          entityType: 'USER_WALLET',
          entityId: updatedWallet.id,
          outcome: 'SUCCESS',
          newValues: { targetUserId: userId, dailyDelta, purchasedDelta, totalDelta, reason, newBalance, transactionId: transaction.id },
        },
        tx,
      );

      return { wallet: updatedWallet, transaction, totalDelta, newBalance };
    });

    return { wallet: result.wallet, transaction: result.transaction };
  }
}

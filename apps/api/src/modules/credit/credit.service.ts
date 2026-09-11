import { Injectable, Logger, HttpStatus, Inject } from '@nestjs/common';
import { CreditRepository } from './credit.repository';
import { ICreditPackage, IPricingConfig } from './credit.constants';
import { BusinessException } from '../../common/errors/business.exception';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';
import { eq, and, sql } from 'drizzle-orm';
import { CreditTransactionType } from '@orion/shared';

@Injectable()
export class CreditService {
  private readonly logger = new Logger(CreditService.name);

  constructor(
    private readonly creditRepo: CreditRepository,
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
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
      const dailySetting = await this.creditRepo.getPricingSetting('DAILY_FREE_CREDITS');
      const dailyAmount = (dailySetting?.value as any)?.amount ?? 5;

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
   * Retrieves or initializes wallet for user, ensuring daily credits are current
   */
  async getWallet(userId: string) {
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

    const dailyFreeCredits = (dailySetting?.value as any)?.amount ?? 5;
    const annualDiscountPercentage = (annualSetting?.value as any)?.percentage ?? 20;
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
  ) {
    if (amount <= 0) {
      throw new BusinessException('Credit amount must be greater than zero', 'INVALID_AMOUNT');
    }

    return this.db.transaction(async (tx) => {
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
    });
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
    if (amount <= 0) {
      throw new BusinessException('Credit deduction must be greater than zero', 'INVALID_AMOUNT');
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

        const dailySetting = await this.creditRepo.getPricingSetting('DAILY_FREE_CREDITS');
        const dailyAmount = (dailySetting?.value as any)?.amount ?? 5;

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
          { required: amount, available: totalAvailable, daily: wallet.dailyCredits, purchased: wallet.purchasedCredits },
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

  // ================= ADMIN MANAGEMENT =================

  async getAllPackages() {
    return this.creditRepo.getAllPackages();
  }

  async createPackage(dto: any) {
    return this.creditRepo.createPackage(dto);
  }

  async updatePackage(id: string, dto: any) {
    return this.creditRepo.updatePackage(id, dto);
  }

  async deletePackage(id: string) {
    return this.creditRepo.deletePackage(id);
  }

  async updatePricingSetting(key: string, value: any, description?: string) {
    return this.creditRepo.upsertPricingSetting(key, value, description);
  }

  async adjustUserCredits(
    userId: string,
    dailyDelta: number,
    purchasedDelta: number,
    reason: string,
    adminId: string,
  ) {
    return this.db.transaction(async (tx) => {
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
      const totalDelta = dailyDelta + purchasedDelta;

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

      return { wallet: updatedWallet, transaction };
    });
  }
}

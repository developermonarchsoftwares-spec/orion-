import { Inject, Injectable } from '@nestjs/common';
import { eq, desc, and, sql, or } from 'drizzle-orm';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';
import { BaseRepository } from '../../common/repositories/base.repository';

@Injectable()
export class CreditRepository extends BaseRepository<typeof schema.userWallets> {
  constructor(
    @Inject(DRIZZLE_DATABASE)
    db: DrizzleDb,
  ) {
    super(db, schema.userWallets);
  }

  async getWallet(userId: string) {
    const rows = await this.db
      .select()
      .from(schema.userWallets)
      .where(eq(schema.userWallets.userId, userId))
      .limit(1);

    return rows[0] || null;
  }

  async ensureWallet(userId: string) {
    const todayStr = new Date().toISOString().slice(0, 10);
    let wallet = await this.getWallet(userId);

    if (!wallet) {
      const [created] = await this.db
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
      wallet = created;
    }

    return wallet;
  }

  async getTransactions(userId: string, page = 1, limit = 20) {
    const offset = (page - 1) * limit;

    const [totalRows, rows] = await Promise.all([
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.creditTransactions)
        .where(eq(schema.creditTransactions.userId, userId)),
      this.db
        .select()
        .from(schema.creditTransactions)
        .where(eq(schema.creditTransactions.userId, userId))
        .orderBy(desc(schema.creditTransactions.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    const total = totalRows[0]?.count || 0;
    const totalPages = Math.ceil(total / limit) || 1;

    return {
      items: rows,
      pagination: {
        page,
        limit,
        totalItems: total,
        totalPages,
      },
    };
  }

  async getActivePackages() {
    return this.db
      .select()
      .from(schema.creditPackages)
      .where(eq(schema.creditPackages.isActive, true))
      .orderBy(schema.creditPackages.sortOrder);
  }

  async getAllPackages() {
    return this.db
      .select()
      .from(schema.creditPackages)
      .orderBy(schema.creditPackages.sortOrder);
  }

  async getPackageByIdOrSlug(idOrSlug: string) {
    const rows = await this.db
      .select()
      .from(schema.creditPackages)
      .where(
        or(
          eq(schema.creditPackages.id, idOrSlug as any),
          eq(schema.creditPackages.slug, idOrSlug),
        ),
      )
      .limit(1);

    return rows[0] || null;
  }

  async createPackage(data: typeof schema.creditPackages.$inferInsert) {
    const [pkg] = await this.db
      .insert(schema.creditPackages)
      .values(data)
      .returning();
    return pkg;
  }

  async updatePackage(id: string, data: Partial<typeof schema.creditPackages.$inferInsert>) {
    const [pkg] = await this.db
      .update(schema.creditPackages)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.creditPackages.id, id))
      .returning();
    return pkg;
  }

  async deletePackage(id: string) {
    const [pkg] = await this.db
      .delete(schema.creditPackages)
      .where(eq(schema.creditPackages.id, id))
      .returning();
    return pkg;
  }

  async getPricingSettings() {
    return this.db.select().from(schema.pricingSettings);
  }

  async getPricingSetting(key: string) {
    const rows = await this.db
      .select()
      .from(schema.pricingSettings)
      .where(eq(schema.pricingSettings.key, key))
      .limit(1);

    return rows[0] || null;
  }

  async upsertPricingSetting(key: string, value: any, description?: string) {
    const existing = await this.getPricingSetting(key);
    if (existing) {
      const [updated] = await this.db
        .update(schema.pricingSettings)
        .set({ value, description, updatedAt: new Date() })
        .where(eq(schema.pricingSettings.key, key))
        .returning();
      return updated;
    } else {
      const [created] = await this.db
        .insert(schema.pricingSettings)
        .values({ key, value, description })
        .returning();
      return created;
    }
  }

  async findWalletsNeedingDailyReset(todayStr: string, limit = 100) {
    return this.db
      .select()
      .from(schema.userWallets)
      .where(
        or(
          sql`${schema.userWallets.lastDailyCreditDate} IS NULL`,
          sql`${schema.userWallets.lastDailyCreditDate} < ${todayStr}`,
        ),
      )
      .limit(limit);
  }
}

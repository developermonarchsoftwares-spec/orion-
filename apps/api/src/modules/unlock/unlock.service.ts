import { Injectable, Logger, HttpStatus, Inject } from '@nestjs/common';
import { UnlockRepository } from './unlock.repository';
import { CreditService } from '../credit/credit.service';
import { DiscoverService } from '../discover/discover.service';
import { BusinessRepository } from '../business/repositories/business.repository';
import { BusinessException } from '../../common/errors/business.exception';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';
import { eq, and, sql, desc } from 'drizzle-orm';

@Injectable()
export class UnlockService {
  private readonly logger = new Logger(UnlockService.name);

  constructor(
    private readonly unlockRepo: UnlockRepository,
    private readonly creditService: CreditService,
    private readonly discoverService: DiscoverService,
    private readonly businessRepo: BusinessRepository,
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
  ) {}

  /**
   * Atomically unlocks a business lead and returns full unmasked contact intelligence
   */
  async unlockBusiness(userId: string, businessId: string) {
    const business = await this.businessRepo.findById(businessId);
    if (!business) {
      throw new BusinessException('Business not found', 'BUSINESS_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    // Check if already unlocked
    const existingUnlock = await this.unlockRepo.findUnlock(userId, businessId);
    if (existingUnlock) {
      const profile = await this.discoverService.getBusinessBySlug(businessId, userId);
      const wallet = await this.creditService.getWallet(userId);
      return {
        success: true,
        alreadyUnlocked: true,
        message: 'Lead is already unlocked in your account',
        creditsSpent: 0,
        balance: wallet.balance,
        business: profile,
      };
    }

    const unlockCost = 1;

    // Deduct credit atomically and create unlock record
    const result = await this.db.transaction(async (tx) => {
      // 1. Deduct 1 credit (preferring dailyCredits first, then purchasedCredits)
      const deduction = await this.creditService.deductCredits(
        userId,
        unlockCost,
        `Unlocked lead: ${business.name}`,
        business.id,
        'UNLOCK_LEAD',
        tx,
      );

      // 2. Create unlock record
      const [unlockRecord] = await tx
        .insert(schema.leadUnlocks)
        .values({
          userId,
          businessId,
          creditsSpent: unlockCost,
        })
        .returning();

      return {
        wallet: deduction.wallet,
        unlockRecord,
      };
    });

    this.logger.log(`User ${userId} unlocked business ${businessId} (${business.name}) for ${unlockCost} credit`);

    // Fetch full unmasked profile
    const unmaskedProfile = await this.discoverService.getBusinessBySlug(businessId, userId);

    return {
      success: true,
      alreadyUnlocked: false,
      message: 'Business unlocked successfully',
      creditsSpent: unlockCost,
      balance: result.wallet.balance,
      dailyCredits: result.wallet.dailyCredits,
      purchasedCredits: result.wallet.purchasedCredits,
      business: unmaskedProfile,
    };
  }

  /**
   * Retrieves paginated unlock history for user
   */
  async getUnlockHistory(userId: string, page = 1, limit = 20) {
    const offset = (page - 1) * limit;

    const [totalRows, rows] = await Promise.all([
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.leadUnlocks)
        .where(eq(schema.leadUnlocks.userId, userId)),
      this.db
        .select()
        .from(schema.leadUnlocks)
        .where(eq(schema.leadUnlocks.userId, userId))
        .orderBy(desc(schema.leadUnlocks.unlockedAt))
        .limit(limit)
        .offset(offset),
    ]);

    const total = totalRows[0]?.count || 0;
    const totalPages = Math.ceil(total / limit) || 1;

    if (rows.length === 0) {
      return {
        items: [],
        pagination: { page, limit, totalItems: total, totalPages },
      };
    }

    const businessIds = rows.map((r) => r.businessId);

    const [businesses, locations, scores, contacts] = await Promise.all([
      this.db.query.businesses.findMany({
        where: sql`${schema.businesses.id} IN ${businessIds}`,
        with: { industry: true, category: true },
      }),
      this.db
        .select()
        .from(schema.businessLocations)
        .where(sql`${schema.businessLocations.businessId} IN ${businessIds}`),
      this.db
        .select()
        .from(schema.businessScores)
        .where(sql`${schema.businessScores.businessId} IN ${businessIds}`),
      this.db
        .select()
        .from(schema.businessContacts)
        .where(sql`${schema.businessContacts.businessId} IN ${businessIds}`),
    ]);

    const businessMap = new Map(businesses.map((b) => [b.id, b]));
    const locMap = new Map(locations.map((l) => [l.businessId, l]));
    const scoreMap = new Map(scores.map((s) => [s.businessId, s.orionScore]));
    const contactsMap = new Map<string, any[]>();
    contacts.forEach((c) => {
      const list = contactsMap.get(c.businessId) || [];
      list.push(c);
      contactsMap.set(c.businessId, list);
    });

    const items = rows.map((r) => {
      const b = businessMap.get(r.businessId);
      const loc = locMap.get(r.businessId);
      const leadContacts = contactsMap.get(r.businessId) || [];

      return {
        id: r.id,
        businessId: r.businessId,
        business: b
          ? {
              id: b.id,
              slug: b.slug,
              name: b.name,
              legalName: b.legalName,
              industryName: b.industry?.name,
              categoryName: b.category?.name,
              city: loc?.city || 'India',
              state: loc?.state || '',
              orionScore: scoreMap.get(b.id) ?? 75,
              opportunityTier: b.opportunityTier,
              isVerified: b.isVerified,
            }
          : null,
        contacts: leadContacts.map((c) => ({
          fullName: c.fullName,
          title: c.title,
          email: c.email,
          phone: c.phone,
          linkedinUrl: c.linkedinUrl,
        })),
        creditsSpent: r.creditsSpent,
        unlockedAt: r.unlockedAt,
      };
    });

    return {
      items,
      pagination: {
        page,
        limit,
        totalItems: total,
        totalPages,
      },
    };
  }

  /**
   * Check if user has already unlocked a specific business
   */
  async checkStatus(userId: string, businessId: string) {
    const existing = await this.unlockRepo.findUnlock(userId, businessId);
    return {
      isUnlocked: !!existing,
      unlockedAt: existing?.unlockedAt || null,
    };
  }
}

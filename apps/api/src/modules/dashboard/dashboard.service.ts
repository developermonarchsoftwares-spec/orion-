import { Injectable, Logger, Inject } from '@nestjs/common';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';
import { eq, desc, sql, and } from 'drizzle-orm';
import { CreditService } from '../credit/credit.service';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
    private readonly creditService: CreditService,
  ) {}

  /**
   * Generates comprehensive customer dashboard analytics and activity feeds
   */
  async getDashboardSummary(userId: string) {
    const [wallet, unlockCountRow, savedLeadsCountRow, savedSearchesCountRow] = await Promise.all([
      this.creditService.getWallet(userId),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.leadUnlocks)
        .where(eq(schema.leadUnlocks.userId, userId)),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.savedLeads)
        .where(eq(schema.savedLeads.userId, userId)),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.savedSearches)
        .where(eq(schema.savedSearches.userId, userId)),
    ]);

    // Recent unlocks
    const recentUnlocks = await this.db
      .select({
        id: schema.leadUnlocks.id,
        businessId: schema.leadUnlocks.businessId,
        creditsSpent: schema.leadUnlocks.creditsSpent,
        unlockedAt: schema.leadUnlocks.unlockedAt,
      })
      .from(schema.leadUnlocks)
      .where(eq(schema.leadUnlocks.userId, userId))
      .orderBy(desc(schema.leadUnlocks.unlockedAt))
      .limit(5);

    let enrichedUnlocks: any[] = [];
    if (recentUnlocks.length > 0) {
      const bIds = recentUnlocks.map((u) => u.businessId);
      const [businesses, locations, scores] = await Promise.all([
        this.db.query.businesses.findMany({
          where: sql`${schema.businesses.id} IN ${bIds}`,
          with: { industry: true },
        }),
        this.db.select().from(schema.businessLocations).where(sql`${schema.businessLocations.businessId} IN ${bIds}`),
        this.db.select().from(schema.businessScores).where(sql`${schema.businessScores.businessId} IN ${bIds}`),
      ]);

      const bMap = new Map(businesses.map((b) => [b.id, b]));
      const lMap = new Map(locations.map((l) => [l.businessId, l]));
      const sMap = new Map(scores.map((s) => [s.businessId, s.orionScore]));

      enrichedUnlocks = recentUnlocks.map((u) => {
        const b = bMap.get(u.businessId);
        const loc = lMap.get(u.businessId);
        return {
          id: u.id,
          businessId: u.businessId,
          name: b?.name || 'Company',
          slug: b?.slug,
          industry: b?.industry?.name,
          city: loc?.city || 'India',
          orionScore: sMap.get(u.businessId) ?? 75,
          unlockedAt: u.unlockedAt,
        };
      });
    }

    // Recent saved leads
    const recentSavedLeads = await this.db
      .select()
      .from(schema.savedLeads)
      .where(eq(schema.savedLeads.userId, userId))
      .orderBy(desc(schema.savedLeads.createdAt))
      .limit(5);

    // Recent searches
    const recentSearches = await this.db
      .select()
      .from(schema.savedSearches)
      .where(eq(schema.savedSearches.userId, userId))
      .orderBy(desc(schema.savedSearches.createdAt))
      .limit(5);

    // Top recommended businesses (HIGH opportunity tier)
    const recommendations = await this.db.query.businesses.findMany({
      where: and(
        eq(schema.businesses.status, 'PUBLISHED'),
        eq(schema.businesses.opportunityTier, 'HIGH'),
      ),
      limit: 4,
      with: { industry: true, category: true },
    });

    return {
      wallet: {
        balance: wallet.balance,
        lifetimePurchased: wallet.lifetimePurchased,
        lifetimeUsed: wallet.lifetimeUsed,
      },
      stats: {
        unlockedLeadsCount: unlockCountRow[0]?.count || 0,
        savedLeadsCount: savedLeadsCountRow[0]?.count || 0,
        savedSearchesCount: savedSearchesCountRow[0]?.count || 0,
      },
      recentUnlocks: enrichedUnlocks,
      recentSavedLeads: recentSavedLeads.map((sl) => ({
        id: sl.id,
        businessId: sl.businessId,
        pipelineStage: sl.pipelineStage,
        tags: sl.tags,
        createdAt: sl.createdAt,
      })),
      recentSearches: recentSearches.map((s) => ({
        id: s.id,
        name: s.name,
        filters: s.filters,
        alertEnabled: s.alertEnabled,
        createdAt: s.createdAt,
      })),
      recommendations: recommendations.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        legalName: r.legalName,
        industryName: r.industry?.name,
        opportunityTier: r.opportunityTier,
        isVerified: r.isVerified,
      })),
    };
  }
}

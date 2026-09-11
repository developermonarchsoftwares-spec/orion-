import { Injectable, Logger, HttpStatus, Inject } from '@nestjs/common';
import { SavedLeadsRepository } from './saved-leads.repository';
import {
  SaveLeadDto,
  UpdateSavedLeadDto,
  BulkSaveLeadsDto,
  BulkDeleteLeadsDto,
  QuerySavedLeadsDto,
} from './dto/saved-leads.dto';
import { BusinessException } from '../../common/errors/business.exception';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';
import { eq, and, sql, desc, inArray } from 'drizzle-orm';

@Injectable()
export class SavedLeadsService {
  private readonly logger = new Logger(SavedLeadsService.name);

  constructor(
    private readonly savedLeadsRepo: SavedLeadsRepository,
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
  ) {}

  /**
   * Saves a business to user's saved leads / CRM pipeline
   */
  async saveLead(userId: string, dto: SaveLeadDto) {
    const existing = await this.savedLeadsRepo.findByUserAndBusiness(userId, dto.businessId);

    if (existing) {
      const updated = await this.savedLeadsRepo.updateById(existing.id, {
        notes: dto.notes !== undefined ? dto.notes : existing.notes,
        pipelineStage: dto.pipelineStage !== undefined ? dto.pipelineStage : existing.pipelineStage,
        tags: dto.tags !== undefined ? dto.tags : existing.tags,
        updatedAt: new Date(),
      });
      return { ...updated, message: 'Lead updated successfully' };
    }

    const created = await this.savedLeadsRepo.create({
      userId,
      businessId: dto.businessId,
      notes: dto.notes || '',
      pipelineStage: dto.pipelineStage || 'NEW',
      tags: dto.tags || [],
    });

    return { ...created, message: 'Lead saved successfully' };
  }

  /**
   * Retrieves paginated saved leads with business overview
   */
  async getSavedLeads(userId: string, query: QuerySavedLeadsDto) {
    const page = query.page || 1;
    const limit = Math.min(query.limit || 20, 100);
    const offset = (page - 1) * limit;

    const conditions = [eq(schema.savedLeads.userId, userId)];
    if (query.stage) {
      conditions.push(eq(schema.savedLeads.pipelineStage, query.stage));
    }

    const whereClause = and(...conditions);

    const [totalRows, rows] = await Promise.all([
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.savedLeads)
        .where(whereClause),
      this.db
        .select()
        .from(schema.savedLeads)
        .where(whereClause)
        .orderBy(desc(schema.savedLeads.createdAt))
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

    // Fetch related businesses, scores, primary locations, and unlock status
    const [businesses, scores, locations, unlocks] = await Promise.all([
      this.db.query.businesses.findMany({
        where: sql`${schema.businesses.id} IN ${businessIds}`,
        with: { industry: true, category: true },
      }),
      this.db
        .select()
        .from(schema.businessScores)
        .where(sql`${schema.businessScores.businessId} IN ${businessIds}`),
      this.db
        .select()
        .from(schema.businessLocations)
        .where(sql`${schema.businessLocations.businessId} IN ${businessIds}`),
      this.db
        .select()
        .from(schema.leadUnlocks)
        .where(
          and(
            eq(schema.leadUnlocks.userId, userId),
            sql`${schema.leadUnlocks.businessId} IN ${businessIds}`,
          ),
        ),
    ]);

    const businessMap = new Map(businesses.map((b) => [b.id, b]));
    const scoresMap = new Map(scores.map((s) => [s.businessId, s.orionScore]));
    const locationsMap = new Map(locations.map((l) => [l.businessId, l]));
    const unlockedSet = new Set(unlocks.map((u) => u.businessId));

    const items = rows.map((r) => {
      const b = businessMap.get(r.businessId);
      const loc = locationsMap.get(r.businessId);
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
              businessType: b.businessType,
              city: loc?.city || 'India',
              state: loc?.state || '',
              orionScore: scoresMap.get(b.id) ?? 75,
              opportunityTier: b.opportunityTier,
              isVerified: b.isVerified,
            }
          : null,
        notes: r.notes,
        pipelineStage: r.pipelineStage,
        tags: r.tags,
        isUnlocked: unlockedSet.has(r.businessId),
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
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
   * Updates an existing saved lead
   */
  async updateSavedLead(userId: string, id: string, dto: UpdateSavedLeadDto) {
    const existing = await this.savedLeadsRepo.findById(id);
    if (!existing || existing.userId !== userId) {
      throw new BusinessException('Saved lead not found', 'LEAD_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const updated = await this.savedLeadsRepo.updateById(id, {
      notes: dto.notes !== undefined ? dto.notes : existing.notes,
      pipelineStage: dto.pipelineStage !== undefined ? dto.pipelineStage : existing.pipelineStage,
      tags: dto.tags !== undefined ? dto.tags : existing.tags,
      updatedAt: new Date(),
    });

    return updated;
  }

  /**
   * Removes a saved lead by lead ID or business ID
   */
  async removeLead(userId: string, idOrBusinessId: string) {
    // Try delete by primary key
    const existing = await this.savedLeadsRepo.findById(idOrBusinessId);
    if (existing && existing.userId === userId) {
      await this.savedLeadsRepo.deleteById(existing.id);
      return { success: true, message: 'Lead removed' };
    }

    // Otherwise delete by businessId
    const deleted = await this.savedLeadsRepo.deleteByUserAndBusiness(userId, idOrBusinessId);
    if (!deleted) {
      throw new BusinessException('Saved lead not found', 'LEAD_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    return { success: true, message: 'Lead removed' };
  }

  /**
   * Bulk saves businesses as leads
   */
  async bulkSave(userId: string, dto: BulkSaveLeadsDto) {
    let savedCount = 0;
    for (const businessId of dto.businessIds) {
      try {
        await this.saveLead(userId, {
          businessId,
          pipelineStage: dto.pipelineStage,
          tags: dto.tags,
        });
        savedCount++;
      } catch (err) {
        this.logger.warn(`Failed to bulk save business ${businessId}: ${(err as Error).message}`);
      }
    }

    return { success: true, savedCount };
  }

  /**
   * Bulk deletes saved leads
   */
  async bulkDelete(userId: string, dto: BulkDeleteLeadsDto) {
    const count = await this.savedLeadsRepo.bulkDelete(userId, dto.leadIds);
    return { success: true, deletedCount: count };
  }
}

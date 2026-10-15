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
import { eq, and, sql, desc, inArray, isNull } from 'drizzle-orm';

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
    if (dto.personId) return this.savePersonLead(userId, dto as SaveLeadDto & { personId: string });

    return this.upsertLead(userId, dto.businessId, null, dto);
  }

  /**
   * Find-or-create of one saved lead, serialised per (customer, company, person). A company-level lead has no unique index (the
   * index only covers person leads), so two parallel saves used to insert the same lead twice (12 parallel saves left 10 rows on a
   * real PostgreSQL); a person lead lost the same race as a database error. The lock is released by the commit, so the second
   * request waits, finds the first one's row and updates it.
   */
  private async upsertLead(userId: string, businessId: string, personId: string | null, dto: SaveLeadDto) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`lead:save:${userId}:${businessId}:${personId ?? ''}`}))`);
      const [existing] = await tx
        .select()
        .from(schema.savedLeads)
        .where(
          and(
            eq(schema.savedLeads.userId, userId),
            eq(schema.savedLeads.businessId, businessId),
            personId ? eq(schema.savedLeads.personId, personId) : isNull(schema.savedLeads.personId),
          ),
        )
        .limit(1);
      if (existing) {
        const [updated] = await tx
          .update(schema.savedLeads)
          .set({
            notes: dto.notes !== undefined ? dto.notes : existing.notes,
            pipelineStage: dto.pipelineStage !== undefined ? dto.pipelineStage : existing.pipelineStage,
            tags: dto.tags !== undefined ? dto.tags : existing.tags,
            updatedAt: new Date(),
          })
          .where(eq(schema.savedLeads.id, existing.id))
          .returning();
        return { ...updated, message: 'Lead updated successfully' };
      }
      // a new lead needs a published company: an unknown id used to reach the foreign key and come back as a 500, and a draft or
      // archived company must not be reachable (or its existence confirmed) through this route
      const [biz] = await tx.select({ status: schema.businesses.status }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).limit(1);
      if (!biz || biz.status !== 'PUBLISHED') {
        throw new BusinessException('Business not found', 'BUSINESS_NOT_FOUND', HttpStatus.NOT_FOUND);
      }
      const [created] = await tx
        .insert(schema.savedLeads)
        .values({
          userId,
          businessId,
          ...(personId ? { personId } : {}),
          notes: dto.notes || '',
          pipelineStage: dto.pipelineStage || 'NEW',
          tags: dto.tags || [],
        })
        .returning();
      return { ...created, message: 'Lead saved successfully' };
    });
  }

  /**
   * Saves a person-at-company as a lead. The person must hold a role at that company and both
   * must be published; a lead is never created for hidden or suppressed people.
   */
  private async savePersonLead(userId: string, dto: SaveLeadDto & { personId: string }) {
    const [role] = await this.db
      .select({ id: schema.companyPeople.id })
      .from(schema.companyPeople)
      .innerJoin(schema.people, eq(schema.people.id, schema.companyPeople.personId))
      .innerJoin(schema.businesses, eq(schema.businesses.id, schema.companyPeople.businessId))
      .where(
        and(
          eq(schema.companyPeople.businessId, dto.businessId),
          eq(schema.companyPeople.personId, dto.personId),
          eq(schema.companyPeople.isPublished, true),
          eq(schema.companyPeople.reviewStatus, 'APPROVED'),
          eq(schema.people.dataStatus, 'PUBLISHED'),
          eq(schema.businesses.status, 'PUBLISHED'),
        ),
      )
      .limit(1);
    if (!role) {
      throw new BusinessException('Person not found at this company', 'PERSON_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    return this.upsertLead(userId, dto.businessId, dto.personId, dto);
  }

  /** Lightweight person summaries for saved-lead rows. Never includes contact values. */
  private async loadPersonSummaries(userId: string, rows: Array<{ businessId: string; personId: string | null }>) {
    const pairs = rows.filter((r): r is { businessId: string; personId: string } => !!r.personId);
    if (pairs.length === 0) return new Map<string, { id: string; fullName: string; jobTitle: string; decisionMaker: string | null; isUnlocked: boolean }>();

    const personIds = [...new Set(pairs.map((p) => p.personId))];
    const [roles, unlocks] = await Promise.all([
      this.db
        .select({
          personId: schema.companyPeople.personId,
          businessId: schema.companyPeople.businessId,
          fullName: schema.people.fullName,
          jobTitle: schema.companyPeople.jobTitleAtCompany,
          decisionMakerType: schema.companyPeople.decisionMakerType,
        })
        .from(schema.companyPeople)
        .innerJoin(schema.people, eq(schema.people.id, schema.companyPeople.personId))
        .where(and(inArray(schema.companyPeople.personId, personIds), eq(schema.companyPeople.isPublished, true), eq(schema.companyPeople.reviewStatus, 'APPROVED'), eq(schema.people.dataStatus, 'PUBLISHED'))),
      this.db
        .select({ personId: schema.personUnlocks.personId })
        .from(schema.personUnlocks)
        .where(and(eq(schema.personUnlocks.userId, userId), inArray(schema.personUnlocks.personId, personIds))),
    ]);
    const unlocked = new Set(unlocks.map((u) => u.personId));
    const map = new Map<string, { id: string; fullName: string; jobTitle: string; decisionMaker: string | null; isUnlocked: boolean }>();
    for (const r of roles) {
      map.set(`${r.businessId}:${r.personId}`, {
        id: r.personId,
        fullName: r.fullName,
        jobTitle: r.jobTitle,
        decisionMaker: r.decisionMakerType,
        isUnlocked: unlocked.has(r.personId),
      });
    }
    return map;
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
        .orderBy(desc(schema.savedLeads.createdAt), desc(schema.savedLeads.id))
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

    const personSummaries = await this.loadPersonSummaries(userId, rows);

    const items = rows.map((r) => {
      const b = businessMap.get(r.businessId);
      const loc = locationsMap.get(r.businessId);
      return {
        id: r.id,
        businessId: r.businessId,
        personId: r.personId,
        person: r.personId && businessMap.get(r.businessId)?.status === 'PUBLISHED' ? (personSummaries.get(`${r.businessId}:${r.personId}`) ?? null) : null,
        // a company that is no longer published is not shown (name, location, score), even on the owner's own saved lead
        business: b && b.status === 'PUBLISHED'
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

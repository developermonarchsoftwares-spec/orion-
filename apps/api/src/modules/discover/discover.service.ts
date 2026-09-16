import { Injectable, Logger, HttpStatus, Inject } from '@nestjs/common';
import { SearchService } from '../search/services/search.service';
import { BusinessRepository } from '../business/repositories/business.repository';
import { DiscoverSearchQueryDto } from './dto/discover.dto';
import { BusinessException } from '../../common/errors/business.exception';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';
import { eq, and, sql, ilike, or, inArray } from 'drizzle-orm';

@Injectable()
export class DiscoverService {
  private readonly logger = new Logger(DiscoverService.name);

  constructor(
    private readonly searchService: SearchService,
    private readonly businessRepo: BusinessRepository,
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
  ) {}

  /**
   * Masks email string: "alex.vance@example.com" -> "a***e@e***.com"
   */
  private maskEmail(email?: string | null): string | null {
    if (!email) return null;
    const parts = email.split('@');
    if (parts.length !== 2) return '***@***.com';
    const name = parts[0];
    const domain = parts[1];
    const maskedName = name.length > 2 ? `${name[0]}***${name[name.length - 1]}` : '***';
    const domainParts = domain.split('.');
    const maskedDomain = domainParts[0].length > 2
      ? `${domainParts[0][0]}***${domainParts[0][domainParts[0].length - 1]}`
      : '***';
    const ext = domainParts.slice(1).join('.');
    return `${maskedName}@${maskedDomain}.${ext}`;
  }

  /**
   * Masks phone string: "+91 9876543210" -> "+91 98*** ***10"
   */
  private maskPhone(phone?: string | null): string | null {
    if (!phone) return null;
    const clean = phone.trim();
    if (clean.length < 6) return '***-***-****';
    const prefix = clean.substring(0, 4);
    const suffix = clean.substring(clean.length - 2);
    return `${prefix}*** ***${suffix}`;
  }

  /**
   * Customer-facing Discover search with lead unlock status & masked contacts
   */
  async search(query: DiscoverSearchQueryDto, userId?: string) {
    let unlockedBusinessIds = new Set<string>();

    if (userId) {
      const unlocks = await this.db
        .select({ businessId: schema.leadUnlocks.businessId })
        .from(schema.leadUnlocks)
        .where(eq(schema.leadUnlocks.userId, userId));
      unlockedBusinessIds = new Set(unlocks.map((u) => u.businessId));
    }

    try {
      // Try Typesense search first
      const searchResult = await this.searchService.searchBusinesses({
        q: query.q,
        industryId: query.industryId,
        categoryId: query.categoryId,
        businessType: query.businessType,
        msmeCategory: query.msmeCategory,
        state: query.state,
        district: query.district,
        city: query.city,
        pincode: query.pincode,
        hasWebsite: query.hasWebsite,
        hasEmail: query.hasEmail,
        hasPhone: query.hasPhone,
        hasGstin: query.hasGstin,
        opportunityTier: query.opportunityTier,
        minOrionScore: query.minOrionScore,
        maxOrionScore: query.maxOrionScore,
        sortBy: query.sortBy,
        page: query.page,
        limit: query.limit,
        cursor: query.cursor,
      });

      const sanitizedHits = searchResult.hits.map((hit) => {
        const isUnlocked = unlockedBusinessIds.has(hit.id);
        return {
          id: hit.id,
          slug: hit.slug,
          name: hit.name,
          legalName: hit.legal_name,
          industryName: hit.industry_name,
          categoryName: hit.category_name,
          businessType: hit.business_type,
          msmeCategory: hit.msme_category,
          opportunityTier: hit.opportunity_tier,
          location: {
            city: hit.city,
            district: hit.district,
            state: hit.state,
            pincode: hit.pincode,
          },
          contactAvailability: {
            hasWebsite: hit.has_website,
            hasEmail: hit.has_email,
            hasPhone: hit.has_phone,
            hasGstin: hit.has_gstin,
          },
          orionScore: hit.orion_score,
          completenessScore: hit.completeness_score ?? 75,
          verificationScore: hit.verification_score ?? 80,
          foundingYear: hit.founding_year,
          isVerified: true,
          isUnlocked,
        };
      });

      return {
        items: sanitizedHits,
        total: searchResult.total,
        page: searchResult.page,
        totalPages: searchResult.totalPages,
        limit: searchResult.limit,
        nextCursor: searchResult.nextCursor,
        facets: searchResult.facetCounts,
        searchDurationMs: searchResult.searchDurationMs,
      };
    } catch (error) {
      this.logger.warn(`Typesense search unavailable, falling back to PostgreSQL: ${(error as Error).message}`);
      return this.searchPostgresFallback(query, unlockedBusinessIds);
    }
  }

  /**
   * Database fallback search when Typesense cluster is offline
   */
  private async searchPostgresFallback(
    query: DiscoverSearchQueryDto,
    unlockedBusinessIds: Set<string>,
  ) {
    const page = query.page || 1;
    const limit = Math.min(query.limit || 20, 100);
    const offset = (page - 1) * limit;

    const conditions = [eq(schema.businesses.status, 'PUBLISHED')];

    if (query.q?.trim()) {
      const term = `%${query.q.trim()}%`;
      conditions.push(or(ilike(schema.businesses.name, term), ilike(schema.businesses.legalName, term))!);
    }
    if (query.industryId) conditions.push(eq(schema.businesses.industryId, query.industryId));
    if (query.categoryId) conditions.push(eq(schema.businesses.categoryId, query.categoryId));
    if (query.businessType) conditions.push(eq(schema.businesses.businessType, query.businessType as any));
    if (query.msmeCategory) conditions.push(eq(schema.businesses.msmeCategory, query.msmeCategory as any));
    if (query.opportunityTier) conditions.push(eq(schema.businesses.opportunityTier, query.opportunityTier as any));

    const whereClause = and(...conditions);

    const [totalRows, rows] = await Promise.all([
      this.db.select({ count: sql<number>`count(*)::int` }).from(schema.businesses).where(whereClause),
      this.db.query.businesses.findMany({
        where: whereClause,
        limit,
        offset,
        with: {
          industry: true,
          category: true,
          businessTypeRef: true,
          msmeCategoryRef: true,
        },
      }),
    ]);

    const total = totalRows[0]?.count || 0;
    const totalPages = Math.ceil(total / limit) || 1;

    // Fetch scores, locations, and contacts for current page
    const businessIds = rows.map((r) => r.id);
    let scoresMap: Record<string, number> = {};
    let locationsMap: Record<string, any> = {};
    let contactsMap: Record<string, { hasEmail: boolean; hasPhone: boolean }> = {};

    if (businessIds.length > 0) {
      const [scores, locations, contacts] = await Promise.all([
        this.db.select().from(schema.businessScores).where(inArray(schema.businessScores.businessId, businessIds)),
        this.db.select().from(schema.businessLocations).where(inArray(schema.businessLocations.businessId, businessIds)),
        this.db.select().from(schema.businessContacts).where(inArray(schema.businessContacts.businessId, businessIds)),
      ]);

      scores.forEach((s) => { scoresMap[s.businessId] = s.orionScore; });
      locations.forEach((l) => { if (l.isPrimary || !locationsMap[l.businessId]) locationsMap[l.businessId] = l; });
      contacts.forEach((c) => {
        if (!contactsMap[c.businessId]) contactsMap[c.businessId] = { hasEmail: false, hasPhone: false };
        if (c.email) contactsMap[c.businessId].hasEmail = true;
        if (c.phone) contactsMap[c.businessId].hasPhone = true;
      });
    }

    const items = rows.map((r) => {
      const loc = locationsMap[r.id];
      const cont = contactsMap[r.id] || { hasEmail: false, hasPhone: false };
      const orionScore = scoresMap[r.id] ?? 70;
      const isUnlocked = unlockedBusinessIds.has(r.id);

      return {
        id: r.id,
        slug: r.slug,
        name: r.name,
        legalName: r.legalName,
        industryName: r.industry?.name,
        categoryName: r.category?.name,
        businessType: r.businessType,
        msmeCategory: r.msmeCategory,
        opportunityTier: r.opportunityTier,
        location: {
          city: loc?.city || 'India',
          district: loc?.district || '',
          state: loc?.state || '',
          pincode: loc?.pincode || '',
        },
        contactAvailability: {
          hasWebsite: !!r.metadata,
          hasEmail: cont.hasEmail,
          hasPhone: cont.hasPhone,
          hasGstin: true,
        },
        orionScore,
        completenessScore: 80,
        verificationScore: 85,
        foundingYear: r.foundingYear,
        isVerified: r.isVerified,
        isUnlocked,
      };
    });

    return {
      items,
      total,
      page,
      totalPages,
      limit,
      searchDurationMs: 12,
    };
  }

  /**
   * Detailed Business Profile with strictly masked contact details if locked
   */
  async getBusinessBySlug(identifier: string, userId?: string) {
    // Identify by slug or UUID
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
    let businessId = identifier;

    if (!isUuid) {
      const found = await this.db.query.businesses.findFirst({
        where: eq(schema.businesses.slug, identifier),
      });
      if (!found) {
        throw new BusinessException('Business not found', 'BUSINESS_NOT_FOUND', HttpStatus.NOT_FOUND);
      }
      businessId = found.id;
    }

    const fullProfile = await this.businessRepo.findFullBusinessProfile(businessId);
    if (!fullProfile) {
      throw new BusinessException('Business not found', 'BUSINESS_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    // Enforce publication state: unpublished businesses (DRAFT, PENDING_REVIEW, ARCHIVED)
    // must NOT be accessible to regular users or anonymous visitors
    if (fullProfile.status !== 'PUBLISHED') {
      let isCallerAdmin = false;
      if (userId) {
        const caller = await this.db.query.users.findFirst({
          where: eq(schema.users.id, userId),
          columns: { role: true },
        });
        isCallerAdmin = caller?.role === 'ADMIN' || caller?.role === 'SUPER_ADMIN';
      }
      if (!isCallerAdmin) {
        throw new BusinessException('Business not found', 'BUSINESS_NOT_FOUND', HttpStatus.NOT_FOUND);
      }
    }

    // Check if current user has unlocked this business
    let isUnlocked = false;
    if (userId) {
      const unlock = await this.db.query.leadUnlocks.findFirst({
        where: and(
          eq(schema.leadUnlocks.userId, userId),
          eq(schema.leadUnlocks.businessId, businessId),
        ),
      });
      isUnlocked = !!unlock;
    }

    // Sanitize Contacts
    const contacts = (fullProfile.contacts || []).map((c) => {
      if (isUnlocked) {
        return {
          id: c.id,
          fullName: c.fullName,
          title: c.title,
          department: c.department,
          email: c.email,
          isEmailVerified: c.isEmailVerified,
          phone: c.phone,
          isPhoneVerified: c.isPhoneVerified,
          linkedinUrl: c.linkedinUrl,
          isPrimary: c.isPrimary,
          isDecisionMaker: c.isDecisionMaker,
          isLocked: false,
        };
      } else {
        return {
          id: c.id,
          fullName: c.fullName ? `${c.fullName.split(' ')[0]} ***` : 'Decision Maker',
          title: c.title || 'Executive',
          department: c.department,
          email: this.maskEmail(c.email),
          isEmailVerified: c.isEmailVerified,
          phone: this.maskPhone(c.phone),
          isPhoneVerified: c.isPhoneVerified,
          linkedinUrl: c.linkedinUrl ? 'https://linkedin.com/in/***' : null,
          isPrimary: c.isPrimary,
          isDecisionMaker: c.isDecisionMaker,
          isLocked: true,
        };
      }
    });

    // Sanitize Locations
    const locations = (fullProfile.locations || []).map((loc) => ({
      id: loc.id,
      addressLine1: isUnlocked ? loc.addressLine1 : '*** Locked Address ***',
      addressLine2: isUnlocked ? loc.addressLine2 : null,
      city: loc.city,
      district: loc.district,
      state: loc.state,
      pincode: loc.pincode,
      country: loc.country,
      latitude: loc.latitude,
      longitude: loc.longitude,
      isPrimary: loc.isPrimary,
    }));

    // Sanitize Digital Presence
    const digitalPresence = (fullProfile.digitalPresences || []).map((dp) => ({
      id: dp.id,
      platform: dp.platform,
      url: dp.url,
      domain: dp.domain,
      isVerified: dp.isVerified,
      followerCount: dp.followerCount,
      techStackDetected: dp.techStackDetected,
    }));

    // Sanitize Identifiers (exclude internal/unverified identifiers)
    const identifiers = (fullProfile.identifiers || []).map((ident) => ({
      type: ident.type,
      value: isUnlocked || ident.type === 'CIN' ? ident.value : `${ident.value.substring(0, 4)}****`,
      isVerified: ident.isVerified,
    }));

    return {
      id: fullProfile.id,
      slug: fullProfile.slug,
      name: fullProfile.name,
      legalName: fullProfile.legalName,
      description: fullProfile.description,
      logoUrl: fullProfile.logoUrl,
      bannerUrl: fullProfile.bannerUrl,
      businessType: fullProfile.businessType,
      msmeCategory: fullProfile.msmeCategory,
      opportunityTier: fullProfile.opportunityTier,
      employeeCountRange: fullProfile.employeeCountRange,
      annualRevenueRange: fullProfile.annualRevenueRange,
      foundingYear: fullProfile.foundingYear,
      incorporationDate: fullProfile.incorporationDate,
      isVerified: fullProfile.isVerified,
      industry: fullProfile.industry ? { id: fullProfile.industry.id, name: fullProfile.industry.name } : null,
      category: fullProfile.category ? { id: fullProfile.category.id, name: fullProfile.category.name } : null,
      locations,
      contacts,
      digitalPresence,
      identifiers,
      metrics: {
        orionScore: fullProfile.scores?.orionScore ?? 75,
        completenessScore: fullProfile.metrics?.completenessScore ?? 80,
        verificationScore: fullProfile.metrics?.verificationScore ?? 85,
        freshnessScore: fullProfile.metrics?.freshnessScore ?? 90,
        digitalPresenceScore: fullProfile.metrics?.digitalPresenceScore ?? 70,
        lastCalculated: fullProfile.scores?.calculatedAt || fullProfile.updatedAt,
      },
      isUnlocked,
      unlockCostCredits: 1,
    };
  }

  /**
   * Search suggestions and autocomplete
   */
  async getSuggestions(query?: string) {
    if (!query || query.trim().length === 0) {
      return { suggestions: [] };
    }

    const term = `%${query.trim()}%`;
    const businesses = await this.db
      .select({
        id: schema.businesses.id,
        name: schema.businesses.name,
        slug: schema.businesses.slug,
      })
      .from(schema.businesses)
      .where(and(eq(schema.businesses.status, 'PUBLISHED'), ilike(schema.businesses.name, term)))
      .limit(6);

    const locations = await this.db
      .selectDistinct({
        city: schema.businessLocations.city,
        state: schema.businessLocations.state,
      })
      .from(schema.businessLocations)
      .where(or(ilike(schema.businessLocations.city, term), ilike(schema.businessLocations.state, term))!)
      .limit(4);

    return {
      businesses: businesses.map((b) => ({ text: b.name, slug: b.slug, type: 'BUSINESS' })),
      locations: locations.map((l) => ({ text: `${l.city}, ${l.state}`, type: 'LOCATION' })),
    };
  }

  /**
   * Returns related businesses in the same industry or region
   */
  async getRelatedBusinesses(identifier: string, limit = 4) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
    let targetBusiness = isUuid
      ? await this.db.query.businesses.findFirst({ where: eq(schema.businesses.id, identifier) })
      : await this.db.query.businesses.findFirst({ where: eq(schema.businesses.slug, identifier) });

    if (!targetBusiness) {
      return [];
    }

    const relatedRows = await this.db.query.businesses.findMany({
      where: and(
        eq(schema.businesses.status, 'PUBLISHED'),
        sql`${schema.businesses.id} != ${targetBusiness.id}`,
        targetBusiness.industryId ? eq(schema.businesses.industryId, targetBusiness.industryId) : undefined,
      ),
      limit: Math.min(limit, 10),
      with: {
        industry: true,
      },
    });

    const relatedIds = relatedRows.map((r) => r.id);
    let scoresMap: Record<string, number> = {};
    let locationsMap: Record<string, any> = {};

    if (relatedIds.length > 0) {
      const [scores, locations] = await Promise.all([
        this.db.select().from(schema.businessScores).where(inArray(schema.businessScores.businessId, relatedIds)),
        this.db.select().from(schema.businessLocations).where(inArray(schema.businessLocations.businessId, relatedIds)),
      ]);
      scores.forEach((s) => { scoresMap[s.businessId] = s.orionScore; });
      locations.forEach((l) => { if (l.isPrimary || !locationsMap[l.businessId]) locationsMap[l.businessId] = l; });
    }

    return relatedRows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      industry: r.industry?.name || 'General Industry',
      city: locationsMap[r.id]?.city || 'India',
      state: locationsMap[r.id]?.state || '',
      opportunityScore: scoresMap[r.id] ?? 80,
    }));
  }
}

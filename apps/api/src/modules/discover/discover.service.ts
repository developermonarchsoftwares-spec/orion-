import { Injectable, Logger, HttpStatus, Inject } from '@nestjs/common';
import { SearchService } from '../search/services/search.service';
import { BusinessRepository } from '../business/repositories/business.repository';
import { DiscoverSearchQueryDto } from './dto/discover.dto';
import { BusinessException } from '../../common/errors/business.exception';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';
import { eq, and, sql, ilike, or, inArray } from 'drizzle-orm';
import { PeopleSearchService, hasPeopleFilters, parseSearchIntent, type IPeopleSearchFilters } from '../people/people-search.service';
import { DECISION_MAKER_TYPES, type DecisionMakerType } from '../people/people.constants';
import { discloseIdentifier, presentCompanyContact } from '../../common/privacy/data-classification';

/** Escapes LIKE wildcards so user text is matched literally ("%" and "_" are ordinary characters). */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** Deterministic order of the PostgreSQL search: a supported sort, then name, then id (always a total order). */
const fallbackOrder = (sortBy?: string) => {
  const [field, dir] = (sortBy ?? '').split(':');
  const desc_ = dir === 'desc';
  return (b: typeof schema.businesses, { asc, desc }: { asc: (c: any) => any; desc: (c: any) => any }) => {
    const d = desc_ ? desc : asc;
    if (field === 'created_at') return [d(b.createdAt), asc(b.name), asc(b.id)];
    if (field === 'name') return [d(b.name), asc(b.id)];
    return [asc(b.name), asc(b.id)];
  };
};

@Injectable()
export class DiscoverService {
  private readonly logger = new Logger(DiscoverService.name);

  constructor(
    private readonly searchService: SearchService,
    private readonly businessRepo: BusinessRepository,
    private readonly peopleSearch: PeopleSearchService,
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
  ) {}

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

    // Decision-maker filters (explicit params and phrases like "with a Head of Procurement") are
    // answered from PostgreSQL: the Typesense index carries no people data.
    const intent = parseSearchIntent(query.q);
    const requestedTypes = (query.decisionMakerType ?? '')
      .split(',')
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);
    const knownTypes = requestedTypes.filter((t) => (DECISION_MAKER_TYPES as readonly string[]).includes(t));
    if (requestedTypes.length > 0 && knownTypes.length === 0) {
      // a filter whose every value is unknown must never be dropped silently (that would return every company)
      throw new BusinessException('Unknown decisionMakerType. See GET /people/taxonomy for the allowed values', 'INVALID_FILTER', HttpStatus.BAD_REQUEST);
    }
    const explicitTypes = knownTypes as DecisionMakerType[]; // unknown values next to known ones are ignored, as before
    const peopleFilters: IPeopleSearchFilters = {
      decisionMakerTypes: [...new Set([...explicitTypes, ...(intent.decisionMakerTypes ?? [])])],
      hasDecisionMaker: query.hasDecisionMaker || intent.hasDecisionMaker,
      hasVerifiedDecisionMaker: query.hasVerifiedDecisionMaker || intent.hasVerifiedDecisionMaker,
      hasDecisionMakerContact: query.hasDecisionMakerContact || intent.hasDecisionMakerContact,
    };
    if (hasPeopleFilters(peopleFilters)) {
      return this.searchPostgresFallback(
        { ...query, q: intent.remainingQuery, city: query.city || intent.city },
        unlockedBusinessIds,
        peopleFilters,
      );
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
    peopleFilters: IPeopleSearchFilters = {},
  ) {
    const page = query.page || 1;
    const limit = Math.min(query.limit || 20, 100);
    const offset = (page - 1) * limit;

    const conditions = [eq(schema.businesses.status, 'PUBLISHED')];

    if (query.q?.trim()) {
      const term = `%${escapeLike(query.q.trim())}%`;
      conditions.push(or(ilike(schema.businesses.name, term), ilike(schema.businesses.legalName, term))!);
    }
    if (query.industryId) conditions.push(eq(schema.businesses.industryId, query.industryId));
    if (query.categoryId) conditions.push(eq(schema.businesses.categoryId, query.categoryId));
    if (query.businessType) conditions.push(eq(schema.businesses.businessType, query.businessType as any));
    if (query.msmeCategory) conditions.push(eq(schema.businesses.msmeCategory, query.msmeCategory as any));
    if (query.opportunityTier) conditions.push(eq(schema.businesses.opportunityTier, query.opportunityTier as any));

    // Literal aliases on purpose: Drizzle's relational query builder rewrites every Column object
    // in a where-clause to the root table alias, which would break a sub-select on another table.
    const locationConditions = [
      query.state ? sql`LOWER(bl.state) = LOWER(${query.state})` : undefined,
      query.district ? sql`LOWER(bl.district) = LOWER(${query.district})` : undefined,
      query.city ? sql`LOWER(bl.city) = LOWER(${query.city})` : undefined,
      query.pincode ? sql`bl.pincode = ${query.pincode}` : undefined,
    ].filter((c): c is NonNullable<typeof c> => !!c);
    if (locationConditions.length > 0) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM business_locations bl WHERE bl.business_id = ${schema.businesses.id} AND ${sql.join(locationConditions, sql` AND `)})`,
      );
    }
    // Contact-availability and score filters, answered here with the same meaning the search index gives them.
    const bid = sql`${schema.businesses.id}`;
    if (query.hasEmail) conditions.push(sql`EXISTS (SELECT 1 FROM business_contacts bc WHERE bc.business_id = ${bid} AND bc.email IS NOT NULL AND bc.email <> '')`);
    if (query.hasPhone) conditions.push(sql`EXISTS (SELECT 1 FROM business_contacts bc WHERE bc.business_id = ${bid} AND bc.phone IS NOT NULL AND bc.phone <> '')`);
    if (query.hasWebsite) conditions.push(sql`EXISTS (SELECT 1 FROM digital_presences dp WHERE dp.business_id = ${bid} AND dp.platform = 'WEBSITE')`);
    if (query.hasGstin) conditions.push(sql`EXISTS (SELECT 1 FROM business_identifiers bi WHERE bi.business_id = ${bid} AND bi.type = 'GSTIN')`);
    if (query.minOrionScore !== undefined) conditions.push(sql`EXISTS (SELECT 1 FROM business_scores bs WHERE bs.business_id = ${bid} AND bs.orion_score >= ${query.minOrionScore})`);
    if (query.maxOrionScore !== undefined) conditions.push(sql`EXISTS (SELECT 1 FROM business_scores bs WHERE bs.business_id = ${bid} AND bs.orion_score <= ${query.maxOrionScore})`);
    const peoplePredicate = this.peopleSearch.buildBusinessPredicate(peopleFilters, sql`${schema.businesses.id}`);
    if (peoplePredicate) conditions.push(peoplePredicate);

    const whereClause = and(...conditions);

    const [totalRows, rows] = await Promise.all([
      this.db.select({ count: sql<number>`count(*)::int` }).from(schema.businesses).where(whereClause),
      this.db.query.businesses.findMany({
        where: whereClause,
        // total order: the same query always returns the same page (a bare LIMIT/OFFSET is not stable)
        orderBy: fallbackOrder(query.sortBy),
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
    const websiteIds = new Set<string>();
    const gstinIds = new Set<string>();

    if (businessIds.length > 0) {
      const [presence, idents] = await Promise.all([
        this.db.select({ businessId: schema.digitalPresences.businessId, platform: schema.digitalPresences.platform }).from(schema.digitalPresences).where(inArray(schema.digitalPresences.businessId, businessIds)),
        this.db.select({ businessId: schema.businessIdentifiers.businessId, type: schema.businessIdentifiers.type }).from(schema.businessIdentifiers).where(inArray(schema.businessIdentifiers.businessId, businessIds)),
      ]);
      presence.forEach((d) => { if (d.platform === 'WEBSITE') websiteIds.add(d.businessId); });
      idents.forEach((i) => { if (i.type === 'GSTIN') gstinIds.add(i.businessId); });
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
          hasWebsite: websiteIds.has(r.id),
          hasEmail: cont.hasEmail,
          hasPhone: cont.hasPhone,
          hasGstin: gstinIds.has(r.id),
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

    // Sanitize Contacts (Phase 10: one shared classifier and disclosure policy; see common/privacy/data-classification.ts)
    const companyDomains = (fullProfile.digitalPresences || []).map((dp) => dp.domain).filter((d): d is string => !!d);
    const contacts = (fullProfile.contacts || []).map((c) => presentCompanyContact(c, { unlocked: isUnlocked, companyDomains }));

    // Sanitize Locations
    const locations = (fullProfile.locations || []).map((loc) => ({
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
      platform: dp.platform,
      url: dp.url,
      domain: dp.domain,
      isVerified: dp.isVerified,
      followerCount: dp.followerCount,
      techStackDetected: dp.techStackDetected,
    }));

    // Sanitize Identifiers: a PAN, or a GSTIN that embeds one, of an individual is never shown in full (DISCLOSURE_POLICY)
    const identifiers = (fullProfile.identifiers || []).map((ident) => ({
      type: ident.type,
      value: discloseIdentifier(ident.type, ident.value, isUnlocked),
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

    const term = `%${escapeLike(query.trim())}%`;
    const businesses = await this.db
      .select({
        id: schema.businesses.id,
        name: schema.businesses.name,
        slug: schema.businesses.slug,
      })
      .from(schema.businesses)
      .where(and(eq(schema.businesses.status, 'PUBLISHED'), ilike(schema.businesses.name, term)))
      .orderBy(schema.businesses.name, schema.businesses.id)
      .limit(6);

    const locations = await this.db
      .selectDistinct({
        city: schema.businessLocations.city,
        state: schema.businessLocations.state,
      })
      .from(schema.businessLocations)
      .innerJoin(schema.businesses, eq(schema.businesses.id, schema.businessLocations.businessId))
      .where(and(eq(schema.businesses.status, 'PUBLISHED'), or(ilike(schema.businessLocations.city, term), ilike(schema.businessLocations.state, term))!))
      .orderBy(schema.businessLocations.state, schema.businessLocations.city)
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

    if (!targetBusiness || targetBusiness.status !== 'PUBLISHED') {
      return [];
    }

    const relatedRows = await this.db.query.businesses.findMany({
      where: and(
        eq(schema.businesses.status, 'PUBLISHED'),
        sql`${schema.businesses.id} != ${targetBusiness.id}`,
        targetBusiness.industryId ? eq(schema.businesses.industryId, targetBusiness.industryId) : undefined,
      ),
      orderBy: (b, { asc }) => [asc(b.name), asc(b.id)],
      limit: Math.min(Math.max(Number(limit) || 4, 1), 10),
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

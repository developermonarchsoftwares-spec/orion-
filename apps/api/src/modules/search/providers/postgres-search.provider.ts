import { Injectable, Logger, Inject } from '@nestjs/common';
import {
  ISearchProvider,
  IBusinessSearchQuery,
  ISearchResultResponse,
} from '../interfaces/search-provider.interface';
import { ITypesenseBusinessDocument } from '../repositories/search.repository';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { eq, and, or, ilike, sql, desc, asc, SQL, inArray } from 'drizzle-orm';

@Injectable()
export class PostgresSearchProvider implements ISearchProvider {
  readonly name = 'POSTGRES';
  private readonly logger = new Logger(PostgresSearchProvider.name);

  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
  ) {}

  async search(query: IBusinessSearchQuery): Promise<ISearchResultResponse> {
    const startTime = Date.now();
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(Math.max(1, query.limit || 20), 100);
    const offset = (page - 1) * limit;

    // 1. Build base business WHERE conditions
    const conditions: (SQL | undefined)[] = [
      eq(schema.businesses.status, 'PUBLISHED'),
    ];

    if (query.q && query.q.trim() && query.q.trim() !== '*') {
      const term = `%${query.q.trim()}%`;
      conditions.push(
        or(
          ilike(schema.businesses.name, term),
          ilike(schema.businesses.legalName, term),
          ilike(schema.businesses.description, term),
        ),
      );
    }

    if (query.industryId) {
      conditions.push(eq(schema.businesses.industryId, query.industryId));
    }
    if (query.categoryId) {
      conditions.push(eq(schema.businesses.categoryId, query.categoryId));
    }
    if (query.businessType) {
      conditions.push(eq(schema.businesses.businessType, query.businessType as any));
    }
    if (query.msmeCategory) {
      conditions.push(eq(schema.businesses.msmeCategory, query.msmeCategory as any));
    }
    if (query.opportunityTier) {
      conditions.push(eq(schema.businesses.opportunityTier, query.opportunityTier as any));
    }

    // Location-based subqueries if location filters are requested
    if (query.state || query.city || query.district || query.pincode) {
      const locConds: (SQL | undefined)[] = [];
      if (query.state) locConds.push(ilike(schema.businessLocations.state, `%${query.state.trim()}%`));
      if (query.city) locConds.push(ilike(schema.businessLocations.city, `%${query.city.trim()}%`));
      if (query.district) locConds.push(ilike(schema.businessLocations.district, `%${query.district.trim()}%`));
      if (query.pincode) locConds.push(eq(schema.businessLocations.pincode, query.pincode.trim()));

      const matchingLocs = this.db
        .select({ businessId: schema.businessLocations.businessId })
        .from(schema.businessLocations)
        .where(and(...locConds.filter(Boolean)));

      conditions.push(inArray(schema.businesses.id, matchingLocs));
    }

    // Contact availability filters
    if (query.hasPhone === true) {
      const withPhone = this.db
        .select({ businessId: schema.businessContacts.businessId })
        .from(schema.businessContacts)
        .where(sql`${schema.businessContacts.phone} IS NOT NULL AND ${schema.businessContacts.phone} <> ''`);
      conditions.push(inArray(schema.businesses.id, withPhone));
    }

    if (query.hasEmail === true) {
      const withEmail = this.db
        .select({ businessId: schema.businessContacts.businessId })
        .from(schema.businessContacts)
        .where(sql`${schema.businessContacts.email} IS NOT NULL AND ${schema.businessContacts.email} <> ''`);
      conditions.push(inArray(schema.businesses.id, withEmail));
    }

    if (query.hasWebsite === true) {
      const withWebsite = this.db
        .select({ businessId: schema.digitalPresences.businessId })
        .from(schema.digitalPresences)
        .where(eq(schema.digitalPresences.platform, 'WEBSITE'));
      conditions.push(inArray(schema.businesses.id, withWebsite));
    } else if (query.hasWebsite === false) {
      const withWebsite = this.db
        .select({ businessId: schema.digitalPresences.businessId })
        .from(schema.digitalPresences)
        .where(eq(schema.digitalPresences.platform, 'WEBSITE'));
      conditions.push(sql`${schema.businesses.id} NOT IN (${withWebsite})`);
    }

    if (query.hasGstin === true) {
      const withGstin = this.db
        .select({ businessId: schema.businessIdentifiers.businessId })
        .from(schema.businessIdentifiers)
        .where(eq(schema.businessIdentifiers.type, 'GSTIN'));
      conditions.push(inArray(schema.businesses.id, withGstin));
    }

    const whereClause = and(...conditions.filter(Boolean));

    // 2. Count total matches
    const [countResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.businesses)
      .where(whereClause);

    const total = countResult?.count || 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));

    // 3. Determine sorting
    let orderByClause: any = desc(schema.businesses.createdAt);
    const sortBy = query.sortBy || 'orion_score:desc';

    if (sortBy.includes('newest') || sortBy === 'created_at:desc') {
      orderByClause = desc(schema.businesses.createdAt);
    } else if (sortBy.includes('oldest') || sortBy === 'created_at:asc') {
      orderByClause = asc(schema.businesses.createdAt);
    } else if (sortBy.includes('name_asc') || sortBy === 'name:asc') {
      orderByClause = asc(schema.businesses.name);
    } else if (sortBy.includes('name_desc') || sortBy === 'name:desc') {
      orderByClause = desc(schema.businesses.name);
    } else if (sortBy.includes('recently_updated') || sortBy === 'updated_at:desc') {
      orderByClause = desc(schema.businesses.updatedAt);
    }

    // 4. Fetch page rows
    const rows = await this.db
      .select({
        id: schema.businesses.id,
        name: schema.businesses.name,
        legalName: schema.businesses.legalName,
        slug: schema.businesses.slug,
        status: schema.businesses.status,
        industryId: schema.businesses.industryId,
        categoryId: schema.businesses.categoryId,
        businessType: schema.businesses.businessType,
        msmeCategory: schema.businesses.msmeCategory,
        opportunityTier: schema.businesses.opportunityTier,
        foundingYear: schema.businesses.foundingYear,
        createdAt: schema.businesses.createdAt,
        updatedAt: schema.businesses.updatedAt,
      })
      .from(schema.businesses)
      .where(whereClause)
      .orderBy(orderByClause)
      .limit(limit)
      .offset(offset);

    // 5. Enrich rows with primary location, contact, score, industry
    const businessIds = rows.map((r) => r.id);
    let locationsMap: Record<string, any> = {};
    let contactsMap: Record<string, any> = {};
    let scoresMap: Record<string, number> = {};
    let industriesMap: Record<string, string> = {};
    let categoriesMap: Record<string, string> = {};
    let websiteMap: Record<string, boolean> = {};
    let gstinMap: Record<string, boolean> = {};

    if (businessIds.length > 0) {
      const [locations, contacts, scores, websites, gstins] = await Promise.all([
        this.db
          .select()
          .from(schema.businessLocations)
          .where(inArray(schema.businessLocations.businessId, businessIds)),
        this.db
          .select()
          .from(schema.businessContacts)
          .where(inArray(schema.businessContacts.businessId, businessIds)),
        this.db
          .select()
          .from(schema.businessScores)
          .where(inArray(schema.businessScores.businessId, businessIds)),
        this.db
          .select({ businessId: schema.digitalPresences.businessId })
          .from(schema.digitalPresences)
          .where(
            and(
              inArray(schema.digitalPresences.businessId, businessIds),
              eq(schema.digitalPresences.platform, 'WEBSITE'),
            ),
          ),
        this.db
          .select({ businessId: schema.businessIdentifiers.businessId })
          .from(schema.businessIdentifiers)
          .where(
            and(
              inArray(schema.businessIdentifiers.businessId, businessIds),
              eq(schema.businessIdentifiers.type, 'GSTIN'),
            ),
          ),
      ]);

      locations.forEach((loc) => {
        if (!locationsMap[loc.businessId] || loc.isPrimary) {
          locationsMap[loc.businessId] = loc;
        }
      });

      contacts.forEach((c) => {
        if (!contactsMap[c.businessId] || c.isPrimary) {
          contactsMap[c.businessId] = c;
        }
      });

      scores.forEach((s) => {
        scoresMap[s.businessId] = s.orionScore;
      });

      websites.forEach((w) => {
        websiteMap[w.businessId] = true;
      });

      gstins.forEach((g) => {
        gstinMap[g.businessId] = true;
      });

      const industryIds = rows.map((r) => r.industryId).filter(Boolean) as string[];
      if (industryIds.length > 0) {
        const inds = await this.db
          .select()
          .from(schema.industries)
          .where(inArray(schema.industries.id, industryIds));
        inds.forEach((i) => {
          industriesMap[i.id] = i.name;
        });
      }

      const categoryIds = rows.map((r) => r.categoryId).filter(Boolean) as string[];
      if (categoryIds.length > 0) {
        const cats = await this.db
          .select()
          .from(schema.categories)
          .where(inArray(schema.categories.id, categoryIds));
        cats.forEach((c) => {
          categoriesMap[c.id] = c.name;
        });
      }
    }

    // 6. Map to unified ITypesenseBusinessDocument shape
    const hits: ITypesenseBusinessDocument[] = rows.map((r) => {
      const loc = locationsMap[r.id];
      const contact = contactsMap[r.id];
      const score = scoresMap[r.id] ?? 75;

      return {
        id: r.id,
        name: r.name,
        legal_name: r.legalName || undefined,
        slug: r.slug,
        status: r.status,
        industry_id: r.industryId || undefined,
        industry_name: r.industryId ? industriesMap[r.industryId] || undefined : undefined,
        category_id: r.categoryId || undefined,
        category_name: r.categoryId ? categoriesMap[r.categoryId] || undefined : undefined,
        business_type: r.businessType || 'PRIVATE_LIMITED',
        msme_category: r.msmeCategory || undefined,
        state: loc?.state || 'India',
        district: loc?.district || '',
        city: loc?.city || 'India',
        pincode: loc?.pincode || '',
        has_website: Boolean(websiteMap[r.id]),
        has_email: Boolean(contact?.email),
        has_phone: Boolean(contact?.phone),
        has_gstin: Boolean(gstinMap[r.id]),
        orion_score: score,
        opportunity_tier: r.opportunityTier || 'MEDIUM',
        completeness_score: 85,
        verification_score: 90,
        freshness_score: 95,
        digital_presence_score: websiteMap[r.id] ? 80 : 40,
        confidence_score: 90,
        founding_year: r.foundingYear || undefined,
        created_at: Math.floor(new Date(r.createdAt).getTime() / 1000),
        updated_at: Math.floor(new Date(r.updatedAt).getTime() / 1000),
      };
    });

    const searchDurationMs = Date.now() - startTime;

    return {
      hits,
      total,
      page,
      totalPages,
      limit,
      searchDurationMs,
    };
  }
}

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { TransactionService } from '../../../database/transaction.service';
import { BusinessRepository } from '../repositories/business.repository';
import { BusinessLocationRepository, BusinessContactRepository, DigitalPresenceRepository } from '../repositories/business-details.repository';
import { BusinessIdentifierRepository } from '../repositories/business-identifier.repository';
import { BusinessMetricsRepository, BusinessScoreRepository } from '../repositories/business-metrics-scores.repository';
import { BusinessScoringService } from './business-scoring.service';
import { BusinessHistoryService } from './business-history.service';
import { StringUtil } from '../../../common/utils/string.util';
import { BusinessStatus, IdentifierType, DigitalPlatformType, BusinessType, MsmeCategory } from '@orion/shared';
import * as schema from '../../../database/schema';

export interface ICreateBusinessAggregateInput {
  name: string;
  legalName?: string;
  industryId?: string;
  categoryId?: string;
  businessTypeId?: string;
  businessType?: BusinessType;
  msmeCategoryId?: string;
  msmeCategory?: MsmeCategory;
  description?: string;
  foundingYear?: number;
  incorporationDate?: Date;
  employeeCountRange?: string;
  annualRevenueRange?: string;
  sourceId?: string;
  createdById?: string;
  locations?: Array<{
    addressLine1: string;
    addressLine2?: string;
    landmark?: string;
    city: string;
    district: string;
    state: string;
    pincode: string;
    country?: string;
    latitude?: string;
    longitude?: string;
    isPrimary?: boolean;
  }>;
  contacts?: Array<{
    fullName: string;
    title?: string;
    department?: string;
    email?: string;
    phone?: string;
    isPrimary?: boolean;
    isDecisionMaker?: boolean;
  }>;
  digitalPresences?: Array<{
    platform: DigitalPlatformType;
    handle?: string;
    url: string;
    domain?: string;
    techStackDetected?: unknown[];
  }>;
  identifiers?: Array<{
    type: IdentifierType;
    value: string;
    isPrimary?: boolean;
  }>;
}

@Injectable()
export class BusinessService {
  private readonly logger = new Logger(BusinessService.name);

  constructor(
    private readonly transactionService: TransactionService,
    private readonly businessRepo: BusinessRepository,
    private readonly locationRepo: BusinessLocationRepository,
    private readonly contactRepo: BusinessContactRepository,
    private readonly digitalPresenceRepo: DigitalPresenceRepository,
    private readonly identifierRepo: BusinessIdentifierRepository,
    private readonly metricsRepo: BusinessMetricsRepository,
    private readonly scoreRepo: BusinessScoreRepository,
    private readonly scoringService: BusinessScoringService,
    private readonly historyService: BusinessHistoryService,
  ) {}

  async getBusinessById(id: string) {
    const business = await this.businessRepo.findFullBusinessProfile(id);
    if (!business) {
      throw new NotFoundException(`Business with ID '${id}' was not found`);
    }
    return business;
  }

  async getBusinessBySlug(slug: string) {
    const business = await this.businessRepo.findBySlug(slug);
    if (!business) {
      throw new NotFoundException(`Business with slug '${slug}' was not found`);
    }
    return this.getBusinessById(business.id);
  }

  /**
   * Creates a complete 3NF normalized business entity atomically
   */
  async createBusinessAggregate(input: ICreateBusinessAggregateInput) {
    const baseSlug = StringUtil.slugify(input.name);
    const uniqueSlug = `${baseSlug}-${Date.now().toString(36)}`;

    return this.transactionService.runInTransaction(async (tx) => {
      // 1. Insert core business record
      const [business] = await tx
        .insert(schema.businesses)
        .values({
          name: input.name,
          legalName: input.legalName || input.name,
          slug: uniqueSlug,
          status: 'DRAFT',
          industryId: input.industryId,
          categoryId: input.categoryId,
          businessTypeId: input.businessTypeId,
           
          businessType: (input.businessType as any) || 'PRIVATE_LIMITED',
          msmeCategoryId: input.msmeCategoryId,
           
          msmeCategory: (input.msmeCategory as any) || 'NOT_APPLICABLE',
          description: input.description,
          foundingYear: input.foundingYear,
          incorporationDate: input.incorporationDate,
          employeeCountRange: input.employeeCountRange,
          annualRevenueRange: input.annualRevenueRange,
          sourceId: input.sourceId,
        })
        .returning();

      // 2. Insert locations
      if (input.locations && input.locations.length > 0) {
        await tx.insert(schema.businessLocations).values(
          input.locations.map((loc, idx) => ({
            businessId: business.id,
            addressLine1: loc.addressLine1,
            addressLine2: loc.addressLine2,
            landmark: loc.landmark,
            city: loc.city,
            district: loc.district,
            state: loc.state,
            pincode: loc.pincode,
            country: loc.country || 'India',
            latitude: loc.latitude,
            longitude: loc.longitude,
            isPrimary: loc.isPrimary ?? (idx === 0),
          })),
        );
      }

      // 3. Insert contacts
      if (input.contacts && input.contacts.length > 0) {
        await tx.insert(schema.businessContacts).values(
          input.contacts.map((c, idx) => ({
            businessId: business.id,
            fullName: c.fullName,
            title: c.title,
            department: c.department,
            email: c.email,
            phone: c.phone,
            isPrimary: c.isPrimary ?? (idx === 0),
            isDecisionMaker: c.isDecisionMaker ?? false,
          })),
        );
      }

      // 4. Insert digital presences
      if (input.digitalPresences && input.digitalPresences.length > 0) {
        await tx.insert(schema.digitalPresences).values(
          input.digitalPresences.map((dp) => ({
            businessId: business.id,
             
            platform: dp.platform as any,
            handle: dp.handle,
            url: dp.url,
            domain: dp.domain || StringUtil.extractDomain(dp.url),
            techStackDetected: dp.techStackDetected || [],
          })),
        );
      }

      // 5. Insert identifiers
      if (input.identifiers && input.identifiers.length > 0) {
        await tx.insert(schema.businessIdentifiers).values(
          input.identifiers.map((ident, idx) => ({
            businessId: business.id,
             
            type: ident.type as any,
            value: ident.value.trim(),
            normalizedValue: ident.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''),
            isPrimary: ident.isPrimary ?? (idx === 0),
          })),
        );
      }

      // 6. Calculate & insert baseline scores
      const calculated = this.scoringService.calculateScores({
        business,
        locations: input.locations || [],
        contacts: input.contacts || [],
        digitalPresences: input.digitalPresences || [],
        identifiers: input.identifiers || [],
      });

      await tx.insert(schema.businessMetrics).values({
        businessId: business.id,
        completenessScore: calculated.completenessScore,
        verificationScore: calculated.verificationScore,
        freshnessScore: calculated.freshnessScore,
        digitalPresenceScore: calculated.digitalPresenceScore,
        confidenceScore: calculated.confidenceScore,
        factorBreakdown: calculated.factorBreakdown,
      });

      await tx.insert(schema.businessScores).values({
        businessId: business.id,
        orionScore: calculated.orionScore,
        weightsApplied: calculated.weightsApplied,
      });

      // Update opportunity tier on business
      await tx
        .update(schema.businesses)
        .set({
          opportunityTier: calculated.opportunityTier,
        })
        .where(eq(schema.businesses.id, business.id));

      // 7. Non-destructive change log
      await this.historyService.logChange({
        businessId: business.id,
        changedById: input.createdById,
        changeType: 'INITIAL_CREATION',
        fullSnapshot: {
          business,
          locations: input.locations,
          contacts: input.contacts,
          identifiers: input.identifiers,
          scores: calculated,
        },
        changeReason: 'Initial business profile creation',
      });

      this.logger.log(`Created business profile: ${business.name} (ID: ${business.id}, Score: ${calculated.orionScore})`);
      return business;
    });
  }

  /**
   * Recalculates metrics and scores for an existing business profile
   */
  async recalculateBusinessScores(businessId: string) {
    const profile = await this.getBusinessById(businessId);

    const calculated = this.scoringService.calculateScores({
      business: profile,
      locations: profile.locations,
      contacts: profile.contacts,
      digitalPresences: profile.digitalPresences as any,
      identifiers: profile.identifiers,
    });

    await this.metricsRepo.upsert({
      businessId,
      completenessScore: calculated.completenessScore,
      verificationScore: calculated.verificationScore,
      freshnessScore: calculated.freshnessScore,
      digitalPresenceScore: calculated.digitalPresenceScore,
      confidenceScore: calculated.confidenceScore,
      factorBreakdown: calculated.factorBreakdown,
    });

    await this.scoreRepo.upsert({
      businessId,
      orionScore: calculated.orionScore,
      weightsApplied: calculated.weightsApplied,
    });

    await this.businessRepo.updateById(businessId, {
      opportunityTier: calculated.opportunityTier,
    });

    return calculated;
  }
}

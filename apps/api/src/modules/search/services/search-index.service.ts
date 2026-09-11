import { Injectable, Logger } from '@nestjs/common';
import { BusinessRepository } from '../../business/repositories/business.repository';
import { SearchRepository, ITypesenseBusinessDocument } from '../repositories/search.repository';
import { SearchSyncLogRepository } from '../repositories/search-sync-log.repository';
import { SearchSyncStatus } from '@orion/shared';

@Injectable()
export class SearchIndexService {
  private readonly logger = new Logger(SearchIndexService.name);

  constructor(
    private readonly businessRepo: BusinessRepository,
    private readonly searchRepo: SearchRepository,
    private readonly syncLogRepo: SearchSyncLogRepository,
  ) {}

  /**
   * Syncs a published business profile to the Typesense search index
   */
  async syncBusiness(businessId: string, action: 'UPSERT' | 'DELETE' = 'UPSERT') {
    const log = await this.syncLogRepo.logSyncAttempt({
      businessId,
      action,
      status: SearchSyncStatus.PENDING,
    });

    try {
      if (action === 'DELETE') {
        await this.searchRepo.deleteDocument(businessId);
        await this.syncLogRepo.updateStatus(log.id, SearchSyncStatus.SYNCED);
        this.logger.log(`Deleted business ${businessId} from search index`);
        return { success: true, action: 'DELETE' };
      }

      const business = await this.businessRepo.findFullBusinessProfile(businessId);
      if (!business) {
        throw new Error(`Business ${businessId} was not found for indexing`);
      }

      const primaryLocation = business.locations.find((l) => l.isPrimary) || business.locations[0];
      const hasWebsite = business.digitalPresences.some((d) => d.platform === 'WEBSITE');
      const hasEmail = business.contacts.some((c) => Boolean(c.email));
      const hasPhone = business.contacts.some((c) => Boolean(c.phone));
      const hasGstin = business.identifiers.some((i) => i.type === 'GSTIN');

      const doc: ITypesenseBusinessDocument = {
        id: business.id,
        name: business.name,
        legal_name: business.legalName || undefined,
        slug: business.slug,
        status: business.status,
        industry_id: business.industryId || undefined,
        industry_name: business.industry?.name || undefined,
        category_id: business.categoryId || undefined,
        category_name: business.category?.name || undefined,
        business_type: business.businessType || undefined,
        msme_category: business.msmeCategory || undefined,
        state: primaryLocation?.state || 'Unknown',
        district: primaryLocation?.district || 'Unknown',
        city: primaryLocation?.city || 'Unknown',
        pincode: primaryLocation?.pincode || '000000',
        has_website: hasWebsite,
        has_email: hasEmail,
        has_phone: hasPhone,
        has_gstin: hasGstin,
        orion_score: business.scores?.orionScore || 0,
        opportunity_tier: business.opportunityTier,
        completeness_score: business.metrics?.completenessScore || 0,
        verification_score: business.metrics?.verificationScore || 0,
        freshness_score: business.metrics?.freshnessScore || 0,
        digital_presence_score: business.metrics?.digitalPresenceScore || 0,
        confidence_score: business.metrics?.confidenceScore || 0,
        founding_year: business.foundingYear || undefined,
        created_at: Math.floor(new Date(business.createdAt).getTime() / 1000),
        updated_at: Math.floor(new Date(business.updatedAt).getTime() / 1000),
      };

      await this.searchRepo.indexDocument(doc);
      await this.syncLogRepo.updateStatus(log.id, SearchSyncStatus.SYNCED);

      this.logger.log(`Indexed business '${business.name}' [Score: ${doc.orion_score}] to Typesense`);
      return { success: true, action: 'UPSERT', document: doc };
    } catch (error) {
      this.logger.error(`Search index failed for business ${businessId}: ${(error as Error).message}`);
      await this.syncLogRepo.updateStatus(log.id, SearchSyncStatus.FAILED, (error as Error).message);
      throw error;
    }
  }
}

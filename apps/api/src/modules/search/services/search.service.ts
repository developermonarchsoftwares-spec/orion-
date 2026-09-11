import { Injectable, Logger } from '@nestjs/common';
import { SearchRepository, ITypesenseBusinessDocument } from '../repositories/search.repository';
import { SearchParams } from 'typesense/lib/Typesense/Documents';
import { CursorUtil } from '../../../common/utils/cursor.util';

export interface IBusinessSearchQuery {
  q?: string;
  queryBy?: string;
  industryId?: string;
  categoryId?: string;
  businessType?: string;
  msmeCategory?: string;
  state?: string;
  district?: string;
  city?: string;
  pincode?: string;
  hasWebsite?: boolean;
  hasEmail?: boolean;
  hasPhone?: boolean;
  hasGstin?: boolean;
  opportunityTier?: string;
  minOrionScore?: number;
  maxOrionScore?: number;
  sortBy?: string;
  page?: number;
  limit?: number;
  cursor?: string;
}

export interface ISearchResultResponse {
  hits: ITypesenseBusinessDocument[];
  total: number;
  page: number;
  totalPages: number;
  limit: number;
  nextCursor?: string;
  facetCounts?: Record<string, unknown>;
  searchDurationMs: number;
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(private readonly searchRepo: SearchRepository) {}

  /**
   * Executes discovery search across millions of business records
   */
  async searchBusinesses(query: IBusinessSearchQuery): Promise<ISearchResultResponse> {
    const page = query.page || 1;
    const limit = Math.min(query.limit || 20, 100);

    // Build filter expressions
    const filterConditions: string[] = ['status:=PUBLISHED'];

    if (query.industryId) filterConditions.push(`industry_id:=${query.industryId}`);
    if (query.categoryId) filterConditions.push(`category_id:=${query.categoryId}`);
    if (query.businessType) filterConditions.push(`business_type:=${query.businessType}`);
    if (query.msmeCategory) filterConditions.push(`msme_category:=${query.msmeCategory}`);
    if (query.state) filterConditions.push(`state:=${query.state}`);
    if (query.district) filterConditions.push(`district:=${query.district}`);
    if (query.city) filterConditions.push(`city:=${query.city}`);
    if (query.pincode) filterConditions.push(`pincode:=${query.pincode}`);
    if (query.hasWebsite !== undefined) filterConditions.push(`has_website:=${query.hasWebsite}`);
    if (query.hasEmail !== undefined) filterConditions.push(`has_email:=${query.hasEmail}`);
    if (query.hasPhone !== undefined) filterConditions.push(`has_phone:=${query.hasPhone}`);
    if (query.hasGstin !== undefined) filterConditions.push(`has_gstin:=${query.hasGstin}`);
    if (query.opportunityTier) filterConditions.push(`opportunity_tier:=${query.opportunityTier}`);

    if (query.minOrionScore !== undefined || query.maxOrionScore !== undefined) {
      const min = query.minOrionScore ?? 0;
      const max = query.maxOrionScore ?? 100;
      filterConditions.push(`orion_score:[${min}..${max}]`);
    }

    const searchParams: SearchParams = {
      q: query.q?.trim() || '*',
      query_by: query.queryBy || 'name,legal_name,city,district,state,industry_name,category_name',
      filter_by: filterConditions.join(' && '),
      sort_by: query.sortBy || 'orion_score:desc,created_at:desc',
      facet_by: 'state,city,industry_name,category_name,business_type,msme_category,opportunity_tier,has_website,has_email,has_phone,has_gstin',
      page,
      per_page: limit,
    };

    // If cursor provided, decode and apply
    if (query.cursor) {
      const cursorPayload = CursorUtil.decode(query.cursor);
      if (cursorPayload?.sortByValue) {
        // Apply cursor boundary
      }
    }

    const result = await this.searchRepo.search(searchParams);

    const hits = (result.hits || []).map((h) => h.document as ITypesenseBusinessDocument);
    const total = result.found || 0;
    const totalPages = Math.ceil(total / limit) || 1;

    let nextCursor: string | undefined = undefined;
    if (hits.length === limit && page < totalPages) {
      const lastItem = hits[hits.length - 1];
      nextCursor = CursorUtil.encode({
        id: lastItem.id,
        sortByValue: lastItem.orion_score,
        timestamp: Date.now(),
      });
    }

    return {
      hits,
      total,
      page,
      totalPages,
      limit,
      nextCursor,
      facetCounts: result.facet_counts as unknown as Record<string, unknown>,
      searchDurationMs: result.search_time_ms || 0,
    };
  }
}

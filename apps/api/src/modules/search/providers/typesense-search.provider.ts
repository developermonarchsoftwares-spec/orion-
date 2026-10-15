import { Injectable, Logger } from '@nestjs/common';
import {
  ISearchProvider,
  IBusinessSearchQuery,
  ISearchResultResponse,
} from '../interfaces/search-provider.interface';
import { SearchRepository, ITypesenseBusinessDocument } from '../repositories/search.repository';
import { SearchParams } from 'typesense/lib/Typesense/Documents';
import { CursorUtil } from '../../../common/utils/cursor.util';
import { buildTypesenseFilter, safeTypesenseSort } from '../typesense-query';

@Injectable()
export class TypesenseSearchProvider implements ISearchProvider {
  readonly name = 'TYPESENSE';
  private readonly logger = new Logger(TypesenseSearchProvider.name);

  constructor(private readonly searchRepo: SearchRepository) {}

  async search(query: IBusinessSearchQuery): Promise<ISearchResultResponse> {
    const page = query.page || 1;
    const limit = Math.min(query.limit || 20, 100);

    const searchParams: SearchParams = {
      q: query.q?.trim() || '*',
      query_by: query.queryBy || 'name,legal_name,city,district,state,industry_name,category_name',
      filter_by: buildTypesenseFilter(query),
      sort_by: safeTypesenseSort(query.sortBy),
      facet_by: 'state,city,industry_name,category_name,business_type,msme_category,opportunity_tier,has_website,has_email,has_phone,has_gstin',
      page,
      per_page: limit,
    };

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

  async indexDocument(doc: ITypesenseBusinessDocument) {
    return this.searchRepo.indexDocument(doc);
  }

  async bulkIndex(docs: ITypesenseBusinessDocument[]) {
    return this.searchRepo.bulkIndex(docs);
  }

  async deleteDocument(id: string) {
    return this.searchRepo.deleteDocument(id);
  }
}

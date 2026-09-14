import { ITypesenseBusinessDocument } from '../repositories/search.repository';

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

export interface ISearchProvider {
  readonly name: string;
  search(query: IBusinessSearchQuery): Promise<ISearchResultResponse>;
  indexDocument?(doc: ITypesenseBusinessDocument): Promise<unknown>;
  bulkIndex?(docs: ITypesenseBusinessDocument[]): Promise<unknown>;
  deleteDocument?(id: string): Promise<unknown>;
}

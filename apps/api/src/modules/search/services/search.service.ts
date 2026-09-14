import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ISearchProvider,
  IBusinessSearchQuery,
  ISearchResultResponse,
} from '../interfaces/search-provider.interface';
import { PostgresSearchProvider } from '../providers/postgres-search.provider';
import { TypesenseSearchProvider } from '../providers/typesense-search.provider';
import { ITypesenseBusinessDocument } from '../repositories/search.repository';

export { IBusinessSearchQuery, ISearchResultResponse };

@Injectable()
export class SearchService implements ISearchProvider {
  readonly name: string;
  private readonly logger = new Logger(SearchService.name);
  private readonly activeProvider: ISearchProvider;

  constructor(
    private readonly configService: ConfigService,
    private readonly postgresProvider: PostgresSearchProvider,
    private readonly typesenseProvider: TypesenseSearchProvider,
  ) {
    const configuredProvider = (
      this.configService.get<string>('SEARCH_PROVIDER') || 'postgres'
    ).toLowerCase();

    if (configuredProvider === 'typesense') {
      this.activeProvider = this.typesenseProvider;
      this.name = 'TYPESENSE';
      this.logger.log('Search service initialized with active provider: Typesense');
    } else {
      this.activeProvider = this.postgresProvider;
      this.name = 'POSTGRES';
      this.logger.log('Search service initialized with active provider: PostgreSQL');
    }
  }

  /**
   * Executes discovery search across business records using the active provider
   */
  async searchBusinesses(query: IBusinessSearchQuery): Promise<ISearchResultResponse> {
    return this.activeProvider.search(query);
  }

  /**
   * Alias to satisfy ISearchProvider interface
   */
  async search(query: IBusinessSearchQuery): Promise<ISearchResultResponse> {
    return this.searchBusinesses(query);
  }

  /**
   * Index document if supported by active provider
   */
  async indexDocument(doc: ITypesenseBusinessDocument): Promise<unknown> {
    if (this.activeProvider.indexDocument) {
      return this.activeProvider.indexDocument(doc);
    }
    return null;
  }

  /**
   * Bulk index documents if supported by active provider
   */
  async bulkIndex(docs: ITypesenseBusinessDocument[]): Promise<unknown> {
    if (this.activeProvider.bulkIndex) {
      return this.activeProvider.bulkIndex(docs);
    }
    return [];
  }

  /**
   * Delete document if supported by active provider
   */
  async deleteDocument(id: string): Promise<unknown> {
    if (this.activeProvider.deleteDocument) {
      return this.activeProvider.deleteDocument(id);
    }
    return null;
  }
}

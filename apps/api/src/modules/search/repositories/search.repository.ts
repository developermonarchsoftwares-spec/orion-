import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'typesense';
import { SearchParams } from 'typesense/lib/Typesense/Documents';
import { TYPESENSE_CLIENT } from '../../typesense/typesense.constants';
import { BUSINESSES_SEARCH_COLLECTION, BUSINESSES_COLLECTION_SCHEMA } from '../search.constants';

export interface ITypesenseBusinessDocument {
  id: string;
  name: string;
  legal_name?: string;
  slug: string;
  status: string;
  industry_id?: string;
  industry_name?: string;
  category_id?: string;
  category_name?: string;
  business_type?: string;
  msme_category?: string;
  state: string;
  district: string;
  city: string;
  pincode: string;
  has_website: boolean;
  has_email: boolean;
  has_phone: boolean;
  has_gstin: boolean;
  orion_score: number;
  opportunity_tier: string;
  completeness_score?: number;
  verification_score?: number;
  freshness_score?: number;
  digital_presence_score?: number;
  confidence_score?: number;
  founding_year?: number;
  created_at: number;
  updated_at: number;
}

@Injectable()
export class SearchRepository implements OnModuleInit {
  private readonly logger = new Logger(SearchRepository.name);

  constructor(
    @Optional()
    @Inject(TYPESENSE_CLIENT)
    private readonly typesenseClient: Client | null,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    const searchProvider = (this.configService.get<string>('SEARCH_PROVIDER') || 'postgres').toLowerCase();
    if (searchProvider !== 'typesense' || !this.typesenseClient) {
      this.logger.log('Typesense search disabled (active provider: postgres). Skipping collection bootstrap.');
      return;
    }
    try {
      await this.ensureCollection();
    } catch (error) {
      this.logger.warn(`Search collection bootstrap deferred: ${(error as Error).message}`);
    }
  }

  /**
   * Idempotently ensures the Typesense collection schema exists
   */
  async ensureCollection() {
    if (!this.typesenseClient) return;
    try {
      await this.typesenseClient.collections(BUSINESSES_SEARCH_COLLECTION).retrieve();
      this.logger.log(`Typesense collection '${BUSINESSES_SEARCH_COLLECTION}' is active.`);
    } catch {
      this.logger.log(`Creating Typesense collection '${BUSINESSES_SEARCH_COLLECTION}'...`);
      await this.typesenseClient.collections().create(BUSINESSES_COLLECTION_SCHEMA);
      this.logger.log(`Typesense collection '${BUSINESSES_SEARCH_COLLECTION}' created successfully.`);
    }
  }

  /**
   * Upserts a single document in Typesense
   */
  async indexDocument(doc: ITypesenseBusinessDocument) {
    if (!this.typesenseClient) return null;
    return this.typesenseClient
      .collections<ITypesenseBusinessDocument>(BUSINESSES_SEARCH_COLLECTION)
      .documents()
      .upsert(doc);
  }

  /**
   * Bulk imports documents in Typesense
   */
  async bulkIndex(docs: ITypesenseBusinessDocument[]) {
    if (!this.typesenseClient || docs.length === 0) return [];
    return this.typesenseClient
      .collections<ITypesenseBusinessDocument>(BUSINESSES_SEARCH_COLLECTION)
      .documents()
      .import(docs, { action: 'upsert' });
  }

  /**
   * Deletes a document by ID
   */
  async deleteDocument(id: string) {
    if (!this.typesenseClient) return null;
    return this.typesenseClient
      .collections(BUSINESSES_SEARCH_COLLECTION)
      .documents(id)
      .delete();
  }

  /**
   * Executes a search query with full-text, filters, facets, and sorting
   */
  async search(params: SearchParams) {
    if (!this.typesenseClient) {
      throw new Error('Typesense client is not available (active provider: postgres)');
    }
    return this.typesenseClient
      .collections<ITypesenseBusinessDocument>(BUSINESSES_SEARCH_COLLECTION)
      .documents()
      .search(params);
  }
}

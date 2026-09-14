import { Module } from '@nestjs/common';
import { BusinessModule } from '../business/business.module';
import { SearchRepository } from './repositories/search.repository';
import { SearchSyncLogRepository } from './repositories/search-sync-log.repository';
import { SearchIndexService } from './services/search-index.service';
import { SearchService } from './services/search.service';
import { SearchSyncWorker } from './workers/search-sync.worker';
import { PostgresSearchProvider } from './providers/postgres-search.provider';
import { TypesenseSearchProvider } from './providers/typesense-search.provider';

@Module({
  imports: [BusinessModule],
  providers: [
    SearchRepository,
    SearchSyncLogRepository,
    SearchIndexService,
    PostgresSearchProvider,
    TypesenseSearchProvider,
    SearchService,
    SearchSyncWorker,
  ],
  exports: [
    SearchRepository,
    SearchSyncLogRepository,
    SearchIndexService,
    PostgresSearchProvider,
    TypesenseSearchProvider,
    SearchService,
    SearchSyncWorker,
  ],
})
export class SearchModule {}

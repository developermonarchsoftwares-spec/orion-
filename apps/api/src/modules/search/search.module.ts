import { Module } from '@nestjs/common';
import { BusinessModule } from '../business/business.module';
import { SearchRepository } from './repositories/search.repository';
import { SearchSyncLogRepository } from './repositories/search-sync-log.repository';
import { SearchIndexService } from './services/search-index.service';
import { SearchService } from './services/search.service';
import { SearchSyncWorker } from './workers/search-sync.worker';

@Module({
  imports: [BusinessModule],
  providers: [
    SearchRepository,
    SearchSyncLogRepository,
    SearchIndexService,
    SearchService,
    SearchSyncWorker,
  ],
  exports: [
    SearchRepository,
    SearchSyncLogRepository,
    SearchIndexService,
    SearchService,
    SearchSyncWorker,
  ],
})
export class SearchModule {}

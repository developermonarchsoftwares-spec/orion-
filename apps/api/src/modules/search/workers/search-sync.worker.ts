import { Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseWorker } from '../../queue/base.worker';
import { RedisService } from '../../redis/redis.service';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import { SearchIndexService } from '../services/search-index.service';

export interface ISearchSyncJobData {
  businessId: string;
  action?: 'UPSERT' | 'DELETE';
}

@Injectable()
export class SearchSyncWorker extends BaseWorker<ISearchSyncJobData, unknown> {
  constructor(
    redisService: RedisService,
    private readonly searchIndexService: SearchIndexService,
  ) {
    super(QUEUE_NAMES.TYPESENSE_SYNC, redisService, { concurrency: 5 });
  }

  async processJob(job: Job<ISearchSyncJobData>): Promise<unknown> {
    const { businessId, action = 'UPSERT' } = job.data;
    this.logger.log(`Worker syncing search index for business: ${businessId} [${action}]`);
    return this.searchIndexService.syncBusiness(businessId, action);
  }
}

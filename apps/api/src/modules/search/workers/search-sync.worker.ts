import { Injectable } from '@nestjs/common';
import { BaseWorker, IWorkerJob } from '../../queue/base.worker';
import { QueueService } from '../../queue/queue.service';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import { SearchIndexService } from '../services/search-index.service';

export interface ISearchSyncJobData {
  businessId: string;
  action?: 'UPSERT' | 'DELETE';
}

@Injectable()
export class SearchSyncWorker extends BaseWorker<ISearchSyncJobData, unknown> {
  constructor(
    queueService: QueueService,
    private readonly searchIndexService: SearchIndexService,
  ) {
    super(QUEUE_NAMES.TYPESENSE_SYNC, queueService, { concurrency: 5 });
  }

  async processJob(job: IWorkerJob<ISearchSyncJobData>): Promise<unknown> {
    const { businessId, action = 'UPSERT' } = job.data;
    this.logger.log(`Worker syncing search index for business: ${businessId} [${action}]`);
    return this.searchIndexService.syncBusiness(businessId, action);
  }
}

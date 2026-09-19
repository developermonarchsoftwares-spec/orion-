import { Injectable } from '@nestjs/common';
import { BaseWorker, IWorkerJob } from '../../queue/base.worker';
import { QueueService } from '../../queue/queue.service';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import { PublishingService } from '../services/publishing.service';

export interface IPublishJobData {
  publishQueueId: string;
}

@Injectable()
export class PublishWorker extends BaseWorker<IPublishJobData, unknown> {
  constructor(
    queueService: QueueService,
    private readonly publishingService: PublishingService,
  ) {
    super(QUEUE_NAMES.AUDIT_LOG, queueService, { concurrency: 5 });
  }

  async processJob(job: IWorkerJob<IPublishJobData>): Promise<unknown> {
    const { publishQueueId } = job.data;
    this.logger.log(`Worker publishing record: ${publishQueueId}`);
    return this.publishingService.publishRecord(publishQueueId);
  }
}

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
    // Phase 15: a queue job carries no administrator, so the publisher refuses it. Publication is only ever an administrator's explicit action
    // (publish-batch) or an approved automatic import; this worker cannot be used to publish around either.
    return this.publishingService.publishRecord(publishQueueId, undefined);
  }
}

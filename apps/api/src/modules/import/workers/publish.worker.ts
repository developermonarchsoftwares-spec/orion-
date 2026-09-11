import { Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseWorker } from '../../queue/base.worker';
import { RedisService } from '../../redis/redis.service';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import { PublishingService } from '../services/publishing.service';

export interface IPublishJobData {
  publishQueueId: string;
}

@Injectable()
export class PublishWorker extends BaseWorker<IPublishJobData, unknown> {
  constructor(
    redisService: RedisService,
    private readonly publishingService: PublishingService,
  ) {
    super(QUEUE_NAMES.AUDIT_LOG, redisService, { concurrency: 5 });
  }

  async processJob(job: Job<IPublishJobData>): Promise<unknown> {
    const { publishQueueId } = job.data;
    this.logger.log(`Worker publishing record: ${publishQueueId}`);
    return this.publishingService.publishRecord(publishQueueId);
  }
}

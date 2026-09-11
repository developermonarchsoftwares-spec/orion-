import { Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseWorker } from '../../queue/base.worker';
import { RedisService } from '../../redis/redis.service';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import { ImportPipelineService } from '../services/import-pipeline.service';

export interface IImportBatchJobData {
  batchId: string;
}

@Injectable()
export class ImportBatchWorker extends BaseWorker<IImportBatchJobData, unknown> {
  constructor(
    redisService: RedisService,
    private readonly pipelineService: ImportPipelineService,
  ) {
    super(QUEUE_NAMES.IMPORT_PROCESSING, redisService, { concurrency: 2 });
  }

  async processJob(job: Job<IImportBatchJobData>): Promise<unknown> {
    const { batchId } = job.data;
    this.logger.log(`Worker processing import batch job: ${batchId}`);
    return this.pipelineService.processBatch(batchId);
  }
}

import { Injectable } from '@nestjs/common';
import { BaseWorker, IWorkerJob } from '../../queue/base.worker';
import { QueueService } from '../../queue/queue.service';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import { ImportPipelineService } from '../services/import-pipeline.service';

export interface IImportBatchJobData {
  batchId: string;
}

@Injectable()
export class ImportBatchWorker extends BaseWorker<IImportBatchJobData, unknown> {
  constructor(
    queueService: QueueService,
    private readonly pipelineService: ImportPipelineService,
  ) {
    super(QUEUE_NAMES.IMPORT_PROCESSING, queueService, { concurrency: 2 });
  }

  async processJob(job: IWorkerJob<IImportBatchJobData>): Promise<unknown> {
    const { batchId } = job.data;
    this.logger.log(`Worker processing import batch job: ${batchId}`);
    return this.pipelineService.processBatch(batchId);
  }
}

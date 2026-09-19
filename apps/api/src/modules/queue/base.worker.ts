import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { QueueService, IJobPayload } from './queue.service';

export interface IWorkerJob<T = unknown> {
  id: string;
  name: string;
  data: T;
}

export abstract class BaseWorker<TData = unknown, TResult = unknown>
  implements OnModuleInit, OnModuleDestroy
{
  protected readonly logger: Logger;

  constructor(
    protected readonly queueName: string,
    protected readonly queueService: QueueService,
    protected readonly options?: { concurrency?: number },
  ) {
    this.logger = new Logger(`Worker[${queueName}]`);
  }

  abstract processJob(job: IWorkerJob<TData>): Promise<TResult>;

  onModuleInit() {
    this.logger.log(`Initializing PostgreSQL worker for queue: ${this.queueName}`);
    this.queueService.registerWorker(this.queueName, async (job: IJobPayload<TData>) => {
      this.logger.debug(`Processing job ${job.id} [${job.name}]`);
      return this.processJob(job);
    });
  }

  async onModuleDestroy() {
    this.logger.log(`Gracefully closing worker for queue: ${this.queueName}...`);
    this.queueService.unregisterWorker(this.queueName);
    this.logger.log(`Worker for queue ${this.queueName} closed.`);
  }
}

import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker, Job, WorkerOptions } from 'bullmq';
import { RedisService } from '../redis/redis.service';

export abstract class BaseWorker<TData = unknown, TResult = unknown>
  implements OnModuleInit, OnModuleDestroy
{
  protected readonly logger: Logger;
  protected worker: Worker<TData, TResult> | null = null;

  constructor(
    protected readonly queueName: string,
    protected readonly redisService: RedisService,
    protected readonly options?: Partial<WorkerOptions>,
  ) {
    this.logger = new Logger(`Worker[${queueName}]`);
  }

  abstract processJob(job: Job<TData, TResult>): Promise<TResult>;

  onModuleInit() {
    this.logger.log(`Initializing worker for queue: ${this.queueName}`);
    const redisClient = this.redisService.getClient();

    this.worker = new Worker<TData, TResult>(
      this.queueName,
      async (job) => {
        this.logger.debug(`Processing job ${job.id} [${job.name}]`);
        return this.processJob(job);
      },
      {
        connection: redisClient.duplicate(),
        concurrency: this.options?.concurrency || 5,
        ...this.options,
      },
    );

    this.worker.on('completed', (job) => {
      this.logger.debug(`Job ${job.id} completed successfully`);
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Job ${job?.id} failed with error: ${err.message}`,
        err.stack,
      );
    });

    this.worker.on('error', (err) => {
      this.logger.error(`Worker error: ${err.message}`, err.stack);
    });
  }

  async onModuleDestroy() {
    if (this.worker) {
      this.logger.log(`Gracefully closing worker for queue: ${this.queueName}...`);
      await this.worker.close();
      this.logger.log(`Worker for queue ${this.queueName} closed.`);
    }
  }
}

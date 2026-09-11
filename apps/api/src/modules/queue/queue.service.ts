import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, JobsOptions } from 'bullmq';
import { RedisService } from '../redis/redis.service';
import { QUEUE_NAMES, QueueNameType } from './queue.constants';

export interface IQueueStats {
  queueName: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
}

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly queues = new Map<string, Queue>();

  constructor(private readonly redisService: RedisService) {}

  onModuleInit() {
    this.logger.log('Initializing BullMQ queues...');
    const redisClient = this.redisService.getClient();

    for (const queueName of Object.values(QUEUE_NAMES)) {
      const queue = new Queue(queueName, {
        connection: redisClient.duplicate(),
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 5000 },
        },
      });

      this.queues.set(queueName, queue);
      this.logger.log(`Registered BullMQ queue: ${queueName}`);
    }
  }

  getQueue(queueName: QueueNameType | string): Queue {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} is not registered`);
    }
    return queue;
  }

  async addJob<T = unknown>(
    queueName: QueueNameType | string,
    jobName: string,
    data: T,
    options?: JobsOptions,
  ) {
    const queue = this.getQueue(queueName);
    return queue.add(jobName, data, options);
  }

  async getQueueStats(queueName: QueueNameType | string): Promise<IQueueStats> {
    const queue = this.getQueue(queueName);
    const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');
    const isPaused = await queue.isPaused();

    return {
      queueName,
      waiting: counts.waiting || 0,
      active: counts.active || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
      delayed: counts.delayed || 0,
      paused: isPaused,
    };
  }

  async getAllQueueStats(): Promise<IQueueStats[]> {
    const stats: IQueueStats[] = [];
    for (const queueName of this.queues.keys()) {
      stats.push(await this.getQueueStats(queueName));
    }
    return stats;
  }

  async ping(): Promise<boolean> {
    try {
      const redisPing = await this.redisService.ping();
      return redisPing && this.queues.size > 0;
    } catch (error) {
      this.logger.error('Queue health ping failed', error);
      return false;
    }
  }

  async onModuleDestroy() {
    this.logger.log('Closing all BullMQ queues...');
    for (const [name, queue] of this.queues.entries()) {
      await queue.close();
      this.logger.log(`Closed queue: ${name}`);
    }
  }
}

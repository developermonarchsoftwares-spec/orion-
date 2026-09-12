import * as dotenv from 'dotenv';
import * as path from 'path';

// Load apps/api/.env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import Redis from 'ioredis';
import { Queue, Worker } from 'bullmq';

async function runVerification() {
  console.log('====================================================');
  console.log('ORION REDIS & BULLMQ VERIFICATION SUITE');
  console.log('====================================================');

  const redisUrl = process.env.REDIS_URL;
  const host = process.env.REDIS_HOST || 'localhost';
  const port = parseInt(process.env.REDIS_PORT || '6379', 10);
  const password = process.env.REDIS_PASSWORD || undefined;
  const db = parseInt(process.env.REDIS_DB || '0', 10);
  const tls = process.env.REDIS_TLS === 'true';

  let client: Redis;
  let targetDisplay: string;
  let isTls = false;

  if (redisUrl && redisUrl.trim().length > 0) {
    try {
      const parsed = new URL(redisUrl.trim());
      isTls = parsed.protocol === 'rediss:';
      targetDisplay = `${parsed.hostname}:${parsed.port || 6379} (TLS: ${isTls ? 'ENABLED' : 'DISABLED'})`;
    } catch {
      targetDisplay = '[configured via REDIS_URL]';
    }

    client = new Redis(redisUrl.trim(), {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      connectTimeout: 10000,
    });
  } else {
    isTls = tls;
    targetDisplay = `${host}:${port}/${db} (TLS: ${isTls ? 'ENABLED' : 'DISABLED'})`;

    client = new Redis({
      host,
      port,
      password: password || undefined,
      db,
      tls: isTls ? {} : undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      connectTimeout: 10000,
    });
  }

  console.log(`Target: ${targetDisplay}`);
  console.log('Testing Redis TCP connection & PING...');

  try {
    const pingResult = await client.ping();
    if (pingResult === 'PONG') {
      console.log('Redis connection: OK');
      console.log('Redis PING: PONG');
    } else {
      console.error(`Unexpected Redis PING response: ${pingResult}`);
      process.exit(1);
    }
  } catch (err: any) {
    console.error(`Redis connection failed: ${err.message}`);
    process.exit(1);
  }

  console.log('----------------------------------------------------');
  console.log('Testing BullMQ Queue and Worker on Upstash...');

  const testQueueName = 'orion-upstash-test-queue';
  const testQueue = new Queue(testQueueName, {
    connection: client.duplicate(),
  });

  let workerProcessed = false;

  const testWorker = new Worker(
    testQueueName,
    async (job) => {
      if (job.name === 'upstash-connectivity-test' && job.data?.check === 'ok') {
        workerProcessed = true;
        return { status: 'processed', time: Date.now() };
      }
      throw new Error('Invalid test job payload');
    },
    {
      connection: client.duplicate(),
      concurrency: 1,
    },
  );

  await testWorker.waitUntilReady();
  console.log('BullMQ worker: READY');

  const testJob = await testQueue.add(
    'upstash-connectivity-test',
    { check: 'ok', sentAt: Date.now() },
    { removeOnComplete: true, removeOnFail: true },
  );
  console.log(`BullMQ test job enqueued (ID: ${testJob.id})`);

  // Wait for worker to process
  const startTime = Date.now();
  while (!workerProcessed && Date.now() - startTime < 15000) {
    await new Promise((res) => setTimeout(res, 250));
  }

  if (!workerProcessed) {
    console.error('BullMQ test job processing timed out after 15 seconds.');
    await testWorker.close();
    await testQueue.close();
    await client.quit();
    process.exit(1);
  }

  console.log('BullMQ test job processed by worker: SUCCESS');
  console.log('Cleaning test resources...');

  try {
    await testJob.remove().catch(() => {});
    await testQueue.drain().catch(() => {});
    await testWorker.close();
    await testQueue.close();
    await client.quit();
  } catch (err: any) {
    console.warn(`Cleanup notice: ${err.message}`);
  }

  console.log('BullMQ test cleanup: COMPLETE');
  console.log('====================================================');
  console.log('ALL REDIS & BULLMQ VERIFICATIONS PASSED SUCCESSFULLY');
  console.log('====================================================');
}

runVerification().catch((err) => {
  console.error('Verification error:', err.message);
  process.exit(1);
});

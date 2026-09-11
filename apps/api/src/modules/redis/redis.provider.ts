import { Provider, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

export const redisProviders: Provider[] = [
  {
    provide: REDIS_CLIENT,
    inject: [ConfigService],
    useFactory: (configService: ConfigService): Redis => {
      const logger = new Logger('RedisProvider');
      const host = configService.get<string>('redis.host', 'localhost');
      const port = configService.get<number>('redis.port', 6379);
      const password = configService.get<string | undefined>('redis.password');
      const db = configService.get<number>('redis.db', 0);
      const tls = configService.get<boolean>('redis.tls', false);

      const client = new Redis({
        host,
        port,
        password: password || undefined,
        db,
        tls: tls ? {} : undefined,
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        retryStrategy: (times: number) => {
          const delay = Math.min(times * 200, 3000);
          logger.warn(`Redis connection retry attempt ${times} in ${delay}ms...`);
          return delay;
        },
        reconnectOnError: (err) => {
          logger.error(`Redis reconnectOnError: ${err.message}`);
          return true;
        },
      });

      client.on('connect', () => {
        logger.log(`Connected to Redis at ${host}:${port}/${db}`);
      });

      client.on('error', (err) => {
        logger.error(`Redis Client Error: ${err.message}`, err.stack);
      });

      return client;
    },
  },
];

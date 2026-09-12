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
      const url = configService.get<string | undefined>('redis.url');
      const host = configService.get<string>('redis.host', 'localhost');
      const port = configService.get<number>('redis.port', 6379);
      const password = configService.get<string | undefined>('redis.password');
      const db = configService.get<number>('redis.db', 0);
      const tls = configService.get<boolean>('redis.tls', false);

      const commonOptions = {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        retryStrategy: (times: number) => {
          const delay = Math.min(times * 200, 3000);
          logger.warn(`Redis connection retry attempt ${times} in ${delay}ms...`);
          return delay;
        },
        reconnectOnError: (err: Error) => {
          logger.error(`Redis reconnectOnError: ${err.message}`);
          return true;
        },
      };

      let client: Redis;
      let sanitizedTarget: string;

      if (url && url.trim().length > 0) {
        client = new Redis(url.trim(), {
          ...commonOptions,
        });
        try {
          const parsed = new URL(url.trim());
          sanitizedTarget = `${parsed.hostname}:${parsed.port || 6379} (TLS: ${parsed.protocol === 'rediss:'})`;
        } catch {
          sanitizedTarget = '[via REDIS_URL]';
        }
      } else {
        client = new Redis({
          host,
          port,
          password: password || undefined,
          db,
          tls: tls ? {} : undefined,
          ...commonOptions,
        });
        sanitizedTarget = `${host}:${port}/${db} (TLS: ${tls})`;
      }

      client.on('connect', () => {
        logger.log(`Connected to Redis at ${sanitizedTarget}`);
      });

      client.on('error', (err) => {
        logger.error(`Redis Client Error: ${err.message}`, err.stack);
      });

      return client;
    },
  },
];

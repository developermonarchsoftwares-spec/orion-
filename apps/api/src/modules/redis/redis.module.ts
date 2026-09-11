import { Global, Module } from '@nestjs/common';
import { redisProviders } from './redis.provider';
import { RedisService } from './redis.service';
import { REDIS_CLIENT } from './redis.constants';

@Global()
@Module({
  providers: [...redisProviders, RedisService],
  exports: [REDIS_CLIENT, RedisService],
})
export class RedisModule {}

import { Global, Module } from '@nestjs/common';
import { databaseProviders } from './database.provider';
import { DatabaseService } from './database.service';
import { TransactionService } from './transaction.service';
import { DRIZZLE_DATABASE, PG_POOL } from './database.constants';

@Global()
@Module({
  providers: [...databaseProviders, DatabaseService, TransactionService],
  exports: [DRIZZLE_DATABASE, PG_POOL, DatabaseService, TransactionService],
})
export class DatabaseModule {}

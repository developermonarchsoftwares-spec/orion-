import { Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE } from './database.constants';
import { DrizzleDb } from './database.provider';

export type TransactionCallback<T> = (tx: Parameters<Parameters<DrizzleDb['transaction']>[0]>[0]) => Promise<T>;

@Injectable()
export class TransactionService {
  private readonly logger = new Logger(TransactionService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
  ) {}

  /**
   * Runs a callback within a managed PostgreSQL database transaction.
   * Automatically rolls back on exception and commits upon successful resolution.
   */
  async runInTransaction<T>(callback: TransactionCallback<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      try {
        return await callback(tx);
      } catch (error) {
        this.logger.error('Transaction rollback triggered due to error', error);
        throw error;
      }
    });
  }
}

import { Inject, Injectable, OnApplicationShutdown, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DATABASE, PG_POOL } from './database.constants';
import { DrizzleDb } from './database.provider';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private closed = false;
  private readonly logger = new Logger(DatabaseService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE)
    public readonly db: DrizzleDb,
    @Inject(PG_POOL)
    private readonly pool: Pool,
  ) {}

  /**
   * Health check query executing SELECT 1
   */
  async ping(): Promise<boolean> {
    try {
      const result = await this.db.execute(sql`SELECT 1 as ping`);
      return result.rowCount !== null && result.rowCount > 0;
    } catch (error) {
      this.logger.error('Database ping failed', error);
      return false;
    }
  }

  /**
   * Gracefully close the pool on application shutdown. This runs in the shutdown phase, which Nest starts only after every
   * module's onModuleDestroy has finished, so schedulers and workers stopped there can no longer be using the pool. Closed once.
   */
  async onApplicationShutdown() {
    if (this.closed) return;
    this.closed = true;
    this.logger.log('Closing PostgreSQL connection pool...');
    await this.pool.end();
    this.logger.log('PostgreSQL connection pool closed.');
  }
}

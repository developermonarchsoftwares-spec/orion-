import { Inject, Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DATABASE, PG_POOL } from './database.constants';
import { DrizzleDb } from './database.provider';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
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
   * Gracefully close pool on application shutdown
   */
  async onModuleDestroy() {
    this.logger.log('Closing PostgreSQL connection pool...');
    await this.pool.end();
    this.logger.log('PostgreSQL connection pool closed.');
  }
}

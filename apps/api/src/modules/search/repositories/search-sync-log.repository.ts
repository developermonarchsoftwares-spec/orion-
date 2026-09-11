import { Inject, Injectable } from '@nestjs/common';
import { eq, desc } from 'drizzle-orm';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';

@Injectable()
export class SearchSyncLogRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
  ) {}

  async logSyncAttempt(data: typeof schema.searchSyncLogs.$inferInsert) {
    const [created] = await this.db.insert(schema.searchSyncLogs).values(data).returning();
    return created;
  }

  async updateStatus(
    id: string,
    status: typeof schema.searchSyncStatusEnum.enumValues[number],
    errorMessage?: string,
  ) {
    const [updated] = await this.db
      .update(schema.searchSyncLogs)
      .set({
        status,
        errorMessage,
        syncedAt: status === 'SYNCED' ? new Date() : undefined,
      })
      .where(eq(schema.searchSyncLogs.id, id))
      .returning();
    return updated;
  }

  async findFailedLogs(limit = 50) {
    return this.db.query.searchSyncLogs.findMany({
      where: eq(schema.searchSyncLogs.status, 'FAILED'),
      orderBy: desc(schema.searchSyncLogs.createdAt),
      limit,
    });
  }
}

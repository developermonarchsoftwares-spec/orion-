import { Inject, Injectable } from '@nestjs/common';
import { eq, desc } from 'drizzle-orm';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';

@Injectable()
export class BusinessMetricsRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
  ) {}

  async findByBusinessId(businessId: string) {
    return this.db.query.businessMetrics.findFirst({
      where: eq(schema.businessMetrics.businessId, businessId),
    });
  }

  async upsert(data: typeof schema.businessMetrics.$inferInsert) {
    const existing = await this.findByBusinessId(data.businessId);
    if (existing) {
      const [updated] = await this.db
        .update(schema.businessMetrics)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(schema.businessMetrics.businessId, data.businessId))
        .returning();
      return updated;
    }

    const [created] = await this.db.insert(schema.businessMetrics).values(data).returning();
    return created;
  }
}

@Injectable()
export class BusinessScoreRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
  ) {}

  async findByBusinessId(businessId: string) {
    return this.db.query.businessScores.findFirst({
      where: eq(schema.businessScores.businessId, businessId),
    });
  }

  async upsert(data: typeof schema.businessScores.$inferInsert) {
    const existing = await this.findByBusinessId(data.businessId);
    if (existing) {
      const [updated] = await this.db
        .update(schema.businessScores)
        .set({ ...data, calculatedAt: new Date() })
        .where(eq(schema.businessScores.businessId, data.businessId))
        .returning();
      return updated;
    }

    const [created] = await this.db.insert(schema.businessScores).values(data).returning();
    return created;
  }
}

@Injectable()
export class BusinessHistoryRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
  ) {}

  async findByBusinessId(businessId: string, limit = 50) {
    return this.db.query.businessHistory.findMany({
      where: eq(schema.businessHistory.businessId, businessId),
      orderBy: desc(schema.businessHistory.changedAt),
      limit,
    });
  }

  async create(data: typeof schema.businessHistory.$inferInsert) {
    const [created] = await this.db.insert(schema.businessHistory).values(data).returning();
    return created;
  }
}

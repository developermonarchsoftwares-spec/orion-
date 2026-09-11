import { Inject, Injectable } from '@nestjs/common';
import { eq, and, desc, sql } from 'drizzle-orm';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';
import { BaseRepository } from '../../common/repositories/base.repository';

@Injectable()
export class UnlockRepository extends BaseRepository<typeof schema.leadUnlocks> {
  constructor(
    @Inject(DRIZZLE_DATABASE)
    db: DrizzleDb,
  ) {
    super(db, schema.leadUnlocks);
  }

  async findUnlock(userId: string, businessId: string) {
    const rows = await this.db
      .select()
      .from(schema.leadUnlocks)
      .where(
        and(
          eq(schema.leadUnlocks.userId, userId),
          eq(schema.leadUnlocks.businessId, businessId),
        ),
      )
      .limit(1);

    return rows[0] || null;
  }

  async getUserUnlocks(userId: string, page = 1, limit = 20) {
    const offset = (page - 1) * limit;

    const [totalRows, rows] = await Promise.all([
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.leadUnlocks)
        .where(eq(schema.leadUnlocks.userId, userId)),
      this.db
        .select()
        .from(schema.leadUnlocks)
        .where(eq(schema.leadUnlocks.userId, userId))
        .orderBy(desc(schema.leadUnlocks.unlockedAt))
        .limit(limit)
        .offset(offset),
    ]);

    const total = totalRows[0]?.count || 0;
    const totalPages = Math.ceil(total / limit) || 1;

    return {
      items: rows,
      pagination: {
        page,
        limit,
        totalItems: total,
        totalPages,
      },
    };
  }
}

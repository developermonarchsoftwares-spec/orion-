import { Inject, Injectable } from '@nestjs/common';
import { eq, and, sql, desc, inArray } from 'drizzle-orm';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';
import { BaseRepository } from '../../common/repositories/base.repository';

@Injectable()
export class SavedLeadsRepository extends BaseRepository<typeof schema.savedLeads> {
  constructor(
    @Inject(DRIZZLE_DATABASE)
    db: DrizzleDb,
  ) {
    super(db, schema.savedLeads);
  }

  async findByUserAndBusiness(userId: string, businessId: string) {
    const rows = await this.db
      .select()
      .from(schema.savedLeads)
      .where(
        and(
          eq(schema.savedLeads.userId, userId),
          eq(schema.savedLeads.businessId, businessId),
        ),
      )
      .limit(1);

    return rows[0] || null;
  }

  async deleteByUserAndBusiness(userId: string, businessId: string) {
    const result = await this.db
      .delete(schema.savedLeads)
      .where(
        and(
          eq(schema.savedLeads.userId, userId),
          eq(schema.savedLeads.businessId, businessId),
        ),
      );

    return (result.rowCount ?? 0) > 0;
  }

  async bulkDelete(userId: string, ids: string[]) {
    if (ids.length === 0) return 0;
    const result = await this.db
      .delete(schema.savedLeads)
      .where(
        and(
          eq(schema.savedLeads.userId, userId),
          inArray(schema.savedLeads.id, ids),
        ),
      );

    return result.rowCount ?? 0;
  }
}

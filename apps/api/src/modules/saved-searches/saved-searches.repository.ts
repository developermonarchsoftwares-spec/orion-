import { Inject, Injectable } from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';
import { BaseRepository } from '../../common/repositories/base.repository';

@Injectable()
export class SavedSearchesRepository extends BaseRepository<typeof schema.savedSearches> {
  constructor(
    @Inject(DRIZZLE_DATABASE)
    db: DrizzleDb,
  ) {
    super(db, schema.savedSearches);
  }

  async findByUser(userId: string) {
    return this.db
      .select()
      .from(schema.savedSearches)
      .where(eq(schema.savedSearches.userId, userId))
      .orderBy(desc(schema.savedSearches.createdAt));
  }
}

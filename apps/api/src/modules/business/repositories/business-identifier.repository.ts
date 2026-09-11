import { Inject, Injectable } from '@nestjs/common';
import { eq, and, inArray } from 'drizzle-orm';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { IdentifierType } from '@orion/shared';

@Injectable()
export class BusinessIdentifierRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
  ) {}

  async findByTypeAndValue(type: IdentifierType, normalizedValue: string) {
    return this.db.query.businessIdentifiers.findFirst({
      where: and(
         
        eq(schema.businessIdentifiers.type, type as any),
        eq(schema.businessIdentifiers.normalizedValue, normalizedValue),
      ),
      with: { business: true },
    });
  }

  async findByBusinessId(businessId: string) {
    return this.db.query.businessIdentifiers.findMany({
      where: eq(schema.businessIdentifiers.businessId, businessId),
    });
  }

  async findMatchesByValues(identifiers: Array<{ type: IdentifierType; normalizedValue: string }>) {
    if (identifiers.length === 0) return [];
    const normalizedValues = identifiers.map((i) => i.normalizedValue);

    return this.db.query.businessIdentifiers.findMany({
      where: inArray(schema.businessIdentifiers.normalizedValue, normalizedValues),
      with: { business: true },
    });
  }

  async create(data: typeof schema.businessIdentifiers.$inferInsert) {
    const [created] = await this.db.insert(schema.businessIdentifiers).values(data).returning();
    return created;
  }

  async createMany(data: Array<typeof schema.businessIdentifiers.$inferInsert>) {
    if (data.length === 0) return [];
    return this.db.insert(schema.businessIdentifiers).values(data).returning();
  }
}

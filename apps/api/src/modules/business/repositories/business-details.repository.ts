import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';

@Injectable()
export class BusinessLocationRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
  ) {}

  async findByBusinessId(businessId: string) {
    return this.db.query.businessLocations.findMany({
      where: eq(schema.businessLocations.businessId, businessId),
    });
  }

  async findPrimaryLocation(businessId: string) {
    return this.db.query.businessLocations.findFirst({
      where: eq(schema.businessLocations.businessId, businessId),
    });
  }

  async create(data: typeof schema.businessLocations.$inferInsert) {
    const [created] = await this.db.insert(schema.businessLocations).values(data).returning();
    return created;
  }

  async createMany(data: Array<typeof schema.businessLocations.$inferInsert>) {
    if (data.length === 0) return [];
    return this.db.insert(schema.businessLocations).values(data).returning();
  }
}

@Injectable()
export class BusinessContactRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
  ) {}

  async findByBusinessId(businessId: string) {
    return this.db.query.businessContacts.findMany({
      where: eq(schema.businessContacts.businessId, businessId),
    });
  }

  async create(data: typeof schema.businessContacts.$inferInsert) {
    const [created] = await this.db.insert(schema.businessContacts).values(data).returning();
    return created;
  }

  async createMany(data: Array<typeof schema.businessContacts.$inferInsert>) {
    if (data.length === 0) return [];
    return this.db.insert(schema.businessContacts).values(data).returning();
  }
}

@Injectable()
export class DigitalPresenceRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
  ) {}

  async findByBusinessId(businessId: string) {
    return this.db.query.digitalPresences.findMany({
      where: eq(schema.digitalPresences.businessId, businessId),
    });
  }

  async findByDomain(domain: string) {
    return this.db.query.digitalPresences.findFirst({
      where: eq(schema.digitalPresences.domain, domain.toLowerCase()),
      with: { business: true },
    });
  }

  async create(data: typeof schema.digitalPresences.$inferInsert) {
    const [created] = await this.db.insert(schema.digitalPresences).values(data).returning();
    return created;
  }

  async createMany(data: Array<typeof schema.digitalPresences.$inferInsert>) {
    if (data.length === 0) return [];
    return this.db.insert(schema.digitalPresences).values(data).returning();
  }
}

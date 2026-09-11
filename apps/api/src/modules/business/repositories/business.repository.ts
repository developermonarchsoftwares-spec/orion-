import { Inject, Injectable } from '@nestjs/common';
import { eq, and, sql, desc, SQL } from 'drizzle-orm';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { BaseRepository } from '../../../common/repositories/base.repository';

@Injectable()
export class BusinessRepository extends BaseRepository<typeof schema.businesses> {
  constructor(
    @Inject(DRIZZLE_DATABASE)
    db: DrizzleDb,
  ) {
    super(db, schema.businesses);
  }

  async findBySlug(slug: string) {
    return this.db.query.businesses.findFirst({
      where: eq(schema.businesses.slug, slug),
      with: {
        industry: true,
        category: true,
        businessTypeRef: true,
        msmeCategoryRef: true,
      },
    });
  }

  async findFullBusinessProfile(id: string) {
    const business = await this.db.query.businesses.findFirst({
      where: eq(schema.businesses.id, id),
      with: {
        industry: true,
        category: true,
        businessTypeRef: true,
        msmeCategoryRef: true,
      },
    });

    if (!business) return null;

    const [locations, contacts, digitalPresences, identifiers, metrics, scores] =
      await Promise.all([
        this.db.query.businessLocations.findMany({
          where: eq(schema.businessLocations.businessId, id),
        }),
        this.db.query.businessContacts.findMany({
          where: eq(schema.businessContacts.businessId, id),
        }),
        this.db.query.digitalPresences.findMany({
          where: eq(schema.digitalPresences.businessId, id),
        }),
        this.db.query.businessIdentifiers.findMany({
          where: eq(schema.businessIdentifiers.businessId, id),
        }),
        this.db.query.businessMetrics.findFirst({
          where: eq(schema.businessMetrics.businessId, id),
        }),
        this.db.query.businessScores.findFirst({
          where: eq(schema.businessScores.businessId, id),
        }),
      ]);

    return {
      ...business,
      locations,
      contacts,
      digitalPresences,
      identifiers,
      metrics,
      scores,
    };
  }

  async findForSearchIndex(id: string) {
    return this.findFullBusinessProfile(id);
  }

  async updateStatus(id: string, status: typeof schema.businessStatusEnum.enumValues[number]) {
    const [updated] = await this.db
      .update(schema.businesses)
      .set({
        status,
        publishedAt: status === 'PUBLISHED' ? new Date() : undefined,
        updatedAt: new Date(),
      })
      .where(eq(schema.businesses.id, id))
      .returning();

    return updated;
  }
}

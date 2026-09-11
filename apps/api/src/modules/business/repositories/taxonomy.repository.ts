import { Inject, Injectable } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';

@Injectable()
export class TaxonomyRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
  ) {}

  async findIndustryByCode(code: string) {
    return this.db.query.industries.findFirst({
      where: eq(schema.industries.code, code.toUpperCase()),
    });
  }

  async findCategoryBySlug(slug: string) {
    return this.db.query.categories.findFirst({
      where: eq(schema.categories.slug, slug.toLowerCase()),
    });
  }

  async findBusinessTypeByCode(code: string) {
    return this.db.query.businessTypes.findFirst({
      where: eq(schema.businessTypes.code, code.toUpperCase()),
    });
  }

  async findMsmeCategoryByCode(code: string) {
    return this.db.query.msmeCategories.findFirst({
      where: eq(schema.msmeCategories.code, code.toUpperCase()),
    });
  }

  async getAllIndustries() {
    return this.db.query.industries.findMany({
      where: eq(schema.industries.isActive, true),
      with: { categories: true },
    });
  }
}

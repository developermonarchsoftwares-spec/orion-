import { Inject, Injectable } from '@nestjs/common';
import { eq, and, sql, desc, inArray } from 'drizzle-orm';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import type { IPeopleIngestionSummary } from '../people/import-people.types';

@Injectable()
export class ImportBatchRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
  ) {}

  async findById(id: string) {
    return this.db.query.importBatches.findFirst({
      where: eq(schema.importBatches.id, id),
      with: { source: true },
    });
  }

  async create(data: typeof schema.importBatches.$inferInsert) {
    const [created] = await this.db.insert(schema.importBatches).values(data).returning();
    return created;
  }

  async updateStats(
    id: string,
    stats: {
      processedRecords?: number;
      successfulRecords?: number;
      failedRecords?: number;
      duplicateRecords?: number;
      status?: typeof schema.importStatusEnum.enumValues[number];
      errorMessage?: string;
      completedAt?: Date;
    },
  ) {
    const [updated] = await this.db
      .update(schema.importBatches)
      .set({ ...stats, updatedAt: new Date() })
      .where(eq(schema.importBatches.id, id))
      .returning();
    return updated;
  }

  /**
   * Adds one record's People-stage counts to the batch summary in a single atomic statement
   * (no read-modify-write), so concurrent record processing cannot lose updates.
   */
  async addPeopleSummary(id: string, d: IPeopleIngestionSummary) {
    const add = (key: keyof IPeopleIngestionSummary) =>
      sql`COALESCE((${schema.importBatches.peopleSummary}->>${key})::int, 0) + ${d[key]}`;
    await this.db
      .update(schema.importBatches)
      .set({
        peopleSummary: sql`jsonb_build_object(
          'received', ${add('received')}, 'accepted', ${add('accepted')}, 'created', ${add('created')},
          'updated', ${add('updated')}, 'unchanged', ${add('unchanged')}, 'quarantined', ${add('quarantined')},
          'rejected', ${add('rejected')}, 'errors', ${add('errors')})`,
        updatedAt: new Date(),
      })
      .where(eq(schema.importBatches.id, id));
  }

  /** Sets the People summary only when none exists yet (never overwrites counts written by the People stage). */
  async setPeopleSummary(id: string, summary: IPeopleIngestionSummary) {
    await this.db
      .update(schema.importBatches)
      .set({ peopleSummary: summary, updatedAt: new Date() })
      .where(and(eq(schema.importBatches.id, id), sql`${schema.importBatches.peopleSummary} IS NULL`));
  }

  /** Number of stored records and how many reached PUBLISHED, for the post-import integrity check. */
  async recordTotals(batchId: string): Promise<{ total: number; published: number }> {
    const r = schema.importRecords;
    const [row] = await this.db
      .select({ total: sql<number>`count(*)::int`, published: sql<number>`count(*) FILTER (WHERE ${r.status} = 'PUBLISHED')::int` })
      .from(r)
      .where(eq(r.batchId, batchId));
    return { total: row?.total ?? 0, published: row?.published ?? 0 };
  }

  async findAll(limit = 50, offset = 0) {
    return this.db.query.importBatches.findMany({
      orderBy: [desc(schema.importBatches.createdAt)],
      limit,
      offset,
      with: { source: true },
    });
  }
}

@Injectable()
export class ImportRecordRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
  ) {}

  async findById(id: string) {
    return this.db.query.importRecords.findFirst({
      where: eq(schema.importRecords.id, id),
      with: { batch: true, validationLogs: true },
    });
  }

  async findByBatchId(batchId: string, limit = 100, offset = 0) {
    return this.db.query.importRecords.findMany({
      where: eq(schema.importRecords.batchId, batchId),
      limit,
      offset,
    });
  }

  async create(data: typeof schema.importRecords.$inferInsert) {
    const [created] = await this.db.insert(schema.importRecords).values(data).returning();
    return created;
  }

  async createMany(data: Array<typeof schema.importRecords.$inferInsert>) {
    if (data.length === 0) return [];
    return this.db.insert(schema.importRecords).values(data).returning();
  }

  async setPeopleResult(id: string, result: object) {
    await this.db
      .update(schema.importRecords)
      .set({ peopleResult: result })
      .where(eq(schema.importRecords.id, id));
  }

  async updateStatus(
    id: string,
    status: typeof schema.importRecordStatusEnum.enumValues[number],
    normalizedPayload?: Record<string, unknown>,
    errorDetails?: Record<string, unknown>,
  ) {
    const [updated] = await this.db
      .update(schema.importRecords)
      .set({
        status,
        normalizedPayload,
        errorDetails,
        updatedAt: new Date(),
      })
      .where(eq(schema.importRecords.id, id))
      .returning();
    return updated;
  }
}

@Injectable()
export class ValidationLogRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
  ) {}

  async create(data: typeof schema.validationLogs.$inferInsert) {
    const [created] = await this.db.insert(schema.validationLogs).values(data).returning();
    return created;
  }

  async createMany(data: Array<typeof schema.validationLogs.$inferInsert>) {
    if (data.length === 0) return [];
    return this.db.insert(schema.validationLogs).values(data).returning();
  }

  async findByRecordId(recordId: string) {
    return this.db.query.validationLogs.findMany({
      where: eq(schema.validationLogs.recordId, recordId),
    });
  }
}

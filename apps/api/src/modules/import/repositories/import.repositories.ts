import { Inject, Injectable } from '@nestjs/common';
import { eq, and, sql, desc, inArray } from 'drizzle-orm';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';

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

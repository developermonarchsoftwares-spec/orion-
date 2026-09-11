import { Inject, Injectable } from '@nestjs/common';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';

@Injectable()
export class DuplicateRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
  ) {}

  async createCluster(data: typeof schema.duplicateClusters.$inferInsert) {
    const [created] = await this.db.insert(schema.duplicateClusters).values(data).returning();
    return created;
  }

  async createCandidates(data: Array<typeof schema.duplicateCandidates.$inferInsert>) {
    if (data.length === 0) return [];
    return this.db.insert(schema.duplicateCandidates).values(data).returning();
  }

  async findClusterById(id: string) {
    return this.db.query.duplicateClusters.findFirst({
      where: eq(schema.duplicateClusters.id, id),
      with: {
        candidates: {
          with: { matchedBusiness: true, record: true },
        },
        primaryBusiness: true,
      },
    });
  }
}

@Injectable()
export class ReviewQueueRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
  ) {}

  async enqueue(data: typeof schema.reviewQueue.$inferInsert) {
    const [created] = await this.db.insert(schema.reviewQueue).values(data).returning();
    return created;
  }

  async findPending(limit = 50) {
    return this.db.query.reviewQueue.findMany({
      where: eq(schema.reviewQueue.status, 'PENDING'),
      orderBy: desc(schema.reviewQueue.priority),
      limit,
      with: { record: true, cluster: true },
    });
  }

  async updateDecision(
    id: string,
    decision: typeof schema.reviewActionEnum.enumValues[number],
    reviewerId: string,
    notes?: string,
    editedPayload?: Record<string, unknown>,
  ) {
    const [updated] = await this.db
      .update(schema.reviewQueue)
      .set({
        decision,
        status: decision,
        reviewerId,
        reviewNotes: notes,
        editedPayload,
        reviewedAt: new Date(),
      })
      .where(eq(schema.reviewQueue.id, id))
      .returning();
    return updated;
  }
}

@Injectable()
export class PublishQueueRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
  ) {}

  async enqueue(data: typeof schema.publishQueue.$inferInsert) {
    const [created] = await this.db.insert(schema.publishQueue).values(data).returning();
    return created;
  }

  async findPendingToPublish(limit = 100) {
    return this.db.query.publishQueue.findMany({
      where: eq(schema.publishQueue.status, 'PENDING'),
      limit,
      with: { record: true },
    });
  }

  async updateStatus(
    id: string,
    status: 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'FAILED',
    targetBusinessId?: string,
    errorMessage?: string,
  ) {
    const [updated] = await this.db
      .update(schema.publishQueue)
      .set({
        status,
        targetBusinessId,
        errorMessage,
        publishedAt: status === 'PUBLISHED' ? new Date() : undefined,
      })
      .where(eq(schema.publishQueue.id, id))
      .returning();
    return updated;
  }
}
